/**
 * MINIMAL GOOGLE APPS SCRIPT FOR CORS TESTING
 * Use this to test if basic CORS functionality works
 * If this works, then gradually add back the full functionality
 */

// Simple CORS headers for testing
function getSimpleCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Origin',
    'Access-Control-Max-Age': '3600'
  };
}

/**
 * Handle OPTIONS requests (CORS preflight)
 */
function doOptions(e) {
  console.log('OPTIONS request received');
  
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders(getSimpleCorsHeaders());
}

/**
 * Handle GET requests
 */
function doGet(e) {
  console.log('GET request received');
  
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      message: 'Minimal CORS test - GET working',
      timestamp: new Date().toISOString(),
      version: 'Minimal Test 1.0'
    }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders(getSimpleCorsHeaders());
}

/**
 * Handle POST requests
 */
function doPost(e) {
  try {
    console.log('POST request received');
    console.log('Post data:', e.postData ? e.postData.contents : 'No post data');
    
    // Simple response without complex processing
    const response = {
      success: true,
      message: 'Minimal CORS test - POST working',
      timestamp: new Date().toISOString(),
      version: 'Minimal Test 1.0',
      receivedData: e.postData ? 'Data received' : 'No data'
    };
    
    console.log('Sending response:', JSON.stringify(response));
    
    return ContentService
      .createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders(getSimpleCorsHeaders());
      
  } catch (error) {
    console.error('Error in doPost:', error.toString());
    
    // Return error response with CORS headers
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: 'Error in doPost: ' + error.toString(),
        timestamp: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders(getSimpleCorsHeaders());
  }
}

/**
 * Test function to verify script is working
 */
function testFunction() {
  console.log('Test function executed successfully');
  return 'Test successful at ' + new Date().toISOString();
}

/*
DEPLOYMENT INSTRUCTIONS:

1. Copy this ENTIRE code to Google Apps Script Code.gs
2. Save the project (Ctrl+S)
3. Deploy as Web App:
   - Execute as: Me
   - Access: Anyone
4. Test with PowerShell:

   # Test GET
   Invoke-WebRequest -Uri "YOUR_NEW_URL" -Method GET -UseBasicParsing

   # Test OPTIONS
   Invoke-WebRequest -Uri "YOUR_NEW_URL" -Method OPTIONS -Headers @{"Origin"="http://localhost:8000"} -UseBasicParsing

   # Test POST
   $body = '{"test": true}';
   Invoke-WebRequest -Uri "YOUR_NEW_URL" -Method POST -Body $body -ContentType "application/json" -Headers @{"Origin"="http://localhost:8000"} -UseBasicParsing

5. If all tests pass, then gradually add back the full functionality

EXPECTED RESULTS:
- All requests should return Status 200
- All responses should be JSON (not HTML)
- CORS headers should be present in all responses
- No "Salah" error pages

If this minimal version works, the issue is in the complex code.
If this minimal version fails, the issue is with deployment or permissions.
*/