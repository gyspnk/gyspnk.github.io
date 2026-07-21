import { CONFIG } from './config.js';

const isDemoMode = () => !CONFIG.API_BASE_URL;

function getToken() {
  return localStorage.getItem(CONFIG.TOKEN_KEY);
}
function setToken(t) {
  if (t) localStorage.setItem(CONFIG.TOKEN_KEY, t);
  else localStorage.removeItem(CONFIG.TOKEN_KEY);
}

async function apiFetch(path, options = {}) {
  const url = CONFIG.API_BASE_URL + path;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ===== Web Crypto PBKDF2 (for demo mode) ===== */
async function pbkdf2Hash(password, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBuf(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  );
  return { hash: bufToHex(bits), salt: bufToHex(salt) };
}
function bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBuf(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

/* ===== Demo localStorage backend ===== */
const DB_USERS = 'pas_presensi_users';
const DB_ATT = 'pas_presensi_attendance';

function dbGet(key) { return JSON.parse(localStorage.getItem(key) || '[]'); }
function dbSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

const demoApi = {
  async setup(username, fullName, password, role) {
    const users = dbGet(DB_USERS);
    if (users.length > 0) throw new Error('Setup already done');
    const { hash, salt } = await pbkdf2Hash(password);
    users.push({ id: 1, username, full_name: fullName, password_hash: hash, salt, role });
    dbSet(DB_USERS, users);
    return { success: true };
  },

  async login(username, password) {
    const users = dbGet(DB_USERS);
    const user = users.find(u => u.username === username);
    if (!user) throw new Error('User tidak ditemukan');
    const { hash } = await pbkdf2Hash(password, user.salt);
    if (hash !== user.password_hash) throw new Error('Password salah');
    let perms = {};
    try { perms = JSON.parse(user.permissions || '{}'); } catch(e) {}
    const token = btoa(JSON.stringify({ id: user.id, username: user.username, role: user.role, permissions: perms, ts: Date.now() }));
    return { token, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, permissions: perms } };
  },

  async getUsers() {
    return dbGet(DB_USERS).map(u => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, permissions: u.permissions || null }));
  },

  async addUser(username, fullName, password, role, permissions) {
    const users = dbGet(DB_USERS);
    if (users.find(u => u.username === username)) throw new Error('Username sudah ada');
    const { hash, salt } = await pbkdf2Hash(password);
    const id = users.length ? Math.max(...users.map(u => u.id)) + 1 : 1;
    users.push({ id, username, full_name: fullName, password_hash: hash, salt, role, permissions: permissions || null });
    dbSet(DB_USERS, users);
    return { success: true };
  },
  async updateUser(id, data) {
    const users = dbGet(DB_USERS);
    const idx = users.findIndex(u => u.id === id);
    if (idx < 0) throw new Error('User tidak ditemukan');
    if (data.permissions !== undefined) users[idx].permissions = data.permissions;
    if (data.role !== undefined) users[idx].role = data.role;
    dbSet(DB_USERS, users);
    return { success: true };
  },

  async deleteUser(id) {
    let users = dbGet(DB_USERS);
    users = users.filter(u => u.id !== id);
    dbSet(DB_USERS, users);
    return { success: true };
  },

  async getAttendance(params = {}) {
    let records = dbGet(DB_ATT);
    if (params.startDate) records = records.filter(r => r.attendance_date >= params.startDate);
    if (params.endDate) records = records.filter(r => r.attendance_date <= params.endDate);
    if (params.academicYear) records = records.filter(r => r.academic_year === params.academicYear);
    if (params.date) records = records.filter(r => r.attendance_date === params.date);
    if (params.presensiType) records = records.filter(r => (r.presensi_type || 'renungan_harian') === params.presensiType);
    return records;
  },

  async saveAttendance(data) {
    const records = dbGet(DB_ATT);
    const pType = data.presensiType || 'renungan_harian';
    for (const rec of data.records) {
      const idx = records.findIndex(r =>
        r.employee_name === rec.employee_name &&
        r.attendance_date === data.date &&
        r.academic_year === data.academicYear &&
        (r.presensi_type || 'renungan_harian') === pType
      );
      const fullRec = {
        ...rec,
        attendance_date: data.date,
        academic_year: data.academicYear,
        presensi_type: pType,
        recorded_by: data.recordedBy,
        recorded_by_role: data.recordedByRole,
      };
      if (idx >= 0) {
        fullRec.id = records[idx].id;
        fullRec.created_at = records[idx].created_at;
        records[idx] = fullRec;
      } else {
        fullRec.id = records.length ? Math.max(...records.map(r => r.id || 0)) + 1 : 1;
        fullRec.created_at = new Date().toISOString();
        records.push(fullRec);
      }
    }
    dbSet(DB_ATT, records);
    return { success: true, count: data.records.length };
  },

  async deleteAttendance(params = {}) {
    let records = dbGet(DB_ATT);
    const before = records.length;
    records = records.filter(r => {
      if (params.date && r.attendance_date !== params.date) return true;
      if (params.academicYear && r.academic_year !== params.academicYear) return true;
      if (params.presensiType && (r.presensi_type || 'renungan_harian') !== params.presensiType) return true;
      if (params.employeeName && r.employee_name !== params.employeeName) return true;
      return false;
    });
    dbSet(DB_ATT, records);
    return { success: true, deletedCount: before - records.length };
  },

  async hasUsers() {
    return dbGet(DB_USERS).length > 0;
  },

  async getAcademicYears() {
    return dbGet('pas_presensi_ay');
  },
  async addAcademicYear(yearCode, yearLabel) {
    const years = dbGet('pas_presensi_ay');
    if (years.find(y => y.year_code === yearCode)) throw new Error('Tahun ajaran sudah ada');
    const id = years.length ? Math.max(...years.map(y => y.id)) + 1 : 1;
    years.push({ id, year_code: yearCode, year_label: yearLabel, is_active: 1, sort_order: id });
    dbSet('pas_presensi_ay', years);
    return { success: true };
  },
  async deleteAcademicYear(id) {
    dbSet('pas_presensi_ay', dbGet('pas_presensi_ay').filter(y => y.id !== id));
    dbSet('pas_presensi_emp', dbGet('pas_presensi_emp').filter(e => e.academic_year_id !== id));
    return { success: true };
  },
  async getEmployees(params = {}) {
    let emps = dbGet('pas_presensi_emp');
    if (params.academicYear) {
      const years = dbGet('pas_presensi_ay');
      const yr = years.find(y => y.year_label === params.academicYear);
      if (yr) emps = emps.filter(e => e.academic_year_id === yr.id);
    }
    if (params.active === 'true') emps = emps.filter(e => (e.is_active_rh != false || e.is_active_im != false));
    if (params.activeRH === 'true') emps = emps.filter(e => e.is_active_rh != false);
    if (params.activeIM === 'true') emps = emps.filter(e => e.is_active_im != false);
    return emps;
  },
  async addEmployee(data) {
    const emps = dbGet('pas_presensi_emp');
    if (emps.find(e => e.name === data.name && e.academic_year_id === data.academicYearId))
      throw new Error('Karyawan sudah ada');
    const id = emps.length ? Math.max(...emps.map(e => e.id)) + 1 : 1;
    emps.push({ id, ...data, is_active_rh: true, is_active_im: true });
    dbSet('pas_presensi_emp', emps);
    return { success: true };
  },
  async updateEmployee(id, data) {
    const emps = dbGet('pas_presensi_emp');
    const idx = emps.findIndex(e => e.id === id);
    if (idx < 0) throw new Error('Karyawan tidak ditemukan');
    if (data.toggleActiveRH !== undefined) emps[idx].is_active_rh = data.toggleActiveRH;
    else if (data.toggleActiveIM !== undefined) emps[idx].is_active_im = data.toggleActiveIM;
    else { emps[idx].name = data.name; emps[idx].position = data.position; emps[idx].division = data.division; emps[idx].employment_status = data.employmentStatus; }
    dbSet('pas_presensi_emp', emps);
    return { success: true };
  },
  async deleteEmployee(id) {
    dbSet('pas_presensi_emp', dbGet('pas_presensi_emp').filter(e => e.id !== id));
    return { success: true };
  },
  async importEmployees(academicYearId, employees) {
    const emps = dbGet('pas_presensi_emp');
    let count = 0;
    for (const emp of employees) {
      if (!emp.name) continue;
      const idx = emps.findIndex(e => e.name === emp.name && e.academic_year_id === academicYearId);
      if (idx >= 0) { emps[idx].position = emp.position; emps[idx].division = emp.division; emps[idx].employment_status = emp.employmentStatus; emps[idx].is_active_rh = true; emps[idx].is_active_im = true; }
      else { const id = emps.length ? Math.max(...emps.map(e => e.id)) + 1 : 1; emps.push({ id, name: emp.name, position: emp.position, division: emp.division, employment_status: emp.employmentStatus, academic_year_id: academicYearId, is_active_rh: true, is_active_im: true }); }
      count++;
    }
    dbSet('pas_presensi_emp', emps);
    return { success: true, count };
  },
  async getDivisions() {
    return dbGet('pas_presensi_divs');
  },
  async addDivision(name) {
    const divs = dbGet('pas_presensi_divs');
    if (divs.find(d => d.name === name)) throw new Error('Divisi sudah ada');
    const id = divs.length ? Math.max(...divs.map(d => d.id)) + 1 : 1;
    divs.push({ id, name, is_active: true });
    dbSet('pas_presensi_divs', divs);
    return { success: true };
  },
  async deleteDivision(id) {
    dbSet('pas_presensi_divs', dbGet('pas_presensi_divs').filter(d => d.id !== id));
    return { success: true };
  },
  async getKFStudents(params = {}) {
    let students = dbGet('pas_presensi_kf_students');
    if (params.academicYear) {
      const years = dbGet('pas_presensi_ay');
      const yr = years.find(y => y.year_label === params.academicYear);
      if (yr) students = students.filter(s => s.academic_year_id === yr.id);
    }
    if (params.active === 'true') students = students.filter(s => s.is_active != false);
    if (params.class) students = students.filter(s => s.class === params.class);
    return students;
  },
  async addKFStudent(data) {
    const students = dbGet('pas_presensi_kf_students');
    const existing = students.find(s => s.name === data.name && s.class === data.studentClass && s.academic_year_id === data.academicYearId);
    if (existing) throw new Error('Siswa sudah ada di kelas ini');
    const id = students.length ? Math.max(...students.map(s => s.id)) + 1 : 1;
    students.push({ id, nis: data.nis || '', name: data.name, class: data.studentClass || '', gender: data.gender || '', religion: data.religion || '', academic_year_id: data.academicYearId, is_active: true });
    dbSet('pas_presensi_kf_students', students);
    return { success: true };
  },
  async updateKFStudent(id, data) {
    const students = dbGet('pas_presensi_kf_students');
    const idx = students.findIndex(s => s.id === id);
    if (idx < 0) throw new Error('Siswa tidak ditemukan');
    if (data.toggleActive !== undefined) students[idx].is_active = data.toggleActive;
    else { students[idx].nis = data.nis || ''; students[idx].name = data.name; students[idx].class = data.studentClass || ''; students[idx].gender = data.gender || ''; students[idx].religion = data.religion || ''; }
    dbSet('pas_presensi_kf_students', students);
    return { success: true };
  },
  async deleteKFStudent(id) {
    dbSet('pas_presensi_kf_students', dbGet('pas_presensi_kf_students').filter(s => s.id !== id));
    return { success: true };
  },
  async importKFStudents(academicYearId, students) {
    const existing = dbGet('pas_presensi_kf_students');
    let count = 0;
    for (const s of students) {
      if (!s.name) continue;
      const idx = existing.findIndex(e => e.name === s.name && e.class === s.studentClass && e.academic_year_id === academicYearId);
      if (idx >= 0) { existing[idx].nis = s.nis || ''; existing[idx].gender = s.gender || ''; existing[idx].religion = s.religion || ''; existing[idx].is_active = true; }
      else { const id = existing.length ? Math.max(...existing.map(e => e.id)) + 1 : 1; existing.push({ id, nis: s.nis || '', name: s.name, class: s.studentClass || '', gender: s.gender || '', religion: s.religion || '', academic_year_id: academicYearId, is_active: true }); }
      count++;
    }
    dbSet('pas_presensi_kf_students', existing);
    return { success: true, count };
  },
  async getPresensiConfig() {
    let config = dbGet('pas_presensi_config');
    if (config.length === 0) {
      config = [
        { presensi_type: 'renungan_harian', allowed_days: '1,2,3,4,5' },
        { presensi_type: 'ibadah_mingguan', allowed_days: '5' },
        { presensi_type: 'kanaan_fellowship_guru', allowed_days: '1,2,3,4,5' },
        { presensi_type: 'kanaan_fellowship_siswa', allowed_days: '1,2,3,4,5' }
      ];
      dbSet('pas_presensi_config', config);
    }
    return config;
  },
  async updatePresensiConfig(presensiType, allowedDays) {
    const config = dbGet('pas_presensi_config');
    const idx = config.findIndex(c => c.presensi_type === presensiType);
    if (idx >= 0) config[idx].allowed_days = allowedDays;
    else config.push({ presensi_type: presensiType, allowed_days: allowedDays });
    dbSet('pas_presensi_config', config);
    return { success: true };
  },
  async getRoles() {
    let roles = dbGet('pas_presensi_roles');
    if (roles.length === 0) {
      roles = [
        { id: 1, role_key: 'admin', role_label: 'Administrator', default_permissions: '{"renungan_harian":"write","ibadah_mingguan":"write","kanaan_fellowship_guru":"write","kanaan_fellowship_siswa":"write"}' },
        { id: 2, role_key: 'pastoral', role_label: 'Pastoral', default_permissions: '{"renungan_harian":"write","ibadah_mingguan":"write","kanaan_fellowship_guru":"write","kanaan_fellowship_siswa":"write"}' },
        { id: 3, role_key: 'guru_agama', role_label: 'Guru Agama', default_permissions: '{"renungan_harian":"write","ibadah_mingguan":"view","kanaan_fellowship_guru":"view","kanaan_fellowship_siswa":"view"}' },
        { id: 4, role_key: 'kepala_sekolah', role_label: 'Kepala Sekolah', default_permissions: '{"renungan_harian":"view","ibadah_mingguan":"view","kanaan_fellowship_guru":"view","kanaan_fellowship_siswa":"view"}' },
        { id: 5, role_key: 'gereja', role_label: 'Gereja', default_permissions: '{"renungan_harian":"view","ibadah_mingguan":"view","kanaan_fellowship_guru":"view","kanaan_fellowship_siswa":"view"}' }
      ];
      dbSet('pas_presensi_roles', roles);
    }
    return roles;
  },
  async addRole(roleKey, roleLabel, defaultPermissions) {
    const roles = dbGet('pas_presensi_roles');
    if (roles.find(r => r.role_key === roleKey)) throw new Error('Role key sudah ada');
    const id = roles.length ? Math.max(...roles.map(r => r.id)) + 1 : 1;
    roles.push({ id, role_key: roleKey, role_label: roleLabel, default_permissions: JSON.stringify(defaultPermissions || {}) });
    dbSet('pas_presensi_roles', roles);
    return { success: true };
  },
  async updateRolePermissions(id, defaultPermissions) {
    const roles = dbGet('pas_presensi_roles');
    const idx = roles.findIndex(r => r.id === id);
    if (idx >= 0) roles[idx].default_permissions = JSON.stringify(defaultPermissions || {});
    dbSet('pas_presensi_roles', roles);
    return { success: true };
  },
  async deleteRole(id) {
    const roles = dbGet('pas_presensi_roles');
    const role = roles.find(r => r.id === id);
    if (!role) throw new Error('Role tidak ditemukan');
    const users = dbGet('pas_presensi_users');
    if (users.find(u => u.role === role.role_key)) throw new Error('Masih ada user dengan role ini');
    dbSet('pas_presensi_roles', roles.filter(r => r.id !== id));
    return { success: true };
  },

  async getCalendarSchedules(sheetId, gid) {
    // Demo mode: no backend, return empty accessible status
    return { success: true, sheetId, gid: gid || '0', columns: [], rows: [], accessible: false, error: 'Tidak tersedia di demo mode' };
  },
};

/* ===== Real API backend ===== */
const realApi = {
  async setup(username, fullName, password, role) {
    return apiFetch('/api/setup', { method: 'POST', body: JSON.stringify({ username, fullName, password, role }) });
  },
  async login(username, password) {
    const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    setToken(data.token);
    return data;
  },
  async getUsers() {
    return apiFetch('/api/users');
  },
  async addUser(username, fullName, password, role, permissions) {
    return apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ username, fullName, password, role, permissions }) });
  },
  async updateUser(id, data) {
    return apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async deleteUser(id) {
    return apiFetch(`/api/users/${id}`, { method: 'DELETE' });
  },
  async getAttendance(params = {}) {
    const qs = new URLSearchParams();
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate) qs.set('endDate', params.endDate);
    if (params.academicYear) qs.set('academicYear', params.academicYear);
    if (params.date) qs.set('date', params.date);
    if (params.presensiType) qs.set('presensiType', params.presensiType);
    return apiFetch('/api/attendance?' + qs.toString());
  },
  async saveAttendance(data) {
    return apiFetch('/api/attendance', { method: 'POST', body: JSON.stringify(data) });
  },
  async deleteAttendance(params = {}) {
    const qs = new URLSearchParams();
    if (params.date) qs.set('date', params.date);
    if (params.academicYear) qs.set('academicYear', params.academicYear);
    if (params.presensiType) qs.set('presensiType', params.presensiType);
    if (params.employeeName) qs.set('employeeName', params.employeeName);
    return apiFetch('/api/attendance?' + qs.toString(), { method: 'DELETE' });
  },
  async hasUsers() {
    const data = await apiFetch('/api/auth/status');
    return data.hasUsers;
  },
  async getAcademicYears() {
    return apiFetch('/api/academic-years');
  },
  async addAcademicYear(yearCode, yearLabel) {
    return apiFetch('/api/academic-years', { method: 'POST', body: JSON.stringify({ yearCode, yearLabel }) });
  },
  async deleteAcademicYear(id) {
    return apiFetch(`/api/academic-years/${id}`, { method: 'DELETE' });
  },
  async getEmployees(params = {}) {
    const qs = new URLSearchParams();
    if (params.academicYear) qs.set('academicYear', params.academicYear);
    if (params.active) qs.set('active', params.active);
    if (params.activeRH) qs.set('activeRH', params.activeRH);
    if (params.activeIM) qs.set('activeIM', params.activeIM);
    if (params.activeKF) qs.set('activeKF', params.activeKF);
    return apiFetch('/api/employees?' + qs.toString());
  },
  async addEmployee(data) {
    return apiFetch('/api/employees', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateEmployee(id, data) {
    return apiFetch(`/api/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async deleteEmployee(id) {
    return apiFetch(`/api/employees/${id}`, { method: 'DELETE' });
  },
  async importEmployees(academicYearId, employees) {
    return apiFetch('/api/employees/import', { method: 'POST', body: JSON.stringify({ academicYearId, employees }) });
  },
  async getDivisions() {
    return apiFetch('/api/divisions');
  },
  async addDivision(name) {
    return apiFetch('/api/divisions', { method: 'POST', body: JSON.stringify({ name }) });
  },
  async renameDivision(id, name) {
    return apiFetch(`/api/divisions/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
  },
  async deleteDivision(id) {
    return apiFetch(`/api/divisions/${id}`, { method: 'DELETE' });
  },
  async getKFStudents(params = {}) {
    const qs = new URLSearchParams();
    if (params.academicYear) qs.set('academicYear', params.academicYear);
    if (params.active) qs.set('active', params.active);
    if (params.class) qs.set('class', params.class);
    return apiFetch('/api/kf-students?' + qs.toString());
  },
  async addKFStudent(data) {
    return apiFetch('/api/kf-students', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateKFStudent(id, data) {
    return apiFetch(`/api/kf-students/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async deleteKFStudent(id) {
    return apiFetch(`/api/kf-students/${id}`, { method: 'DELETE' });
  },
  async importKFStudents(academicYearId, students) {
    return apiFetch('/api/kf-students/import', { method: 'POST', body: JSON.stringify({ academicYearId, students }) });
  },
  async getPresensiTypes() {
    return apiFetch('/api/presensi-types');
  },
  async addPresensiType(typeKey, typeLabel, category) {
    return apiFetch('/api/presensi-types', { method: 'POST', body: JSON.stringify({ typeKey, typeLabel, category }) });
  },
  async togglePresensiType(id, isActive) {
    return apiFetch(`/api/presensi-types/${id}`, { method: 'PUT', body: JSON.stringify({ is_active: isActive }) });
  },
  async deletePresensiType(id) {
    return apiFetch(`/api/presensi-types/${id}`, { method: 'DELETE' });
  },
  async getPresensiConfig() {
    return apiFetch('/api/presensi-config');
  },
  async updatePresensiConfig(presensiType, allowedDays) {
    return apiFetch('/api/presensi-config', { method: 'PUT', body: JSON.stringify({ presensiType, allowedDays }) });
  },
  async getRoles() {
    return apiFetch('/api/roles');
  },
  async addRole(roleKey, roleLabel, defaultPermissions) {
    return apiFetch('/api/roles', { method: 'POST', body: JSON.stringify({ roleKey, roleLabel, defaultPermissions }) });
  },
  async updateRolePermissions(id, defaultPermissions) {
    return apiFetch(`/api/roles/${id}`, { method: 'PUT', body: JSON.stringify({ defaultPermissions }) });
  },
  async deleteRole(id) {
    return apiFetch(`/api/roles/${id}`, { method: 'DELETE' });
  },

  async getCalendarSchedules(sheetId, gid) {
    const qs = new URLSearchParams();
    qs.set('sheetId', sheetId);
    if (gid) qs.set('gid', gid);
    return apiFetch('/api/calendar-schedules?' + qs.toString());
  }
};

export const api = isDemoMode() ? demoApi : realApi;
export { isDemoMode, getToken, setToken };
