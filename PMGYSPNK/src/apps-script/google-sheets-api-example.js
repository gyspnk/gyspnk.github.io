// Google Sheets API approach - more professional
// Requires API key but much more reliable

async function submitToGoogleSheetsAPI(data) {
  const API_KEY = 'YOUR_GOOGLE_SHEETS_API_KEY';
  const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
  const RANGE = 'Sheet1!A:H'; // Adjust range as needed
  
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${RANGE}:append?valueInputOption=USER_ENTERED&key=${API_KEY}`;
  
  const values = [[
    new Date().toISOString(),
    data.userEmail,
    data.amount,
    data.fromMonth,
    data.fromYear,
    data.toMonth,
    data.toYear,
    data.description
  ]];
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: values
      })
    });
    
    if (response.ok) {
      console.log('Successfully submitted to Google Sheets');
      return true;
    } else {
      throw new Error('Failed to submit to Google Sheets');
    }
  } catch (error) {
    console.error('Google Sheets API submission failed:', error);
    throw error;
  }
}