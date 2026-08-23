const express = require('express');
const router = express.Router();
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

// Connect queue producer to Redis
const connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
});

const downloadQueue = new Queue('creative-downloads', { connection });

/**
 * Helper to select the target URL based on priority:
 * 1. Instagram
 * 2. TikTok
 */
function selectPriorityUrl(body) {
    const { instagram_url, tiktok_url, url, urls } = body;

    // Direct field priority check
    if (instagram_url && instagram_url.includes('instagram.com')) {
        return instagram_url.trim();
    }
    if (tiktok_url && tiktok_url.includes('tiktok.com')) {
        return tiktok_url.trim();
    }

    // Array of URLs check
    if (Array.isArray(urls) && urls.length > 0) {
        const igUrl = urls.find(u => typeof u === 'string' && u.includes('instagram.com'));
        if (igUrl) return igUrl.trim();

        const ttUrl = urls.find(u => typeof u === 'string' && u.includes('tiktok.com'));
        if (ttUrl) return ttUrl.trim();
    }

    // Single string containing one or multiple URLs
    if (typeof url === 'string') {
        const extractedUrls = url.match(/https?:\/\/[^\s]+/g) || [url];
        const igUrl = extractedUrls.find(u => u.includes('instagram.com'));
        if (igUrl) return igUrl.trim();

        const ttUrl = extractedUrls.find(u => u.includes('tiktok.com'));
        if (ttUrl) return ttUrl.trim();

        return url.trim();
    }

    return null;
}

// POST: Add creative download to background queue
router.post('/upload', async (req, res) => {
    const selectedUrl = selectPriorityUrl(req.body);

    if (!selectedUrl) {
        return res.status(400).json({ 
            error: 'A valid Instagram or TikTok URL is required.' 
        });
    }

    const platform = selectedUrl.includes('instagram.com') ? 'instagram' : 'tiktok';
    const fileName = `creative_${platform}_${Date.now()}.mp4`;

    try {
        const job = await downloadQueue.add('download-media', {
            mediaUrl: selectedUrl,
            outputFileName: fileName,
            platform: platform
        });

        return res.status(200).json({
            message: `Queued download (${platform} selected by priority)`,
            jobId: job.id,
            fileName: fileName,
            targetUrl: selectedUrl
        });
    } catch (error) {
        console.error('Queue error:', error);
        return res.status(500).json({ error: 'Failed to queue download task.' });
    }
});

// GET: Check job processing status
router.get('/status/:jobId', async (req, res) => {
    try {
        const job = await downloadQueue.getJob(req.params.jobId);
        if (!job) {
            return res.status(404).json({ error: 'Job not found.' });
        }

        const state = await job.getState();
        const result = job.returnvalue;

        return res.status(200).json({
            id: job.id,
            state,
            result: result || null,
        });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to retrieve job status.' });
    }
});

module.exports = router;
