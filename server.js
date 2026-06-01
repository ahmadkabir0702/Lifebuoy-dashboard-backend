const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');

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

app.post('/api/add-creative', async (req, res) => {
  try {
    const { date, campaign, type, ig, fb, tt } = req.body;
    
    // Generate a unique Creative ID
    const safeCampaignName = campaign.replace(/\s+/g, '');
    const creativeId = `LifebuoyBW_${safeCampaignName}_New_${Date.now()}`;
    
    let sheetName = '';
    let rowData = [];

    if (type === 'Brand Say') {
      sheetName = 'Brand Say Contents';
      // Format aligns with Brand Say Columns:
      // Date, Creative ID, Is Repurposed, Original Creative ID, Campaign, Type, Content Hook, 1st Seg, 2nd Seg, 3rd Seg, 4th Seg, Content Type, Duration, IG, FB, TT
      rowData = [date, creativeId, 'No', '', campaign, type, '', '', '', '', '', 'Video', '', ig, fb, tt];
    } else if (type === 'Others Say') {
      sheetName = 'Others Say Contents';
      // Format aligns with Others Say Columns:
      // Date, Creative ID, Campaign, Type, Creator Profile, Content Type, Content Hook, 1st Seg, 2nd Seg, 3rd Seg, 4th Seg, Duration (s), IG, FB, TT, YT...
      rowData = [date, creativeId, campaign, type, '', 'Video', '', '', '', '', '', '', ig, fb, tt, ''];
    } else {
      return res.status(400).json({ error: 'Invalid Type selected.' });
    }

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: `${sheetName}!A:P`, // Ensure it appends looking at columns A through P
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [rowData]
      }
    });

    res.json({ success: true, data: response.data, creativeId });
  } catch (error) {
    console.error("Add Creative Error:", error);
    res.status(500).json({ error: 'Failed to add creative to Google Sheets.' });
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
