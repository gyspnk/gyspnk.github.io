# 🔍 Google Apps Script Diagnostics

## ❌ Problem Identified

**Current Issue**: Google Apps Script mengembalikan HTML error page dengan title "Salah" ketika menerima POST request.

**Evidence**:
- ✅ GET request working (Status 200)
- ✅ Basic CORS header present: `Access-Control-Allow-Origin: *`
- ❌ OPTIONS request: 405 Method Not Allowed
- ❌ POST request: Returns HTML error page instead of JSON
- ❌ Response Content-Type: `text/html` (should be `application/json`)

## 🕵️ Root Cause Analysis

The script is throwing an error when processing POST requests. Common causes:

1. **Syntax Error in Code**: JavaScript syntax error preventing execution
2. **Missing Permissions**: Script doesn't have required permissions
3. **Runtime Error**: Error in `doPost()` function execution
4. **Incomplete Code Upload**: Not all code was properly copied

## 🛠️ Troubleshooting Steps

### Step 1: Check Google Apps Script Console

1. **Open Apps Script Console**: https://script.google.com
2. **Find Your Project**: Look for the project with URL ending in `...nuWybn40noEj`
3. **Check Executions**: Go to "Executions" tab
4. **Look for Errors**: Check recent execution logs for error details

### Step 2: Verify Complete Code Upload

**Check if these functions exist in your Code.gs**:

```javascript
✅ const ALLOWED_ORIGINS = [...]
✅ function getCorsHeaders(requestOrigin) {...}
✅ function doOptions(e) {...}
✅ function doPost(e) {...}
✅ function doGet(e) {...}
```

### Step 3: Test with Simple Function

Add this test function to check basic functionality:

```javascript
function testScript() {
  console.log("Script is working");
  return "Test successful";
}
```

### Step 4: Check Permissions

The script needs these permissions:
- Google Sheets API
- Google Drive API
- External URL access

## 🔧 Quick Fix Steps

### Option 1: Re-deploy with Minimal Code

1. **Backup Current Code**: Copy your current code
2. **Test with Minimal Function**:
```javascript
function doPost(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      message: "Minimal test working",
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
}

function doOptions(e) {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
}
```

3. **Test Minimal Version**: If this works, gradually add back features

### Option 2: Check for Common Errors

**Look for these in your code**:

1. **Missing Semicolons**: JavaScript syntax errors
2. **Undefined Variables**: Variables used before declaration
3. **API Permissions**: Make sure all APIs are enabled
4. **JSON Parsing**: Check `JSON.parse()` calls for errors

## 🧪 Diagnostic Commands

**Test the minimal version**:
```powershell
# Test minimal POST
$body = '{"test": true}';
$response = Invoke-WebRequest -Uri "YOUR_URL" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing;
Write-Host "Status: $($response.StatusCode)";
Write-Host "Content-Type: $($response.Headers['Content-Type'])";
if ($response.Headers['Content-Type'] -like "*json*") {
    $data = $response.Content | ConvertFrom-Json;
    Write-Host "Success: $($data.success)";
    Write-Host "Message: $($data.message)";
} else {
    Write-Host "HTML Response - there's an error in the script";
}
```

## 🎯 Expected vs Actual

### Expected Response:
```json
{
  "success": true,
  "message": "Test connection successful",
  "version": "3.0"
}
```

### Actual Response:
```html
<!DOCTYPE html>
<html>
<head>
  <title>Salah</title>
  ...
</head>
```

## 📋 Action Plan

1. **Check Apps Script Console** for execution errors
2. **Verify complete code upload** with all required functions
3. **Test with minimal code** to isolate the issue
4. **Grant necessary permissions** if prompted
5. **Redeploy after fixing** the underlying error

The fact that you get an HTML error page means the script is running but encountering a runtime error. Check the Apps Script execution logs to see the specific error message.