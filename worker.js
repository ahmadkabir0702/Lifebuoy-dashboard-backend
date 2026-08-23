/**
 * worker.js — background creative processor
 *
 * Does everything /api/add-creative used to do inline, minus the initial row
 * insert (which stays in the route so the creative appears immediately):
 *
 *   1. resolve a CDN link via RapidAPI
 *   2. stream the mp4 to a temp file
 *   3. upload to Gemini, wait for processing
 *   4. ask for hook + a fixed-interval timeline + duration
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

// Cost levers, all env-tunable so they can be tried without a deploy.
//   GEMINI_THINKING_BUDGET  thinking tokens bill at OUTPUT rates. Describing
//                           what is on screen needs little reasoning, so a low
//                           budget is cheaper and faster. -1 = model default,
//                           0 = off where the model allows it.
//   GEMINI_MEDIA_RESOLUTION video input is ~60% of the cost. 'low' cuts it
//                           substantially; the trade is small on-screen text.
const THINKING_BUDGET = process.env.GEMINI_THINKING_BUDGET === undefined
  ? null : Number(process.env.GEMINI_THINKING_BUDGET);
const MEDIA_RESOLUTION = process.env.GEMINI_MEDIA_RESOLUTION || null;

const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST
  || 'instagram-tiktok-youtube-downloader.p.rapidapi.com';

// Segment granularity. Fixed intervals, not scene changes: retention data is
// time-indexed, so to say "hold rate collapses at 6s and here is what was on
// screen at 6s" the descriptions have to sit on the same time grid.
const SEG_SECONDS = Number(process.env.SEGMENT_SECONDS || 2);
const MAX_SEGMENTS = Number(process.env.MAX_SEGMENTS || 60);

// Structured output. responseMimeType alone asks for JSON without saying what
// shape; a schema constrains it, which is what stops the model returning an
// object where an array is expected or renaming keys.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    duration: { type: 'number' },
    hook: { type: 'string' },
    timeline: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          t: { type: 'number' },
          d: { type: 'string' },
        },
        required: ['t', 'd'],
      },
    },
  },
  required: ['duration', 'hook', 'timeline'],
  propertyOrdering: ['duration', 'hook', 'timeline'],
};

function buildPrompt(hintDuration) {
  const dur = hintDuration && hintDuration > 0 ? hintDuration : null;
  const n = dur ? Math.min(Math.ceil(dur / SEG_SECONDS), MAX_SEGMENTS) : null;

  return `Watch this video carefully and describe it on a fixed time grid.

Return ONE JSON object with these keys:

"duration": the exact length of the video in seconds (number).

"hook": 1-2 sentences describing the opening hook — what grabs attention in the first two seconds.

"timeline": an array of ${n ? `exactly ${n}` : ''} objects, one per ${SEG_SECONDS}-second window, covering the whole video from 0 to the end with no gaps. Each object:
  { "t": <window start in seconds, a multiple of ${SEG_SECONDS}>,
    "d": "<one sentence, present tense, describing what is on screen and what is said or heard in that window>" }
Cover EVERY window in order. Do NOT merge, skip or group windows — a window where little happens still gets its own entry saying so. ${n ? `The array must contain ${n} entries: t = 0, ${SEG_SECONDS}, ${SEG_SECONDS * 2}, and so on up to ${(n - 1) * SEG_SECONDS}.` : ''} If a window is visually similar to the one before, say what changed rather than repeating the text. Name what matters for performance: who is on screen, what they do, on-screen text, product visibility, scene cuts, and audio or voiceover.

Return only the JSON object. No markdown, no commentary.`;
}

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
async function analyseVideo(ai, videoPath, hintDuration) {
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
        {
          fileData: { fileUri: geminiFile.uri, mimeType: 'video/mp4' },
          ...(MEDIA_RESOLUTION
            ? { videoMetadata: { mediaResolution: `MEDIA_RESOLUTION_${MEDIA_RESOLUTION.toUpperCase()}` } }
            : {}),
        },
        { text: buildPrompt(hintDuration) },
      ]}],
      // A 90s video at 2s granularity is ~45 timeline entries plus the four
      // quartile segments, and thinking tokens count toward this ceiling.
      config: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: 16000,
        ...(THINKING_BUDGET !== null && Number.isFinite(THINKING_BUDGET)
          ? { thinkingConfig: { thinkingBudget: THINKING_BUDGET } }
          : {}),
      },
    });
    // Log real token usage. Thinking tokens bill at output rates and are the
    // hardest part of the cost to predict, so measure rather than estimate.
    const u = result.usageMetadata || {};
    const inTok = u.promptTokenCount || 0;
    const outTok = u.candidatesTokenCount || 0;
    const think = u.thoughtsTokenCount || 0;
    if (inTok || outTok) {
      const IN_RATE = Number(process.env.GEMINI_IN_RATE || 0.75) / 1e6;
      const OUT_RATE = Number(process.env.GEMINI_OUT_RATE || 3.75) / 1e6;
      const cost = inTok * IN_RATE + (outTok + think) * OUT_RATE;
      console.log(`[gemini] model=${GEMINI_MODEL} in=${inTok} out=${outTok} thinking=${think} ` +
                  `total=${u.totalTokenCount || inTok + outTok + think} cost=$${cost.toFixed(4)}`);
    }

    return JSON.parse(result.text.replace(/```json|```/g, '').trim());
  } finally {
    try { await ai.files.delete({ name: geminiFile.name }); } catch (e) {}
  }
}

/**
 * Models drift on shape: t may come back as "0", "0s" or "00:04", and windows
 * can arrive out of order or duplicated. Normalise to { t: <number>, d: <string> }
 * sorted and de-duplicated, so anything reading this can trust the grid.
 */
function normaliseTimeline(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];

  for (const item of raw) {
    if (!item) continue;
    const d = String(item.d || item.desc || item.description || '').trim();
    if (!d) continue;

    let t = item.t !== undefined ? item.t : (item.start !== undefined ? item.start : item.time);
    if (typeof t === 'string') {
      const mmss = t.match(/^(\d+):(\d+(?:\.\d+)?)$/);
      t = mmss ? Number(mmss[1]) * 60 + Number(mmss[2]) : parseFloat(t.replace(/[^\d.]/g, ''));
    }
    t = Number(t);
    if (!Number.isFinite(t) || t < 0) continue;

    t = Math.round(t * 10) / 10;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push({ t, d });
  }

  out.sort((x, y) => x.t - y.t);
  return out.slice(0, MAX_SEGMENTS);
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
      const a = await analyseVideo(ai, videoPath, typeof meta.duration === 'number' ? meta.duration : null);

      // A partial analysis is not worth storing — the dashboard labels
      // segments by position, so a missing one mislabels the rest.
      if (!a.hook || !String(a.hook).trim()) {
        throw new Error('Analysis incomplete — no hook returned.');
      }

      const timeline = normaliseTimeline(a.timeline);
      if (!timeline.length) {
        throw new Error('Analysis incomplete — no timeline returned.');
      }

      // Models save output tokens by grouping windows ("0:14-0:30: she keeps
      // talking"). That returns valid JSON with a sparse timeline, which would
      // otherwise be stored as if complete. Check coverage against duration
      // and fail the job so the retry gets another go.
      const durForCheck = (typeof meta.duration === 'number' && meta.duration > 0)
        ? meta.duration
        : (Number.isFinite(parseFloat(a.duration)) ? parseFloat(a.duration) : null);

      if (durForCheck) {
        const expected = Math.min(Math.ceil(durForCheck / SEG_SECONDS), MAX_SEGMENTS);
        // 70%: allows a window or two of slack at the tail without accepting
        // a timeline that has clearly been collapsed.
        if (timeline.length < Math.floor(expected * 0.7)) {
          throw new Error(
            `Timeline too sparse — got ${timeline.length} windows for ${durForCheck.toFixed(0)}s, ` +
            `expected about ${expected}. The model grouped intervals.`
          );
        }
        const lastCovered = timeline[timeline.length - 1].t + SEG_SECONDS;
        if (lastCovered < durForCheck * 0.8) {
          throw new Error(
            `Timeline stops at ${lastCovered.toFixed(0)}s of ${durForCheck.toFixed(0)}s — incomplete coverage.`
          );
        }
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
            content_hook, duration_s, segments)
         values ($1,$2,coalesce($3::date, current_date),$4,$5,$6,$7,'Video',
                 $8,$9,$10,$11,$12,$13)
         on conflict (creative_id) do update set
           content_hook = excluded.content_hook,
           duration_s = coalesce(excluded.duration_s, creatives.duration_s),
           segments = excluded.segments`,
        [creativeId, d.brand, d.date, d.campaign, d.type, d.repurposed,
         d.originalId, d.ig, d.fb, d.tt,
         a.hook, safeDur, JSON.stringify(timeline)]
      );

      console.log(`[worker] ${creativeId}: analysed ${platform} (${safeDur === null ? '?' : safeDur}s, ${timeline.length} segments) and added`);

      notifySuccess({
        creativeId, brand: d.brand, campaign: d.campaign, platform,
        duration: safeDur, hook: a.hook, addedBy: d.addedBy,
      }).catch(e => console.error('[worker] notify:', e.message));
      return {
        status: 'completed', creativeId, platform,
        hook: a.hook || null,
        timelineCount: timeline.length,
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

module.exports = { startWorker, buildPrompt, normaliseTimeline };

// Standalone mode: node worker.js
if (require.main === module) {
  const { GoogleGenAI } = require('@google/genai');
  const ai = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;
  startWorker(ai);
}
