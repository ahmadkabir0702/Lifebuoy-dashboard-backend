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
    const { date, campaign, type, ig, fb, tt, repurposed, originalId } = req.body;
    
    const safeCampaignName = campaign.replace(/\s+/g, '');
    const creativeId = `LifebuoyBW_${safeCampaignName}_New_${Date.now()}`;
    
    let sheetName = '';
    let rowData = [];

    // NOTE: Passing 'null' into the array tells the Google API to skip editing that cell entirely,
    // which protects your automated 'Type' formulas.

    if (type === 'Brand Say') {
      sheetName = 'Brand Say Contents';
      // Format aligns with Brand Say Columns:
      // Date(0), ID(1), Repurposed(2), OrigID(3), Campaign(4), Type(5)(Null for auto), Hook(6), Segments(7-10), ContentType(11), Duration(12), IG(13), FB(14), TT(15)
      rowData = [date, creativeId, repurposed, originalId, campaign, null, null, null, null, null, null, 'Video', null, ig, fb, tt];
    } else if (type === 'Others Say') {
      sheetName = 'Others Say Contents';
      // Format aligns with Others Say Columns:
      // Date(0), ID(1), Campaign(2), Type(3)(Null for auto), Profile(4), ContentType(5), Hook(6), Segments(7-10), Duration(11), IG(12), FB(13), TT(14)
      rowData = [date, creativeId, campaign, null, null, 'Video', null, null, null, null, null, null, ig, fb, tt];
    } else {
      return res.status(400).json({ error: 'Invalid Type selected.' });
    }

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: `${sheetName}!A:P`, 
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
