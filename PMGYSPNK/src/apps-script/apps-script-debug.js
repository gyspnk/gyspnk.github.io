/**
 * Google Apps Script for Kas Pemuda GYSPNK - DEBUG VERSION
 * This version includes extensive logging to help debug the doPost failure
 */

const SHEET_NAME = 'Kas Kecil Pemuda GYS Pontianak';
const DRIVE_FOLDER_NAME = 'Kas GYSPNK - Bukti Transfer';

// CORS configuration
const ALLOWED_ORIGINS = [
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'https://thengb.github.io',
  'https://gyspnk.site',
  'https://www.gyspnk.site'
];

function getCorsHeaders(requestOrigin) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Origin',
    'Access-Control-Max-Age': '3600',
    'Access-Control-Allow-Credentials': 'false',
    'Vary': 'Origin'
  };
}

function doGet(e) {
  console.log('doGet called with params:', e.parameter);
  try {
    const params = e.parameter || {};
    
    if (params.info === 'true') {
      return ContentService
        .createTextOutput(JSON.stringify({ 
          success: true,
          scriptInfo: {
            name: 'Kas GYSPNK - Debug Version',
            version: '3.0-debug',
            timestamp: new Date().toISOString()
          }
        }))
        .setMimeType(ContentService.MimeType.JSON)
        .setHeaders(getCorsHeaders(null));
    }
    
    return HtmlService.createHtmlOutput(`
      <html>
        <body style="font-family: Arial; padding: 20px;">
          <h1>Kas GYSPNK - Debug Version</h1>
          <p><strong>Status:</strong> ✅ Active</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString('id-ID')}</p>
          <p><strong>Version:</strong> 3.0-debug</p>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Error in doGet:', error);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doOptions(e) {
  console.log('doOptions called');
  return ContentService
    .createTextOutput()
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders(getCorsHeaders(null));
}

function doPost(e) {
  console.log('=== doPost DEBUG START ===');
  
  try {
    // Log the raw request
    console.log('e.postData:', e.postData);
    console.log('e.parameter:', e.parameter);
    console.log('e.parameters:', e.parameters);
    
    // Check if postData exists
    if (!e.postData) {
      console.error('No postData in request');
      return ContentService
        .createTextOutput(JSON.stringify({ 
          success: false, 
          error: 'No postData received',
          debug: { hasPostData: false, parameter: e.parameter }
        }))
        .setMimeType(ContentService.MimeType.JSON)
        .setHeaders(getCorsHeaders(null));
    }
    
    console.log('postData.contents length:', e.postData.contents ? e.postData.contents.length : 'null');
    console.log('postData.type:', e.postData.type);
    
    // Parse incoming data
    let data;
    let parseMethod = 'unknown';
    
    try {
      // Method 1: Try direct JSON parse
      parseMethod = 'direct-json';
      data = JSON.parse(e.postData.contents || '{}');
      console.log('Parsed via direct JSON');
    } catch (parseErr) {
      console.log('Direct JSON parse failed:', parseErr.message);
      
      try {
        // Method 2: Try FormData parsing
        parseMethod = 'formdata';
        const raw = e.postData.contents || '';
        console.log('Raw contents preview:', raw.substring(0, 200));
        
        if (raw.includes('json=')) {
          const jsonMatch = raw.match(/json=([^&]*)/);
          if (jsonMatch) {
            const encoded = jsonMatch[1];
            console.log('Found json field, encoded length:', encoded.length);
            const decoded = decodeURIComponent(encoded);
            console.log('Decoded length:', decoded.length);
            data = JSON.parse(decoded);
            console.log('Parsed via FormData');
          } else {
            throw new Error('json field found but could not extract');
          }
        } else {
          throw new Error('No json field in FormData');
        }
      } catch (parseErr2) {
        console.error('FormData parse also failed:', parseErr2.message);
        return ContentService
          .createTextOutput(JSON.stringify({ 
            success: false, 
            error: 'Could not parse request data',
            debug: {
              directJsonError: parseErr.message,
              formDataError: parseErr2.message,
              rawPreview: (e.postData.contents || '').substring(0, 100),
              contentType: e.postData.type
            }
          }))
          .setMimeType(ContentService.MimeType.JSON)
          .setHeaders(getCorsHeaders(null));
      }
    }
    
    console.log('Successfully parsed data via:', parseMethod);
    console.log('Received data keys:', Object.keys(data));
    console.log('userEmail:', data.userEmail);
    console.log('amount:', data.amount);
    console.log('test flag:', data.test);
    
    // Handle test requests
    if (data.test) {
      console.log('Processing test request');
      return ContentService
        .createTextOutput(JSON.stringify({ 
          success: true, 
          message: 'Test successful - Debug version working',
          timestamp: new Date().toISOString(),
          debug: { parseMethod: parseMethod, dataKeys: Object.keys(data) }
        }))
        .setMimeType(ContentService.MimeType.JSON)
        .setHeaders(getCorsHeaders(null));
    }
    
    // Validate required fields
    if (!data.userEmail) {
      console.error('Missing userEmail');
      return ContentService
        .createTextOutput(JSON.stringify({ 
          success: false, 
          error: 'Missing userEmail field',
          debug: { dataKeys: Object.keys(data), userEmail: data.userEmail }
        }))
        .setMimeType(ContentService.MimeType.JSON)
        .setHeaders(getCorsHeaders(null));
    }
    
    if (!data.amount) {
      console.error('Missing amount');
      return ContentService
        .createTextOutput(JSON.stringify({ 
          success: false, 
          error: 'Missing amount field',
          debug: { dataKeys: Object.keys(data), amount: data.amount }
        }))
        .setMimeType(ContentService.MimeType.JSON)
        .setHeaders(getCorsHeaders(null));
    }
    
    console.log('Validation passed, proceeding to save to sheets');
    
    // Try to save to sheets (simplified)
    try {
      const sheet = getOrCreateSheet();
      console.log('Got sheet:', sheet.getName());
      
      const result = saveToSheetSimple(sheet, data);
      console.log('Save result:', result);
      
      if (result.success) {
        const response = { 
          success: true, 
          message: 'Data berhasil disimpan ke Google Sheets',
          rowNumber: result.rowNumber,
          timestamp: new Date().toISOString(),
          debug: { parseMethod: parseMethod }
        };
        
        return ContentService
          .createTextOutput(JSON.stringify(response))
          .setMimeType(ContentService.MimeType.JSON)
          .setHeaders(getCorsHeaders(null));
      } else {
        return ContentService
          .createTextOutput(JSON.stringify({ 
            success: false, 
            error: result.error,
            debug: { parseMethod: parseMethod, sheetName: sheet.getName() }
          }))
          .setMimeType(ContentService.MimeType.JSON)
          .setHeaders(getCorsHeaders(null));
      }
      
    } catch (sheetError) {
      console.error('Sheet operation failed:', sheetError);
      return ContentService
        .createTextOutput(JSON.stringify({ 
          success: false, 
          error: 'Sheet operation failed: ' + sheetError.toString(),
          debug: { parseMethod: parseMethod }
        }))
        .setMimeType(ContentService.MimeType.JSON)
        .setHeaders(getCorsHeaders(null));
    }
    
  } catch (error) {
    console.error('=== MAIN doPost ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return ContentService
      .createTextOutput(JSON.stringify({ 
        success: false, 
        error: 'doPost failed: ' + error.toString(),
        debug: {
          errorMessage: error.message,
          errorStack: error.stack ? error.stack.substring(0, 500) : 'No stack trace'
        }
      }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders(getCorsHeaders(null));
  } finally {
    console.log('=== doPost DEBUG END ===');
  }
}

function getOrCreateSheet() {
  console.log('Getting or creating sheet...');
  
  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    console.log('Found active spreadsheet:', spreadsheet.getName());
  } catch (error) {
    console.log('No active spreadsheet, creating new one');
    spreadsheet = SpreadsheetApp.create('Kas Management Debug');
    console.log('Created new spreadsheet:', spreadsheet.getName());
  }
  
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    console.log('Creating new sheet:', SHEET_NAME);
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    
    // Set up simple headers
    const headers = [
      'Timestamp', 'Email User', 'Nama User', 'Jumlah (Rp)', 
      'Bulan', 'Tahun', 'Keterangan', 'Status'
    ];
    
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    
    // Format headers
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('white');
    headerRange.setFontWeight('bold');
    
    console.log('Sheet created and formatted');
  } else {
    console.log('Using existing sheet:', SHEET_NAME);
  }
  
  return sheet;
}

function saveToSheetSimple(sheet, data) {
  console.log('Saving to sheet with data:', data);
  
  try {
    const currentDate = new Date();
    const rowData = [
      data.timestamp || currentDate.toISOString(),
      data.userEmail || '',
      data.userName || '',
      data.amount || 0,
      data.month || currentDate.getMonth() + 1,
      data.year || currentDate.getFullYear(),
      data.description || '',
      'Berhasil'
    ];
    
    console.log('Row data prepared:', rowData);
    
    const lastRow = sheet.getLastRow();
    const newRowNumber = lastRow + 1;
    
    console.log('Writing to row:', newRowNumber);
    
    sheet.getRange(newRowNumber, 1, 1, rowData.length).setValues([rowData]);
    
    console.log('Data written successfully');
    
    return { success: true, rowNumber: newRowNumber };
    
  } catch (error) {
    console.error('Error in saveToSheetSimple:', error);
    return { success: false, error: error.toString() };
  }
}