/**
 * Google Drive API helper using service account
 * All uploads go to staff.pas.kkr@kanaan.sch.id's Drive storage
 */

let _cachedToken = null;
let _tokenExpiry = 0;

function getServiceAccount(env) {
  try {
    return JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  } catch(e) {
    return {};
  }
}

async function getAccessToken(env) {
  if (_cachedToken && Date.now() < _tokenExpiry - 60000) {
    return _cachedToken;
  }

  const sa = getServiceAccount(env);
  if (!sa.client_email || !sa.private_key) {
    throw new Error('Google Service Account not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON secret.');
  }

  // Create JWT
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encoder = new TextEncoder();
  const headerB64 = btoaUrl(encoder.encode(JSON.stringify(header)));
  const payloadB64 = btoaUrl(encoder.encode(JSON.stringify(payload)));
  const toSign = `${headerB64}.${payloadB64}`;

  // Sign with private key
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' }, key, encoder.encode(toSign)
  );
  const sigB64 = btoaUrl(signature);
  const jwt = `${toSign}.${sigB64}`;

  // Exchange JWT for access token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google OAuth error: ${err}`);
  }

  const data = await res.json();
  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}

async function importPrivateKey(pemKey) {
  // Clean up PEM format
  const pem = pemKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const binary = atob(pem);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return crypto.subtle.importKey(
    'pkcs8', bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

function btoaUrl(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function atob(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return globalThis.atob(str);
}

/**
 * Upload file to Google Drive with structured folder path
 */
export async function uploadToDrive(env, fileName, base64Data, mimeType, folderPath) {
  const token = await getAccessToken(env);

  // Step 1: Create/get folder structure
  const folderId = await getOrCreateFolderPath(token, folderPath);

  // Step 2: Upload file as multipart
  const metadata = { name: fileName, parents: [folderId], mimeType: mimeType || 'image/jpeg' };
  const boundary = '-------driveuploadboundary';
  const parts = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType || 'image/jpeg'}`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Data,
    `--${boundary}--`
  ];
  const body = parts.join('\r\n');

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Drive upload error: ${uploadRes.status}`);
  }

  const fileData = await uploadRes.json();

  // Step 3: Make file publicly readable
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });

  return {
    fileId: fileData.id,
    webViewLink: fileData.webViewLink || `https://drive.google.com/file/d/${fileData.id}/view`,
    thumbnailLink: fileData.thumbnailLink || ''
  };
}

async function getOrCreateFolderPath(token, folderPath) {
  const parts = folderPath.split('/').filter(Boolean);
  let parentId = 'root';

  for (const folderName of parts) {
    const query = encodeURIComponent(
      `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    );
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const searchData = await searchRes.json();

    if (searchData.files && searchData.files.length > 0) {
      parentId = searchData.files[0].id;
    } else {
      const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId]
        })
      });
      const createData = await createRes.json();
      parentId = createData.id;
    }
  }

  return parentId;
}
