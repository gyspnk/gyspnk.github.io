import { CONFIG } from './config.js';
import { api, isDemoMode } from './api.js';
import { login, logout, getCurrentUser, checkHasUsers, setupAdmin, hasRole, getUserPermissions, hasAccess } from './auth.js';
import { initDashboard } from './dashboard.js';
import { initPresensi, loadPresensiData } from './attendance.js';
import { initHistory, loadHistory } from './history.js';
import { initExport } from './export.js';
import { getAvailableYears, getCurrentAcademicYear, loadKaryawanData } from './data-loader.js';

let currentView = 'dashboard';
let viewsInitialized = { dashboard: false, presensi: false, history: false, export: false, admin: false };

document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  if (isDemoMode()) {
    document.getElementById('demo-banner').classList.remove('hidden');
    migrateDemoEmployeeData();
  }

  initMobileMenu();

  const user = getCurrentUser();
  if (user) {
    showMainApp();
  } else {
    showLogin();
  }
}

/* ===== Demo Data Migration ===== */
function migrateDemoEmployeeData() {
  try {
    const emps = JSON.parse(localStorage.getItem('pas_presensi_emp') || '[]');
    if (emps.length === 0) return;
    let changed = false;
    for (const emp of emps) {
      // Sync old is_active value to new columns, then delete is_active
      if (emp.is_active_rh === undefined && emp.is_active !== undefined) {
        emp.is_active_rh = emp.is_active !== false;
        changed = true;
      }
      if (emp.is_active_im === undefined && emp.is_active !== undefined) {
        emp.is_active_im = emp.is_active !== false;
        changed = true;
      }
      if (emp.is_active !== undefined) {
        delete emp.is_active;
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem('pas_presensi_emp', JSON.stringify(emps));
      console.log('Demo employee data migrated: is_active → is_active_rh / is_active_im, old column removed');
    }
  } catch (e) {
    console.warn('Demo data migration warning:', e.message);
  }
}

/* ===== Mobile Menu ===== */
function initMobileMenu() {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (!menuBtn || !sidebar || !overlay) return;

  function openMenu() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }

  menuBtn.onclick = openMenu;
  overlay.onclick = closeMenu;

  // Close sidebar when a nav link is clicked (mobile)
  sidebar.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeMenu();
    });
  });

  // Close sidebar on window resize to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closeMenu();
  });
}

/* ===== Login ===== */
function showLogin() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('main-app').classList.add('hidden');

  const loginForm = document.getElementById('login-form');
  loginForm.onsubmit = handleLogin;

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.onclick = handleLogout;

  if (isDemoMode()) {
    checkHasUsers().then(has => {
      if (!has) {
        document.getElementById('demo-setup').classList.remove('hidden');
        document.getElementById('setup-form').onsubmit = handleSetup;
      }
    });
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');

  try {
    await login(username, password);
    showMainApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function handleSetup(e) {
  e.preventDefault();
  const username = document.getElementById('setup-username').value.trim();
  const fullName = document.getElementById('setup-fullname').value.trim();
  const password = document.getElementById('setup-password').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');

  try {
    await setupAdmin(username, fullName, password);
    await login(username, password);
    showMainApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

function handleLogout() {
  logout();
  showLogin();
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
}

/* ===== Main App ===== */
function showMainApp() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');

  const user = getCurrentUser();
  document.getElementById('user-display-name').textContent = user.full_name || user.username;
  document.getElementById('user-display-role').textContent = CONFIG.ROLES[user.role] || user.role;

  const adminNav = document.getElementById('admin-nav');
  if (hasRole('admin')) {
    adminNav.parentElement.style.display = '';
  } else {
    adminNav.parentElement.style.display = 'none';
  }

  document.querySelectorAll('.nav-link').forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      switchView(link.dataset.view);
    };
  });

  document.getElementById('logout-btn').onclick = handleLogout;

  updateSidebarPermissions();

  switchView(currentView || 'dashboard');
}

function updateSidebarPermissions() {
  const user = getCurrentUser();
  if (!user) return;
  const perms = getUserPermissions();

  // Show/hide sidebar menu items based on user permissions
  // Presensi link is always visible (it shows category dropdown)
  // Lihat Presensi - visible if user has at least view access to any type
  const hasAnyAccess = Object.values(perms).some(p => p !== 'none');
  const historyLink = document.querySelector('.nav-link[data-view="history"]');
  const exportLink = document.querySelector('.nav-link[data-view="export"]');

  if (historyLink) historyLink.parentElement.style.display = hasAnyAccess ? '' : 'none';
  if (exportLink) exportLink.parentElement.style.display = hasAnyAccess ? '' : 'none';
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const link = document.querySelector(`.nav-link[data-view="${view}"]`);
  if (link) link.classList.add('active');

  if (view === 'dashboard') {
    if (!viewsInitialized.dashboard) {
      viewsInitialized.dashboard = true;
      initDashboard();
    } else {
      loadDashboardRefresh();
    }
  }

  if (view === 'presensi') {
    if (!viewsInitialized.presensi) {
      viewsInitialized.presensi = true;
      initPresensi();
    } else {
      loadPresensiData();
    }
  }

  if (view === 'history') {
    if (!viewsInitialized.history) {
      viewsInitialized.history = true;
      initHistory();
    } else {
      loadHistory();
    }
  }

  if (view === 'export' && !viewsInitialized.export) {
    viewsInitialized.export = true;
    initExport();
  }

  if (view === 'admin' && hasRole('admin')) {
    initAdmin();
  }
}

async function loadDashboardRefresh() {
  const btn = document.getElementById('dash-refresh');
  if (btn) btn.click();
}

/* ===== Admin ===== */
let adminData = { years: [], employees: [], divisions: [] };

async function initAdmin() {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.onclick = () => switchAdminTab(tab.dataset.adminTab);
  });

  const form = document.getElementById('add-user-form');
  form.onsubmit = handleAddUser;

  try {
    const users = await api.getUsers();
    renderUsers(users);
  } catch (e) {
    console.error('Failed to load users:', e);
  }

  initAdminYears();
  initAdminDivisions();
  initAdminEmployees();
  initAdminKFStudents();
}

function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.admin-tab[data-admin-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
  document.getElementById(`admin-tab-${tab}`).classList.remove('hidden');
}

/* --- Academic Years --- */
function initAdminYears() {
  const form = document.getElementById('add-year-form');
  form.onsubmit = handleAddYear;
  loadAdminYears();
}

async function loadAdminYears() {
  try {
    adminData.years = await api.getAcademicYears();
    renderAdminYears();
    populateEmpYearSelect();
    populateKFSYearSelect();  // Also populate KF-Siswa year dropdown
  } catch (e) {
    console.error('Failed to load years:', e);
  }
}

function renderAdminYears() {
  const tbody = document.getElementById('years-tbody');
  tbody.innerHTML = '';
  adminData.years.forEach(y => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${y.year_code}</strong></td>
      <td>${y.year_label}</td>
      <td>${y.is_active ? '<span class="toggle-switch toggle-active">Aktif</span>' : '<span class="toggle-switch toggle-inactive">Nonaktif</span>'}</td>
      <td id="year-emp-count-${y.id}">...</td>
      <td><button class="btn btn-danger btn-sm" data-del-year="${y.id}">Hapus</button></td>
    `;
    tbody.appendChild(tr);
    api.getEmployees({ academicYear: y.year_label }).then(emps => {
      const el = document.getElementById(`year-emp-count-${y.id}`);
      if (el) el.textContent = emps.length;
    }).catch(() => {});
  });
  tbody.querySelectorAll('[data-del-year]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Hapus tahun ajaran ini beserta semua data karyawannya? Data presensi yang sudah ada tidak akan terhapus.')) return;
      try {
        await api.deleteAcademicYear(parseInt(btn.dataset.delYear));
        await loadAdminYears();
      } catch (e) {
        alert('Gagal: ' + e.message);
      }
    };
  });
}

async function handleAddYear(e) {
  e.preventDefault();
  const yearCode = document.getElementById('new-year-code').value.trim().toUpperCase();
  const yearLabel = document.getElementById('new-year-label').value.trim();
  try {
    await api.addAcademicYear(yearCode, yearLabel);
    document.getElementById('new-year-code').value = '';
    document.getElementById('new-year-label').value = '';
    await loadAdminYears();
  } catch (e) {
    alert('Gagal: ' + e.message);
  }
}

/* --- Divisions --- */
function initAdminDivisions() {
  const form = document.getElementById('add-division-form');
  form.onsubmit = handleAddDivision;
  document.getElementById('quick-add-division').onclick = handleQuickAddDivision;
  loadAdminDivisions();
}

async function loadAdminDivisions() {
  try {
    adminData.divisions = await api.getDivisions();
    renderAdminDivisions();
    populateDivisionDropdown();
  } catch (e) {
    console.error('Failed to load divisions:', e);
  }
}

function renderAdminDivisions() {
  const tbody = document.getElementById('divisions-tbody');
  tbody.innerHTML = '';
  adminData.divisions.forEach(div => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${div.name}</td>
      <td id="div-emp-count-${div.id}">...</td>
      <td>
        <div class="action-cell">
          <button class="btn btn-danger btn-sm" data-del-div="${div.id}">Hapus</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
    api.getEmployees({ active: 'true' }).then(emps => {
      const count = emps.filter(e => e.division === div.name).length;
      const el = document.getElementById(`div-emp-count-${div.id}`);
      if (el) el.textContent = count;
    }).catch(() => {});
  });
  tbody.querySelectorAll('[data-del-div]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Hapus divisi ini?')) return;
      try {
        await api.deleteDivision(parseInt(btn.dataset.delDiv, 10));
        await loadAdminDivisions();
      } catch (e) {
        alert('Gagal: ' + e.message);
      }
    };
  });
  if (tbody.children.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:20px">Belum ada divisi</td></tr>';
  }
}

function populateDivisionDropdown() {
  const select = document.getElementById('new-emp-division');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Pilih divisi...</option>';
  adminData.divisions.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.name;
    opt.textContent = d.name;
    select.appendChild(opt);
  });
  if (current && adminData.divisions.find(d => d.name === current)) select.value = current;
}

async function handleAddDivision(e) {
  e.preventDefault();
  const name = document.getElementById('new-division-name').value.trim();
  try {
    await api.addDivision(name);
    document.getElementById('new-division-name').value = '';
    await loadAdminDivisions();
  } catch (e) {
    alert('Gagal: ' + e.message);
  }
}

async function handleQuickAddDivision() {
  const name = prompt('Nama divisi baru:');
  if (!name || !name.trim()) return;
  try {
    await api.addDivision(name.trim());
    await loadAdminDivisions();
    const select = document.getElementById('new-emp-division');
    if (select) select.value = name.trim();
  } catch (e) {
    alert('Gagal: ' + e.message);
  }
}

/* --- Employees --- */
function initAdminEmployees() {
  const form = document.getElementById('add-employee-form');
  form.onsubmit = handleAddEmployee;
  document.getElementById('emp-load').onclick = loadAdminEmployees;
  document.getElementById('emp-search').oninput = renderAdminEmployees;
  document.getElementById('emp-filter-active').onchange = renderAdminEmployees;
  document.getElementById('emp-import-btn').onclick = handleImportEmployees;
}

function populateEmpYearSelect() {
  const select = document.getElementById('emp-year-select');
  if (!select) return;
  select.innerHTML = '';
  adminData.years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y.id;
    opt.textContent = y.year_label;
    select.appendChild(opt);
  });
  const currentAY = getCurrentAcademicYear(adminData.years.map(y => ({ code: y.year_code, label: y.year_label })));
  const match = adminData.years.find(y => y.year_label === currentAY.label);
  if (match) select.value = match.id;
  loadAdminEmployees();
}

async function loadAdminEmployees() {
  const yearId = parseInt(document.getElementById('emp-year-select').value, 10);
  if (!yearId) return;
  const year = adminData.years.find(y => y.id === yearId);
  if (!year) return;
  try {
    adminData.employees = await api.getEmployees({ academicYear: year.year_label });
    renderAdminEmployees();
  } catch (e) {
    console.error('Failed to load employees:', e);
  }
}

function renderAdminEmployees() {
  const tbody = document.getElementById('employees-tbody');
  tbody.innerHTML = '';
  const search = (document.getElementById('emp-search').value || '').toLowerCase();
  const filter = document.getElementById('emp-filter-active').value;

  let emps = adminData.employees;
  if (filter === 'active') emps = emps.filter(e => (e.is_active_rh != false || e.is_active_im != false));
  if (filter === 'inactive') emps = emps.filter(e => (e.is_active_rh == false && e.is_active_im == false));
  if (search) emps = emps.filter(e => e.name.toLowerCase().includes(search) || (e.position || '').toLowerCase().includes(search) || (e.division || '').toLowerCase().includes(search));

  document.getElementById('emp-count').textContent = `(${emps.length})`;

  emps.forEach(emp => {
    const tr = document.createElement('tr');
    const divOptions = adminData.divisions.map(d => `<option value="${d.name}" ${d.name === emp.division ? 'selected' : ''}>${d.name}</option>`).join('');
    const isActiveRH = emp.is_active_rh != false;
    const isActiveIM = emp.is_active_im != false;
    const isActiveKF = emp.is_active_kf != false;
    tr.innerHTML = `
      <td>${emp.name}</td>
      <td>${emp.position || ''}</td>
      <td class="editable-div" data-emp-id="${emp.id}" data-emp-name="${emp.name}">
        <span class="div-label">${emp.division || '—'}</span>
        <select class="div-select hidden" data-emp-id="${emp.id}">${divOptions}</select>
      </td>
      <td>${emp.employment_status || ''}</td>
      <td><span class="toggle-switch ${isActiveRH ? 'toggle-active' : 'toggle-inactive'}">${isActiveRH ? 'Aktif' : 'Nonaktif'}</span></td>
      <td><span class="toggle-switch ${isActiveIM ? 'toggle-active' : 'toggle-inactive'}">${isActiveIM ? 'Aktif' : 'Nonaktif'}</span></td>
      <td><span class="toggle-switch ${isActiveKF ? 'toggle-active' : 'toggle-inactive'}">${isActiveKF ? 'Aktif' : 'Nonaktif'}</span></td>
      <td>
        <div class="action-cell">
          <button class="btn btn-sm ${isActiveRH ? 'btn-warn' : 'btn-success'}" data-toggle-rh="${emp.id}" data-active-rh="${isActiveRH ? 1 : 0}">RH: ${isActiveRH ? 'Off' : 'On'}</button>
          <button class="btn btn-sm ${isActiveIM ? 'btn-warn' : 'btn-success'}" data-toggle-im="${emp.id}" data-active-im="${isActiveIM ? 1 : 0}">IM: ${isActiveIM ? 'Off' : 'On'}</button>
          <button class="btn btn-sm ${isActiveKF ? 'btn-warn' : 'btn-success'}" data-toggle-kf="${emp.id}" data-active-kf="${isActiveKF ? 1 : 0}">KF: ${isActiveKF ? 'Off' : 'On'}</button>
          <button class="btn btn-danger btn-sm" data-del-emp="${emp.id}">Hapus</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);

    // Division click-to-edit
    const divCell = tr.querySelector('.editable-div');
    const divLabel = divCell.querySelector('.div-label');
    const divSelect = divCell.querySelector('.div-select');

    divCell.onclick = () => {
      divLabel.classList.add('hidden');
      divSelect.classList.remove('hidden');
      divSelect.focus();
    };

    divSelect.onchange = async () => {
      const newDiv = divSelect.value;
      const oldDiv = emp.division || '—';
      if (newDiv === oldDiv) {
        divSelect.classList.add('hidden');
        divLabel.classList.remove('hidden');
        return;
      }
      const ok = confirm(`Ubah divisi "${emp.name}" dari "${oldDiv}" menjadi "${newDiv}"?`);
      if (!ok) {
        divSelect.value = oldDiv;
        divSelect.classList.add('hidden');
        divLabel.classList.remove('hidden');
        return;
      }
      try {
        await api.updateEmployee(emp.id, { name: emp.name, position: emp.position, division: newDiv, employmentStatus: emp.employment_status });
        await loadAdminEmployees();
      } catch (e) {
        alert('Gagal: ' + e.message);
        divSelect.value = oldDiv;
        divSelect.classList.add('hidden');
        divLabel.classList.remove('hidden');
      }
    };

    divSelect.onblur = () => {
      setTimeout(() => {
        divSelect.classList.add('hidden');
        divLabel.classList.remove('hidden');
      }, 200);
    };
  });

  tbody.querySelectorAll('[data-toggle-rh]').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.toggleRh, 10);
      const isActive = btn.dataset.activeRh === '1';
      try {
        await api.updateEmployee(id, { toggleActiveRH: !isActive });
        await loadAdminEmployees();
      } catch (e) {
        alert('Gagal: ' + e.message);
      }
    };
  });

  tbody.querySelectorAll('[data-toggle-im]').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.toggleIm, 10);
      const isActive = btn.dataset.activeIm === '1';
      try {
        await api.updateEmployee(id, { toggleActiveIM: !isActive });
        await loadAdminEmployees();
      } catch (e) {
        alert('Gagal: ' + e.message);
      }
    };
  });

  tbody.querySelectorAll('[data-toggle-kf]').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.toggleKf, 10);
      const isActive = btn.dataset.activeKf === '1';
      try {
        await api.updateEmployee(id, { toggleActiveKF: !isActive });
        await loadAdminEmployees();
      } catch (e) {
        alert('Gagal: ' + e.message);
      }
    };
  });

  tbody.querySelectorAll('[data-del-emp]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Hapus karyawan ini?')) return;
      try {
        await api.deleteEmployee(parseInt(btn.dataset.delEmp, 10));
        await loadAdminEmployees();
      } catch (e) {
        alert('Gagal: ' + e.message);
      }
    };
  });

  if (tbody.children.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px">Tidak ada data karyawan</td></tr>';
  }
}

async function handleAddEmployee(e) {
  e.preventDefault();
  const yearId = parseInt(document.getElementById('emp-year-select').value, 10);
  const name = document.getElementById('new-emp-name').value.trim();
  const position = document.getElementById('new-emp-position').value.trim();
  const division = document.getElementById('new-emp-division').value.trim();
  const employmentStatus = document.getElementById('new-emp-status').value.trim();

  try {
    await api.addEmployee({ name, position, division, employmentStatus, academicYearId: yearId });
    document.getElementById('new-emp-name').value = '';
    document.getElementById('new-emp-position').value = '';
    document.getElementById('new-emp-division').value = '';
    document.getElementById('new-emp-status').value = '';
    await loadAdminEmployees();
  } catch (e) {
    alert('Gagal: ' + e.message);
  }
}

async function handleImportEmployees() {
  const fileInput = document.getElementById('emp-import-file');
  const msgEl = document.getElementById('emp-import-msg');
  const yearId = parseInt(document.getElementById('emp-year-select').value, 10);

  if (!fileInput.files || !fileInput.files[0]) {
    msgEl.textContent = 'Pilih file Excel terlebih dahulu.';
    msgEl.classList.remove('hidden');
    return;
  }
  if (!yearId) {
    msgEl.textContent = 'Pilih tahun ajaran terlebih dahulu.';
    msgEl.classList.remove('hidden');
    return;
  }

  msgEl.textContent = 'Memproses file...';
  msgEl.classList.remove('hidden');

  try {
    const file = fileInput.files[0];
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const employees = rows
      .filter(r => r[0] && String(r[0]).trim())
      .map(r => ({
        name: String(r[0]).trim(),
        position: String(r[1] || '').trim(),
        division: String(r[2] || '').trim(),
        employmentStatus: String(r[3] || '').trim()
      }));

    if (employees.length === 0) {
      msgEl.textContent = 'Tidak ada data valid di file Excel.';
      msgEl.style.background = '#fee2e2';
      msgEl.style.color = '#991b1b';
      return;
    }

    const result = await api.importEmployees(yearId, employees);
    msgEl.textContent = `Berhasil import ${result.count} karyawan.`;
    msgEl.style.background = '#dcfce7';
    msgEl.style.color = '#166534';
    fileInput.value = '';
    await loadAdminEmployees();
  } catch (e) {
    msgEl.textContent = 'Gagal import: ' + e.message;
    msgEl.style.background = '#fee2e2';
    msgEl.style.color = '#991b1b';
  }
}

function renderUsers(users) {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '';
  const currentUserObj = getCurrentUser();
  users.forEach(u => {
    const tr = document.createElement('tr');
    let perms = {};
    try { perms = (typeof u.permissions === 'string' ? JSON.parse(u.permissions) : u.permissions) || {}; } catch(e) {}
    // Fall back to role defaults for display
    if (Object.keys(perms).length === 0 && CONFIG.PERMISSION_DEFAULTS[u.role]) {
      perms = {...CONFIG.PERMISSION_DEFAULTS[u.role]};
    }
    const permSummary = CONFIG.PRESENSI_TYPES.map(t => {
      const level = perms[t.value] || 'none';
      const icon = level === 'write' ? '✏️' : level === 'view' ? '👁️' : '—';
      return `<span title="${t.label}: ${CONFIG.PERMISSION_LABELS[level]}" style="font-size:13px">${icon}</span>`;
    }).join(' ');

    tr.innerHTML = `
      <td>${u.username}</td>
      <td>${u.full_name}</td>
      <td><span class="status-badge" style="background:var(--primary);font-size:11px">${CONFIG.ROLES[u.role] || u.role}</span></td>
      <td>${permSummary}</td>
      <td>${u.id === currentUserObj.id ? '<span class="muted">—</span>' : `
        <div class="action-cell">
          <button class="btn btn-sm btn-info" data-edit-perms="${u.id}" data-perms='${JSON.stringify(perms)}' data-username="${u.username}">Izin</button>
          <button class="btn btn-danger btn-sm" data-del="${u.id}">Hapus</button>
        </div>`}
      </td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-edit-perms]').forEach(btn => {
    btn.onclick = () => {
      const id = parseInt(btn.dataset.editPerms, 10);
      let perms = {};
      try { perms = JSON.parse(btn.dataset.perms); } catch(e) {}
      const username = btn.dataset.username;
      showPermissionModal(id, username, perms);
    };
  });

  tbody.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Hapus user ini?')) return;
      try {
        await api.deleteUser(parseInt(btn.dataset.del));
        const users = await api.getUsers();
        renderUsers(users);
      } catch (e) {
        alert('Gagal: ' + e.message);
      }
    };
  });
}

function showPermissionModal(userId, username, currentPerms) {
  const types = CONFIG.PRESENSI_TYPES;
  const levels = CONFIG.PERMISSION_LEVELS;
  const labels = CONFIG.PERMISSION_LABELS;

  let html = `<div style="max-width:500px">
    <h3 style="margin-bottom:12px">Izin Akses: ${username}</h3>
    <table style="width:100%;margin-bottom:16px">
    <thead><tr><th>Presensi</th>${levels.map(l => `<th style="text-align:center">${labels[l]}</th>`).join('')}</tr></thead>
    <tbody>`;

  types.forEach(t => {
    const current = currentPerms[t.value] || 'none';
    html += `<tr>
      <td style="padding:6px 8px">${t.icon} ${t.label}</td>
      ${levels.map(l => `
        <td style="text-align:center;padding:6px 4px">
          <label style="cursor:pointer;display:flex;align-items:center;justify-content:center;gap:2px">
            <input type="radio" name="perm_${t.value}" value="${l}" ${current === l ? 'checked' : ''} style="accent-color:var(--primary)" />
          </label>
        </td>
      `).join('')}
    </tr>`;
  });

  html += `</tbody></table>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="perm-cancel" class="btn btn-secondary btn-sm">Batal</button>
      <button id="perm-save" class="btn btn-primary btn-sm">Simpan</button>
    </div>
    <div id="perm-msg" class="info-msg hidden" style="margin-top:8px"></div>
  </div>`;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `<div style="background:var(--card-bg);border-radius:12px;padding:24px;max-width:95vw">${html}</div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#perm-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#perm-save').onclick = async () => {
    const newPerms = {};
    types.forEach(t => {
      const radio = overlay.querySelector(`input[name="perm_${t.value}"]:checked`);
      if (radio) newPerms[t.value] = radio.value;
    });
    const msgEl = overlay.querySelector('#perm-msg');
    msgEl.textContent = 'Menyimpan...';
    msgEl.classList.remove('hidden');
    try {
      await api.updateUser(userId, { permissions: newPerms });
      msgEl.textContent = '✅ Izin berhasil disimpan.';
      msgEl.style.background = '#dcfce7'; msgEl.style.color = '#166534';
      setTimeout(async () => {
        overlay.remove();
        const users = await api.getUsers();
        renderUsers(users);
      }, 800);
    } catch (e) {
      msgEl.textContent = 'Gagal: ' + e.message;
      msgEl.style.background = '#fee2e2'; msgEl.style.color = '#991b1b';
    }
  };
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

async function handleAddUser(e) {
  e.preventDefault();
  const username = document.getElementById('new-user-username').value.trim();
  const fullName = document.getElementById('new-user-fullname').value.trim();
  const password = document.getElementById('new-user-password').value;
  const role = document.getElementById('new-user-role').value;

  try {
    const defaultPerms = CONFIG.PERMISSION_DEFAULTS[role] || {};
    await api.addUser(username, fullName, password, role, defaultPerms);
    document.getElementById('new-user-username').value = '';
    document.getElementById('new-user-fullname').value = '';
    document.getElementById('new-user-password').value = '';
    const users = await api.getUsers();
    renderUsers(users);
  } catch (e) {
    alert('Gagal: ' + e.message);
  }
}

/* ===== Kanaan Fellowship Student Management ===== */
let kfsData = [];

let kfsInitialized = false;
function initAdminKFStudents() {
  if (kfsInitialized) return;
  kfsInitialized = true;
  document.getElementById('kfs-load').onclick = loadAdminKFStudents;
  document.getElementById('kfs-search').oninput = renderAdminKFStudents;
  document.getElementById('kfs-filter-active').onchange = renderAdminKFStudents;
  document.getElementById('kfs-filter-class').onchange = renderAdminKFStudents;
  document.getElementById('add-kfs-form').onsubmit = handleAddKFStudent;
  document.getElementById('kfs-import-btn').onclick = handleImportKFStudents;
  document.getElementById('kfs-import-siswa-folder').onclick = handleImportSiswaFolder;
  populateKFSYearSelect();
}

function populateKFSYearSelect() {
  const select = document.getElementById('kfs-year-select');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '';
  adminData.years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y.id;
    opt.textContent = y.year_label;
    select.appendChild(opt);
  });
  // Preserve selected year if still valid
  if (currentVal && adminData.years.find(y => y.id == currentVal)) {
    select.value = currentVal;
  } else {
    const currentAY = getCurrentAcademicYear(adminData.years.map(y => ({ code: y.year_code, label: y.year_label })));
    const match = adminData.years.find(y => y.year_label === currentAY.label);
    if (match) select.value = match.id;
  }
  // Auto-load if we have a valid year selected
  if (select.value) {
    loadAdminKFStudents();
  }
}

async function loadAdminKFStudents() {
  const yearId = parseInt(document.getElementById('kfs-year-select').value, 10);
  if (!yearId) return;
  const year = adminData.years.find(y => y.id === yearId);
  if (!year) return;
  try {
    kfsData = await api.getKFStudents({ academicYear: year.label });
    renderAdminKFStudents();
  } catch (e) {
    console.error('Failed to load KF students:', e);
  }
}

function renderAdminKFStudents() {
  const tbody = document.getElementById('kfs-tbody');
  tbody.innerHTML = '';
  const search = (document.getElementById('kfs-search').value || '').toLowerCase();
  const filter = document.getElementById('kfs-filter-active').value;
  const classFilter = document.getElementById('kfs-filter-class')?.value || 'all';

  // Populate class filter dropdown from unique classes
  populateKFSClassFilter();

  let students = kfsData;
  if (filter === 'active') students = students.filter(s => s.is_active != false);
  if (filter === 'inactive') students = students.filter(s => s.is_active == false);
  if (classFilter !== 'all') students = students.filter(s => (s.class || '') === classFilter);
  if (search) students = students.filter(s => s.name.toLowerCase().includes(search) || (s.class || '').toLowerCase().includes(search) || (s.nis || '').toLowerCase().includes(search));

  document.getElementById('kfs-count').textContent = `(${students.length})`;

  students.forEach(s => {
    const tr = document.createElement('tr');
    const isActive = s.is_active != false;
    tr.innerHTML = `
      <td>${s.nis || '—'}</td>
      <td>${s.name}</td>
      <td>${s.class || '—'}</td>
      <td>${s.gender || '—'}</td>
      <td>${s.religion || '—'}</td>
      <td><span class="toggle-switch ${isActive ? 'toggle-active' : 'toggle-inactive'}">${isActive ? 'Aktif' : 'Nonaktif'}</span></td>
      <td>
        <div class="action-cell">
          <button class="btn btn-sm ${isActive ? 'btn-warn' : 'btn-success'}" data-kfs-toggle="${s.id}" data-kfs-active="${isActive ? 1 : 0}">${isActive ? 'Nonaktif' : 'Aktifkan'}</button>
          <button class="btn btn-danger btn-sm" data-kfs-del="${s.id}">Hapus</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-kfs-toggle]').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.kfsToggle, 10);
      const isActive = btn.dataset.kfsActive === '1';
      try {
        await api.updateKFStudent(id, { toggleActive: !isActive });
        await loadAdminKFStudents();
      } catch (e) { alert('Gagal: ' + e.message); }
    };
  });

  tbody.querySelectorAll('[data-kfs-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Hapus siswa ini?')) return;
      try {
        await api.deleteKFStudent(parseInt(btn.dataset.kfsDel, 10));
        await loadAdminKFStudents();
      } catch (e) { alert('Gagal: ' + e.message); }
    };
  });

  if (tbody.children.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">Tidak ada data siswa</td></tr>';
  }
}

function populateKFSClassFilter() {
  const select = document.getElementById('kfs-filter-class');
  if (!select) return;
  const currentVal = select.value;
  const classes = [...new Set(kfsData.map(s => s.class).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'id', { numeric: true })
  );
  select.innerHTML = '<option value="all">Semua Kelas</option>';
  classes.forEach(cls => {
    const opt = document.createElement('option');
    opt.value = cls;
    opt.textContent = cls;
    select.appendChild(opt);
  });
  if (currentVal && classes.includes(currentVal)) select.value = currentVal;
}

async function handleAddKFStudent(e) {
  e.preventDefault();
  const yearId = parseInt(document.getElementById('kfs-year-select').value, 10);
  const name = document.getElementById('new-kfs-name').value.trim();
  const nis = document.getElementById('new-kfs-nis').value.trim();
  const studentClass = document.getElementById('new-kfs-class').value.trim();
  const gender = document.getElementById('new-kfs-gender').value;
  const religion = document.getElementById('new-kfs-religion').value.trim();

  try {
    await api.addKFStudent({ name, nis, studentClass, gender, religion, academicYearId: yearId });
    document.getElementById('new-kfs-name').value = '';
    document.getElementById('new-kfs-nis').value = '';
    document.getElementById('new-kfs-class').value = '';
    document.getElementById('new-kfs-gender').value = '';
    document.getElementById('new-kfs-religion').value = '';
    await loadAdminKFStudents();
  } catch (e) { alert('Gagal: ' + e.message); }
}

async function handleImportKFStudents() {
  const fileInput = document.getElementById('kfs-import-file');
  const msgEl = document.getElementById('kfs-import-msg');
  const yearId = parseInt(document.getElementById('kfs-year-select').value, 10);
  if (!fileInput.files || !fileInput.files[0]) { msgEl.textContent = 'Pilih file Excel.'; msgEl.classList.remove('hidden'); return; }
  if (!yearId) { msgEl.textContent = 'Pilih tahun ajaran.'; msgEl.classList.remove('hidden'); return; }

  msgEl.textContent = 'Memproses...';
  msgEl.classList.remove('hidden');

  try {
    const file = fileInput.files[0];
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1);
    const students = rows.filter(r => r[1] && String(r[1]).trim()).map(r => ({
      nis: String(r[0] || '').trim(),
      name: String(r[1] || '').trim(),
      studentClass: String(r[2] || '').trim(),
      gender: String(r[3] || '').trim(),
      religion: String(r[4] || '').trim()
    }));
    if (students.length === 0) { msgEl.textContent = 'Tidak ada data valid.'; return; }
    const result = await api.importKFStudents(yearId, students);
    msgEl.textContent = `Berhasil import ${result.count} siswa.`;
    msgEl.style.background = '#dcfce7'; msgEl.style.color = '#166534';
    fileInput.value = '';
    await loadAdminKFStudents();
  } catch (e) { msgEl.textContent = 'Gagal: ' + e.message; msgEl.style.background = '#fee2e2'; msgEl.style.color = '#991b1b'; }
}

async function handleImportSiswaFolder() {
  const msgEl = document.getElementById('kfs-import-msg');
  const yearId = parseInt(document.getElementById('kfs-year-select').value, 10);
  if (!yearId) { msgEl.textContent = 'Pilih tahun ajaran.'; msgEl.classList.remove('hidden'); return; }

  msgEl.textContent = 'Membaca file dari folder Siswa/AY2627...';
  msgEl.classList.remove('hidden');

  const classFiles = {
    'TK A': 'TK A.xlsx', 'TK B': 'TK B.xlsx',
    '1 SD': '1 SD.xlsx', '2 SD': '2 SD.xlsx', '3 SD': '3 SD.xlsx',
    '4 SD': '4 SD.xlsx', '5 SD': '5 SD.xlsx', '6 SD': '6 SD.xlsx',
    '7 SMP': '7 SMP.xlsx', '8 SMP': '8 SMP.xlsx', '9 SMP': '9 SMP.xlsx'
  };

  let totalCount = 0;
  try {
    for (const [className, filename] of Object.entries(classFiles)) {
      try {
        const url = `./Siswa/AY2627/${encodeURIComponent(filename)}`;
        const res = await fetch(url);
        if (!res.ok) { console.warn(`Skip ${filename}: ${res.status}`); continue; }
        const arrayBuffer = await res.arrayBuffer();
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1);
        const students = rows.filter(r => r[3] && String(r[3]).trim()).map(r => ({
          nis: String(r[1] || '').trim(),
          name: String(r[3] || '').trim(),
          studentClass: className,
          gender: String(r[6] || '').trim(),
          religion: String(r[11] || '').trim()
        }));
        if (students.length > 0) {
          const result = await api.importKFStudents(yearId, students);
          totalCount += result.count || students.length;
          msgEl.textContent = `Mengimpor ${className} (${students.length} siswa)... Total: ${totalCount}`;
        }
      } catch (e) { console.warn(`Error importing ${filename}:`, e.message); }
    }
    msgEl.textContent = `✅ Berhasil impor ${totalCount} siswa dari folder Siswa/AY2627.`;
    msgEl.style.background = '#dcfce7'; msgEl.style.color = '#166534';
    await loadAdminKFStudents();
  } catch (e) { msgEl.textContent = 'Gagal: ' + e.message; msgEl.style.background = '#fee2e2'; msgEl.style.color = '#991b1b'; }
}
