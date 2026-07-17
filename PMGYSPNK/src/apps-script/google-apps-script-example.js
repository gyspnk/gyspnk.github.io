// Google Apps Script approach - much more reliable
// This would be deployed as a web app in Google Apps Script

// Replace the Google Forms submission with this simpler approach
async function submitToGoogleSheet(data) {
  // Your deployed Google Apps Script URL
  const SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';
  
  try {
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: data.amount,
        fromMonth: data.fromMonth,
        fromYear: data.fromYear,
        toMonth: data.toMonth,
        toYear: data.toYear,
        description: data.description,
        userEmail: data.userEmail,
        timestamp: new Date().toISOString(),
        // Note: File uploads need special handling with Google Apps Script
      })
    });
    
    const result = await response.json();
    if (result.success) {
      console.log('Successfully submitted to Google Sheet');
      return true;
    } else {
      throw new Error(result.error || 'Submission failed');
    }
  } catch (error) {
    console.error('Google Sheet submission failed:', error);
    throw error;
  }
}