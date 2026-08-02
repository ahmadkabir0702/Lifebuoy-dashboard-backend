const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const youtubedl = require('youtube-dl-exec');
const os = require('os'); // <--- ADD THIS
const { GoogleGenAI } = require('@google/genai');
const session = require('express-session');
const { query } = require('./db');

const app = express();
app.use(cors({ origin: '*' }));
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
  if (req.path === '/login' || req.path === '/logout' || req.path === '/api/test-gemini') return next();
  if (req.session && req.session.user) return next();
  // API calls get 401, not redirect
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/login');
}

app.options('*', cors({ origin: '*' }));

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
    <h2>Unilever Content Analysis Hub</h2>
    <p class="sub">Creative Hub · 2026</p>
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


app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.post('/api/test-gemini', async (req, res) => {
  const { videoBase64, password } = req.body;
  if (password !== process.env.TEST_SECRET) return res.status(401).json({ error: 'Wrong password' });
  try {
  console.log(`[AI Worker] Generating detailed descriptions...`);
    
    const prompt = `Watch this video carefully and provide a highly descriptive visual and narrative analysis. Extract the following 5 segments:

1. "hook": Write exactly 2 detailed sentences describing the opening hook (first 3 seconds). Note the visual impact, audio, or text used to grab attention.
2. "seg1": (0–25%) Write exactly 2-3 detailed sentences describing the setting, who appears, specific actions, and any text on screen.
3. "seg2": (25–50%) Write exactly 2-3 detailed sentences describing how the narrative, demonstration, or emotional tone develops.
4. "seg3": (50–75%) Write exactly 2-3 detailed sentences describing the core product moment, key features shown, or the climax of the message.
5. "seg4": (75–100%) Write exactly 2-3 detailed sentences describing the closing scene, final branding moments, and the call to action.

Make your descriptions vivid and specific (mention colors, emotions, or exact text if relevant). Return ONLY a valid JSON object with exactly these keys: "hook", "seg1", "seg2", "seg3", "seg4". Do not use markdown formatting or include any extra text outside the JSON.`;
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: 'video/mp4', data: videoBase64 } },
        { text: prompt }
      ]}],
      config: { responseMimeType: 'application/json', maxOutputTokens: 4000 }
    });
    const parsed = JSON.parse(result.text.replace(/```json|```/g, '').trim());
    res.json({ success: true, result: parsed });
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});

// Serve static files — only after auth middleware
app.use(express.static(path.join(__dirname, 'public')));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });





// All Postgres-backed API routes live in routes.js
require('./routes')(app, { ai, youtubedl });

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
