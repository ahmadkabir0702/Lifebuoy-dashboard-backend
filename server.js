const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs'); // ADD THIS
const youtubedl = require('youtube-dl-exec'); // ADD THIS
const { GoogleGenAI } = require('@google/genai'); // ADD THIS

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const auth = new google.auth.JWT(
  process.env.CLIENT_EMAIL,
  null,
  process.env.PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, ''), 
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); // Ensure GEMINI_API_KEY is in your system or .env

app.post('/api/add-creative', async (req, res) => {
  const { date, campaign, type, ig, fb, tt, repurposed, originalId } = req.body;
  const safeCampaignName = campaign.replace(/\s+/g, '');
  const creativeId = `LifebuoyBW_${safeCampaignName}_New_${Date.now()}`;
  
  // Prioritize downloading from IG, then TT, then FB
  const videoLinkToDownload = ig || tt || fb; 
  
  let hook = "", seg1 = "", seg2 = "", seg3 = "", seg4 = "";
  let videoPath = null;
  let geminiFile = null;

  try {
    // Phase 1: Try to download and analyze the video if a link exists
    if (videoLinkToDownload) {
        console.log(`Downloading video from: ${videoLinkToDownload}`);
        videoPath = path.join(__dirname, `temp_video_${Date.now()}.mp4`);
        
        try {
            await youtubedl(videoLinkToDownload, { output: videoPath, format: 'mp4' });
            
            console.log(`Uploading to Gemini...`);
            geminiFile = await ai.files.upload({ file: videoPath, mimeType: 'video/mp4' });
            
            // Wait for Google's servers to process the video stream
            let fileState = await ai.files.get({ name: geminiFile.name });
            while (fileState.state === 'PROCESSING') {
                await new Promise(resolve => setTimeout(resolve, 3000));
                fileState = await ai.files.get({ name: geminiFile.name });
            }
            
            if (fileState.state !== 'FAILED') {
                console.log(`Generating AI Breakdown...`);
               const prompt = `
Watch this video carefully. Extract the following:

1. "hook": A 1-2 sentence description of the opening hook — what visually happens in the first 2-3 seconds, the emotion or tension it creates, and why it stops the scroll.

2. "seg1": (0–25%) Describe the setting, who appears, what action or message is shown, the tone, and any key text or audio cues.

3. "seg2": (25–50%) Describe how the narrative or demonstration develops — what new information, emotion, or visual is introduced and how it builds on the hook.

4. "seg3": (50–75%) Describe the core message or product moment — what is being shown or said, how it connects to the brand, and the viewer's emotional journey at this point.

5. "seg4": (75–100%) Describe the closing — the call to action, final visual, any end card or branding, and the overall feeling the video leaves the viewer with.

Keep each description to 2-3 sentences. Be specific about visuals, on-screen text, and tone. Do not use generic filler phrases.

Return only a JSON object with keys: "hook", "seg1", "seg2", "seg3", "seg4". No markdown, no extra text.
`;
                const result = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [{ role: 'user', parts: [{ fileData: { fileUri: geminiFile.uri, mimeType: 'video/mp4' } }, { text: prompt }] }],
                    config: { responseMimeType: "application/json" }
                });

                const analysisData = JSON.parse(result.text);
                hook = analysisData.hook || "";
                seg1 = analysisData.seg1 || "";
                seg2 = analysisData.seg2 || "";
                seg3 = analysisData.seg3 || "";
                seg4 = analysisData.seg4 || "";
                console.log("AI Analysis Successful.");
            }
        } catch (downloadOrAiError) {
            console.error("AI/Download Pipeline Failed. Proceeding to add row without AI descriptions.", downloadOrAiError);
            // We swallow this error so it doesn't crash the sheet insertion if TikTok blocks the download.
        }
    }

    // Phase 2: Add to Google Sheets
    let sheetName = '';
    let rowData = [];

    if (type === 'Brand Say') {
      sheetName = 'Brand Say Contents';
      // Columns: Date(0), ID(1), Repurposed(2), OrigID(3), Campaign(4), Type(5)(Null for auto), Hook(6), Segments(7-10), ContentType(11), Duration(12), IG(13), FB(14), TT(15)
      rowData = [date, creativeId, repurposed, originalId, campaign, null, hook, seg1, seg2, seg3, seg4, 'Video', null, ig, fb, tt];
    } else if (type === 'Others Say') {
      sheetName = 'Others Say Contents';
      // Columns: Date(0), ID(1), Campaign(2), Type(3)(Null for auto), Profile(4), ContentType(5), Hook(6), Segments(7-10), Duration(11), IG(12), FB(13), TT(14)
      rowData = [date, creativeId, campaign, null, null, 'Video', hook, seg1, seg2, seg3, seg4, null, ig, fb, tt];
    } else {
      return res.status(400).json({ error: 'Invalid Type selected.' });
    }

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: `${sheetName}!A:P`, 
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowData] }
    });

    res.json({ success: true, data: response.data, creativeId });

  } catch (error) {
    console.error("Critical Add Creative Error:", error);
    res.status(500).json({ error: 'Failed to complete workflow.' });
  } finally {
    // Phase 3: Cleanup Server Storage
    if (videoPath && fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
    }
    if (geminiFile) {
        try { await ai.files.delete({ name: geminiFile.name }); } catch(e) {}
    }
  }
});

app.get('/api/dashboard-data', async (req, res) => {
  try {
    // Exact tab names matching your Excel file uploads
const sheetNames = [
      'Post performance Meta [Paid]',
      'Post performance TT [Paid]',
      'Recommendation - Meta',
      'Recommendation - Tiktok',
      'Brand Say Contents',
      'Others Say Contents',
      'Post performance IG [Oragnic]',
      'Post performance FB [Oragnic]',
      'Post performance TT [Oragnic]',
      'Account Overview' // <-- ADD THIS
    ];

    const requests = sheetNames.map(sheet => 
      sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: sheet,
      })
    );

    const responses = await Promise.all(requests);
    const data = responses.map(r => r.data.values);

    res.json(data);
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.post('/api/update-action', async (req, res) => {
  try {
    const { updateData } = req.body;
    const response = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.SHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updateData
      }
    });
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({ error: 'Failed to update sheet' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
