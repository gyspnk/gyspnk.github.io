import { CONFIG } from './config.js';
import { api } from './api.js';
import { getCurrentUser, isReadOnly, canWrite } from './auth.js';
import { getAvailableYears, loadKaryawanData, getCurrentAcademicYear } from './data-loader.js';

let currentEmployees = [];
let currentAttendance = {};
let currentYearObj = null;
let divisionFilter = 'all';
let currentPresensiType = 'renungan_harian';

export async function initPresensi() {
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

function enforceDateRestriction() {
  const dateInput = document.getElementById('presensi-date');
  if (!dateInput) return;
  if (currentPresensiType === 'ibadah_mingguan') {
    // Only allow Fridays (day 5)
    const currentVal = dateInput.value;
    if (currentVal) {
      const d = new Date(currentVal + 'T00:00:00');
      if (d.getDay() !== CONFIG.IBADAH_MINGGUAN_DAY) {
        // Auto-adjust to nearest Friday
        dateInput.value = getNearestFriday(d);
      }
    }
    dateInput.addEventListener('change', validateFriday);
    const msgEl = document.getElementById('presensi-status-msg');
    if (msgEl && msgEl.style.background !== '#fee2e2' && msgEl.style.background !== 'rgb(254, 226, 226)') {
      msgEl.textContent = '⛪ Ibadah Mingguan hanya dapat diisi untuk hari Jumat.';
      msgEl.classList.remove('hidden');
    }
  } else {
    dateInput.removeEventListener('change', validateFriday);
  }
}

function validateFriday() {
  const dateInput = document.getElementById('presensi-date');
  if (!dateInput || currentPresensiType !== 'ibadah_mingguan') return;
  const val = dateInput.value;
  if (val) {
    const d = new Date(val + 'T00:00:00');
    if (d.getDay() !== CONFIG.IBADAH_MINGGUAN_DAY) {
      dateInput.value = getNearestFriday(d);
    }
  }
}

function getNearestFriday(d) {
  const day = d.getDay();
  const target = CONFIG.IBADAH_MINGGUAN_DAY; // 5 = Friday
  const diff = target - day;
  const friday = new Date(d);
  friday.setDate(d.getDate() + diff);
  return `${friday.getFullYear()}-${String(friday.getMonth()+1).padStart(2,'0')}-${String(friday.getDate()).padStart(2,'0')}`;
}

async function loadPresensiData() {
  const yearLabel = document.getElementById('presensi-year').value;
  const date = document.getElementById('presensi-date').value;
  const years = await getAvailableYears();
  const yearObj = years.find(y => y.label === yearLabel) || getCurrentAcademicYear(years);
  currentYearObj = yearObj;
  const msgEl = document.getElementById('presensi-status-msg');

  if (!date) {
    msgEl.textContent = 'Pilih tanggal terlebih dahulu.';
    msgEl.classList.remove('hidden');
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

  renderTable();
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

  const readOnly = isReadOnly();

  filtered.forEach((emp, i) => {

    const existing = currentAttendance[emp.name] || {};
    const currentStatus = existing.status || '';
    const statusCfg = CONFIG.ATTENDANCE_STATUSES.find(s => s.value === currentStatus);

    const tr = document.createElement('tr');
    if (readOnly) {
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${emp.name}</td>
        <td>${emp.position}</td>
        <td>${emp.division}</td>
        <td>${statusCfg ? `<span class="status-badge status-${currentStatus}">${statusCfg.label}</span>` : '<span class="muted">—</span>'}</td>
        <td><span class="muted">${existing.notes || ''}</span></td>
      `;
    } else {
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${emp.name}</td>
        <td>${emp.position}</td>
        <td>${emp.division}</td>
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
      `;
    }
    tbody.appendChild(tr);

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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">Tidak ada data karyawan</td></tr>';
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
  const date = document.getElementById('presensi-date').value;
  const yearLabel = document.getElementById('presensi-year').value;
  const user = getCurrentUser();
  const msgEl = document.getElementById('presensi-status-msg');

  if (!date) {
    msgEl.textContent = 'Pilih tanggal terlebih dahulu.';
    msgEl.classList.remove('hidden');
    return;
  }

  // Validate Friday for ibadah mingguan
  if (currentPresensiType === 'ibadah_mingguan') {
    const d = new Date(date + 'T00:00:00');
    if (d.getDay() !== CONFIG.IBADAH_MINGGUAN_DAY) {
      msgEl.textContent = '⛪ Ibadah Mingguan hanya dapat diisi untuk hari Jumat.';
      msgEl.classList.remove('hidden');
      msgEl.style.background = '#fee2e2';
      msgEl.style.color = '#991b1b';
      return;
    }
  }

  const records = currentEmployees
    .filter(emp => divisionFilter === 'all' || emp.division === divisionFilter)
    .filter(emp => currentAttendance[emp.name] && currentAttendance[emp.name].status)
    .map(emp => ({
      employee_name: emp.name,
      employee_position: emp.position,
      employee_division: emp.division,
      employee_status: emp.status,
      status: currentAttendance[emp.name].status,
      notes: currentAttendance[emp.name].notes || ''
    }));

  if (records.length === 0) {
    msgEl.textContent = 'Tidak ada presensi yang diisi. Tandai status minimal satu karyawan.';
    msgEl.classList.remove('hidden');
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
  } catch (e) {
    msgEl.textContent = 'Gagal menyimpan: ' + e.message;
    msgEl.style.background = '#fee2e2';
    msgEl.style.color = '#991b1b';
  }
}

export function getPresensiState() {
  return { currentEmployees, currentAttendance, currentYearObj };
}

export { loadPresensiData };
