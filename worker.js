const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
});

console.log('Creative worker active and listening for background download tasks...');

const worker = new Worker('creative-downloads', async (job) => {
    const { mediaUrl, outputFileName, platform } = job.data;
    console.log(`[Job ${job.id}] Processing ${platform} download for: ${mediaUrl}`);

    // 1. Fetch raw CDN URL from RapidAPI (works for both Instagram & TikTok)
    const options = {
        method: 'GET',
        url: 'https://instagram-tiktok-youtube-downloader.p.rapidapi.com/fetch',
        params: { url: mediaUrl },
        headers: {
            'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
            'X-RapidAPI-Host': 'instagram-tiktok-youtube-downloader.p.rapidapi.com',
        },
    };

    const apiResponse = await axios.request(options);
    const data = apiResponse.data;

    if (!data || !data.download_url) {
        throw new Error(`RapidAPI failed to return a download_url for ${mediaUrl}`);
    }

    const rawVideoUrl = data.download_url;

    // 2. Ensure public/uploads directory exists
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // 3. Stream .mp4 file to disk
    const destinationPath = path.join(uploadsDir, outputFileName);
    const writer = fs.createWriteStream(destinationPath);

    const videoStream = await axios({
        url: rawVideoUrl,
        method: 'GET',
        responseType: 'stream',
    });

    videoStream.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => {
            console.log(`[Job ${job.id}] Successfully saved: ${outputFileName}`);
            resolve({
                status: 'completed',
                fileName: outputFileName,
                platform: platform,
                caption: data.caption || '',
                thumbnail: data.thumbnail_url || '',
                duration: data.duration || null,
            });
        });
        writer.on('error', reject);
    });
}, {
    connection,
    concurrency: 2,
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
});

worker.on('failed', (job, err) => {
    console.error(`[Job ${job?.id}] Failed: ${err.message}`);
});
