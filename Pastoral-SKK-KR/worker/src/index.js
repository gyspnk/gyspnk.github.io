import { query, execute, initSchema } from './db.js';
import { hashPassword, verifyPassword, createJWT, verifyJWT } from './auth.js';

let _schemaReady = false;
async function ensureSchema(env) {
  if (!_schemaReady) {
    try { await initSchema(env); } catch (e) { console.error('Schema init:', e.message); }
    _schemaReady = true;
  }
}

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

      // Auth required below
      const authHeader = request.headers.get('Authorization');
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const payload = await verifyJWT(token, env.JWT_SECRET);
      if (!payload) return json({ error: 'Tidak terautentikasi' }, 401, allowOrigin);

      if (path === '/api/users' && request.method === 'GET') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const users = await query(env, 'SELECT id, username, full_name, role, permissions FROM users ORDER BY id');
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
        if (params.get('active') === 'true') { sql += ' AND (e.is_active_rh = TRUE OR e.is_active_im = TRUE)'; }
        if (params.get('activeRH') === 'true') { sql += ' AND e.is_active_rh = TRUE'; }
        if (params.get('activeIM') === 'true') { sql += ' AND e.is_active_im = TRUE'; }
        if (params.get('activeKF') === 'true') { sql += ' AND e.is_active_kf = TRUE'; }
        sql += ' ORDER BY e.is_active_rh DESC, e.is_active_im DESC, e.name';
        const rows = await query(env, sql, vals);
        return json(rows, 200, allowOrigin);
      }

      if (path === '/api/employees' && request.method === 'POST') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const { name, position, division, employmentStatus, academicYearId } = await request.json();
        if (!name || !academicYearId) return json({ error: 'Field tidak lengkap' }, 400, allowOrigin);
        const existing = await query(env, 'SELECT id FROM employees WHERE name = ? AND academic_year_id = ?', [name, academicYearId]);
        if (existing.length > 0) return json({ error: 'Karyawan sudah ada di tahun ajaran ini' }, 409, allowOrigin);
        await execute(env, 'INSERT INTO employees (name, position, division, employment_status, academic_year_id, is_active_rh, is_active_im) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [name, position || '', division || '', employmentStatus || '', academicYearId, true, true]);
        return json({ success: true }, 201, allowOrigin);
      }

      if (path.startsWith('/api/employees/') && request.method === 'PUT') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        const body = await request.json();
        if (body.toggleActiveRH !== undefined) {
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

      // ===== KF Documentation =====
      if (path === '/api/kf-docs' && request.method === 'GET') {
        const params = url.searchParams;
        let sql = 'SELECT * FROM kf_documentation WHERE 1=1';
        const vals = [];
        if (params.get('academicYear')) { sql += ' AND academic_year = ?'; vals.push(params.get('academicYear')); }
        if (params.get('classGroup')) { sql += ' AND class_group = ?'; vals.push(params.get('classGroup')); }
        if (params.get('eventDate')) { sql += ' AND event_date = ?'; vals.push(params.get('eventDate')); }
        sql += ' ORDER BY event_date DESC, uploaded_at DESC';
        const rows = await query(env, sql, vals);
        return json(rows, 200, allowOrigin);
      }

      if (path === '/api/kf-docs' && request.method === 'POST') {
        const { eventDate, academicYear, classGroup, fileName, driveFileId, driveUrl } = await request.json();
        if (!eventDate || !classGroup || !driveFileId) return json({ error: 'Data tidak lengkap' }, 400, allowOrigin);
        await execute(env,
          'INSERT INTO kf_documentation (event_date, academic_year, class_group, file_name, drive_file_id, drive_url, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [eventDate, academicYear, classGroup, fileName || '', driveFileId, driveUrl || '', payload.username]);
        return json({ success: true }, 201, allowOrigin);
      }

      if (path.startsWith('/api/kf-docs/') && request.method === 'DELETE') {
        if (payload.role !== 'admin') return json({ error: 'Akses ditolak' }, 403, allowOrigin);
        const id = parseInt(path.split('/').pop(), 10);
        await execute(env, 'DELETE FROM kf_documentation WHERE id = ?', [id]);
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

      return json({ error: 'Endpoint tidak ditemukan' }, 404, allowOrigin);
    } catch (err) {
      return json({ error: err.message || 'Server error' }, 500, allowOrigin);
    }
  }
};
