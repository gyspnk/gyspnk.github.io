import { CONFIG } from './config.js';
import { api } from './api.js';
import { getAvailableYears, getCurrentAcademicYear, loadKaryawanData } from './data-loader.js';
import { exportRecords } from './export.js';
import { hasRole } from './auth.js';
import { getNearestPreviousAllowedDay } from './attendance.js';

let allRecords = [];
let allEmployees = [];
let allStudents = [];
let userMap = {};
let historyChart = null;
let currentPage = 1;
let perPage = 10;
let historyViewMode = 'list'; // 'table' | 'list'
let historyAllowedDays = {}; // populated from API (hari aktif per presensi type)
let lastSnapInfo = '';       // info "tanggal otomatis mundur" — ditampilkan setelah load

export async function initHistory() {
  const years = await getAvailableYears();
  const currentAY = getCurrentAcademicYear(years);

  const yearSelect = document.getElementById('history-year');
  yearSelect.innerHTML = '';
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y.label;
    opt.textContent = y.label;
    if (y.label === currentAY.label) opt.selected = true;
    yearSelect.appendChild(opt);
  });

  // Presensi type selector — reload employees when type changes
  const typeSelect = document.getElementById('history-type');
  typeSelect.onchange = async () => {
    const presensiType = typeSelect.value;
    // Reload employees for the selected presensi type
    try {
      const years = await getAvailableYears();
      const currentAY2 = getCurrentAcademicYear(years);
      if (CONFIG.isSiswaType(presensiType)) {
        allStudents = await api.getKFStudents({ academicYear: currentAY2.label, active: 'true' });
      } else {
        allEmployees = await loadKaryawanData(currentAY2, presensiType);
      }
    } catch (e) {
      console.error('Failed to reload employees for type change:', e);
    }
    // Arahkan tanggal ke hari aktif terdekat (mundur) — sama seperti menu presensi
    snapHistoryDate(presensiType, false);
    updateHistoryFilterLabel();
    loadHistory();
  };

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  document.getElementById('history-start').value = fmtD(firstDay);
  document.getElementById('history-end').value = fmtD(now);
  document.getElementById('history-single-date').value = fmtD(now);
  // Auto-load tanpa tombol Muat: setiap perubahan langsung memuat ulang.
  // Jika pengguna memilih tanggal di luar hari aktif kategori, arahkan ke hari aktif terdekat.
  document.getElementById('history-single-date').onchange = () => {
    const type = document.getElementById('history-type')?.value || 'renungan_harian';
    snapHistoryDate(type, true);
    loadHistory();
  };
  document.getElementById('history-start').onchange = loadHistory;
  document.getElementById('history-end').onchange = loadHistory;
  document.getElementById('history-year').onchange = loadHistory;
  document.getElementById('history-employee').onchange = loadHistory;

  const modeRadios = document.querySelectorAll('input[name="history-mode"]');
  modeRadios.forEach(r => r.onchange = toggleMode);

  // Default: 1 Hari mode (single date). Range mode is hidden initially.
  document.getElementById('history-single-date-group').classList.remove('hidden');
  document.getElementById('history-range-group').classList.add('hidden');
  document.getElementById('history-range-group-end').classList.add('hidden');

  document.getElementById('history-load').onclick = loadHistory;
  document.getElementById('history-export').onclick = exportHistory;
  document.getElementById('history-search').oninput = () => {
    currentPage = 1;
    if (historyViewMode === 'list') renderHistoryListView();
    else renderHistoryTable();
  };
  document.getElementById('history-per-page').onchange = () => { perPage = parseInt(document.getElementById('history-per-page').value, 10); currentPage = 1; renderHistoryTable(); };

  // View toggle — set initial button states to match default mode (list)
  const tableBtn = document.getElementById('hist-view-table');
  const listBtn = document.getElementById('hist-view-list');
  if (historyViewMode === 'list') {
    tableBtn.className = 'btn btn-sm btn-secondary';
    listBtn.className = 'btn btn-sm btn-primary';
  }
  document.getElementById('hist-view-table').onclick = () => switchHistoryView('table');
  document.getElementById('hist-view-list').onclick = () => switchHistoryView('list');

  try {
    // Load employees for the initially selected presensi type
    const initialType = document.getElementById('history-type')?.value || 'renungan_harian';
    if (CONFIG.isSiswaType(initialType)) {
      allEmployees = [];
      allStudents = await api.getKFStudents({ academicYear: currentAY.label, active: 'true' });
    } else {
      allEmployees = await loadKaryawanData(currentAY, initialType);
      allStudents = await api.getKFStudents({ academicYear: currentAY.label, active: 'true' });
    }
  } catch (e) {
    console.error('Failed to load data for history:', e);
  }

  try {
    const users = await api.getUsers();
    userMap = {};
    users.forEach(u => { userMap[u.username] = u; });
  } catch (e) {
    console.error('Failed to load users for history:', e);
  }

  // Arahkan tanggal awal ke hari aktif terdekat kategori yang sedang dipilih
  await loadHistoryDayConfig();
  snapHistoryDate(document.getElementById('history-type')?.value || 'renungan_harian', false);

  updateHistoryFilterLabel();
  loadHistory();
}

/** Muat konfigurasi hari aktif per presensi type (dari API) — fallback ke default */
async function loadHistoryDayConfig() {
  try {
    const config = await api.getPresensiConfig();
    historyAllowedDays = {};
    config.forEach(c => { historyAllowedDays[c.presensi_type] = (c.allowed_days || '').split(',').map(Number).filter(n => !isNaN(n)); });
  } catch (e) {
    historyAllowedDays = {};
  }
}

function getHistoryAllowedDays(type) {
  if (!historyAllowedDays[type]) {
    return type === 'ibadah_mingguan' ? [5] : [1, 2, 3, 4, 5];
  }
  return historyAllowedDays[type];
}

/**
 * Arahkan tanggal mode 1 Hari ke hari aktif terdekat yang sudah dilewati
 * (mundur) — perilaku sama seperti menu presensi. fromPickedDate=true berarti
 * referensinya tanggal yang baru dipilih pengguna; selain itu pakai hari ini.
 */
function snapHistoryDate(type, fromPickedDate) {
  const dateInput = document.getElementById('history-single-date');
  if (!dateInput || !dateInput.value) return;
  const allowedDays = getHistoryAllowedDays(type);
  const reference = fromPickedDate ? new Date(dateInput.value + 'T00:00:00') : new Date();
  const nearest = getNearestPreviousAllowedDay(reference, allowedDays);
  lastSnapInfo = '';
  if (nearest !== dateInput.value) {
    dateInput.value = nearest;
    const d = new Date(nearest + 'T00:00:00');
    lastSnapInfo = `📅 Tanggal otomatis mundur ke ${nearest} (${CONFIG.DAY_NAMES[d.getDay()]}) — hari aktif kategori ini.`;
  }
}

function updateHistoryFilterLabel() {
  const type = document.getElementById('history-type')?.value || 'renungan_harian';
  const label = document.getElementById('history-employee-label');
  const select = document.getElementById('history-employee');

  if (CONFIG.isSiswaType(type)) {
    if (label) label.textContent = 'Kelas';
    select.innerHTML = '<option value="all">Semua Kelas</option>';
    const classes = [...new Set(allStudents.map(s => s.class).filter(Boolean))].sort((a,b) => a.localeCompare(b,'id',{numeric:true}));
    classes.forEach(cls => {
      const opt = document.createElement('option');
      opt.value = cls;
      opt.textContent = cls;
      select.appendChild(opt);
    });
  } else {
    if (label) label.textContent = 'Karyawan';
    select.innerHTML = '<option value="all">Semua</option>';
    allEmployees.forEach(emp => {
      const opt = document.createElement('option');
      opt.value = emp.name;
      opt.textContent = `${emp.name} (${emp.division})`;
      select.appendChild(opt);
    });
  }
}

function updateHistoryTableHeaders() {
  const headerRow = document.getElementById('history-table-header');
  if (!headerRow) return;
  const type = document.getElementById('history-type')?.value || 'renungan_harian';
  const isSiswa = CONFIG.isSiswaType(type);
  headerRow.innerHTML = isSiswa
    ? '<th>No</th><th>Tanggal</th><th>Nama</th><th>NIS</th><th>Kelas</th><th>Status</th><th>Keterangan</th><th>Tipe</th><th>Diisi Oleh</th>'
    : '<th>No</th><th>Tanggal</th><th>Nama</th><th>Jabatan</th><th>Divisi</th><th>Status</th><th>Keterangan</th><th>Tipe</th><th>Diisi Oleh (Nama / Username / Role)</th>';
}

function toggleMode() {
  const mode = document.querySelector('input[name="history-mode"]:checked').value;
  const isRange = mode === 'range';
  document.getElementById('history-single-date-group').classList.toggle('hidden', isRange);
  document.getElementById('history-range-group').classList.toggle('hidden', !isRange);
  document.getElementById('history-range-group-end').classList.toggle('hidden', !isRange);
  // Auto-load saat mode berubah (list view otomatis jadi tabel untuk rentang)
  loadHistory();
}

async function loadHistory() {
  window.showLoading();
  const yearLabel = document.getElementById('history-year').value;
  const mode = document.querySelector('input[name="history-mode"]:checked').value;
  const employee = document.getElementById('history-employee').value;
  const presensiType = document.getElementById('history-type').value;
  const statusEl = document.getElementById('history-status');
  const statusMsg = document.getElementById('history-status-msg');

  let params = { academicYear: yearLabel, presensiType };
  if (mode === 'single') {
    const date = document.getElementById('history-single-date').value;
    if (!date) {
      statusMsg.textContent = 'Pilih tanggal terlebih dahulu.';
      statusMsg.classList.remove('hidden');
      return;
    }
    params.date = date;
  } else {
    const startDate = document.getElementById('history-start').value;
    const endDate = document.getElementById('history-end').value;
    if (!startDate || !endDate) {
      statusMsg.textContent = 'Pilih rentang tanggal terlebih dahulu.';
      statusMsg.classList.remove('hidden');
      return;
    }
    params.startDate = startDate;
    params.endDate = endDate;
  }

  statusMsg.textContent = 'Memuat data...';
  statusMsg.classList.remove('hidden');
  statusEl.textContent = '';

  try {
    allRecords = await api.getAttendance(params);
  } catch (e) {
    statusMsg.textContent = 'Gagal memuat: ' + e.message;
    return;
  }

  const typeLabel = CONFIG.PRESENSI_TYPE_LABELS[presensiType] || '';
  const count = allRecords.length;
  const isSiswa = CONFIG.isSiswaType(presensiType);
  const filterLabel = employee === 'all' ? (isSiswa ? 'semua kelas' : 'semua karyawan') : employee;
  statusMsg.textContent = `${count} record ${typeLabel} ditemukan untuk ${filterLabel}.` + (lastSnapInfo ? ' ' + lastSnapInfo : '');
  currentPage = 1;

  // List view only for single date — auto-switch to table if range
  const viewMode = document.querySelector('input[name="history-mode"]:checked').value;
  if (viewMode === 'range' && historyViewMode === 'list') {
    switchHistoryView('table');
  }

  if (historyViewMode === 'list') {
    switchViewTo('list');
    renderHistoryListView();
  } else {
    switchViewTo('table');
    renderHistoryTable();
  }
  renderHistoryChart();
  window.hideLoading();
}

function getFilteredRecords() {
  const employee = document.getElementById('history-employee').value;
  const searchTerm = (document.getElementById('history-search').value || '').toLowerCase();
  const presensiType = document.getElementById('history-type')?.value || 'renungan_harian';

  return allRecords.filter(r => {
    // For KF-Siswa, filter by class; for others, filter by employee name
    if (CONFIG.isSiswaType(presensiType)) {
      if (employee !== 'all' && r.employee_division !== employee) return false;
    } else {
      if (employee !== 'all' && r.employee_name !== employee) return false;
    }
    if (searchTerm) {
      const user = userMap[r.recorded_by];
      const recorderName = user ? user.full_name : '';
      if (!r.employee_name.toLowerCase().includes(searchTerm) &&
          !(r.notes || '').toLowerCase().includes(searchTerm) &&
          !(r.recorded_by || '').toLowerCase().includes(searchTerm) &&
          !recorderName.toLowerCase().includes(searchTerm) &&
          !(r.employee_division || '').toLowerCase().includes(searchTerm)) return false;
    }
    return true;
  });
}

function renderHistoryTable() {
  const tbody = document.getElementById('history-tbody');
  tbody.innerHTML = '';
  const allFiltered = getFilteredRecords();

  const statusCfgList = CONFIG.ATTENDANCE_STATUSES;
  const statusLabels = {};
  statusCfgList.forEach(s => statusLabels[s.value] = s.label);
  const presensiType = document.getElementById('history-type')?.value || 'renungan_harian';
  const isSiswa = CONFIG.isSiswaType(presensiType);

  // ===== Kolom tanggal horizontal (hari aktif dalam rentang terpilih) =====
  const mode = document.querySelector('input[name="history-mode"]:checked')?.value || 'single';
  const allowedDays = getHistoryAllowedDays(presensiType);
  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const colDates = [];
  if (mode === 'single') {
    const d = document.getElementById('history-single-date').value;
    if (d) colDates.push(d);
  } else {
    const start = document.getElementById('history-start').value;
    const end = document.getElementById('history-end').value;
    if (start && end) {
      for (let d = new Date(start + 'T00:00:00'); d <= new Date(end + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
        if (allowedDays.includes(d.getDay())) {
          colDates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
        }
      }
    }
  }

  // ===== Pivot: 1 baris per nama, status per tanggal =====
  const byName = new Map();
  allFiltered.forEach(r => {
    const key = r.employee_name || '(tanpa nama)';
    if (!byName.has(key)) {
      byName.set(key, {
        name: key, nis: r.employee_status || '', jabatan: r.employee_position || '', kelas: r.employee_division || '',
        perDate: {}
      });
    }
    const emp = byName.get(key);
    const dk = (r.attendance_date || '').split('T')[0];
    if (!emp.perDate[dk]) emp.perDate[dk] = [];
    emp.perDate[dk].push(r);
  });
  const names = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'id'));

  const totalPages = Math.max(1, Math.ceil(names.length / perPage));
  if (currentPage > totalPages) currentPage = totalPages;
  const startIdx = (currentPage - 1) * perPage;
  const pageNames = names.slice(startIdx, startIdx + perPage);

  // ===== Header dinamis =====
  const identCols = isSiswa ? '<th>NIS</th><th>Kelas</th>' : '<th>Jabatan</th><th>Divisi</th>';
  const dateThs = colDates.map(dk => {
    const d = new Date(dk + 'T00:00:00');
    return `<th class="hist-pivot-date"><span class="hist-pivot-dow">${dayNames[d.getDay()]}</span><span class="hist-pivot-dmy">${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}</span></th>`;
  }).join('');
  const thead = document.getElementById('history-table-header');
  if (thead) {
    thead.innerHTML = `<th>No</th><th>Nama</th>${identCols}${dateThs}<th class="hist-pivot-total-hdr">Total</th>`;
  }

  // ===== Baris pivot =====
  const badgeFor = r => {
    const s = statusCfgList.find(x => x.value === r.status);
    if (!s) return `<span class="hist-pivot-badge" style="background:#64748b" title="${r.status}">?</span>`;
    const title = `${s.label}${r.notes ? ' — ' + r.notes : ''}`;
    return `<span class="hist-pivot-badge" style="background:${s.color}" title="${title}">${s.short}</span>`;
  };

  pageNames.forEach((emp, i) => {
    const tr = document.createElement('tr');
    const totals = {};
    statusCfgList.forEach(s => totals[s.value] = 0);
    const dateCells = colDates.map(dk => {
      const recs = emp.perDate[dk] || [];
      recs.forEach(r => { if (totals[r.status] !== undefined) totals[r.status]++; });
      if (recs.length === 0) return '<td class="hist-pivot-cell"></td>';
      return `<td class="hist-pivot-cell">${recs.map(badgeFor).join('')}</td>`;
    }).join('');
    const totalHtml = statusCfgList.map(s => totals[s.value] ? `<span style="color:${s.color};font-weight:600">${s.short}${totals[s.value]}</span>` : '').filter(Boolean).join(' · ') || '—';
    tr.innerHTML = `
      <td style="color:var(--text-muted);font-size:12px">${startIdx + i + 1}</td>
      <td style="font-weight:500;white-space:nowrap">${emp.name}</td>
      <td>${isSiswa ? (emp.nis || '—') : (emp.jabatan || '—')}</td>
      <td>${emp.kelas || '—'}</td>
      ${dateCells}
      <td class="hist-pivot-total">${totalHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  if (pageNames.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${4 + colDates.length + 1}" style="text-align:center;color:var(--text-muted);padding:20px">Tidak ada data presensi</td></tr>`;
  }

  const statusEl = document.getElementById('history-status');
  if (statusEl) statusEl.textContent = `${allFiltered.length} record · ${names.length} nama — Halaman ${currentPage}/${totalPages}`;

  renderPagination(totalPages, names.length);
}

function renderPagination(totalPages, totalItems) {
  const container = document.getElementById('history-pagination');
  if (!container) return;
  container.innerHTML = '';

  if (totalPages <= 1) return;

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-sm btn-secondary';
  prevBtn.textContent = '‹ Prev';
  prevBtn.disabled = currentPage <= 1;
  prevBtn.onclick = () => { currentPage--; renderHistoryTable(); };
  container.appendChild(prevBtn);

  const maxShow = 5;
  let startP = Math.max(1, currentPage - Math.floor(maxShow / 2));
  let endP = Math.min(totalPages, startP + maxShow - 1);
  if (endP - startP + 1 < maxShow) startP = Math.max(1, endP - maxShow + 1);

  if (startP > 1) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-secondary';
    btn.textContent = '1';
    btn.onclick = () => { currentPage = 1; renderHistoryTable(); };
    container.appendChild(btn);
    if (startP > 2) container.appendChild(Object.assign(document.createElement('span'), { className: 'pagination-ellipsis', textContent: '…' }));
  }

  for (let p = startP; p <= endP; p++) {
    const btn = document.createElement('button');
    btn.className = `btn btn-sm ${p === currentPage ? 'btn-primary' : 'btn-secondary'}`;
    btn.textContent = p;
    btn.onclick = () => { currentPage = p; renderHistoryTable(); };
    container.appendChild(btn);
  }

  if (endP < totalPages) {
    if (endP < totalPages - 1) container.appendChild(Object.assign(document.createElement('span'), { className: 'pagination-ellipsis', textContent: '…' }));
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-secondary';
    btn.textContent = totalPages;
    btn.onclick = () => { currentPage = totalPages; renderHistoryTable(); };
    container.appendChild(btn);
  }

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-sm btn-secondary';
  nextBtn.textContent = 'Next ›';
  nextBtn.disabled = currentPage >= totalPages;
  nextBtn.onclick = () => { currentPage++; renderHistoryTable(); };
  container.appendChild(nextBtn);
}

function renderHistoryChart() {
  if (historyChart) { historyChart.destroy(); historyChart = null; }
  const records = getFilteredRecords();
  if (records.length === 0) return;

  const byDate = {};
  records.forEach(r => {
    if (!byDate[r.attendance_date]) byDate[r.attendance_date] = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0, total: 0 };
    if (byDate[r.attendance_date][r.status] !== undefined) byDate[r.attendance_date][r.status]++;
    byDate[r.attendance_date].total++;
  });

  const dates = Object.keys(byDate).sort();
  const datasets = CONFIG.ATTENDANCE_STATUSES.map(s => ({
    label: s.label,
    data: dates.map(d => byDate[d][s.value]),
    backgroundColor: s.color
  }));

  const ctx = document.getElementById('history-chart');
  if (!ctx) return;
  historyChart = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: { labels: dates, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } }
    }
  });
}

/* ===== View Toggle ===== */
function switchViewTo(mode) {
  const listView = document.getElementById('history-list-view');
  // Cari table-wrapper yg mengandung #history-table (bukan punya list view)
  const tableWrapper = document.getElementById('history-table')?.closest('.table-wrapper');
  const pagination = document.getElementById('history-pagination');
  const perPageGroup = document.getElementById('history-per-page')?.closest('.form-group');

  if (mode === 'list') {
    if (tableWrapper) tableWrapper.style.display = 'none';
    if (pagination) pagination.style.display = 'none';
    if (listView) listView.classList.remove('hidden');
    if (perPageGroup) perPageGroup.style.display = 'none';
  } else {
    if (tableWrapper) tableWrapper.style.display = '';
    if (pagination) pagination.style.display = '';
    if (listView) listView.classList.add('hidden');
    if (perPageGroup) perPageGroup.style.display = '';
  }
  // Chart is always visible regardless of view mode
}

function switchHistoryView(mode) {
  historyViewMode = mode;
  const tableBtn = document.getElementById('hist-view-table');
  const listBtn = document.getElementById('hist-view-list');

  if (mode === 'list') {
    tableBtn.className = 'btn btn-sm btn-secondary';
    listBtn.className = 'btn btn-sm btn-primary';
    switchViewTo('list');
    renderHistoryListView();
  } else {
    listBtn.className = 'btn btn-sm btn-secondary';
    tableBtn.className = 'btn btn-sm btn-primary';
    switchViewTo('table');
    renderHistoryTable();
  }
}

/* ===== Daftar Kehadiran (Read-Only List View) ===== */
function renderHistoryListView() {
  const container = document.getElementById('history-list-view');
  if (!container) return;

  const isSiswa = CONFIG.isSiswaType(document.getElementById('history-type')?.value || '');
  const searchTerm = (document.getElementById('history-search')?.value || '').toLowerCase();
  const employee = document.getElementById('history-employee')?.value || 'all';
  const statusLabels = {};
  CONFIG.ATTENDANCE_STATUSES.forEach(s => statusLabels[s.value] = s.label);

  // Filter: exclude auto-generated records, apply employee/search filter
  let filtered = allRecords.filter(r => {
    // Skip auto-generated "belum diisi"
    if (r.notes && r.notes.includes('Otomatis')) return false;
    // Apply employee/division filter (sama seperti di menu isi presensi)
    if (isSiswa) {
      if (employee !== 'all' && r.employee_division !== employee) return false;
    } else {
      if (employee !== 'all' && r.employee_name !== employee) return false;
    }
    // Apply search
    if (searchTerm) {
      if (!r.employee_name.toLowerCase().includes(searchTerm) &&
          !(r.notes || '').toLowerCase().includes(searchTerm)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Tidak ada data kehadiran yang sudah diisi.</div>';
    return;
  }

  // Group by division (guru) or class (siswa) — seperti pengelompokan jenjang
  const groups = {};
  filtered.forEach(r => {
    const key = r.employee_division || 'Tanpa Divisi';
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  // Sort group keys
  let sortedKeys;
  if (isSiswa) {
    const gradeOrder = { 'TK': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9 };
    sortedKeys = Object.keys(groups).sort((a, b) => {
      const aPrefix = a.split(' ')[0];
      const bPrefix = b.split(' ')[0];
      const aOrder = gradeOrder[aPrefix] ?? 99;
      const bOrder = gradeOrder[bPrefix] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b, 'id');
    });
  } else {
    sortedKeys = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'id'));
  }

  const sectionLabel = isSiswa ? 'KELAS' : 'DIVISI';
  let html = '';
  sortedKeys.forEach(key => {
    const items = groups[key];
    items.sort((a, b) => (a.employee_name || '').localeCompare(b.employee_name || '', 'id'));

    // Ringkas: 1 baris per nama (record nama yang sama digabung)
    const byName = new Map();
    items.forEach(r => {
      const nm = r.employee_name || '(tanpa nama)';
      if (!byName.has(nm)) {
        byName.set(nm, { name: nm, nis: r.employee_status || '', kelas: r.employee_division || '', jabatan: r.employee_position || '', records: [] });
      }
      byName.get(nm).records.push(r);
    });
    const nameRows = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'id'));

    // Hitung status per section (dari record)
    const counts = {};
    items.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const countSummary = CONFIG.ATTENDANCE_STATUSES.map(s => {
      const c = counts[s.value] || 0;
      return c ? `<span class="hist-summary-dot" style="background:${s.color}"></span>${s.short} ${c}` : '';
    }).filter(Boolean).join(' · ') || '0';

    // Render table per section — header sama seperti menu isi presensi
    const isAdmin = hasRole('admin');
    const colHeaders = isSiswa
      ? ['No', 'Nama', 'NIS', 'Kelas', 'Status', 'Keterangan', 'Diisi Oleh']
      : ['No', 'Nama', 'Jabatan', 'Divisi', 'Status', 'Keterangan', 'Diisi Oleh'];
    if (isAdmin) colHeaders.push('Aksi');

    const rowsHtml = nameRows.map((emp, i) => {
      const badgesHtml = emp.records.map(r => {
        const statusCfg = CONFIG.ATTENDANCE_STATUSES.find(s => s.value === r.status);
        return statusCfg
          ? `<span class="status-badge status-${r.status}">${statusLabels[r.status]}</span>`
          : `<span class="status-badge">${r.status}</span>`;
      }).join(' ');
      const notesHtml = [...new Set(emp.records.map(r => (r.notes || '').trim()).filter(Boolean))].join('; ');
      const recordersHtml = [...new Set(emp.records.map(r => {
        const u = userMap[r.recorded_by];
        return u ? u.full_name : (r.recorded_by || '—');
      }))].join(', ');
      const col2 = isSiswa ? (emp.nis || '—') : (emp.jabatan || '—');
      const col3 = isSiswa ? (emp.kelas || '—') : (emp.kelas || '—');
      const delBtn = isAdmin
        ? `<button class="btn btn-danger btn-sm hist-del-user" data-name="${emp.name}" data-date="${emp.records[0].attendance_date}" title="Hapus presensi ${emp.name} (${emp.records.length} record)" style="padding:2px 6px;font-size:14px">🗑</button>`
        : '';
      return `<tr>
        <td style="color:var(--text-muted);font-size:12px">${i + 1}</td>
        <td style="font-weight:500">${emp.name}</td>
        <td>${col2}</td>
        <td>${col3}</td>
        <td>${badgesHtml}</td>
        <td style="font-size:12px;color:var(--text-muted)">${notesHtml}</td>
        <td style="font-size:12px"><span style="color:var(--text-muted)">${recordersHtml}</span></td>
        ${isAdmin ? `<td style="text-align:center;white-space:nowrap">${delBtn}</td>` : ''}
      </tr>`;
    }).join('');

    html += `<div class="history-list-section">
      <div class="history-list-header">
        <span class="history-list-header-title">${sectionLabel}: ${key}</span>
        <span class="history-list-header-count">${nameRows.length} orang · ${countSummary}</span>
      </div>
      <div class="table-wrapper" style="margin:0;border:none">
        <table>
          <thead><tr>${colHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;
  });

  container.innerHTML = html;

  // Wire up delete buttons for admin
  if (hasRole('admin')) {
    container.querySelectorAll('.hist-del-user').forEach(btn => {
      btn.onclick = async () => {
        const employeeName = btn.dataset.name;
        const date = btn.dataset.date;
        const presensiType = document.getElementById('history-type')?.value || 'renungan_harian';
        const yearLabel = document.getElementById('history-year')?.value;
        if (!confirm(`Hapus data presensi "${employeeName}" pada tanggal ${date}?\nData tidak bisa dikembalikan.`)) return;
        try {
          btn.disabled = true;
          btn.textContent = '...';
          await api.deleteAttendance({ date, academicYear: yearLabel, presensiType, employeeName });
          // Hapus dari allRecords dan re-render
          allRecords = allRecords.filter(r => !(r.attendance_date === date && r.employee_name === employeeName));
          renderHistoryListView();
        } catch (e) {
          alert('Gagal: ' + e.message);
          btn.disabled = false;
          btn.textContent = '🗑';
        }
      };
    });
  }
}

async function exportHistory() {
  let records = getFilteredRecords();
  const btn = document.getElementById('history-export');
  const employee = document.getElementById('history-employee').value;

  if (records.length === 0) {
    alert('Tidak ada data untuk diexport.');
    return;
  }

  // Filter out inactive employees (per presensi type)
  const yearLabel = document.getElementById('history-year').value;
  const presensiType = document.getElementById('history-type').value;
  try {
    const activeEmps = await loadKaryawanData(yearLabel, presensiType);
    const activeNames = new Set(activeEmps.map(e => e.name));
    records = records.filter(r => activeNames.has(r.employee_name));
  } catch (e) {
    console.error('Failed to filter inactive employees:', e);
  }

  if (records.length === 0) {
    alert('Tidak ada data karyawan aktif untuk diexport.');
    return;
  }

  const mode = document.querySelector('input[name="history-mode"]:checked').value;
  let startDate, endDate;
  if (mode === 'single') {
    startDate = endDate = document.getElementById('history-single-date').value;
  } else {
    startDate = document.getElementById('history-start').value;
    endDate = document.getElementById('history-end').value;
  }

  btn.disabled = true;
  btn.textContent = 'Membuat Excel...';

  try {
    const typeLabel = CONFIG.PRESENSI_TYPE_LABELS[presensiType] || 'Presensi';
    const typeSlugMap = {
      renungan_harian: 'Renungan_Harian',
      ibadah_mingguan: 'Ibadah_Mingguan',
      kanaan_fellowship_guru: 'Kanaan_Fellowship_Guru',
      kanaan_fellowship_siswa: 'Kanaan_Fellowship_Siswa'
    };
    const typeSlug = typeSlugMap[presensiType] || 'Presensi';
    const isSiswa = CONFIG.isSiswaType(presensiType);
    // Load presensi config for day filtering
    let allowedDays;
    try {
      const config = await api.getPresensiConfig();
      const cfg = config.find(c => c.presensi_type === presensiType);
      allowedDays = cfg ? cfg.allowed_days.split(',').map(Number).filter(n => !isNaN(n)) : undefined;
    } catch(e) { /* ignore */ }
    const meta = {
      startDate,
      endDate,
      academicYear: document.getElementById('history-year').value,
      employee: employee === 'all' ? (isSiswa ? 'Semua Kelas' : 'Semua Karyawan') : employee,
      presensiType,
      allowedDays,
      userMap
    };
    const fileName = employee === 'all'
      ? `Laporan_${typeSlug}_${startDate}_${endDate}.xlsx`
      : `Laporan_${typeSlug}_${employee.replace(/\s+/g, '_')}_${startDate}_${endDate}.xlsx`;
    await exportRecords(records, meta, fileName);
  } catch (e) {
    alert('Gagal export: ' + e.message);
  }

  btn.disabled = false;
  btn.textContent = 'Export Data Ini';
}

export { loadHistory };
