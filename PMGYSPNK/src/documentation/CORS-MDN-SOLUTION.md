# CORS Solution Implementation - MDN Best Practices

## Overview
This document details the implementation of CORS (Cross-Origin Resource Sharing) fixes based on Mozilla MDN documentation for the Google Apps Script webhook, specifically addressing the "CORS header 'Access-Control-Allow-Origin' missing" error.

## Source Documentation
- **Reference**: [MDN CORS Missing Allow Origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSMissingAllowOrigin)
- **Implementation Date**: September 21, 2025
- **Applied to**: Google Apps Script v3.0 for Kas Pemuda GYSPNK

## Problem Analysis
The CORS error occurs when:
1. Browser makes a cross-origin request to Google Apps Script
2. Server doesn't include proper `Access-Control-Allow-Origin` header
3. Browser blocks the response for security reasons

## MDN-Recommended Solution
Instead of using wildcard `*` for all origins, the MDN documentation recommends:

1. **Dynamic Origin Handling**: Read the `Origin` header from requests
2. **Whitelist Specific Origins**: Maintain a list of allowed domains
3. **Conditional Headers**: Set appropriate headers based on request origin
4. **Include Vary Header**: Add `Vary: Origin` for proper caching

## Implementation Details

### 1. Allowed Origins Configuration
```javascript
const ALLOWED_ORIGINS = [
  'http://localhost:8000',       // Local development
  'http://127.0.0.1:8000',      // Alternative localhost
  'https://thengb.github.io',    // GitHub Pages
  'https://gyspnk.site',         // Production domain
  'https://www.gyspnk.site'      // Production with www
];
```

### 2. Dynamic CORS Headers Function
```javascript
function getCorsHeaders(requestOrigin) {
  let allowOrigin = '*';
  let allowCredentials = 'false';
  
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    allowOrigin = requestOrigin;
    allowCredentials = 'true';
  }
  
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Origin',
    'Access-Control-Max-Age': '3600',
    'Access-Control-Allow-Credentials': allowCredentials,
    'Vary': 'Origin'
  };
}
```

### 3. OPTIONS Preflight Handler
```javascript
function doOptions(e) {
  let requestOrigin = null;
  try {
    requestOrigin = e.parameter?.origin || e.headers?.Origin || e.headers?.origin;
  } catch (error) {
    console.log('Could not read origin header:', error);
  }
  
  return ContentService
    .createTextOutput()
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders(getCorsHeaders(requestOrigin));
}
```

## Key Improvements

### Before (Wildcard Approach)
```javascript
'Access-Control-Allow-Origin': '*'
```

### After (Dynamic Origin Approach)
```javascript
// Reads actual origin from request
// Uses specific origin if whitelisted
// Falls back to wildcard for unknown origins
// Includes Vary: Origin header for proper caching
```

## Security Benefits

1. **Credential Support**: Allows credentials for trusted domains
2. **Origin Validation**: Only specific domains get full access
3. **Proper Caching**: `Vary: Origin` ensures correct cache behavior
4. **Fallback Safety**: Unknown origins still get basic access with wildcard

## Testing Commands

### PowerShell Testing for All Domains

```powershell
# Test localhost
Invoke-WebRequest -Uri "YOUR_SCRIPT_URL" -Method OPTIONS -Headers @{"Origin"="http://localhost:8000"} -UseBasicParsing

# Test GitHub Pages
Invoke-WebRequest -Uri "YOUR_SCRIPT_URL" -Method OPTIONS -Headers @{"Origin"="https://thengb.github.io"} -UseBasicParsing

# Test Production Domain
Invoke-WebRequest -Uri "YOUR_SCRIPT_URL" -Method OPTIONS -Headers @{"Origin"="https://gyspnk.site"} -UseBasicParsing

# Test Unknown Origin (should get wildcard)
Invoke-WebRequest -Uri "YOUR_SCRIPT_URL" -Method OPTIONS -Headers @{"Origin"="https://unknown.com"} -UseBasicParsing
```

### Expected Headers in Response
```
Access-Control-Allow-Origin: http://localhost:8000 (or specific origin)
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Origin
Access-Control-Max-Age: 3600
Access-Control-Allow-Credentials: true (for whitelisted origins)
Vary: Origin
```

## Domain-Specific Configuration

### Localhost Development
- **Origin**: `http://localhost:8000`
- **Credentials**: Enabled
- **Use Case**: Local development and testing

### GitHub Pages
- **Origin**: `https://thengb.github.io`
- **Credentials**: Enabled
- **Use Case**: Staging/demo environment

### Production Domain
- **Origin**: `https://gyspnk.site` and `https://www.gyspnk.site`
- **Credentials**: Enabled
- **Use Case**: Live production environment

## Deployment Steps

1. **Update Apps Script**: Copy the enhanced code to Google Apps Script
2. **Deploy New Version**: Create new deployment in Apps Script console
3. **Update Web App URLs**: Replace old script URLs in all applications
4. **Test All Domains**: Verify CORS works for localhost, GitHub Pages, and production
5. **Monitor Logs**: Check Apps Script logs for origin validation

## Troubleshooting Guide

### If CORS Still Fails

1. **Check Script URL**: Ensure using latest deployment URL
2. **Verify Origin Header**: Browser must send correct origin
3. **Check Console Logs**: Look for origin validation messages
4. **Test with PowerShell**: Verify server-side CORS implementation
5. **Clear Browser Cache**: Force fresh preflight requests

### Common Issues

- **Mixed URLs**: Using old deployment without CORS fixes
- **Case Sensitivity**: Origin domains must match exactly
- **Protocol Mismatch**: HTTP vs HTTPS in origin validation
- **Subdomain Issues**: www vs non-www domain variations

## Performance Notes

- **Preflight Caching**: 3600 seconds max-age reduces repeated OPTIONS calls
- **Origin Validation**: Minimal performance impact with whitelist check
- **Vary Header**: Ensures proper CDN/proxy caching behavior

## Security Considerations

- **Whitelist Maintenance**: Keep allowed origins list current
- **Credential Handling**: Only trusted domains can send credentials
- **Logging**: Track unauthorized origin attempts
- **Regular Review**: Audit allowed origins periodically

## Files Modified

1. `apps-script.js` - Updated with dynamic CORS implementation
2. All response methods now use `getCorsHeaders()` function
3. OPTIONS handler enhanced with origin validation
4. Constants added for maintainable origin whitelist

## Next Steps

1. Test implementation across all three target domains
2. Monitor Apps Script execution logs for CORS validation
3. Update any client-side code to handle credential requirements
4. Document any domain-specific deployment considerations