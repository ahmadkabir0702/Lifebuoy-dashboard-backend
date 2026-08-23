const express = require('express');
const router = express.Router();
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

// Initialize the queue connection to Render's Redis
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const downloadQueue = new Queue('creative-downloads', { connection });

router.post('/upload', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    const fileName = `creative_${Date.now()}.mp4`;

    try {
        // Instantly drop the job into the queue and return a success response
        const job = await downloadQueue.add('download-media', {
            mediaUrl: url,
            outputFileName: fileName,
        });

        return res.status(200).json({
            message: 'Creative download queued successfully',
            jobId: job.id,
            fileName: fileName,
        });
    } catch (error) {
        console.error('Queue error:', error);
        return res.status(500).json({ error: 'Failed to queue download' });
    }
});

module.exports = router;
