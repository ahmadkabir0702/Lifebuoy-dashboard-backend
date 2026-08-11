// =====================================================================
//  routes.js — Postgres-backed API for Campaign Lens
//
//  Replaces the Google Sheets endpoints in server.js. Mount with:
//      require('./routes')(app, { ai, youtubedl });
//
//  BRAND SCOPING: Express connects with a role that bypasses RLS, so
//  every data query is scoped in code. Each handler resolves the brand
//  through assertBrandAllowed() before touching data. Adding a new
//  endpoint without that call leaks another client's data.
// =====================================================================
const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { query, brandsForUser, assertBrandAllowed } = require('./db');

module.exports = function mountRoutes(app, deps = {}) {
  const { ai, youtubedl } = deps;

  // Resolve which brand this request is for: explicit ?brand=, else the
  // session's active brand, else their first allowed brand.
  function resolveBrand(req) {
    const requested = req.query.brand || req.body?.brand_id || req.session.activeBrand;
    const brand = requested || (req.session.brands || [])[0];
    return assertBrandAllowed(req.session, brand);
  }

  // -------------------------------------------------------------------
  //  LOGIN — reads app_users instead of USER_* environment variables
  // -------------------------------------------------------------------
  app.post('/login', async (req, res) => {
    const username = (req.body.username || '').trim();
    const password = (req.body.password || '').trim();

    try {
      const { rows } = await query(
        `select password_hash from app_users
          where username = $1 and is_active = true`,
        [username]
      );

      // Compare even when the user is missing, so a wrong username and a
      // wrong password take the same time and cannot be told apart.
      const hash = rows.length ? rows[0].password_hash
                               : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
      const ok = await bcrypt.compare(password, hash);
      if (!rows.length || !ok) return res.redirect('/login?error=1');

      const access = await brandsForUser(username);
      if (!access || !access.brands.length) {
        console.warn(`[login] ${username} authenticated but has no brands assigned`);
        return res.redirect('/login?error=2');
      }

      req.session.user = username;
      req.session.brands = access.brands;
      req.session.isInternal = access.isInternal;
      req.session.activeBrand = access.brands[0];
      req.session.save(err => {
        if (err) { console.error('[login] session save:', err); return res.redirect('/login?error=1'); }
        res.redirect('/');
      });
    } catch (err) {
      console.error('[login] failed:', err.message);
      res.redirect('/login?error=1');
    }
  });

  // -------------------------------------------------------------------
  //  Which brands can this user see, and which is active
  // -------------------------------------------------------------------
app.get('/api/brands', async (req, res) => {
    try {
      const [b, a] = await Promise.all([
        query(`select brand_id, name from brands
                where brand_id = any($1) and is_active = true order by name`,
              [req.session.brands || []]),
        query(`select agency_id, name from agencies
                where is_active = true order by name`)
      ]);
      const u = await query(
        `select display_name from app_users where username = $1`,
        [req.session.user]
      );
      res.json({
        brands: b.rows,
        active: req.session.activeBrand,
        isInternal: !!req.session.isInternal,
        agencies: a.rows,
        user: { username: req.session.user,
                displayName: u.rows[0]?.display_name || req.session.user }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/switch-brand', (req, res) => {
    try {
      const brand = assertBrandAllowed(req.session, req.body.brand_id);
      req.session.activeBrand = brand;
      req.session.save(() => res.json({ success: true, active: brand }));
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------
  //  DASHBOARD DATA — same 11-array shape the frontend already parses
  // -------------------------------------------------------------------
  const { buildPayload } = require('./creatives');

  app.get('/api/dashboard-data', async (req, res) => {
    try {
      const brand = resolveBrand(req);
      res.json(await buildPayload(brand));
    } catch (err) {
      console.error('[dashboard-data]', err.message);
      res.status(err.message.startsWith('Access denied') ? 403 : 500)
         .json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------
  //  ADD CREATIVE — writes to `creatives`, then Gemini fills the rest
  // -------------------------------------------------------------------
 app.post('/api/add-creative', async (req, res) => {
    const { campaign, type, date, ig, fb, tt, repurposed, originalId } = req.body;
    let brand;
    try { brand = resolveBrand(req); }
    catch (err) { return res.status(403).json({ error: err.message }); }

    if (!['Brand Say', 'Others Say'].includes(type)) {
      return res.status(400).json({ error: 'Invalid Type selected.' });
    }
    if (!campaign) return res.status(400).json({ error: 'Campaign is required.' });

    // The creative_id is typed by hand into ad names after the pipe, so
    // it has to be short. Brand + type + a 6-char base36 stamp.
    const typeCode = type === 'Brand Say' ? 'BS' : 'OS';
    const stamp = Date.now().toString(36).slice(-6).toUpperCase();
    const creativeId = `${brand.toUpperCase()}_${typeCode}_${stamp}`;

    let videoPath = null, geminiFile = null;

    try {
      await query(
        `insert into creatives
           (creative_id, brand_id, date, campaign, type, is_repurposed,
            original_creative_id, content_type, ig_link, fb_link, tt_link)
         values ($1,$2,coalesce($3::date, current_date),$4,$5,$6,$7,'Video',$8,$9,$10)`,
        [creativeId, brand, date || null, campaign, type, repurposed === 'Yes',
         originalId || null, ig || null, fb || null, tt || null]
      );

      const videoLink = ig || tt || fb;
      if (!videoLink) return res.json({ success: true, creativeId, aiPending: false });
      if (!ai || !youtubedl) return res.json({ success: true, creativeId, aiPending: false });

      videoPath = path.join(os.tmpdir(), `temp_video_${Date.now()}.mp4`);
      await youtubedl(videoLink, {
        output: videoPath,
        format: 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
        mergeOutputFormat: 'mp4',
        noWarnings: true,
        noCheckCertificates: true,
        addHeader: [
          'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
          'accept-language:en-US,en;q=0.9'
        ]
      });

      geminiFile = await ai.files.upload({ file: videoPath, mimeType: 'video/mp4' });
      let state = await ai.files.get({ name: geminiFile.name });
      while (state.state === 'PROCESSING') {
        await new Promise(r => setTimeout(r, 3000));
        state = await ai.files.get({ name: geminiFile.name });
      }
      if (state.state === 'FAILED') throw new Error('Gemini processing failed.');

      const prompt = `Watch this video carefully. Extract the following:
1. "hook": A 1-2 sentence description of the opening hook.
2. "seg1": (0-25%) Describe the setting, who appears, what action or message is shown.
3. "seg2": (25-50%) Describe how the narrative develops.
4. "seg3": (50-75%) Describe the core message or product moment.
5. "seg4": (75-100%) Describe the closing and call to action.
6. "duration": The exact length of the video in seconds (number).
Always return all four segments. If the video is too short to divide, describe the same footage from four angles rather than omitting keys — the dashboard labels segments by position, so a missing key mislabels the rest.
Keep each to 2-3 sentences. Return only a JSON object with keys: "hook", "seg1", "seg2", "seg3", "seg4", "duration". No markdown, no extra text.`;

      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [
          { fileData: { fileUri: geminiFile.uri, mimeType: 'video/mp4' } },
          { text: prompt }
        ]}],
        config: { responseMimeType: 'application/json', maxOutputTokens: 2000 }
      });

      const a = JSON.parse(result.text.replace(/```json|```/g, '').trim());
      const dur = parseFloat(a.duration);
      // Gemini estimates duration by watching, which drives the retention
      // denominator. Anything outside 1-600s is a bad read, not a long video.
      const safeDur = Number.isFinite(dur) && dur >= 1 && dur <= 600 ? dur : null;

      await query(
        `update creatives
            set content_hook = $2, seg1 = $3, seg2 = $4, seg3 = $5, seg4 = $6,
                duration_s = $7
          where creative_id = $1`,
        [creativeId, a.hook || null, a.seg1 || null, a.seg2 || null,
         a.seg3 || null, a.seg4 || null, safeDur]
      );

      res.json({
        success: true, creativeId, aiPending: true,
        analysis: {
          hook: a.hook || null,
          segments: [a.seg1, a.seg2, a.seg3, a.seg4],
          duration: safeDur
        }
      });
    } catch (err) {
      console.error('[add-creative]', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message, creativeId, aiPending: false });
      }
    } finally {
      if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (geminiFile) { try { await ai.files.delete({ name: geminiFile.name }); } catch (e) {} }
    }
  });

  // Re-run the analysis on a creative that already exists. Used when the
  // first attempt failed — the row is already saved, only the
  // descriptions are missing.
  app.post('/api/regenerate-description', async (req, res) => {
    let brand;
    try { brand = resolveBrand(req); }
    catch (err) { return res.status(403).json({ error: err.message }); }

    const { creative_id } = req.body;
    if (!creative_id) return res.status(400).json({ error: 'creative_id is required' });
    if (!ai || !youtubedl) return res.status(503).json({ error: 'Video analysis is not configured on this server.' });

    let videoPath = null, geminiFile = null;
    try {
      const { rows } = await query(
        `select ig_link, fb_link, tt_link from creatives
          where creative_id = $1 and brand_id = $2`,
        [creative_id, brand]
      );
      if (!rows.length) return res.status(404).json({ error: 'Creative not found for this brand' });

      const videoLink = rows[0].ig_link || rows[0].tt_link || rows[0].fb_link;
      if (!videoLink) return res.status(400).json({ error: 'This creative has no video link to analyse.' });

      videoPath = path.join(os.tmpdir(), `regen_${Date.now()}.mp4`);
        await youtubedl(videoLink, {
        output: videoPath,
        format: 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
        mergeOutputFormat: 'mp4',
        noWarnings: true,
        noCheckCertificates: true,
        addHeader: [
          'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
          'accept-language:en-US,en;q=0.9'
        ]
      });

      geminiFile = await ai.files.upload({ file: videoPath, mimeType: 'video/mp4' });
      let state = await ai.files.get({ name: geminiFile.name });
      while (state.state === 'PROCESSING') {
        await new Promise(r => setTimeout(r, 3000));
        state = await ai.files.get({ name: geminiFile.name });
      }
      if (state.state === 'FAILED') throw new Error('Gemini processing failed.');

      const prompt = `Watch this video carefully. Extract the following:
1. "hook": A 1-2 sentence description of the opening hook.
2. "seg1": (0-25%) Describe the setting, who appears, what action or message is shown.
3. "seg2": (25-50%) Describe how the narrative develops.
4. "seg3": (50-75%) Describe the core message or product moment.
5. "seg4": (75-100%) Describe the closing and call to action.
6. "duration": The exact length of the video in seconds (number).
Always return all four segments. If the video is too short to divide, describe the same footage from four angles rather than omitting keys.
Keep each to 2-3 sentences. Return only a JSON object with keys: "hook", "seg1", "seg2", "seg3", "seg4", "duration". No markdown, no extra text.`;

      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [
          { fileData: { fileUri: geminiFile.uri, mimeType: 'video/mp4' } },
          { text: prompt }
        ]}],
        config: { responseMimeType: 'application/json', maxOutputTokens: 2000 }
      });

      const a = JSON.parse(result.text.replace(/```json|```/g, '').trim());
      const dur = parseFloat(a.duration);
      const safeDur = Number.isFinite(dur) && dur >= 1 && dur <= 600 ? dur : null;

      await query(
        `update creatives
            set content_hook = $2, seg1 = $3, seg2 = $4, seg3 = $5, seg4 = $6,
                duration_s = coalesce($7, duration_s)
          where creative_id = $1`,
        [creative_id, a.hook || null, a.seg1 || null, a.seg2 || null,
         a.seg3 || null, a.seg4 || null, safeDur]
      );

      res.json({
        success: true, creativeId: creative_id,
        analysis: { hook: a.hook || null,
                    segments: [a.seg1, a.seg2, a.seg3, a.seg4],
                    duration: safeDur }
      });
    } catch (err) {
      console.error('[regenerate-description]', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (geminiFile) { try { await ai.files.delete({ name: geminiFile.name }); } catch (e) {} }
    }
  });

  // -------------------------------------------------------------------
  //  UPDATE ACTION — writes to `recommendations`
  //  The old endpoint took Sheets A1 ranges. This takes fields.
  // -------------------------------------------------------------------
  app.post('/api/update-action', async (req, res) => {
    try {
      const brand = resolveBrand(req);
      const { creative_id, platform, action_status, actioned_by, action_date, agency } = req.body;

      if (!creative_id) return res.status(400).json({ error: 'creative_id is required' });
      if (!['meta', 'tiktok'].includes(platform)) {
        return res.status(400).json({ error: "platform must be 'meta' or 'tiktok'" });
      }

      // Confirm the creative belongs to a brand this user may touch.
      const { rows } = await query(
        `select 1 from creatives where creative_id = $1 and brand_id = $2`,
        [creative_id, brand]
      );
      if (!rows.length) return res.status(404).json({ error: 'Creative not found for this brand' });

      await query(
        `insert into recommendations
           (creative_id, platform, action_status, actioned_by, action_date, agency, updated_at)
         values ($1,$2,$3,$4,$5,$6, now())
         on conflict (creative_id, platform) do update set
           action_status = excluded.action_status,
           actioned_by   = excluded.actioned_by,
           action_date   = excluded.action_date,
           agency        = excluded.agency,
           updated_at    = now()`,
        [creative_id, platform, action_status || null, actioned_by || null,
         action_date || null, agency || null]
      );

      res.json({ success: true });
    } catch (err) {
      console.error('[update-action]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------
  //  OTHERS SAY STATS — manual entry. No sheet to type into any more,
  //  so this is the only way these numbers get in.
  // -------------------------------------------------------------------
  app.get('/api/others-say-pending', async (req, res) => {
    try {
      const brand = resolveBrand(req);
      const { rows } = await query(
        `select c.creative_id, c.campaign, c.creator_profile, c.duration_s,
                c.ig_link, c.fb_link, c.tt_link,
                coalesce(
                  json_agg(json_build_object(
                    'platform', o.platform, 'views', o.views, 'likes', o.likes,
                    'comments', o.comments, 'shares', o.shares, 'saves', o.saves,
                    'avg_watch_time', o.avg_watch_time
                  ) order by o.platform) filter (where o.platform is not null),
                  '[]'
                ) as stats
           from creatives c
           left join organic_perf o on o.creative_id = c.creative_id
          where c.brand_id = $1 and c.type = 'Others Say'
          group by c.creative_id, c.campaign, c.creator_profile, c.duration_s,
                   c.ig_link, c.fb_link, c.tt_link
          order by c.date desc nulls last`,
        [brand]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/others-say-stats', async (req, res) => {
    try {
      const brand = resolveBrand(req);
      const { creative_id, platform, views, likes, comments, shares, saves, avg_watch_time } = req.body;

      if (!['ig', 'fb', 'tt'].includes(platform)) {
        return res.status(400).json({ error: "platform must be 'ig', 'fb' or 'tt'" });
      }

      const { rows } = await query(
        `select duration_s from creatives
          where creative_id = $1 and brand_id = $2 and type = 'Others Say'`,
        [creative_id, brand]
      );
      if (!rows.length) return res.status(404).json({ error: 'Others Say creative not found for this brand' });

      const num = v => (v === '' || v === null || v === undefined ? null : Number(v));
      const watch = num(avg_watch_time);

      // Guard the commonest hand-entry mistake: milliseconds pasted from
      // an API export instead of seconds off Business Suite. The database
      // CHECK also blocks it, but a clear message here beats a 500.
      const dur = rows[0].duration_s;
      if (watch !== null && dur && watch > dur * 5) {
        return res.status(400).json({
          error: `Average watch time of ${watch}s is implausible for a ${dur}s video. Enter SECONDS, not milliseconds.`
        });
      }

      const l = num(likes) || 0, c = num(comments) || 0,
            s = num(shares) || 0, sv = num(saves) || 0;

      await query(
        `insert into organic_perf
           (creative_id, platform, views, likes, comments, shares, saves,
            total_interactions, avg_watch_time)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (creative_id, platform) do update set
           views = excluded.views, likes = excluded.likes,
           comments = excluded.comments, shares = excluded.shares,
           saves = excluded.saves,
           total_interactions = excluded.total_interactions,
           avg_watch_time = excluded.avg_watch_time`,
        [creative_id, platform, num(views), l, c, s, sv, l + c + s + sv, watch]
      );

      res.json({ success: true });
    } catch (err) {
      console.error('[others-say-stats]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------
  //  TEMPORARY manual-upload tool. Takes a raw MP4 body, runs it through
  //  the same Gemini Files-API flow as add-creative, and returns the
  //  descriptions without touching the database. Backs upload-test.html.
  //  Session-protected via the global requireAuth (path is under /api/).
  //  Safe to delete this route + the HTML page when no longer needed.
  // -------------------------------------------------------------------
  app.post('/api/describe-upload',
    express.raw({ type: () => true, limit: '200mb' }),
    async (req, res) => {
      if (!ai) return res.status(500).json({ error: 'Gemini is not configured (GEMINI_API_KEY missing).' });
      if (!req.body || !req.body.length) return res.status(400).json({ error: 'No file received.' });

      let videoPath = null, geminiFile = null;
      try {
        videoPath = path.join(os.tmpdir(), `upload_${Date.now()}.mp4`);
        fs.writeFileSync(videoPath, req.body);

        geminiFile = await ai.files.upload({ file: videoPath, mimeType: 'video/mp4' });
        let state = await ai.files.get({ name: geminiFile.name });
        while (state.state === 'PROCESSING') {
          await new Promise(r => setTimeout(r, 3000));
          state = await ai.files.get({ name: geminiFile.name });
        }
        if (state.state === 'FAILED') throw new Error('Gemini processing failed.');

        const prompt = `Watch this video carefully and describe it in consecutive 2.5-second windows.

Rules:
- Start at 0s and step in exact 2.5-second windows (0–2.5, 2.5–5.0, 5.0–7.5, …) until the very end of the video. The final window may be shorter than 2.5s if the clip does not divide evenly — clamp its "end" to the true video length.
- Cover the ENTIRE video. Do not skip time. Do not merge windows. A 60-second video must produce 24 windows.
- For each window write 1-2 specific sentences: what is on screen (people, product, setting, colours), any on-screen text spoken word-for-word if legible, actions, and audio/tone.

Return ONLY a JSON object with these keys, no markdown, no extra text:
{
  "duration": <total length in seconds, number>,
  "segments": [
    { "start": <number>, "end": <number>, "desc": "<string>" }
  ]
}`;

        const result = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [
            { fileData: { fileUri: geminiFile.uri, mimeType: 'video/mp4' } },
            { text: prompt }
          ]}],
          config: { responseMimeType: 'application/json', maxOutputTokens: 8000 }
        });

        const a = JSON.parse(result.text.replace(/```json|```/g, '').trim());
        res.json({ success: true, analysis: a });
      } catch (err) {
        console.error('[describe-upload]', err.message);
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      } finally {
        if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        if (geminiFile) { try { await ai.files.delete({ name: geminiFile.name }); } catch (e) {} }
      }
    });

  // -------------------------------------------------------------------
  //  Health check. Doubles as the free-tier keep-alive target.
  // -------------------------------------------------------------------
  app.get('/api/health', async (req, res) => {
    try {
      await query('select 1');
      res.json({ ok: true });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });
};
