import { CONFIG } from './config.js';
import { api } from './api.js';
import { getCurrentUser, isReadOnly, canWrite, hasRole } from './auth.js';
import { getAvailableYears, loadKaryawanData, getCurrentAcademicYear } from './data-loader.js';

let currentEmployees = [];
let currentAttendance = {};
let currentYearObj = null;
let divisionFilter = 'all';
let currentPresensiType = 'renungan_harian';

export async function initPresensi() {
  await loadPresensiDayConfig();
  const years = await getAvailableYears();
  const currentAY = getCurrentAcademicYear(years);
  currentYearObj = currentAY;

  const yearSelect = document.getElementById('presensi-year');
  yearSelect.innerHTML = '';
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y.label;
    opt.textContent = y.label;
    if (y.label === currentAY.label) opt.selected = true;
    yearSelect.appendChild(opt);
  });

  const dateInput = document.getElementById('presensi-date');
  const now = new Date();
  dateInput.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  // Presensi type selector
  const typeSelect = document.getElementById('presensi-type');
  typeSelect.onchange = () => {
    currentPresensiType = typeSelect.value;
    updatePresensiTitle();
    enforceDateRestriction();
    updatePresensiWriteUI();
    loadPresensiData();
  };
  currentPresensiType = typeSelect.value || 'renungan_harian';
  updatePresensiTitle();
  updatePresensiWriteUI();

  document.getElementById('presensi-date').onchange = loadPresensiData;
  document.getElementById('presensi-year').onchange = loadPresensiData;
  document.getElementById('presensi-save').onclick = savePresensi;
  document.getElementById('presensi-delete').onclick = deletePresensi;
  document.getElementById('presensi-search').oninput = filterTable;
  document.getElementById('presensi-division-filter').onchange = () => {
    divisionFilter = document.getElementById('presensi-division-filter').value;
    renderTable();
  };

  document.querySelectorAll('[data-bulk]').forEach(btn => {
    btn.onclick = () => bulkMark(btn.dataset.bulk);
  });

  if (isReadOnly()) {
    document.getElementById('presensi-save').classList.add('hidden');
    document.querySelector('.presensi-toolbar').classList.add('hidden');
  }

  enforceDateRestriction();
  loadPresensiData();
}

function updatePresensiTitle() {
  const titleEl = document.querySelector('#view-presensi .page-header h2');
  if (titleEl) {
    const label = CONFIG.PRESENSI_TYPE_LABELS[currentPresensiType] || 'Presensi';
    titleEl.textContent = `Presensi ${label}`;
  }
  // Update table headers
  const headerRow = document.getElementById('presensi-table-header');
  if (!headerRow) return;
  const isSiswa = currentPresensiType === 'kanaan_fellowship_siswa';
  const isAdmin = hasRole('admin');
  headerRow.innerHTML = isSiswa
    ? `<th>No</th><th>Nama</th><th>NIS</th><th>Kelas</th><th>Status</th><th>Keterangan</th>${isAdmin ? '<th>Aksi</th>' : ''}`
    : `<th>No</th><th>Nama</th><th>Jabatan</th><th>Divisi</th><th>Status</th><th>Keterangan</th>${isAdmin ? '<th>Aksi</th>' : ''}`;
}

function updatePresensiWriteUI() {
  const hasWrite = canWrite(currentPresensiType);
  const saveBtn = document.getElementById('presensi-save');
  const toolbar = document.querySelector('.presensi-toolbar');
  const msgEl = document.getElementById('presensi-status-msg');

  if (!hasWrite && !isReadOnly()) {
    if (saveBtn) saveBtn.classList.add('hidden');
    if (toolbar) toolbar.classList.add('hidden');
    if (msgEl) {
      msgEl.textContent = '🔒 Anda hanya memiliki akses lihat untuk presensi ini.';
      msgEl.classList.remove('hidden');
      msgEl.style.background = '#fef3c7';
      msgEl.style.color = '#92400e';
    }
  } else if (!isReadOnly()) {
    if (saveBtn) saveBtn.classList.remove('hidden');
    if (toolbar) toolbar.classList.remove('hidden');
  }
}

let presensiAllowedDays = {}; // populated from API

async function loadPresensiDayConfig() {
  try {
    const config = await api.getPresensiConfig();
    presensiAllowedDays = {};
    config.forEach(c => { presensiAllowedDays[c.presensi_type] = (c.allowed_days || '').split(',').map(Number).filter(n => !isNaN(n)); });
  } catch(e) { presensiAllowedDays = {}; }
}

function getAllowedDays() {
  // Fallback to defaults if not loaded
  if (!presensiAllowedDays[currentPresensiType]) {
    return currentPresensiType === 'ibadah_mingguan' ? [5] : [1,2,3,4,5];
  }
  return presensiAllowedDays[currentPresensiType];
}

function enforceDateRestriction() {
  const dateInput = document.getElementById('presensi-date');
  if (!dateInput) return;
  const allowedDays = getAllowedDays();

  // Grey out disallowed days in the date picker
  dateInput.addEventListener('input', validateDayAllowed);
  dateInput.addEventListener('change', validateDayPopup);

  const msgEl = document.getElementById('presensi-status-msg');
  const dayNames = CONFIG.DAY_NAMES;
  const allowedNames = allowedDays.map(d => dayNames[d]).join(', ');
  if (msgEl && msgEl.style.background !== '#fee2e2') {
    msgEl.textContent = `📅 Hari yang diperbolehkan: ${allowedNames}.`;
    msgEl.classList.remove('hidden');
    msgEl.style.background = '#dbeafe'; msgEl.style.color = '#1e40af';
  }

  // Validate current date
  validateCurrentDate();
}

function validateCurrentDate() {
  const dateInput = document.getElementById('presensi-date');
  if (!dateInput) return;
  const val = dateInput.value;
  if (!val) return;
  const d = new Date(val + 'T00:00:00');
  const allowedDays = getAllowedDays();
  if (!allowedDays.includes(d.getDay())) {
    // Only show visual warning — don't auto-change date on initial load
    // The user should manually pick a valid date or the save validation will catch it
    const dayNames = CONFIG.DAY_NAMES;
    const allowedNames = allowedDays.map(d => dayNames[d]).join(', ');
    dateInput.style.borderColor = 'var(--red)';
    dateInput.style.background = '#fef2f2';
    const msgEl = document.getElementById('presensi-status-msg');
    if (msgEl) {
      msgEl.textContent = `⚠️ Hari ${dayNames[d.getDay()]} tidak diperbolehkan. Hari yang bisa: ${allowedNames}. Silakan pilih tanggal lain.`;
      msgEl.classList.remove('hidden');
      msgEl.style.background = '#fee2e2';
      msgEl.style.color = '#991b1b';
    }
  }
}

function validateDayAllowed() {
  const dateInput = document.getElementById('presensi-date');
  if (!dateInput) return;
  const val = dateInput.value;
  if (!val) return;
  const d = new Date(val + 'T00:00:00');
  const allowedDays = getAllowedDays();
  // Visual only: grey out in supported browsers
  if (!allowedDays.includes(d.getDay())) {
    dateInput.style.borderColor = 'var(--red)';
    dateInput.style.background = '#fef2f2';
  } else {
    dateInput.style.borderColor = '';
    dateInput.style.background = '';
  }
}

function validateDayPopup() {
  const dateInput = document.getElementById('presensi-date');
  if (!dateInput) return;
  const val = dateInput.value;
  if (!val) return;
  const d = new Date(val + 'T00:00:00');
  const allowedDays = getAllowedDays();
  if (!allowedDays.includes(d.getDay())) {
    const dayNames = CONFIG.DAY_NAMES;
    const allowedNames = allowedDays.map(d => dayNames[d]).join(', ');
    const previousVal = dateInput.dataset.previousDate || '';
    alert(`⚠️ Hari ${dayNames[d.getDay()]} tidak diperbolehkan untuk presensi ini.\n\nHari yang diperbolehkan: ${allowedNames}\n\nTanggal akan dikembalikan.`);
    dateInput.value = previousVal || getNearestAllowedDay(d, allowedDays);
    dateInput.style.borderColor = '';
    dateInput.style.background = '';
  } else {
    dateInput.dataset.previousDate = val;
    dateInput.style.borderColor = '';
    dateInput.style.background = '';
  }
}

function getNearestAllowedDay(d, allowedDays) {
  // Find closest allowed day (forward first)
  for (let i = 0; i < 7; i++) {
    const check = new Date(d);
    check.setDate(d.getDate() + i);
    if (allowedDays.includes(check.getDay())) {
      return `${check.getFullYear()}-${String(check.getMonth()+1).padStart(2,'0')}-${String(check.getDate()).padStart(2,'0')}`;
    }
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function loadPresensiData() {
  window.showLoading();
  const yearLabel = document.getElementById('presensi-year').value;
  const date = document.getElementById('presensi-date').value;
  const years = await getAvailableYears();
  const yearObj = years.find(y => y.label === yearLabel) || getCurrentAcademicYear(years);
  currentYearObj = yearObj;
  const msgEl = document.getElementById('presensi-status-msg');

  if (!date) {
    msgEl.textContent = 'Pilih tanggal terlebih dahulu.';
    msgEl.classList.remove('hidden');
    window.hideLoading();
    return;
  }

  // Validate Friday for ibadah mingguan
  if (currentPresensiType === 'ibadah_mingguan') {
    const d = new Date(date + 'T00:00:00');
    if (d.getDay() !== CONFIG.IBADAH_MINGGUAN_DAY) {
      msgEl.textContent = '⛪ Ibadah Mingguan hanya dapat diisi untuk hari Jumat. Silakan pilih tanggal Jumat.';
      msgEl.classList.remove('hidden');
      msgEl.style.background = '#fee2e2';
      msgEl.style.color = '#991b1b';
      return;
    }
  }

  msgEl.textContent = 'Memuat data karyawan...';
  msgEl.classList.remove('hidden');
  msgEl.style.background = '';
  msgEl.style.color = '';

  try {
    currentEmployees = await loadKaryawanData(yearObj, currentPresensiType);
  } catch (e) {
    msgEl.textContent = 'Gagal memuat data: ' + e.message;
    window.hideLoading();
    return;
  }

  populateDivisionFilter();

  currentAttendance = {};
  try {
    const existing = await api.getAttendance({ date, academicYear: yearObj.label, presensiType: currentPresensiType });
    for (const rec of existing) {
      currentAttendance[rec.employee_name] = {
        status: rec.status,
        notes: rec.notes || '',
        recorded_by: rec.recorded_by
      };
    }
  } catch {}

  if (Object.keys(currentAttendance).length > 0) {
    msgEl.textContent = `Data presensi ${CONFIG.PRESENSI_TYPE_LABELS[currentPresensiType]} tanggal ${date} sudah ada (diisi oleh ${getRecordedBy()}). Anda dapat mengeditnya.`;
  } else {
    msgEl.textContent = `Belum ada data presensi ${CONFIG.PRESENSI_TYPE_LABELS[currentPresensiType]} untuk tanggal ${date}. Silakan isi presensi.`;
  }

  // Show/hide delete button (admin only, and only when data exists)
  updateDeleteButtonVisibility();

  renderTable();
  window.hideLoading();
}

function updateDeleteButtonVisibility() {
  const deleteBtn = document.getElementById('presensi-delete');
  if (!deleteBtn) return;
  if (hasRole('admin') && Object.keys(currentAttendance).length > 0 && !isReadOnly() && canWrite(currentPresensiType)) {
    deleteBtn.classList.remove('hidden');
  } else {
    deleteBtn.classList.add('hidden');
  }
}

function getRecordedBy() {
  const names = Object.values(currentAttendance).map(a => a.recorded_by).filter(Boolean);
  return [...new Set(names)].join(', ') || '—';
}

function populateDivisionFilter() {
  const select = document.getElementById('presensi-division-filter');
  if (!select) return;
  const divisions = [...new Set(currentEmployees.map(e => e.division).filter(Boolean))].sort();
  const current = select.value;
  select.innerHTML = '';
  divisions.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    select.appendChild(opt);
  });
  if (divisions.includes(current)) {
    select.value = current;
  } else if (divisions.length > 0) {
    select.value = divisions[0];
  }
  divisionFilter = select.value;
}

function renderTable() {
  const tbody = document.getElementById('presensi-tbody');
  tbody.innerHTML = '';
  const searchTerm = (document.getElementById('presensi-search').value || '').toLowerCase();

  const filtered = currentEmployees.filter((emp) => {
    if (divisionFilter !== 'all' && emp.division !== divisionFilter) return false;
    if (searchTerm && !emp.name.toLowerCase().includes(searchTerm) &&
        !emp.position.toLowerCase().includes(searchTerm) &&
        !emp.division.toLowerCase().includes(searchTerm)) return false;
    return true;
  });

  const readOnly = isReadOnly() || !canWrite(currentPresensiType);
  const isSiswa = currentPresensiType === 'kanaan_fellowship_siswa';
  const isAdmin = hasRole('admin');

  filtered.forEach((emp, i) => {

    const existing = currentAttendance[emp.name] || {};
    const currentStatus = existing.status || '';
    const statusCfg = CONFIG.ATTENDANCE_STATUSES.find(s => s.value === currentStatus);

    const col2 = isSiswa ? (emp.status || '—') : (emp.position || '');
    const col3 = isSiswa ? (emp.division || '—') : (emp.division || '');

    const deleteBtnHtml = (isAdmin && existing.status) ? `<button class="btn btn-danger btn-sm" data-del-user="${emp.name}" title="Hapus presensi user ini" style="padding:2px 6px;font-size:14px">🗑</button>` : '';

    const tr = document.createElement('tr');
    if (readOnly) {
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${emp.name}</td>
        <td>${col2}</td>
        <td>${col3}</td>
        <td>${statusCfg ? `<span class="status-badge status-${currentStatus}">${statusCfg.label}</span>` : '<span class="muted">—</span>'}</td>
        <td><span class="muted">${existing.notes || ''}</span></td>
        ${isAdmin ? `<td>${deleteBtnHtml}</td>` : ''}
      `;
    } else {
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${emp.name}</td>
        <td>${col2}</td>
        <td>${col3}</td>
        <td>
          <div class="status-cell" data-employee="${emp.name}">
            ${CONFIG.ATTENDANCE_STATUSES.map(s => `
              <label class="opt-${s.value} ${currentStatus === s.value ? 'selected' : ''}" data-status="${s.value}">
                <input type="radio" name="status_${i}" value="${s.value}" ${currentStatus === s.value ? 'checked' : ''} />
                ${s.short}
              </label>
            `).join('')}
          </div>
        </td>
        <td>
          <input type="text" class="notes-input" data-employee="${emp.name}" value="${existing.notes || ''}" placeholder="Keterangan..." style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px" />
        </td>
        ${isAdmin ? `<td>${deleteBtnHtml}</td>` : ''}
      `;
    }
    tbody.appendChild(tr);

    // Wire up per-user delete buttons
    if (isAdmin) {
      const delBtn = tr.querySelector('[data-del-user]');
      if (delBtn) {
        delBtn.onclick = () => deletePresensiPerUser(delBtn.dataset.delUser);
      }
    }

    if (!readOnly) {
      const statusCell = tr.querySelector('.status-cell');
      statusCell.querySelectorAll('label').forEach(label => {
        label.onclick = () => {
          statusCell.querySelectorAll('label').forEach(l => l.classList.remove('selected'));
          label.classList.add('selected');
          label.querySelector('input').checked = true;
          currentAttendance[emp.name] = {
            ...(currentAttendance[emp.name] || {}),
            status: label.dataset.status
          };
        };
      });

      const notesInput = tr.querySelector('.notes-input');
      notesInput.oninput = () => {
        currentAttendance[emp.name] = {
          ...(currentAttendance[emp.name] || {}),
          notes: notesInput.value
        };
      };
    }
  });

  if (tbody.children.length === 0) {
    const adminColspan = hasRole('admin') ? '7' : '6';
    tbody.innerHTML = `<tr><td colspan="${adminColspan}" style="text-align:center;color:var(--text-muted);padding:20px">Tidak ada data karyawan</td></tr>`;
  }
}

function filterTable() {
  renderTable();
}

function bulkMark(status) {
  const searchTerm = (document.getElementById('presensi-search').value || '').toLowerCase();
  const filtered = currentEmployees.filter((emp) => {
    if (divisionFilter !== 'all' && emp.division !== divisionFilter) return false;
    if (searchTerm && !emp.name.toLowerCase().includes(searchTerm) &&
        !emp.position.toLowerCase().includes(searchTerm) &&
        !emp.division.toLowerCase().includes(searchTerm)) return false;
    return true;
  });
  filtered.forEach(emp => {
    currentAttendance[emp.name] = {
      ...(currentAttendance[emp.name] || {}),
      status
    };
  });
  renderTable();
}

async function savePresensi() {
  window.showLoading();
  const date = document.getElementById('presensi-date').value;
  const yearLabel = document.getElementById('presensi-year').value;
  const user = getCurrentUser();
  const msgEl = document.getElementById('presensi-status-msg');

  if (!date) {
    msgEl.textContent = 'Pilih tanggal terlebih dahulu.';
    msgEl.classList.remove('hidden');
    window.hideLoading();
    return;
  }

  // Validate day based on presensi config
  const allowedDays = getAllowedDays();
  const d = new Date(date + 'T00:00:00');
  if (!allowedDays.includes(d.getDay())) {
    const dayName = CONFIG.DAY_NAMES[d.getDay()];
    const allowedNames = allowedDays.map(dn => CONFIG.DAY_NAMES[dn]).join(', ');
    msgEl.textContent = `⚠️ Hari ${dayName} tidak diperbolehkan. Hari yang bisa: ${allowedNames}.`;
    msgEl.classList.remove('hidden');
    msgEl.style.background = '#fee2e2';
    msgEl.style.color = '#991b1b';
    window.hideLoading();
    return;
  }

  // Include ALL employees — auto-mark empty ones as "tidak hadir"
  const records = currentEmployees
    .filter(emp => divisionFilter === 'all' || emp.division === divisionFilter)
    .map(emp => {
      const att = currentAttendance[emp.name];
      const hasStatus = att && att.status;
      return {
        employee_name: emp.name,
        employee_position: emp.position,
        employee_division: emp.division,
        employee_status: emp.status,
        status: hasStatus ? att.status : 'tidak_hadir_tk',
        notes: hasStatus ? (att.notes || '') : 'Otomatis: tidak hadir (belum diisi)'
      };
    });

  if (records.length === 0) {
    msgEl.textContent = 'Tidak ada karyawan untuk disimpan.';
    msgEl.classList.remove('hidden');
    window.hideLoading();
    return;
  }

  msgEl.textContent = 'Menyimpan...';
  msgEl.classList.remove('hidden');

  try {
    const result = await api.saveAttendance({
      date,
      academicYear: yearLabel,
      recordedBy: user.username,
      recordedByRole: user.role,
      presensiType: currentPresensiType,
      records
    });
    msgEl.textContent = `Berhasil menyimpan ${result.count || records.length} record presensi ${CONFIG.PRESENSI_TYPE_LABELS[currentPresensiType]} untuk tanggal ${date}.`;
    msgEl.style.background = '#dcfce7';
    msgEl.style.color = '#166534';
    setTimeout(() => { msgEl.style.background = ''; msgEl.style.color = ''; }, 5000);
    await loadPresensiData();
    window.hideLoading();
  } catch (e) {
    msgEl.textContent = 'Gagal menyimpan: ' + e.message;
    msgEl.style.background = '#fee2e2';
    msgEl.style.color = '#991b1b';
    window.hideLoading();
  }
}

async function deletePresensi() {
  const date = document.getElementById('presensi-date').value;
  const yearLabel = document.getElementById('presensi-year').value;
  const msgEl = document.getElementById('presensi-status-msg');

  if (!date) {
    msgEl.textContent = 'Pilih tanggal terlebih dahulu.';
    msgEl.classList.remove('hidden');
    return;
  }

  const count = Object.keys(currentAttendance).length;
  if (!confirm(`Hapus SEMUA data presensi ${CONFIG.PRESENSI_TYPE_LABELS[currentPresensiType]} untuk tanggal ${date}?\n\nJumlah record: ${count}\n\nData akan kembali ke status "belum diisi" dan tidak bisa dikembalikan.`)) return;

  window.showLoading();
  msgEl.textContent = 'Menghapus...';
  msgEl.classList.remove('hidden');

  try {
    await api.deleteAttendance({
      date,
      academicYear: yearLabel,
      presensiType: currentPresensiType
    });
    msgEl.textContent = `Berhasil menghapus ${count} record presensi ${CONFIG.PRESENSI_TYPE_LABELS[currentPresensiType]} untuk tanggal ${date}.`;
    msgEl.style.background = '#dcfce7';
    msgEl.style.color = '#166534';
    setTimeout(() => { msgEl.style.background = ''; msgEl.style.color = ''; }, 5000);
    currentAttendance = {};
    renderTable();
    updateDeleteButtonVisibility();
    window.hideLoading();
  } catch (e) {
    msgEl.textContent = 'Gagal menghapus: ' + e.message;
    msgEl.style.background = '#fee2e2';
    msgEl.style.color = '#991b1b';
    window.hideLoading();
  }
}

async function deletePresensiPerUser(employeeName) {
  const date = document.getElementById('presensi-date').value;
  const yearLabel = document.getElementById('presensi-year').value;
  const msgEl = document.getElementById('presensi-status-msg');

  if (!confirm(`Hapus data presensi untuk "${employeeName}" pada tanggal ${date}?\n\nData akan kembali ke status "belum diisi".`)) return;

  window.showLoading();
  msgEl.textContent = 'Menghapus...';
  msgEl.classList.remove('hidden');

  try {
    await api.deleteAttendance({
      date,
      academicYear: yearLabel,
      presensiType: currentPresensiType,
      employeeName
    });
    delete currentAttendance[employeeName];
    msgEl.textContent = `Berhasil menghapus presensi "${employeeName}".`;
    msgEl.style.background = '#dcfce7';
    msgEl.style.color = '#166534';
    setTimeout(() => { msgEl.style.background = ''; msgEl.style.color = ''; }, 3000);
    renderTable();
    updateDeleteButtonVisibility();
    window.hideLoading();
  } catch (e) {
    msgEl.textContent = 'Gagal menghapus: ' + e.message;
    msgEl.style.background = '#fee2e2';
    msgEl.style.color = '#991b1b';
    window.hideLoading();
  }
}

export function getPresensiState() {
  return { currentEmployees, currentAttendance, currentYearObj };
}

export { loadPresensiData };
