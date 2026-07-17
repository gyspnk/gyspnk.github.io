/**
 * Google Apps Script - VERSION 5.0 WITH CORS SUPPORT
 * Full CORS support for proper client-server communication
 */

// CORS headers function - Apps Script compatible
function addCorsHeaders(output) {
  // Note: Apps Script ContentService doesn't support setHeaders()
  // CORS is handled at the Google Apps Script platform level
  // when deployed as web app with "Anyone" access
  return output;
}

// Debug function to test what method is being called
function debugRequest(e, methodName) {
  console.log(`🔎 ${methodName} function called at ${new Date().toISOString()}`);
  console.log('Request object structure:', {
    hasParameter: !!e.parameter,
    hasPostData: !!e.postData,
    parameterKeys: Object.keys(e.parameter || {}),
    postDataType: e.postData ? e.postData.type : 'none',
    postDataLength: e.postData && e.postData.contents ? e.postData.contents.length : 0
  });
}

function doGet(e) {
  debugRequest(e, 'doGet');
  console.log('🔍 doGet called - this should only happen for GET requests');
  
  // Return JSON instead of HTML to avoid CSP issues
  try {
    const params = e.parameter || {};
    
    if (params.test === 'basic') {
      return ContentService
        .createTextOutput(JSON.stringify({
          success: true,
          message: 'Apps Script is working',
          timestamp: new Date().toISOString(),
          params: params
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (params.test === 'sheet') {
      try {
        const sheet = getSheet();
        const testRow = [
          new Date().toISOString(),
          'test@example.com',
          'Test User',
          10000,
          new Date().getMonth() + 1,
          new Date().getFullYear(),
          'GET Test',
          'Success'
        ];
        
        const lastRow = sheet.getLastRow();
        sheet.getRange(lastRow + 1, 1, 1, testRow.length).setValues([testRow]);
        
        return ContentService
          .createTextOutput(JSON.stringify({
            success: true,
            message: 'Sheet test successful',
            rowNumber: lastRow + 1,
            sheetName: sheet.getName()
          }))
          .setMimeType(ContentService.MimeType.JSON);
      } catch (sheetError) {
        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: 'Sheet test failed: ' + sheetError.toString()
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // Default response
    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        message: 'Kas GYSPNK Apps Script - CORS Enabled Version',
        version: '5.0-cors',
        timestamp: new Date().toISOString(),
        availableTests: ['?test=basic', '?test=sheet'],
        corsEnabled: true
      }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    console.error('doGet error:', error);
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doOptions(e) {
  debugRequest(e, 'doOptions');
  console.log('⚙️ doOptions called - handling CORS preflight');
  
  // Return success for preflight requests
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      message: 'CORS preflight accepted',
      timestamp: new Date().toISOString(),
      method: 'OPTIONS'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  debugRequest(e, 'doPost');
  console.log('📤 doPost called - POST request received');
  
  // Enhanced debugging - log the entire request object structure
  console.log('🔍 Full request object inspection:');
  console.log('- e exists:', !!e);
  console.log('- e.postData exists:', !!e.postData);
  console.log('- e.parameter exists:', !!e.parameter);
  console.log('- Object.keys(e):', Object.keys(e || {}));
  
  if (e.postData) {
    console.log('- postData.type:', e.postData.type);
    console.log('- postData.contents length:', e.postData.contents ? e.postData.contents.length : 'null/undefined');
    console.log('- postData.contents preview (first 100 chars):', e.postData.contents ? e.postData.contents.substring(0, 100) : 'empty');
  }
  
  if (e.parameter && Object.keys(e.parameter).length > 0) {
    console.log('- URL parameters found:', Object.keys(e.parameter));
    console.log('- Parameter values:', e.parameter);
  }
  
  try {
    if (!e.postData) {
      console.log('❌ No postData in request - this might be a GET request sent as POST');
      console.log('❌ Check if data is in e.parameter instead');
      
      // Check if data came as URL parameters instead
      if (e.parameter && e.parameter.json) {
        console.log('🔄 Found JSON in URL parameters, attempting to parse...');
        try {
          const data = JSON.parse(decodeURIComponent(e.parameter.json));
          console.log('✅ Successfully parsed data from URL parameters:', data);
          return createResponse(true, 'Data received via URL parameters (not POST body)', { data: data });
        } catch (paramParseErr) {
          console.log('❌ Failed to parse JSON from URL parameters:', paramParseErr.toString());
        }
      }
      
      return createResponse(false, 'No postData received and no valid parameters found');
    }
    
    console.log('📥 PostData received:', {
      type: e.postData.type,
      length: e.postData.contents ? e.postData.contents.length : 0,
      preview: e.postData.contents ? e.postData.contents.substring(0, 200) + '...' : 'empty'
    });
    
    let data;
    
    // Try direct JSON first
    try {
      data = JSON.parse(e.postData.contents || '{}');
      console.log('✅ Parsed JSON directly');
    } catch (parseErr) {
      console.log('⚠️ JSON parse failed, trying URL-encoded parsing...');
      // Try URL-encoded form data parsing
      const raw = e.postData.contents || '';
      console.log('URL-encoded raw content preview:', raw.substring(0, 300));
      
      if (raw.includes('json=')) {
        const match = raw.match(/json=([^&]*)/);
        if (match) {
          try {
            data = JSON.parse(decodeURIComponent(match[1]));
            console.log('✅ Parsed URL-encoded data successfully');
          } catch (formParseErr) {
            console.log('❌ URL-encoded JSON parse failed:', formParseErr.toString());
          }
        } else {
          console.log('❌ URL-encoded json parameter not found');
        }
      } else {
        console.log('❌ No json= parameter in URL-encoded data');
      }
    }
    
    if (!data) {
      console.log('❌ Data parsing failed completely');
      return createResponse(false, 'Could not parse request data. Check request format.');
    }
    
    console.log('✅ Data successfully parsed:', Object.keys(data));
    console.log('📋 Data preview:', JSON.stringify(data, null, 2));
    
    // Handle test requests
    if (data.test) {
      return createResponse(true, 'Test successful');
    }
    
    // Validate required fields
    if (!data.userEmail || !data.amount) {
      return createResponse(false, 'Missing required fields: userEmail and amount');
    }
    
    // Handle image upload if present
    let imageUploadResult = null;
    if (data.imageFile) {
      try {
        console.log('Processing image upload...');
        imageUploadResult = uploadImageToDrive(data);
        console.log('Image upload result:', imageUploadResult);
      } catch (uploadError) {
        console.error('Image upload failed:', uploadError);
        imageUploadResult = { success: false, error: uploadError.toString() };
      }
    }

    // Save to transaction history
    try {
      const sheet = getSheet();
      const lastRow = sheet.getLastRow();
      const transactionNumber = Math.max(1, lastRow); // Start from 1, continue sequence
      
      const currentDate = new Date();
      const fromMonth = data.fromMonth || data.month || currentDate.getMonth() + 1;
      const fromYear = data.fromYear || data.year || currentDate.getFullYear();
      const toMonth = data.toMonth || data.fromMonth || data.month || currentDate.getMonth() + 1;
      const toYear = data.toYear || data.fromYear || data.year || currentDate.getFullYear();
      
      // Create a more descriptive period format
      const monthNames = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
      ];
      
      let period;
      if (fromMonth === toMonth && fromYear === toYear) {
        // Single month payment
        period = `${monthNames[fromMonth - 1]} ${fromYear}`;
      } else {
        // Multi-month payment
        const fromMonthName = monthNames[fromMonth - 1];
        const toMonthName = monthNames[toMonth - 1];
        
        if (fromYear === toYear) {
          period = `${fromMonthName} - ${toMonthName} ${fromYear}`;
        } else {
          period = `${fromMonthName} ${fromYear} - ${toMonthName} ${toYear}`;
        }
      }
      
      // Extended row data to include image information
      const rowData = [
        transactionNumber,                                    // No
        data.timestamp || currentDate.toISOString(),         // Timestamp
        currentDate.toLocaleDateString('id-ID'),             // Date (ID)
        data.userEmail,                                      // User Email
        data.userName || '',                                 // User Name
        data.amount,                                         // Amount (Rp)
        fromMonth,                                           // From Month
        fromYear,                                            // From Year
        toMonth,                                             // To Month
        toYear,                                              // To Year
        period,                                             // Payment Period (e.g., "September - November 2025")
        data.description || 'Payment transaction',          // Description
        data.type || 'payment',                            // Type
        'Success',                                          // Status
        'Web App',                                          // Source
        imageUploadResult ? imageUploadResult.fileName : '', // Image File Name
        imageUploadResult ? imageUploadResult.fileUrl : '',  // Image URL
        imageUploadResult ? imageUploadResult.folderPath : '' // Image Folder Path
      ];
      
      console.log('Adding transaction #' + transactionNumber + ' to history');
      sheet.getRange(lastRow + 1, 1, 1, rowData.length).setValues([rowData]);
      
      // Format the new row
      const newRowRange = sheet.getRange(lastRow + 1, 1, 1, rowData.length);
      if (lastRow % 2 === 0) {
        newRowRange.setBackground('#f8f9fa'); // Alternate row coloring
      }
      
      // Format amount as currency
      sheet.getRange(lastRow + 1, 6).setNumberFormat('#,##0');
      
      // Make image URL clickable if present
      if (imageUploadResult && imageUploadResult.success && imageUploadResult.fileUrl) {
        const urlCell = sheet.getRange(lastRow + 1, 17); // Image URL column (now column 17)
        urlCell.setFormula(`=HYPERLINK("${imageUploadResult.fileUrl}","View Image")`);
        urlCell.setFontColor('#1155cc');
      }
      
      console.log('✅ Transaction saved successfully');
      
      const response = { 
        transactionNumber: transactionNumber,
        rowNumber: lastRow + 1,
        totalTransactions: lastRow
      };
      
      if (imageUploadResult) {
        response.imageUpload = imageUploadResult;
        if (imageUploadResult.success) {
          return createResponse(true, 'Transaction and image saved successfully', response);
        } else {
          return createResponse(true, 'Transaction saved, but image upload failed', response);
        }
      } else {
        return createResponse(true, 'Transaction saved to history', response);
      }
      
    } catch (sheetError) {
      console.error('Sheet error:', sheetError);
      return createResponse(false, 'Sheet error: ' + sheetError.toString());
    }
    
  } catch (error) {
    console.error('doPost error:', error);
    return createResponse(false, 'doPost error: ' + error.toString());
  }
}

function uploadImageToDrive(data) {
  console.log('Starting image upload process...');
  
  try {
    if (!data.imageFile) {
      throw new Error('No image file data provided');
    }
    
    // Create organized folder structure
    const MAIN_FOLDER = 'Kas GYSPNK - Data';
    const IMAGE_FOLDER = 'Payment Images';
    
    // Get or create main folder
    let mainFolder;
    const mainFolders = DriveApp.getFoldersByName(MAIN_FOLDER);
    if (mainFolders.hasNext()) {
      mainFolder = mainFolders.next();
    } else {
      mainFolder = DriveApp.createFolder(MAIN_FOLDER);
      console.log('Created main folder:', MAIN_FOLDER);
    }
    
    // Get or create images subfolder
    let imageFolder;
    const imageFolders = mainFolder.getFoldersByName(IMAGE_FOLDER);
    if (imageFolders.hasNext()) {
      imageFolder = imageFolders.next();
    } else {
      imageFolder = mainFolder.createFolder(IMAGE_FOLDER);
      console.log('Created image folder:', IMAGE_FOLDER);
    }
    
    // Create organized filename with better readability
    const currentDate = new Date();
    const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = currentDate.toTimeString().split(' ')[0].replace(/:/g, '.'); // HH.MM.SS
    
    // Clean and format user name for filename
    const userName = data.userName || data.userEmail || 'Unknown';
    const cleanUserName = userName
      .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 20); // Limit length
    
    // Format amount with thousand separators
    const formattedAmount = (data.amount || 0).toLocaleString('id-ID');
    
    // Determine file extension
    let fileExtension = 'jpg'; // default
    if (data.imageFile.includes('data:image/png')) {
      fileExtension = 'png';
    } else if (data.imageFile.includes('data:image/jpeg') || data.imageFile.includes('data:image/jpg')) {
      fileExtension = 'jpg';
    } else if (data.imageFile.includes('data:image/webp')) {
      fileExtension = 'webp';
    }
    
    const fileName = `Payment ${dateStr} ${timeStr} - ${cleanUserName} - Rp ${formattedAmount}.${fileExtension}`;
    
    console.log('Creating file with name:', fileName);
    
    // Parse base64 image data
    const base64Data = data.imageFile.split(',')[1];
    if (!base64Data) {
      throw new Error('Invalid base64 image data');
    }
    
    const imageBlob = Utilities.newBlob(
      Utilities.base64Decode(base64Data),
      data.imageFile.split(';')[0].split(':')[1], // mime type
      fileName
    );
    
    // Upload to organized folder
    const uploadedFile = imageFolder.createFile(imageBlob);
    
    console.log('✅ Image uploaded successfully');
    console.log('File ID:', uploadedFile.getId());
    console.log('File name:', uploadedFile.getName());
    console.log('Folder path:', MAIN_FOLDER + '/' + IMAGE_FOLDER);
    
    // Make file viewable by anyone with the link (for easy access)
    uploadedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    return {
      success: true,
      fileName: fileName,
      fileId: uploadedFile.getId(),
      fileUrl: uploadedFile.getUrl(),
      viewUrl: `https://drive.google.com/file/d/${uploadedFile.getId()}/view`,
      folderPath: MAIN_FOLDER + '/' + IMAGE_FOLDER,
      uploadDate: currentDate.toISOString()
    };
    
  } catch (error) {
    console.error('❌ Image upload failed:', error.toString());
    throw new Error('Image upload failed: ' + error.toString());
  }
}

function createResponse(success, message, extra = {}) {
  const response = {
    success: success,
    message: message,
    timestamp: new Date().toISOString(),
    ...extra
  };
  
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  console.log('Getting persistent transaction history sheet...');
  
  // Fixed spreadsheet name and folder for consistency
  const SPREADSHEET_NAME = 'Kas GYSPNK - Transaction History';
  const FOLDER_NAME = 'Kas GYSPNK - Data';
  const SHEET_NAME = 'Transaction History';
  
  let spreadsheet;
  let sheet;
  
  try {
    // First, try to find existing spreadsheet by name
    console.log('Searching for existing spreadsheet:', SPREADSHEET_NAME);
    const files = DriveApp.getFilesByName(SPREADSHEET_NAME);
    
    if (files.hasNext()) {
      // Found existing spreadsheet
      const file = files.next();
      spreadsheet = SpreadsheetApp.openById(file.getId());
      console.log('✅ Found existing spreadsheet:', spreadsheet.getName());
      console.log('Spreadsheet ID:', spreadsheet.getId());
      console.log('Current location:', file.getParents().next().getName());
    } else {
      // Create new spreadsheet in organized folder
      console.log('Creating new spreadsheet and organizing in folder...');
      
      // Get or create folder
      let folder;
      const folders = DriveApp.getFoldersByName(FOLDER_NAME);
      if (folders.hasNext()) {
        folder = folders.next();
        console.log('✅ Using existing folder:', folder.getName());
      } else {
        folder = DriveApp.createFolder(FOLDER_NAME);
        console.log('✅ Created new folder:', folder.getName());
      }
      
      // Create spreadsheet
      spreadsheet = SpreadsheetApp.create(SPREADSHEET_NAME);
      console.log('✅ Created new spreadsheet:', spreadsheet.getName());
      
      // Move to organized folder
      const file = DriveApp.getFileById(spreadsheet.getId());
      file.getParents().next().removeFile(file);
      folder.addFile(file);
      console.log('✅ Moved spreadsheet to folder:', folder.getName());
    }
    
  } catch (error) {
    console.error('❌ Error accessing/creating spreadsheet:', error.toString());
    throw new Error('Cannot access or create transaction spreadsheet: ' + error.toString());
  }
  
  // Verify spreadsheet exists
  if (!spreadsheet) {
    throw new Error('Spreadsheet is null after creation/access attempt');
  }
  
  try {
    console.log('Looking for sheet:', SHEET_NAME);
    
    // Try to get existing sheet
    sheet = spreadsheet.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      console.log('Creating transaction history sheet...');
      
      // Create our sheet first
      sheet = spreadsheet.insertSheet(SHEET_NAME);
      console.log('✅ Created new sheet:', sheet.getName());
      
      // Then delete default sheet if it exists (and we have more than one sheet)
      const allSheets = spreadsheet.getSheets();
      if (allSheets.length > 1) {
        const defaultSheet = allSheets.find(s => 
          s.getName() === 'Sheet1' || s.getName() === 'Lembar1'
        );
        if (defaultSheet && defaultSheet.getName() !== SHEET_NAME) {
          spreadsheet.deleteSheet(defaultSheet);
          console.log('✅ Removed default sheet');
        }
      }
      
      // Set up comprehensive headers for transaction history including image columns
      const headers = [
        'No', 'Timestamp', 'Date (ID)', 'User Email', 'User Name', 
        'Amount (Rp)', 'From Month', 'From Year', 'To Month', 'To Year', 'Payment Period', 'Description', 
        'Type', 'Status', 'Source', 'Image File Name', 'Image URL', 'Image Folder'
      ];
      
      console.log('Setting up transaction history headers...');
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      
      // Format header row
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground('#2E7D32'); // Green theme
      headerRange.setFontColor('white');
      headerRange.setFontWeight('bold');
      headerRange.setHorizontalAlignment('center');
      
      // Set column widths for better readability
      sheet.setColumnWidth(1, 50);   // No
      sheet.setColumnWidth(2, 150);  // Timestamp
      sheet.setColumnWidth(3, 120);  // Date ID
      sheet.setColumnWidth(4, 200);  // Email
      sheet.setColumnWidth(5, 150);  // Name
      sheet.setColumnWidth(6, 100);  // Amount
      sheet.setColumnWidth(7, 80);   // From Month
      sheet.setColumnWidth(8, 80);   // From Year
      sheet.setColumnWidth(9, 80);   // To Month
      sheet.setColumnWidth(10, 80);  // To Year
      sheet.setColumnWidth(11, 150); // Payment Period
      sheet.setColumnWidth(12, 200); // Description
      sheet.setColumnWidth(13, 80);  // Type
      sheet.setColumnWidth(14, 80);  // Status
      sheet.setColumnWidth(15, 100); // Source
      sheet.setColumnWidth(16, 250); // Image File Name
      sheet.setColumnWidth(17, 120); // Image URL
      sheet.setColumnWidth(18, 150); // Image Folder
      
      console.log('✅ Transaction history sheet setup complete');
      
      // Add initial row to show it's working
      const initDate = new Date();
      const initMonth = initDate.getMonth() + 1;
      const initYear = initDate.getFullYear();
      const initMonthNames = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
      ];
      const initPeriod = `${initMonthNames[initMonth - 1]} ${initYear}`;
      
      const initialRow = [
        1, initDate.toISOString(), initDate.toLocaleDateString('id-ID'), 
        'system@gyspnk.site', 'System', 0, 
        initMonth, initYear, initMonth, initYear, initPeriod,
        'Transaction history initialized', 'system', 'initialized', 'Apps Script',
        '', '', '' // Empty image columns for system entry
      ];
      sheet.getRange(2, 1, 1, initialRow.length).setValues([initialRow]);
      
    } else {
      console.log('✅ Using existing transaction history sheet:', sheet.getName());
      console.log('Current transaction count:', Math.max(0, sheet.getLastRow() - 1));
    }
    
  } catch (sheetError) {
    console.error('❌ Sheet operation failed:', sheetError.toString());
    throw new Error('Sheet operation failed: ' + sheetError.toString());
  }
  
  return sheet;
}