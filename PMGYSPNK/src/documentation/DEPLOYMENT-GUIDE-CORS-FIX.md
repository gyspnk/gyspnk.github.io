# 🚀 Google Apps Script Deployment Guide with CORS Fix

## ⚠️ Current Issue Analysis

**URL yang ditest**: `https://script.google.com/macros/s/AKfycbxlX_UgSCtoOzAJJF3mJDSsCajf-ZTqZYe3fgdy0eybmUrzaytG2c5-nuWybn40noEj/exec`

**Test Results**:
- ✅ GET Request: Status 200 (Working)
- ❌ CORS Headers: Only `Vary: Accept-Encoding` (Missing CORS implementation)
- ❌ OPTIONS Request: 405 Method Not Allowed (No doOptions function)
- ❌ POST Response: Invalid JSON (Old implementation)

**Root Cause**: Deployment menggunakan kode lama yang tidak memiliki implementasi CORS yang sudah kita buat.

## 📋 Step-by-Step Deployment Fix

### Step 1: Verify Your Google Apps Script Code

1. **Open Google Apps Script Console**: https://script.google.com
2. **Find Your Project**: Look for the project with the URL above
3. **Check Code.gs Content**: Make sure it contains our enhanced code

**Required Functions to Check**:
```javascript
✅ getCorsHeaders(requestOrigin) - Dynamic CORS header generator
✅ doOptions(e) - OPTIONS preflight handler  
✅ ALLOWED_ORIGINS constant - Origin whitelist
✅ doPost(e) with CORS headers - Enhanced POST handler
```

### Step 2: Replace Code in Google Apps Script

1. **Select All Code**: Ctrl+A in the Code.gs editor
2. **Delete Existing Code**: Delete everything
3. **Copy Enhanced Code**: Copy the entire content from `apps-script.js` file
4. **Paste New Code**: Paste into Code.gs editor
5. **Save**: Ctrl+S or File → Save

### Step 3: Create New Deployment

**Important**: Don't update existing deployment, create a NEW one.

1. **Click "Deploy"** in top-right corner
2. **Select "New deployment"** (not "Manage deployments")
3. **Configuration**:
   - Type: Web app
   - Description: "CORS-Fixed Version with MDN Implementation"
   - Execute as: Me (your email)
   - Who has access: Anyone
4. **Click "Deploy"**
5. **Copy New URL**: This will be different from your current URL

### Step 4: Verify New Deployment

Use PowerShell to test the new URL:

```powershell
# Replace YOUR_NEW_URL with the deployment URL from Step 3
$newUrl = "YOUR_NEW_URL"

# Test OPTIONS request (should work now)
try {
    $response = Invoke-WebRequest -Uri $newUrl -Method OPTIONS -Headers @{"Origin"="http://localhost:8000"} -UseBasicParsing
    Write-Host "✅ OPTIONS Status: $($response.StatusCode)"
    Write-Host "✅ CORS Headers:"
    $response.Headers.GetEnumerator() | Where-Object { $_.Key -like "*Access-Control*" -or $_.Key -eq "Vary" } | ForEach-Object { 
        Write-Host "  $($_.Key): $($_.Value)" 
    }
} catch {
    Write-Host "❌ OPTIONS Failed: $($_.Exception.Message)"
}

# Test POST request
$body = '{"test": true, "userEmail": "test@gyspnk.site", "amount": 50000}'
try {
    $response = Invoke-WebRequest -Uri $newUrl -Method POST -Body $body -ContentType "application/json" -Headers @{"Origin"="http://localhost:8000"} -UseBasicParsing
    Write-Host "✅ POST Status: $($response.StatusCode)"
    $data = $response.Content | ConvertFrom-Json
    Write-Host "✅ Response: $($data.message)"
} catch {
    Write-Host "❌ POST Failed: $($_.Exception.Message)"
}
```

### Expected Results After Fix

**OPTIONS Request Response**:
```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: http://localhost:8000
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Origin
Access-Control-Max-Age: 3600
Access-Control-Allow-Credentials: true
Vary: Origin
```

**POST Request Response**:
```json
{
  "success": true,
  "message": "Test connection successful - Apps Script Updated with Google Drive",
  "timestamp": "2025-09-21T...",
  "version": "3.0 - Bank Transfer, OCR & Google Drive Support"
}
```

## 🔧 Alternative: Update Existing Deployment

If you prefer to update the existing deployment:

1. **Update Code**: Follow Step 2 above
2. **Go to Deploy → Manage deployments**
3. **Click the pencil icon** next to your web app
4. **Change Version**: Select "New version"
5. **Update Description**: "CORS-Fixed Version"
6. **Click "Deploy"**

**Note**: URL remains the same, but may take a few minutes to propagate.

## 🧪 Browser Testing

After deployment, test with the HTML tool:

1. **Start Python Server**: `python -m http.server 8000`
2. **Open Test Page**: http://localhost:8000/cors-test.html
3. **Enter New URL**: Paste your new deployment URL
4. **Run Tests**: Click "Test OPTIONS" and "Test POST"
5. **Check Results**: Should show ✅ for all tests

## 📱 Update Your Applications

After successful deployment, update the script URL in:

1. **Firebase Configuration**
2. **Web Application Settings**
3. **Mobile App Configuration**
4. **Any Hardcoded References**

Replace:
```
OLD: https://script.google.com/macros/s/AKfycbxlX_UgSCtoOzAJJF3mJDSsCajf-ZTqZYe3fgdy0eybmUrzaytG2c5-nuWybn40noEj/exec
NEW: [Your new deployment URL with CORS support]
```

## ❗ Common Deployment Issues

### Issue 1: "Script function not found"
**Solution**: Make sure you pasted the complete code, including all functions.

### Issue 2: "Authorization required"
**Solution**: 
1. Go to Extensions → Apps Script API
2. Enable the API
3. Grant necessary permissions

### Issue 3: "Deployment failed"
**Solution**:
1. Check for syntax errors in code
2. Save the project first
3. Try deploying again

### Issue 4: "Still getting CORS errors"
**Solution**:
1. Clear browser cache
2. Wait 2-3 minutes for propagation
3. Verify you're using the NEW deployment URL

## 🎯 Quick Checklist

- [ ] Open Google Apps Script console
- [ ] Find the correct project
- [ ] Replace code with enhanced version (entire `apps-script.js` content)
- [ ] Save the project
- [ ] Create NEW deployment (not update existing)
- [ ] Test with PowerShell commands
- [ ] Update application URLs
- [ ] Test in browser with cors-test.html

## 📞 If Still Having Issues

1. **Check Console Logs**: Look for JavaScript errors
2. **Network Tab**: Check actual HTTP headers in browser DevTools
3. **Apps Script Logs**: Check execution transcript for errors
4. **Test Different Origins**: Try with different domains from whitelist

The key issue is that your current deployment doesn't have the CORS implementation. Once you deploy the correct code, all CORS issues should be resolved.