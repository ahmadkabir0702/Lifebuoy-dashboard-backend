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

    // The API signals failure with ok:false and still returns HTTP 200, so
    // checking the status code alone is not enough.
    if (!data || data.ok === false) {
        throw new Error(`API rejected ${mediaUrl}: ${data && (data.error || data.message) || 'unknown reason'}`);
    }
    if (!data.download_url) {
        throw new Error(`No download_url returned for ${mediaUrl}`);
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

    // CDN links are signed and short-lived (the x-expires param), so fetch now.
    // Instagram's CDN rejects requests without a browser-ish user agent.
    const videoStream = await axios({
        url: rawVideoUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: 180000,
        maxRedirects: 5,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        },
    });

    videoStream.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => {
            console.log(`[Job ${job.id}] Successfully saved: ${outputFileName}`);
            // Instagram returns duration: null while TikTok returns seconds, so
            // treat duration as optional downstream rather than assuming a number.
            resolve({
                status: 'completed',
                fileName: outputFileName,
                filePath: destinationPath,
                platform,
                creativeId: job.data.creativeId || null,
                sourceId: data.id || null,
                caption: data.caption || '',
                thumbnail: data.thumbnail_url || '',
                duration: typeof data.duration === 'number' ? data.duration : null,
                width: data.width || null,
                height: data.height || null,
            });
        });
        writer.on('error', err => {
            try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch (e) {}
            reject(err);
        });
    });
}, {
    connection,
    concurrency: 2,
    // NOTE: `attempts` and `backoff` are JOB options, not Worker options.
    // They are set when the job is added (see media-queue.js), not here.
});

worker.on('failed', (job, err) => {
    console.error(`[Job ${job?.id}] Failed: ${err.message}`);
});
