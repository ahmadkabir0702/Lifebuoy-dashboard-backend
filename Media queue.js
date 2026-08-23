/**
 * media-queue.js — background video download queue (BullMQ + Redis)
 *
 * This was previously written into creatives.js, which overwrote the module
 * that builds the dashboard payload. It lives in its own file now.
 *
 * Mounting is opt-in: without REDIS_URL the routes are not registered at all,
 * so the app boots normally on a machine with no Redis.
 */
const express = require('express');

function mountMediaQueue(app) {
  if (!process.env.REDIS_URL) {
    console.log('[media-queue] REDIS_URL not set — queue routes disabled.');
    return null;
  }

  const { Queue } = require('bullmq');
  const IORedis = require('ioredis');

  const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on('error', e => console.error('[media-queue] redis:', e.message));

  const downloadQueue = new Queue('creative-downloads', { connection });
  const router = express.Router();

  // Instagram first, then TikTok — matches add-creative's existing priority.
  function selectPriorityUrl(body = {}) {
    const { ig_link, tt_link, instagram_url, tiktok_url } = body;
    const ig = ig_link || instagram_url;
    const tt = tt_link || tiktok_url;
    if (ig && ig.includes('instagram.com')) return ig.trim();
    if (tt && tt.includes('tiktok.com')) return tt.trim();
    return null;
  }

  router.post('/upload', async (req, res) => {
    const selectedUrl = selectPriorityUrl(req.body);
    const creativeId = req.body.creative_id || null;
    if (!selectedUrl) {
      return res.status(400).json({ error: 'A valid Instagram or TikTok URL is required.' });
    }
    const platform = selectedUrl.includes('instagram.com') ? 'instagram' : 'tiktok';

    try {
      const job = await downloadQueue.add(
        'download-media',
        { mediaUrl: selectedUrl, creativeId, platform,
          outputFileName: `creative_${platform}_${Date.now()}.mp4` },
        // Retry options belong on the job, not on the Worker.
        { attempts: 3, backoff: { type: 'exponential', delay: 10000 },
          removeOnComplete: 100, removeOnFail: 500 }
      );
      return res.status(202).json({ jobId: job.id, platform, queued: true });
    } catch (error) {
      console.error('[media-queue] enqueue failed:', error.message);
      return res.status(500).json({ error: 'Failed to queue download task.' });
    }
  });

  router.get('/status/:jobId', async (req, res) => {
    try {
      const job = await downloadQueue.getJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Job not found.' });
      return res.json({
        id: job.id,
        state: await job.getState(),
        result: job.returnvalue || null,
        failedReason: job.failedReason || null,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to retrieve job status.' });
    }
  });

  app.use('/api/media', router);
  console.log('[media-queue] mounted at /api/media');
  return downloadQueue;
}

module.exports = { mountMediaQueue };
