import { CONFIG } from './config.js';
import { api } from './api.js';
import { getAvailableYears, getCurrentAcademicYear, loadKaryawanData } from './data-loader.js';
import { exportRecords } from './export.js';

let allRecords = [];
let allEmployees = [];
let allStudents = [];
let userMap = {};
let historyChart = null;
let currentPage = 1;
let perPage = 10;

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

  // Presensi type selector — update filter when changed
  const typeSelect = document.getElementById('history-type');
  typeSelect.onchange = () => {
    updateHistoryFilterLabel();
    loadHistory();
  };

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  document.getElementById('history-start').value = fmtD(firstDay);
  document.getElementById('history-end').value = fmtD(now);

  const modeRadios = document.querySelectorAll('input[name="history-mode"]');
  modeRadios.forEach(r => r.onchange = toggleMode);

  document.getElementById('history-single-date-group').classList.add('hidden');
  document.getElementById('history-range-group').classList.remove('hidden');

  document.getElementById('history-load').onclick = loadHistory;
  document.getElementById('history-export').onclick = exportHistory;
  document.getElementById('history-search').oninput = () => { currentPage = 1; renderHistoryTable(); };
  document.getElementById('history-per-page').onchange = () => { perPage = parseInt(document.getElementById('history-per-page').value, 10); currentPage = 1; renderHistoryTable(); };

  try {
    allEmployees = await loadKaryawanData(currentAY);
    // Also load KF students for the dropdown
    allStudents = await api.getKFStudents({ academicYear: currentAY.label, active: 'true' });
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

  updateHistoryFilterLabel();
  loadHistory();
}

function updateHistoryFilterLabel() {
  const type = document.getElementById('history-type')?.value || 'renungan_harian';
  const label = document.getElementById('history-employee-label');
  const select = document.getElementById('history-employee');

  if (type === 'kanaan_fellowship_siswa') {
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

function toggleMode() {
  const mode = document.querySelector('input[name="history-mode"]:checked').value;
  const isRange = mode === 'range';
  document.getElementById('history-single-date-group').classList.toggle('hidden', isRange);
  document.getElementById('history-range-group').classList.toggle('hidden', !isRange);
  document.getElementById('history-range-group-end').classList.toggle('hidden', !isRange);
}

async function loadHistory() {
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
  const isSiswa = presensiType === 'kanaan_fellowship_siswa';
  const filterLabel = employee === 'all' ? (isSiswa ? 'semua kelas' : 'semua karyawan') : employee;
  statusMsg.textContent = `${count} record ${typeLabel} ditemukan untuk ${filterLabel}.`;
  currentPage = 1;
  renderHistoryTable();
  renderHistoryChart();
}

function getFilteredRecords() {
  const employee = document.getElementById('history-employee').value;
  const searchTerm = (document.getElementById('history-search').value || '').toLowerCase();
  const presensiType = document.getElementById('history-type')?.value || 'renungan_harian';

  return allRecords.filter(r => {
    // For KF-Siswa, filter by class; for others, filter by employee name
    if (presensiType === 'kanaan_fellowship_siswa') {
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

  const statusLabels = {};
  CONFIG.ATTENDANCE_STATUSES.forEach(s => statusLabels[s.value] = s.label);

  allFiltered.sort((a, b) => (b.attendance_date || '').localeCompare(a.attendance_date || '') || (a.employee_name || '').localeCompare(b.employee_name || ''));

  const totalPages = Math.max(1, Math.ceil(allFiltered.length / perPage));
  if (currentPage > totalPages) currentPage = totalPages;
  const startIdx = (currentPage - 1) * perPage;
  const pageRecords = allFiltered.slice(startIdx, startIdx + perPage);

  pageRecords.forEach((r, i) => {
    const tr = document.createElement('tr');
    const statusCfg = CONFIG.ATTENDANCE_STATUSES.find(s => s.value === r.status);
    const user = userMap[r.recorded_by];
    const recorderName = user ? user.full_name : r.recorded_by || '—';
    const recorderRole = r.recorded_by_role ? (CONFIG.ROLES[r.recorded_by_role] || r.recorded_by_role) : (user ? (CONFIG.ROLES[user.role] || user.role) : '');
    const presensiTypeLabel = CONFIG.PRESENSI_TYPE_LABELS[r.presensi_type] || '';
    const presensiTypeClass = r.presensi_type === 'ibadah_mingguan' ? 'presensi-type-im' : 'presensi-type-rh';
    tr.innerHTML = `
      <td>${startIdx + i + 1}</td>
      <td>${r.attendance_date || ''}</td>
      <td>${r.employee_name || ''}</td>
      <td>${r.employee_position || ''}</td>
      <td>${r.employee_division || ''}</td>
      <td>${statusCfg ? `<span class="status-badge status-${r.status}">${statusLabels[r.status]}</span>` : r.status}</td>
      <td>${r.notes || ''}</td>
      <td><span class="presensi-type-badge ${presensiTypeClass}">${presensiTypeLabel}</span></td>
      <td><div class="recorder-info"><span class="recorder-name">${recorderName}</span><span class="recorder-username">@${r.recorded_by || '—'}</span>${recorderRole ? `<span class="recorder-role">${recorderRole}</span>` : ''}</div></td>
    `;
    tbody.appendChild(tr);
  });

  if (tbody.children.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px">Tidak ada data presensi</td></tr>';
  }

  const statusEl = document.getElementById('history-status');
  if (statusEl) statusEl.textContent = `${allFiltered.length} record — Halaman ${currentPage}/${totalPages}`;

  renderPagination(totalPages, allFiltered.length);
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

async function exportHistory() {
  let records = getFilteredRecords();
  const btn = document.getElementById('history-export');
  const employee = document.getElementById('history-employee').value;

  if (records.length === 0) {
    alert('Tidak ada data untuk diexport.');
    return;
  }

  // Filter out inactive employees
  const yearLabel = document.getElementById('history-year').value;
  try {
    const activeEmps = await loadKaryawanData(yearLabel);
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
    const presensiType = document.getElementById('history-type').value;
    const typeLabel = CONFIG.PRESENSI_TYPE_LABELS[presensiType] || 'Presensi';
    const typeSlug = presensiType === 'ibadah_mingguan' ? 'Ibadah_Mingguan' : 'Renungan_Harian';
    const isSiswa = presensiType === 'kanaan_fellowship_siswa';
    const meta = {
      startDate,
      endDate,
      academicYear: document.getElementById('history-year').value,
      employee: employee === 'all' ? (isSiswa ? 'Semua Kelas' : 'Semua Karyawan') : employee,
      presensiType,
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
