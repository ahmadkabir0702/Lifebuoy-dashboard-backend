const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { ApifyClient } = require('apify-client');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

console.log('Creative background worker active and listening for jobs...');

const worker = new Worker('creative-downloads', async job => {
    const { mediaUrl, outputFileName } = job.data;
    console.log(`Processing download for: ${mediaUrl}`);

    let rawVideoUrl = null;

    if (mediaUrl.includes('instagram.com')) {
        const run = await apifyClient.actor('apify/instagram-scraper').call({
            directUrls: [mediaUrl],
            resultsType: 'details',
            searchType: 'hashtag',
        });
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        if (items.length > 0 && items[0].videoUrl) rawVideoUrl = items[0].videoUrl;
        
    } else if (mediaUrl.includes('tiktok.com')) {
        const run = await apifyClient.actor('scrape-creators/best-tiktok-scraper').call({
            'video URLs': [mediaUrl],
            resultsPerPage: 1,
        });
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        if (items.length > 0) rawVideoUrl = items[0].videoUrl;
    }

    if (!rawVideoUrl) throw new Error('Could not resolve raw CDN video link from Apify.');

    const destinationPath = path.join(__dirname, 'public', outputFileName);
    const writer = fs.createWriteStream(destinationPath);

    const response = await axios({
        url: rawVideoUrl,
        method: 'GET',
        responseType: 'stream',
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve({ status: 'completed', file: outputFileName }));
        writer.on('error', reject);
    });
}, {
    connection,
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
});

worker.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed with error: ${err.message}`);
});
