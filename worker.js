/**
 * worker.js — background creative processor
 *
 * Does everything /api/add-creative used to do inline, minus the initial row
 * insert (which stays in the route so the creative appears immediately):
 *
 *   1. resolve a CDN link via RapidAPI
 *   2. stream the mp4 to a temp file
 *   3. upload to Gemini, wait for processing
 *   4. ask for hook + four segments + duration
 *   5. write the analysis back to `creatives`
 *
 * Runs two ways, same code:
 *   - in-process, started from server.js (default — no extra Render service)
 *   - standalone, `node worker.js`, when you want a dedicated service
 *
 * At ~17 videos a day the in-process worker is free and sufficient. Splitting
 * it out later is a start command, not a rewrite.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { query } = require('./db');
const { notifySuccess, notifyFailure } = require('./notify');

// Gemini model. Google retires these on their own schedule — 2.5-flash was
// pulled for new users — so it is an env var, changeable without a deploy.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST
  || 'instagram-tiktok-youtube-downloader.p.rapidapi.com';

const PROMPT = `Watch this video carefully. Extract the following:
1. "hook": A 1-2 sentence description of the opening hook.
2. "seg1": (0-25%) Describe the setting, who appears, what action or message is shown.
3. "seg2": (25-50%) Describe how the narrative develops.
4. "seg3": (50-75%) Describe the core message or product moment.
5. "seg4": (75-100%) Describe the closing and call to action.
6. "duration": The exact length of the video in seconds (number).
Always return all four segments. If the video is too short to divide, describe the same footage from four angles rather than omitting keys — the dashboard labels segments by position, so a missing key mislabels the rest.
Keep each to 2-3 sentences. Return only a JSON object with keys: "hook", "seg1", "seg2", "seg3", "seg4", "duration". No markdown, no extra text.`;

// ── Step 1: CDN link ──────────────────────────────────────────────────────────
async function resolveMediaUrl(mediaUrl) {
  if (!process.env.RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY is not set.');

  const { data } = await axios.request({
    method: 'GET',
    url: `https://${RAPIDAPI_HOST}/fetch`,
    params: { url: mediaUrl },
    headers: {
      'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
      'X-RapidAPI-Host': RAPIDAPI_HOST,
    },
    timeout: 60000,
  });

  // The API returns HTTP 200 with ok:false on failure, so the status code
  // alone is not enough to tell success from failure.
  if (!data || data.ok === false) {
    throw new Error(`API rejected the link: ${(data && (data.error || data.message)) || 'unknown reason'}`);
  }
  if (!data.download_url) throw new Error('API returned no download_url.');
  return data;
}

// ── Step 2: download ──────────────────────────────────────────────────────────
async function streamToFile(url, destPath) {
  // CDN links are signed and short-lived, and Instagram's fbcdn rejects
  // requests without a browser-ish user agent.
  const res = await axios({
    url, method: 'GET', responseType: 'stream',
    timeout: 180000, maxRedirects: 5,
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' },
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', err => {
      try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) {}
      reject(err);
    });
  });

  const { size } = fs.statSync(destPath);
  if (size < 10240) {
    fs.unlinkSync(destPath);
    throw new Error('Downloaded file was too small to be a video.');
  }
  return destPath;
}

// ── Steps 3-4: Gemini ─────────────────────────────────────────────────────────
async function analyseVideo(ai, videoPath) {
  const geminiFile = await ai.files.upload({ file: videoPath, mimeType: 'video/mp4' });
  try {
    let state = await ai.files.get({ name: geminiFile.name });
    const deadline = Date.now() + 5 * 60 * 1000;
    while (state.state === 'PROCESSING') {
      if (Date.now() > deadline) throw new Error('Gemini processing timed out after 5 minutes.');
      await new Promise(r => setTimeout(r, 3000));
      state = await ai.files.get({ name: geminiFile.name });
    }
    if (state.state === 'FAILED') throw new Error('Gemini processing failed.');

    const result = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [
        { fileData: { fileUri: geminiFile.uri, mimeType: 'video/mp4' } },
        { text: PROMPT },
      ]}],
      config: { responseMimeType: 'application/json', maxOutputTokens: 2000 },
    });
    return JSON.parse(result.text.replace(/```json|```/g, '').trim());
  } finally {
    try { await ai.files.delete({ name: geminiFile.name }); } catch (e) {}
  }
}

// ── The job ───────────────────────────────────────────────────────────────────
function makeProcessor(ai) {
  return async function processJob(job) {
    const d = job.data;
    const { mediaUrl, creativeId, platform } = d;
    let videoPath = null;

    try {
      await job.updateProgress({ step: 'resolving', pct: 10 });
      const meta = await resolveMediaUrl(mediaUrl);

      await job.updateProgress({ step: 'downloading', pct: 30 });
      videoPath = path.join(os.tmpdir(), `creative_${job.id}.mp4`);
      await streamToFile(meta.download_url, videoPath);

      await job.updateProgress({ step: 'analysing', pct: 60 });
      const a = await analyseVideo(ai, videoPath);

      // A partial analysis is not worth storing — the dashboard labels
      // segments by position, so a missing one mislabels the rest.
      const missing = ['hook', 'seg1', 'seg2', 'seg3', 'seg4']
        .filter(k => !a[k] || !String(a[k]).trim());
      if (missing.length) {
        throw new Error(`Analysis incomplete — missing ${missing.join(', ')}.`);
      }

      // Gemini estimates duration by watching, and that drives the retention
      // denominator. Anything outside 1-600s is a bad read, not a long video.
      // The API's own duration wins when it gives one: TikTok does, Instagram
      // returns null.
      const apiDur = typeof meta.duration === 'number' ? meta.duration : null;
      const aiDur = parseFloat(a.duration);
      const guess = apiDur !== null ? apiDur : (Number.isFinite(aiDur) ? aiDur : null);
      const safeDur = guess !== null && guess >= 1 && guess <= 600 ? guess : null;

      // Insert the complete row only now. Nothing reaches the database
      // without descriptions, so a failed job leaves no half-creative behind.
      await job.updateProgress({ step: 'saving', pct: 90 });
      await query(
        `insert into creatives
           (creative_id, brand_id, date, campaign, type, is_repurposed,
            original_creative_id, content_type, ig_link, fb_link, tt_link,
            content_hook, seg1, seg2, seg3, seg4, duration_s)
         values ($1,$2,coalesce($3::date, current_date),$4,$5,$6,$7,'Video',
                 $8,$9,$10,$11,$12,$13,$14,$15,$16)
         on conflict (creative_id) do update set
           content_hook = excluded.content_hook,
           seg1 = excluded.seg1, seg2 = excluded.seg2,
           seg3 = excluded.seg3, seg4 = excluded.seg4,
           duration_s = coalesce(excluded.duration_s, creatives.duration_s)`,
        [creativeId, d.brand, d.date, d.campaign, d.type, d.repurposed,
         d.originalId, d.ig, d.fb, d.tt,
         a.hook, a.seg1, a.seg2, a.seg3, a.seg4, safeDur]
      );

      console.log(`[worker] ${creativeId}: analysed ${platform} (${safeDur === null ? '?' : safeDur}s) and added`);

      notifySuccess({
        creativeId, brand: d.brand, campaign: d.campaign, platform,
        duration: safeDur, hook: a.hook, addedBy: d.addedBy,
      }).catch(e => console.error('[worker] notify:', e.message));
      return {
        status: 'completed', creativeId, platform,
        hook: a.hook || null,
        segments: [a.seg1, a.seg2, a.seg3, a.seg4],
        duration: safeDur,
        caption: meta.caption || '',
        thumbnail: meta.thumbnail_url || '',
      };
    } finally {
      // Temp file only — nothing is served from disk, so there is no reason to
      // keep it, and Render's filesystem is ephemeral anyway.
      if (videoPath && fs.existsSync(videoPath)) {
        try { fs.unlinkSync(videoPath); } catch (e) {}
      }
    }
  };
}

// ── Start ─────────────────────────────────────────────────────────────────────
function startWorker(ai) {
  if (!process.env.REDIS_URL) {
    console.log('[worker] REDIS_URL not set — worker not started.');
    return null;
  }
  if (!ai) {
    console.warn('[worker] No Gemini client available — jobs will fail at the analysis step.');
  }

  const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on('error', e => console.error('[worker] redis:', e.message));

  const worker = new Worker('creative-downloads', makeProcessor(ai), {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY || 2),
  });

  worker.on('failed', (job, err) => {
    if (!job) return;
    const attempts = job.opts && job.opts.attempts ? job.opts.attempts : 1;
    console.error(`[worker] job ${job.id} failed (attempt ${job.attemptsMade}/${attempts}): ${err.message}`);
    // Only notify once the retries are exhausted — otherwise a transient
    // rate-limit sends three emails for one creative.
    if (job.attemptsMade >= attempts) {
      notifyFailure({
        creativeId: job.data.creativeId, brand: job.data.brand,
        campaign: job.data.campaign, link: job.data.mediaUrl,
        error: err.message, attempts,
      }).catch(e => console.error('[worker] notify:', e.message));
    }
  });
  worker.on('completed', job => console.log(`[worker] job ${job.id} completed`));

  console.log('[worker] active and listening for background download tasks');
  return worker;
}

module.exports = { startWorker };

// Standalone mode: node worker.js
if (require.main === module) {
  const { GoogleGenAI } = require('@google/genai');
  const ai = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;
  startWorker(ai);
}
