import { query, execute, initSchema } from './db.js';
import { hashPassword, verifyPassword, createJWT, verifyJWT } from './auth.js';

let _schemaReady = false;
// In-memory cache for calendar schedules (5 min TTL)
const _calendarCache = new Map();
async function ensureSchema(env) {
  if (!_schemaReady) {
    try { await initSchema(env); } catch (e) { console.error('Schema init:', e.message); }
    _schemaReady = true;
  }
  // Always run migrations (idempotent DDL) — catches tables added after initial deploy
  try {
    await execute(env,
      `CREATE TABLE IF NOT EXISTS employee_presensi_active (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL,
        presensi_type VARCHAR(50) NOT NULL,
        is_active INT DEFAULT 1,
        UNIQUE KEY uq_emp_presensi (employee_id, presensi_type)
      )`);
  } catch (e) { console.error('Migration employee_presensi_active:', e.message); }
}

// Simple CSV line parser
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// Helper: parse GSA_JSON with aggressive cleanup
function parseGSAJson(raw) {
  if (!raw) return null;
  let str = raw;
  // Remove ALL characters before the first '{' — handles BOM, whitespace, newlines, anything
  const start = str.indexOf('{');
  if (start > 0) str = str.slice(start);
  if (start < 0) throw new Error('No JSON object found in GSA_JSON');
  return JSON.parse(str);
}

// ===== Google Service Account OAuth2 (Web Crypto JWT) =====
// Used for non-public Google Sheets. Credentials stored as Cloudflare Worker secret `GSA_JSON`.
// No credentials are ever exposed to client — token exchange happens entirely server-side.

function base64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new TextEncoder().encode(String(buf));
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 4096) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + 4096, bytes.length))));
  }
  return btoa(chunks.join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function pemToBytes(pem) {
  const b64 = pem
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function signJWT(header, payload, privateKeyPEM) {
  const keyData = pemToBytes(privateKeyPEM);
  const key = await crypto.subtle.importKey(
    'pkcs8', keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const toSign = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(toSign));
  return `${toSign}.${base64url(new Uint8Array(sig))}`;
}

let _cachedAccessToken = null;
let _tokenExpiry = 0;

async function getGoogleAccessToken(env) {
  // Return cached token if still valid (with 60s safety margin)
  if (_cachedAccessToken && Date.now() < _tokenExpiry - 60000) {
    return _cachedAccessToken;
  }

  let sa;
  try { sa = parseGSAJson(env.GSA_JSON); } catch (e) { console.error('GSA_JSON parse error:', e.message); return null; }
  if (!sa || !sa.client_email || !sa.private_key) { console.error('GSA_JSON missing client_email or private_key'); return null; }

  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJWT(
    { alg: 'RS256', typ: 'JWT' },
    { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now },
    sa.private_key
  );

  const tokenUrl = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`
  });

  if (!res.ok) { console.error('Google OAuth2 token error:', res.status, await res.text().catch(() => '')); return null; }

  const data = await res.json();
  _cachedAccessToken = data.access_token;
  _tokenExpiry = Date.now() + ((data.expires_in || 3600) * 1000);
  return _cachedAccessToken;
}

async function fetchSheetViaSheetsAPI(sheetId, gid, accessToken) {
  // Get sheet name from gid via metadata
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`;
  const metaRes = await fetch(metaUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!metaRes.ok) return null;

  const meta = await metaRes.json();
  let sheetName = null;
  const gidNum = parseInt(gid, 10);
  if (meta.sheets) {
    for (const s of meta.sheets) {
      if (s.properties.sheetId === gidNum) { sheetName = s.properties.title; break; }
    }
  }
  if (!sheetName && meta.sheets && meta.sheets.length > 0) sheetName = meta.sheets[0].properties.title;
  if (!sheetName) sheetName = 'Sheet1';

  // Fetch values
  const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(sheetName)}?valueRenderOption=FORMATTED_VALUE`;
  const dataRes = await fetch(valuesUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!dataRes.ok) return null;

  const data = await dataRes.json();
  const values = data.values || [];
  if (values.length === 0) return { columns: [], rows: [] };

  const columns = values[0].map(c => String(c || ''));
  const rows = values.slice(1);
  return { columns, rows };
}

async function fetchSheetViaSheetsAPIWithKey(sheetId, gid, apiKey) {
  // Get sheet name from gid via metadata
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties&key=${encodeURIComponent(apiKey)}`;
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) return null;

  const meta = await metaRes.json();
  let sheetName = null;
  const gidNum = parseInt(gid, 10);
  if (meta.sheets) {
    for (const s of meta.sheets) {
      if (s.properties.sheetId === gidNum) { sheetName = s.properties.title; break; }
    }
  }
  if (!sheetName && meta.sheets && meta.sheets.length > 0) sheetName = meta.sheets[0].properties.title;
  if (!sheetName) sheetName = 'Sheet1';

  // Fetch values
  const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(sheetName)}?valueRenderOption=FORMATTED_VALUE&key=${encodeURIComponent(apiKey)}`;
  const dataRes = await fetch(valuesUrl);
  if (!dataRes.ok) return null;

  const data = await dataRes.json();
  const values = data.values || [];
  if (values.length === 0) return { columns: [], rows: [] };

  const columns = values[0].map(c => String(c || ''));
  const rows = values.slice(1);
  return { columns, rows };
}

// ===== End Google OAuth2 helpers =====

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin'
});

const json = (data, status, origin) =>
  new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = (env.CORS_ORIGIN || '*').split(',');
    const allowOrigin = allowedOrigins.includes('*') ? origin : (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowOrigin) });
    }

    try {
      await ensureSchema(env);

      if (path === '/api/auth/status' && request.method === 'GET') {
        const users = await query(env, 'SELECT COUNT(*) as cnt FROM users');
        return json({ hasUsers: users[0].cnt > 0 }, 200, allowOrigin);
      }

      if (path === '/api/setup' && request.method === 'POST') {
        const users = await query(env, 'SELECT COUNT(*) as cnt FROM users');
        if (users[0].cnt > 0) return json({ error: 'Setup sudah dilakukan' }, 403, allowOrigin);
        const { username, fullName, password, role } = await request.json();
        if (!username || !password || !fullName) return json({ error: 'Field tidak lengkap' }, 400, allowOrigin);
        const { hash, salt } = await hashPassword(password);
        await execute(env, 'INSERT INTO users (username, full_name, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)',
          [username, fullName, hash, salt, role || 'admin']);
        return json({ success: true }, 200, allowOrigin);
      }

      if (path === '/api/auth/login' && request.method === 'POST') {
        const { username, password } = await request.json();
        const users = await query(env, 'SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0) return json({ error: 'User tidak ditemukan' }, 401, allowOrigin);
        const user = users[0];
        const valid = await verifyPassword(password, user.password_hash, user.salt);
        if (!valid) return json({ error: 'Password salah' }, 401, allowOrigin);
        let permissions = {};
        try { permissions = JSON.parse(user.permissions || '{}'); } catch(e) {}
        const token = await createJWT({ id: user.id, username: user.username, role: user.role, permissions }, env.JWT_SECRET);
        return json({ token, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, permissions } }, 200, allowOrigin);
      }

      // ===== Debug: Test Google Sheets OAuth2 (PUBLIC — no auth) =====
      if (path === '/api/debug-oauth2' && request.method === 'GET') {
        const sheetId = url.searchParams.get('sheetId') || '1Xkhum8q8c8RvJy3Vck4qm54P0ik7d6y6zaxR_XO4gc4';
        const steps = [];
        steps.push({ step: 'secrets', hasGapiKey: !!env.GAPI_KEY, hasGsaJson: !!env.GSA_JSON });

        if (env.GSA_JSON) {
          try {
            const sa = parseGSAJson(env.GSA_JSON);
            steps.push({ step: 'gsa_parsed', client_email: sa.client_email });
            const now = Math.floor(Date.now() / 1000);
            const jwt = await signJWT(
              { alg: 'RS256', typ: 'JWT' },
              { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
                aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now },
              sa.private_key
            );
            steps.push({ step: 'jwt_signed', ok: true });

            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`
            });
            const tokenBody = await tokenRes.text();
            steps.push({ step: 'token_exchange', status: tokenRes.status, ok: tokenRes.ok });

            if (tokenRes.ok) {
              const tokenData = JSON.parse(tokenBody);
              steps.push({ step: 'token_obtained', ok: true });

              const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`;
              const metaRes = await fetch(metaUrl, { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } });
              steps.push({ step: 'sheet_meta', status: metaRes.status, ok: metaRes.ok });

              if (metaRes.ok) {
                const meta = await metaRes.json();
                const sheets = (meta.sheets || []).map(s => ({ title: s.properties.title, sheetId: s.properties.sheetId }));
                steps.push({ step: 'sheet_found', sheets });

                // Fetch first 8 rows of actual data
                if (sheets.length > 0) {
                  const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheets[0].title)}?valueRenderOption=FORMATTED_VALUE`;
                  const valuesRes = await fetch(valuesUrl, { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } });
                  if (valuesRes.ok) {
                    const valuesData = await valuesRes.json();
                    const allValues = valuesData.values || [];
                    steps.push({ step: 'values_total', count: allValues.length });
                    steps.push({ step: 'sample_rows', rows: allValues.slice(0, 8) });
                  }
                }
              } else {
                const errBody = await metaRes.text();
                steps.push({ step: 'sheet_meta_error', status: metaRes.status, body: errBody.substring(0, 300) });
              }
            } else {
              steps.push({ step: 'token_error', body: tokenBody.substring(0, 300) });
            }
          } catch (e) {
            steps.push({ step: 'error', message: e.message, stack: e.stack ? e.stack.substring(0, 300) : '' });
          }
        } else {
          steps.push({ step: 'no_gsa_json', error: 'GSA_JSON secret not configured' });
        }
        return json({ success: true, steps }, 200, allowOrigin);
      }

      // Auth required below
      const authHeader = request.headers.get('Authorization');
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const payload = await verifyJWT(token, env.JWT_SECRET);
      if (!payload) return json({ error: 'Tidak terautentikasi' }, 401, allowOrigin);

      if (path === '/api/users' && request.method === 'GET') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const users = await query(env, 'SELECT id, username, full_name, role, permissions, created_at FROM users ORDER BY id');
        return json(users, 200, allowOrigin);
      }

      if (path === '/api/users' && request.method === 'POST') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const { username, fullName, password, role, permissions } = await request.json();
        if (!username || !password || !fullName) return json({ error: 'Field tidak lengkap' }, 400, allowOrigin);
        const existing = await query(env, 'SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0) return json({ error: 'Username sudah ada' }, 409, allowOrigin);
        const { hash, salt } = await hashPassword(password);
        const permsJson = permissions ? JSON.stringify(permissions) : null;
        await execute(env, 'INSERT INTO users (username, full_name, password_hash, salt, role, permissions) VALUES (?, ?, ?, ?, ?, ?)',
          [username, fullName, hash, salt, role || 'guru_agama', permsJson]);
        return json({ success: true }, 201, allowOrigin);
      }

      if (path.startsWith('/api/users/') && request.method === 'PUT') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        const body = await request.json();
        if (body.permissions !== undefined) {
          const permsJson = body.permissions ? JSON.stringify(body.permissions) : null;
          await execute(env, 'UPDATE users SET permissions = ? WHERE id = ?', [permsJson, id]);
        }
        if (body.role !== undefined) {
          await execute(env, 'UPDATE users SET role = ? WHERE id = ?', [body.role, id]);
        }
        return json({ success: true }, 200, allowOrigin);
      }

      if (path.startsWith('/api/users/') && request.method === 'DELETE') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        if (id === payload.id) return json({ error: 'Tidak bisa hapus diri sendiri' }, 400, allowOrigin);
        await execute(env, 'DELETE FROM users WHERE id = ?', [id]);
        return json({ success: true }, 200, allowOrigin);
      }

      // ===== Divisions =====
      if (path === '/api/divisions' && request.method === 'GET') {
        const rows = await query(env, 'SELECT * FROM divisions ORDER BY is_active DESC, name');
        return json(rows, 200, allowOrigin);
      }

      if (path === '/api/divisions' && request.method === 'POST') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const { name } = await request.json();
        if (!name || !name.trim()) return json({ error: 'Nama divisi tidak boleh kosong' }, 400, allowOrigin);
        const existing = await query(env, 'SELECT id FROM divisions WHERE name = ?', [name.trim()]);
        if (existing.length > 0) return json({ error: 'Divisi sudah ada' }, 409, allowOrigin);
        await execute(env, 'INSERT INTO divisions (name, is_active) VALUES (?, ?)', [name.trim(), true]);
        return json({ success: true }, 201, allowOrigin);
      }

      if (path.startsWith('/api/divisions/') && request.method === 'PUT') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        const body = await request.json();
        if (body.name !== undefined) {
          await execute(env, 'UPDATE divisions SET name = ? WHERE id = ?', [body.name.trim(), id]);
        }
        return json({ success: true }, 200, allowOrigin);
      }

      if (path.startsWith('/api/divisions/') && request.method === 'DELETE') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        const div = await query(env, 'SELECT name FROM divisions WHERE id = ?', [id]);
        if (div.length === 0) return json({ error: 'Divisi tidak ditemukan' }, 404, allowOrigin);
        const empCount = await query(env, 'SELECT COUNT(*) as cnt FROM employees WHERE division = ? AND (is_active_rh = TRUE OR is_active_im = TRUE)', [div[0].name]);
        if (empCount[0].cnt > 0) return json({ error: `Tidak bisa hapus: masih ada ${empCount[0].cnt} karyawan aktif di divisi ini` }, 400, allowOrigin);
        await execute(env, 'DELETE FROM divisions WHERE id = ?', [id]);
        return json({ success: true }, 200, allowOrigin);
      }

      if (path === '/api/attendance' && request.method === 'GET') {
        const params = url.searchParams;
        let sql = 'SELECT * FROM attendance WHERE 1=1';
        const vals = [];
        if (params.get('startDate')) { sql += ' AND attendance_date >= ?'; vals.push(params.get('startDate')); }
        if (params.get('endDate')) { sql += ' AND attendance_date <= ?'; vals.push(params.get('endDate')); }
        if (params.get('academicYear')) { sql += ' AND academic_year = ?'; vals.push(params.get('academicYear')); }
        if (params.get('date')) { sql += ' AND attendance_date = ?'; vals.push(params.get('date')); }
        if (params.get('presensiType')) { sql += ' AND presensi_type = ?'; vals.push(params.get('presensiType')); }
        sql += ' ORDER BY attendance_date, employee_name';
        const rows = await query(env, sql, vals);
        return json(rows, 200, allowOrigin);
      }

      if (path === '/api/attendance' && request.method === 'POST') {
        const { date, academicYear, recordedBy, recordedByRole, records, presensiType } = await request.json();
        if (!date || !academicYear || !records || !records.length) return json({ error: 'Data tidak lengkap' }, 400, allowOrigin);
        const pType = presensiType || 'renungan_harian';
        let count = 0;
        for (const rec of records) {
          await execute(env,
            `INSERT INTO attendance (employee_name, employee_position, employee_division, employee_status, academic_year, attendance_date, presensi_type, status, notes, recorded_by, recorded_by_role)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes), recorded_by = VALUES(recorded_by), recorded_by_role = VALUES(recorded_by_role), updated_at = CURRENT_TIMESTAMP`,
            [rec.employee_name, rec.employee_position, rec.employee_division, rec.employee_status, academicYear, date, pType, rec.status, rec.notes || '', recordedBy, recordedByRole]
          );
          count++;
        }
        return json({ success: true, count }, 200, allowOrigin);
      }

      if (path === '/api/attendance' && request.method === 'DELETE') {
        if (payload.role !== 'admin') return json({ error: 'Hanya admin yang bisa menghapus presensi' }, 403, allowOrigin);
        const params = url.searchParams;
        const date = params.get('date');
        const academicYear = params.get('academicYear');
        const presensiType = params.get('presensiType') || 'renungan_harian';
        const employeeName = params.get('employeeName'); // optional — delete single user
        if (!date || !academicYear) return json({ error: 'date dan academicYear diperlukan' }, 400, allowOrigin);
        let sql = 'DELETE FROM attendance WHERE attendance_date = ? AND academic_year = ? AND presensi_type = ?';
        const vals = [date, academicYear, presensiType];
        if (employeeName) {
          sql += ' AND employee_name = ?';
          vals.push(employeeName);
        }
        await execute(env, sql, vals);
        return json({ success: true }, 200, allowOrigin);
      }

      // ===== Academic Years =====
      if (path === '/api/academic-years' && request.method === 'GET') {
        const rows = await query(env, 'SELECT * FROM academic_years ORDER BY sort_order, id');
        return json(rows, 200, allowOrigin);
      }

      if (path === '/api/academic-years' && request.method === 'POST') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const { yearCode, yearLabel } = await request.json();
        if (!yearCode || !yearLabel) return json({ error: 'Field tidak lengkap' }, 400, allowOrigin);
        const existing = await query(env, 'SELECT id FROM academic_years WHERE year_code = ?', [yearCode]);
        if (existing.length > 0) return json({ error: 'Tahun ajaran sudah ada' }, 409, allowOrigin);
        const maxOrder = await query(env, 'SELECT MAX(sort_order) as mx FROM academic_years');
        const sortOrder = (maxOrder[0].mx || 0) + 1;
        await execute(env, 'INSERT INTO academic_years (year_code, year_label, is_active, sort_order) VALUES (?, ?, ?, ?)',
          [yearCode, yearLabel, true, sortOrder]);
        return json({ success: true }, 201, allowOrigin);
      }

      if (path.startsWith('/api/academic-years/') && request.method === 'DELETE') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        const attCount = await query(env, 'SELECT COUNT(*) as cnt FROM attendance WHERE academic_year = (SELECT year_label FROM academic_years WHERE id = ?)', [id]);
        if (attCount[0].cnt > 0) return json({ error: `Tidak bisa hapus: masih ada ${attCount[0].cnt} record presensi` }, 400, allowOrigin);
        await execute(env, 'DELETE FROM employees WHERE academic_year_id = ?', [id]);
        await execute(env, 'DELETE FROM academic_years WHERE id = ?', [id]);
        return json({ success: true }, 200, allowOrigin);
      }

      // ===== Employees =====
      if (path === '/api/employees' && request.method === 'GET') {
        const params = url.searchParams;
        let sql = `SELECT e.*, ay.year_label, ay.year_code FROM employees e
                   JOIN academic_years ay ON e.academic_year_id = ay.id WHERE 1=1`;
        const vals = [];
        if (params.get('academicYear')) { sql += ' AND ay.year_label = ?'; vals.push(params.get('academicYear')); }

        // Support legacy active flags AND new dynamic presensi active table
        const activeFilter = params.get('activePresensi');
        if (params.get('active') === 'true') {
          sql += ' AND (e.is_active_rh = TRUE OR e.is_active_im = TRUE)';
        } else if (activeFilter) {
          // Filter employees active for a specific presensi type via the junction table
          sql += ` AND e.id IN (SELECT employee_id FROM employee_presensi_active WHERE presensi_type = ? AND is_active = TRUE)`;
          vals.push(activeFilter);
        }
        sql += ' ORDER BY e.name';
        const rows = await query(env, sql, vals);

        // Fetch dynamic active flags for all returned employees
        if (rows.length > 0) {
          const empIds = rows.map(r => r.id);
          const placeholders = empIds.map(() => '?').join(',');
          const activeFlags = await query(env,
            `SELECT employee_id, presensi_type, is_active FROM employee_presensi_active WHERE employee_id IN (${placeholders})`,
            empIds);
          // Merge into rows
          const flagMap = {};
          activeFlags.forEach(f => {
            if (!flagMap[f.employee_id]) flagMap[f.employee_id] = {};
            flagMap[f.employee_id][f.presensi_type] = !!f.is_active;
          });
          rows.forEach(r => {
            r._presensi_active = flagMap[r.id] || {};
          });
        }
        return json(rows, 200, allowOrigin);
      }

      if (path === '/api/employees' && request.method === 'POST') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const { name, position, division, employmentStatus, academicYearId } = await request.json();
        if (!name || !academicYearId) return json({ error: 'Field tidak lengkap' }, 400, allowOrigin);
        const existing = await query(env, 'SELECT id FROM employees WHERE name = ? AND academic_year_id = ?', [name, academicYearId]);
        if (existing.length > 0) return json({ error: 'Karyawan sudah ada di tahun ajaran ini' }, 409, allowOrigin);
        const result = await execute(env, 'INSERT INTO employees (name, position, division, employment_status, academic_year_id, is_active_rh, is_active_im) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [name, position || '', division || '', employmentStatus || '', academicYearId, true, true]);
        // Create default active flags for all guru presensi types
        const allTypes = await query(env, 'SELECT type_key FROM presensi_types WHERE category = ? AND is_active = TRUE', ['guru']);
        const empId = result.insertId;
        for (const t of allTypes) {
          await execute(env,
            'INSERT INTO employee_presensi_active (employee_id, presensi_type, is_active) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE is_active = TRUE',
            [empId, t.type_key, 1]);
        }
        return json({ success: true, id: empId }, 201, allowOrigin);
      }

      if (path.startsWith('/api/employees/') && request.method === 'PUT') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        const body = await request.json();
        // Generic presensi type toggle (new dynamic approach)
        if (body.togglePresensi !== undefined && body.presensiType) {
          await execute(env,
            `INSERT INTO employee_presensi_active (employee_id, presensi_type, is_active) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE is_active = VALUES(is_active)`,
            [id, body.presensiType, body.togglePresensi ? 1 : 0]);
        // Legacy toggle support
        } else if (body.toggleActiveRH !== undefined) {
          await execute(env, 'UPDATE employees SET is_active_rh = ? WHERE id = ?', [body.toggleActiveRH ? 1 : 0, id]);
        } else if (body.toggleActiveIM !== undefined) {
          await execute(env, 'UPDATE employees SET is_active_im = ? WHERE id = ?', [body.toggleActiveIM ? 1 : 0, id]);
        } else if (body.toggleActiveKF !== undefined) {
          await execute(env, 'UPDATE employees SET is_active_kf = ? WHERE id = ?', [body.toggleActiveKF ? 1 : 0, id]);
        } else {
          const { name, position, division, employmentStatus } = body;
          await execute(env, 'UPDATE employees SET name = ?, position = ?, division = ?, employment_status = ? WHERE id = ?',
            [name, position || '', division || '', employmentStatus || '', id]);
        }
        return json({ success: true }, 200, allowOrigin);
      }

      if (path.startsWith('/api/employees/') && request.method === 'DELETE') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        await execute(env, 'DELETE FROM employees WHERE id = ?', [id]);
        return json({ success: true }, 200, allowOrigin);
      }

      if (path === '/api/employees/import' && request.method === 'POST') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const { academicYearId, employees } = await request.json();
        if (!academicYearId || !employees || !employees.length) return json({ error: 'Data tidak lengkap' }, 400, allowOrigin);
        let count = 0;
        for (const emp of employees) {
          if (!emp.name) continue;
          await execute(env,
            `INSERT INTO employees (name, position, division, employment_status, academic_year_id, is_active_rh, is_active_im) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE position = VALUES(position), division = VALUES(division), employment_status = VALUES(employment_status), is_active_rh = TRUE, is_active_im = TRUE`,
            [emp.name, emp.position || '', emp.division || '', emp.employmentStatus || '', academicYearId, true, true]
          );
          count++;
        }
        return json({ success: true, count }, 200, allowOrigin);
      }

      // ===== Roles =====
      if (path === '/api/roles' && request.method === 'GET') {
        const rows = await query(env, 'SELECT * FROM roles ORDER BY id');
        return json(rows, 200, allowOrigin);
      }

      if (path === '/api/roles' && request.method === 'POST') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const { roleKey, roleLabel, defaultPermissions } = await request.json();
        if (!roleKey || !roleLabel) return json({ error: 'Field tidak lengkap' }, 400, allowOrigin);
        const permsJson = defaultPermissions ? JSON.stringify(defaultPermissions) : null;
        await execute(env, 'INSERT INTO roles (role_key, role_label, default_permissions) VALUES (?, ?, ?)',
          [roleKey, roleLabel, permsJson]);
        return json({ success: true }, 201, allowOrigin);
      }

      if (path.startsWith('/api/roles/') && request.method === 'DELETE') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        // Don't allow deleting if users with this role exist
        const role = await query(env, 'SELECT role_key FROM roles WHERE id = ?', [id]);
        if (role.length === 0) return json({ error: 'Role tidak ditemukan' }, 404, allowOrigin);
        const userCount = await query(env, 'SELECT COUNT(*) as cnt FROM users WHERE role = ?', [role[0].role_key]);
        if (userCount[0].cnt > 0) return json({ error: `Masih ada ${userCount[0].cnt} user dengan role ini` }, 400, allowOrigin);
        await execute(env, 'DELETE FROM roles WHERE id = ?', [id]);
        return json({ success: true }, 200, allowOrigin);
      }

      if (path.startsWith('/api/roles/') && request.method === 'PUT') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        const body = await request.json();
        if (body.defaultPermissions !== undefined) {
          const permsJson = body.defaultPermissions ? JSON.stringify(body.defaultPermissions) : null;
          await execute(env, 'UPDATE roles SET default_permissions = ? WHERE id = ?', [permsJson, id]);
        }
        return json({ success: true }, 200, allowOrigin);
      }

      // ===== Presensi Types =====
      if (path === '/api/presensi-types' && request.method === 'GET') {
        const rows = await query(env, 'SELECT * FROM presensi_types ORDER BY sort_order, id');
        if (rows.length === 0) {
          // Fallback to hardcoded types
          return json([
            { type_key: 'renungan_harian', type_label: 'Renungan Harian', category: 'guru' },
            { type_key: 'ibadah_mingguan', type_label: 'Ibadah Mingguan (Tiap Jumat)', category: 'guru' },
            { type_key: 'kanaan_fellowship_guru', type_label: 'Kanaan Fellowship (Sabat Ceria) - Guru', category: 'guru' },
            { type_key: 'kanaan_fellowship_siswa', type_label: 'Kanaan Fellowship (Sabat Ceria) - Siswa', category: 'siswa' }
          ], 200, allowOrigin);
        }
        return json(rows, 200, allowOrigin);
      }

      if (path === '/api/presensi-types' && request.method === 'POST') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const { typeKey, typeLabel, category } = await request.json();
        if (!typeKey || !typeLabel) return json({ error: 'Field tidak lengkap' }, 400, allowOrigin);
        const maxOrder = await query(env, 'SELECT MAX(sort_order) as mx FROM presensi_types');
        const sortOrder = (maxOrder[0].mx || 0) + 1;
        await execute(env, 'INSERT INTO presensi_types (type_key, type_label, category, sort_order) VALUES (?, ?, ?, ?)',
          [typeKey, typeLabel, category || 'guru', sortOrder]);
        return json({ success: true }, 201, allowOrigin);
      }

      if (path.startsWith('/api/presensi-types/') && request.method === 'PUT') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        const body = await request.json();
        if (body.is_active !== undefined) {
          await execute(env, 'UPDATE presensi_types SET is_active = ? WHERE id = ?', [body.is_active ? 1 : 0, id]);
        }
        return json({ success: true }, 200, allowOrigin);
      }

      if (path.startsWith('/api/presensi-types/') && request.method === 'DELETE') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        await execute(env, 'DELETE FROM presensi_types WHERE id = ?', [id]);
        return json({ success: true }, 200, allowOrigin);
      }

      // ===== Presensi Config =====
      if (path === '/api/presensi-config' && request.method === 'GET') {
        const rows = await query(env, 'SELECT * FROM presensi_config ORDER BY presensi_type');
        // If table is empty, return defaults
        if (rows.length === 0) {
          const defaults = [
            { presensi_type: 'renungan_harian', allowed_days: '1,2,3,4,5' },
            { presensi_type: 'ibadah_mingguan', allowed_days: '5' },
            { presensi_type: 'kanaan_fellowship_guru', allowed_days: '1,2,3,4,5' },
            { presensi_type: 'kanaan_fellowship_siswa', allowed_days: '1,2,3,4,5' }
          ];
          // Auto-insert defaults
          for (const d of defaults) {
            await execute(env,
              'INSERT IGNORE INTO presensi_config (presensi_type, allowed_days) VALUES (?, ?)',
              [d.presensi_type, d.allowed_days]);
          }
          return json(defaults, 200, allowOrigin);
        }
        return json(rows, 200, allowOrigin);
      }

      if (path === '/api/presensi-config' && request.method === 'PUT') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const { presensiType, allowedDays } = await request.json();
        if (!presensiType) return json({ error: 'Field tidak lengkap' }, 400, allowOrigin);
        await execute(env,
          'INSERT INTO presensi_config (presensi_type, allowed_days) VALUES (?, ?) ON DUPLICATE KEY UPDATE allowed_days = VALUES(allowed_days)',
          [presensiType, allowedDays]);
        return json({ success: true }, 200, allowOrigin);
      }

      // ===== Kanaan Fellowship Students =====
      if (path === '/api/kf-students' && request.method === 'GET') {
        const params = url.searchParams;
        let sql = `SELECT s.*, ay.year_label, ay.year_code FROM kanaan_fellowship_students s
                   JOIN academic_years ay ON s.academic_year_id = ay.id WHERE 1=1`;
        const vals = [];
        if (params.get('academicYear')) { sql += ' AND ay.year_label = ?'; vals.push(params.get('academicYear')); }
        if (params.get('active') === 'true') { sql += ' AND s.is_active = TRUE'; }
        if (params.get('class')) { sql += ' AND s.class = ?'; vals.push(params.get('class')); }
        sql += ' ORDER BY s.class, s.name';
        const rows = await query(env, sql, vals);
        return json(rows, 200, allowOrigin);
      }

      if (path === '/api/kf-students' && request.method === 'POST') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const { nis, name, studentClass, gender, religion, academicYearId } = await request.json();
        if (!name || !academicYearId) return json({ error: 'Field tidak lengkap' }, 400, allowOrigin);
        const existing = await query(env, 'SELECT id FROM kanaan_fellowship_students WHERE name = ? AND class = ? AND academic_year_id = ?',
          [name, studentClass || '', academicYearId]);
        if (existing.length > 0) return json({ error: 'Siswa sudah ada di kelas ini' }, 409, allowOrigin);
        await execute(env,
          'INSERT INTO kanaan_fellowship_students (nis, name, class, gender, religion, academic_year_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [nis || '', name, studentClass || '', gender || '', religion || '', academicYearId, true]);
        return json({ success: true }, 201, allowOrigin);
      }

      if (path.startsWith('/api/kf-students/') && request.method === 'PUT') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        const body = await request.json();
        if (body.toggleActive !== undefined) {
          await execute(env, 'UPDATE kanaan_fellowship_students SET is_active = ? WHERE id = ?', [body.toggleActive ? 1 : 0, id]);
        } else {
          const { nis, name, studentClass, gender, religion } = body;
          await execute(env,
            'UPDATE kanaan_fellowship_students SET nis=?, name=?, class=?, gender=?, religion=? WHERE id=?',
            [nis || '', name, studentClass || '', gender || '', religion || '', id]);
        }
        return json({ success: true }, 200, allowOrigin);
      }

      if (path.startsWith('/api/kf-students/') && request.method === 'DELETE') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        await execute(env, 'DELETE FROM kanaan_fellowship_students WHERE id = ?', [id]);
        return json({ success: true }, 200, allowOrigin);
      }

      if (path === '/api/kf-students/import' && request.method === 'POST') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const { academicYearId, students } = await request.json();
        if (!academicYearId || !students || !students.length) return json({ error: 'Data tidak lengkap' }, 400, allowOrigin);
        let count = 0;
        for (const s of students) {
          if (!s.name) continue;
          await execute(env,
            `INSERT INTO kanaan_fellowship_students (nis, name, class, gender, religion, academic_year_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE nis = VALUES(nis), gender = VALUES(gender), religion = VALUES(religion), is_active = TRUE`,
            [s.nis || '', s.name, s.studentClass || '', s.gender || '', s.religion || '', academicYearId, true]);
          count++;
        }
        return json({ success: true, count }, 200, allowOrigin);
      }

      // ===== Calendar Schedules (Google Sheets proxy) =====
      if (path === '/api/calendar-schedules' && request.method === 'GET') {
        const sheetId = url.searchParams.get('sheetId');
        const gid = url.searchParams.get('gid') || '0';
        if (!sheetId) return json({ error: 'sheetId diperlukan' }, 400, allowOrigin);

        const cacheKey = `${sheetId}:${gid}`;
        const cached = _calendarCache.get(cacheKey);
        if (cached && (Date.now() - cached.ts) < 300000) { // 5 min TTL
          return json(cached.data, 200, allowOrigin);
        }

        try {
          // Try gviz endpoint first (works for public sheets)
          const gvizUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:json&gid=${gid}`;
          const res = await fetch(gvizUrl, { headers: { 'Accept': 'application/json' } });

          if (res.ok) {
            const text = await res.text();
            // Google's gviz wraps JSON in a callback-like prefix: /*O_o*/google.visualization.Query.setResponse({...});
            const jsonStart = text.indexOf('{');
            const jsonEnd = text.lastIndexOf('}');
            if (jsonStart < 0 || jsonEnd < 0) throw new Error('Invalid gviz response');
            const raw = JSON.parse(text.slice(jsonStart, jsonEnd + 1));

            if (raw.status !== 'ok') {
              throw new Error(raw.errors?.[0]?.detailed_message || 'gviz returned error status');
            }

            const table = raw.table;
            const cols = (table.cols || []).map(c => c.label || '');
            const rows = (table.rows || []).map(r =>
              (r.c || []).map(cell => (cell && cell.v !== undefined) ? cell.v : (cell && cell.f || ''))
            );

            const result = { success: true, sheetId, gid, columns: cols, rows, accessible: true };
            _calendarCache.set(cacheKey, { ts: Date.now(), data: result });
            return json(result, 200, allowOrigin);
          }

          // If gviz fails, try Google Sheets API v4
          if (res.status === 401 || res.status === 403) {
            const diagnostics = { gviz: `${res.status}`, methods: [] };

            // 2a. Try with API key first
            const gapiKey = env.GAPI_KEY;
            if (gapiKey) {
              const apiData = await fetchSheetViaSheetsAPIWithKey(sheetId, gid, gapiKey);
              diagnostics.methods.push({ method: 'apikey', ok: !!apiData });
              if (apiData) {
                const { columns, rows } = apiData;
                const result = { success: true, sheetId, gid, columns, rows, accessible: true };
                _calendarCache.set(cacheKey, { ts: Date.now(), data: result });
                return json(result, 200, allowOrigin);
              }
            } else {
              diagnostics.methods.push({ method: 'apikey', ok: false, error: 'GAPI_KEY not configured' });
            }

            // 2b. Try with OAuth2 service account
            let oauthError = null;
            try {
              const accessToken = await getGoogleAccessToken(env);
              if (accessToken) {
                const apiData = await fetchSheetViaSheetsAPI(sheetId, gid, accessToken);
                diagnostics.methods.push({ method: 'oauth2', ok: !!apiData, tokenObtained: true });
                if (apiData) {
                  const { columns, rows } = apiData;
                  const result = { success: true, sheetId, gid, columns, rows, accessible: true };
                  _calendarCache.set(cacheKey, { ts: Date.now(), data: result });
                  return json(result, 200, allowOrigin);
                }
                diagnostics.methods[diagnostics.methods.length - 1].error = 'Sheets API call failed with valid token';
              } else {
                oauthError = 'Failed to obtain OAuth2 token';
                diagnostics.methods.push({ method: 'oauth2', ok: false, error: oauthError, tokenObtained: false });
              }
            } catch (e) {
              oauthError = e.message;
              diagnostics.methods.push({ method: 'oauth2', ok: false, error: oauthError });
            }

            // 2c. Try CSV export
            const csvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${gid}`;
            const csvRes = await fetch(csvUrl);
            diagnostics.methods.push({ method: 'csvexport', ok: csvRes.ok });
            if (csvRes.ok) {
              const csvText = await csvRes.text();
              const lines = csvText.trim().split('\n');
              const cols = lines.length > 0 ? parseCSVLine(lines[0]) : [];
              const rows = lines.slice(1).map(line => parseCSVLine(line));
              const result = { success: true, sheetId, gid, columns: cols, rows, accessible: true };
              _calendarCache.set(cacheKey, { ts: Date.now(), data: result });
              return json(result, 200, allowOrigin);
            }

            // All methods failed
            let saEmail = null;
            try { if (env.GSA_JSON) saEmail = parseGSAJson(env.GSA_JSON).client_email; } catch (e) { /* ignore */ }
            return json({
              success: true, sheetId, gid, columns: [], rows: [],
              accessible: false,
              error: saEmail
                ? `Sheet tidak dapat diakses. Service account: ${saEmail}. Diagnostics: ${JSON.stringify(diagnostics)}`
                : `Sheet tidak dapat diakses. Diagnostics: ${JSON.stringify(diagnostics)}`,
              diagnostics
            }, 200, allowOrigin);
          }

          throw new Error(`Google returned HTTP ${res.status}`);
        } catch (e) {
          return json({ success: false, sheetId, gid, accessible: false, error: e.message }, 200, allowOrigin);
        }
      }

      // ===== Calendar Sheet Configs (admin only) =====
      if (path === '/api/calendar-config' && request.method === 'GET') {
        const ay = url.searchParams.get('academicYear') || '';
        let sql = 'SELECT * FROM calendar_sheet_configs WHERE is_active = TRUE';
        const vals = [];
        if (ay) { sql += ' AND academic_year = ?'; vals.push(ay); }
        sql += ' ORDER BY sort_order, id';
        const rows = await query(env, sql, vals);
        // If no configs in DB, return defaults from CONFIG
        return json(rows, 200, allowOrigin);
      }

      if (path === '/api/calendar-config' && request.method === 'POST') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const { academicYear, sheetKey, sheetLabel, sheetId, gid, color, sortOrder } = await request.json();
        if (!academicYear || !sheetKey || !sheetLabel || !sheetId) return json({ error: 'Field tidak lengkap' }, 400, allowOrigin);
        await execute(env,
          `INSERT INTO calendar_sheet_configs (academic_year, sheet_key, sheet_label, sheet_id, gid, color, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE sheet_label=VALUES(sheet_label), sheet_id=VALUES(sheet_id), gid=VALUES(gid), color=VALUES(color), sort_order=VALUES(sort_order), is_active=TRUE`,
          [academicYear, sheetKey, sheetLabel, sheetId, gid || '0', color || '#3b82f6', sortOrder || 0]);
        return json({ success: true }, 200, allowOrigin);
      }

      if (path.startsWith('/api/calendar-config/') && request.method === 'DELETE') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        await execute(env, 'UPDATE calendar_sheet_configs SET is_active = FALSE WHERE id = ?', [id]);
        return json({ success: true }, 200, allowOrigin);
      }

      // ===== Calendar Custom Events =====
      if (path === '/api/calendar-events' && request.method === 'GET') {
        const ay = url.searchParams.get('academicYear') || '';
        const rows = ay
          ? await query(env, 'SELECT * FROM calendar_custom_events WHERE academic_year = ? ORDER BY start_date', [ay])
          : await query(env, 'SELECT * FROM calendar_custom_events ORDER BY start_date');
        return json(rows, 200, allowOrigin);
      }

      if (path === '/api/calendar-events' && request.method === 'POST') {
        const { academicYear, title, description, startDate, endDate, color } = await request.json();
        if (!academicYear || !title || !startDate || !endDate) return json({ error: 'Field tidak lengkap' }, 400, allowOrigin);
        const result = await execute(env,
          'INSERT INTO calendar_custom_events (academic_year, title, description, start_date, end_date, color, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [academicYear, title, description || '', startDate, endDate, color || '#ef4444', payload.username]);
        return json({ success: true, id: result.insertId }, 201, allowOrigin);
      }

      if (path.startsWith('/api/calendar-events/') && request.method === 'PUT') {
        const id = parseInt(path.split('/').pop(), 10);
        const { title, description, startDate, endDate, color } = await request.json();
        if (!title || !startDate || !endDate) return json({ error: 'Field tidak lengkap' }, 400, allowOrigin);
        await execute(env,
          'UPDATE calendar_custom_events SET title = ?, description = ?, start_date = ?, end_date = ?, color = ? WHERE id = ?',
          [title, description || '', startDate, endDate, color || '#ef4444', id]);
        return json({ success: true }, 200, allowOrigin);
      }

      if (path.startsWith('/api/calendar-events/') && request.method === 'DELETE') {
        const id = parseInt(path.split('/').pop(), 10);
        await execute(env, 'DELETE FROM calendar_custom_events WHERE id = ?', [id]);
        return json({ success: true }, 200, allowOrigin);
      }

      // Get distinct academic years that have calendar configs
      if (path === '/api/calendar-config-years' && request.method === 'GET') {
        const rows = await query(env, 'SELECT DISTINCT academic_year FROM calendar_sheet_configs WHERE is_active = TRUE ORDER BY academic_year');
        return json(rows.map(r => r.academic_year), 200, allowOrigin);
      }

      return json({ error: 'Endpoint tidak ditemukan' }, 404, allowOrigin);
    } catch (err) {
      return json({ error: err.message || 'Server error' }, 500, allowOrigin);
    }
  }
};
