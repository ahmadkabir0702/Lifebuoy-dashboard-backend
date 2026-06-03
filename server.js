const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const youtubedl = require('youtube-dl-exec');
const { GoogleGenAI } = require('@google/genai');
const session = require('express-session');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'changeme-set-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Auth middleware — skips login/logout routes
function requireAuth(req, res, next) {
  if (req.path === '/login' || req.path === '/logout') return next();
  if (req.session && req.session.user) return next();
  // API calls get 401, not redirect
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/login');
}

app.use(requireAuth);

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Login</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f8f7f4; display: flex; align-items: center;
      justify-content: center; height: 100vh; }
    .box { background: #fff; border: 1px solid rgba(0,0,0,0.08);
      border-radius: 12px; padding: 32px; width: 320px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06); }
    h2 { font-size: 18px; font-weight: 700; margin-bottom: 6px; }
    .sub { font-size: 12px; color: #6b6b6b; margin-bottom: 24px; }
    label { font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .06em; color: #6b6b6b; display: block; margin-bottom: 5px; }
    input { width: 100%; padding: 10px 12px; border: 1px solid rgba(0,0,0,0.12);
      border-radius: 7px; font-size: 13px; font-family: inherit;
      outline: none; margin-bottom: 14px; }
    input:focus { border-color: #2563eb; }
    button { width: 100%; padding: 11px; background: #2563eb; color: #fff;
      border: none; border-radius: 7px; font-size: 13px; font-weight: 600;
      cursor: pointer; font-family: inherit; }
    button:hover { background: #1d4ed8; }
    .err { background: #fee2e2; color: #b91c1c; border-radius: 6px;
      padding: 9px 12px; font-size: 12px; margin-bottom: 14px; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Dashboard Login</h2>
    <p class="sub">Lifebuoy BW · 2026</p>
    ${req.query.error ? '<div class="err">Incorrect username or password.</div>' : ''}
    <form method="POST" action="/login">
      <label>Username</label>
      <input type="text" name="username" autocomplete="username" required autofocus>
      <label>Password</label>
      <input type="password" name="password" autocomplete="current-password" required>
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`);
});

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = (req.body.password || '').trim();
  console.log('Login attempt for:', username);
  const envKey = 'USER_' + username;
  const storedPassword = process.env[envKey];
  console.log('Env key:', envKey, '| Match:', storedPassword === password);
  if (storedPassword && storedPassword === password) {
    req.session.user = username;
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.redirect('/login?error=1');
      }
      res.redirect('/');
    });
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Serve static files — only after auth middleware
app.use(express.static(path.join(__dirname, 'public')));

const auth = new google.auth.JWT(
  process.env.CLIENT_EMAIL,
  null,
  process.env.PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, ''),
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/add-creative', async (req, res) => {
  const { date, campaign, type, ig, fb, tt, repurposed, originalId } = req.body;
  const safeCampaignName = campaign.replace(/\s+/g, '');
  const creativeId = `LifebuoyBW_${safeCampaignName}_New_${Date.now()}`;

  const videoLinkToDownload = ig || tt || fb;

  let hook = "", seg1 = "", seg2 = "", seg3 = "", seg4 = "";
  let videoPath = null;
  let geminiFile = null;

  try {
    if (videoLinkToDownload) {
      console.log(`Downloading video from: ${videoLinkToDownload}`);
      videoPath = path.join(__dirname, `temp_video_${Date.now()}.mp4`);

      try {
        await youtubedl(videoLinkToDownload, { output: videoPath, format: 'mp4' });

        console.log(`Uploading to Gemini...`);
        geminiFile = await ai.files.upload({ file: videoPath, mimeType: 'video/mp4' });

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
            config: { responseMimeType: "application/json", maxOutputTokens: 600 }
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
        console.error("AI/Download Pipeline Failed. Proceeding without AI descriptions.", downloadOrAiError);
      }
    }

    let sheetName = '';
    let rowData = [];

    if (type === 'Brand Say') {
      sheetName = 'Brand Say Contents';
      rowData = [date, creativeId, repurposed, originalId, campaign, null, hook, seg1, seg2, seg3, seg4, 'Video', null, ig, fb, tt];
    } else if (type === 'Others Say') {
      sheetName = 'Others Say Contents';
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
      'Account Overview'
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
