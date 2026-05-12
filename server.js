const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// THIS is where this line belongs! (After the app is created)
// We are using the "path" version just to make it completely bulletproof
app.use(express.static(path.join(__dirname, 'public')));

// 1. Authenticate with Google
const auth = new google.auth.JWT(
  process.env.CLIENT_EMAIL,
  null,
  // This cleanly handles the multi-line private key from environment variables
  process.env.PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, ''), 
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth });

// 2. Read Data Endpoint
app.get('/api/dashboard-data', async (req, res) => {
  try {
    const sheetNames = [
      'Post performance Meta [Paid]',
      'Post performance TT [Paid]',
      'Recommendation - Meta',
      'Recommendation - Tiktok',
      'Brand Say Contents',
      'Others Say Contents'
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

// 3. Write Data Endpoint (For the Action Modal)
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

// Fallback: If they go to the root URL, forcefully hand them the index.html file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 4. Start Server 
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
