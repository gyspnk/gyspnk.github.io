import { CONFIG } from './config.js';
import { api } from './api.js';
import { getAvailableYears, getCurrentAcademicYear, loadKaryawanData } from './data-loader.js';
import { buildClassGroups, createMultiSelect, jenjangOfClass } from './multiselect.js?v=20261109a';

/* ===== Trend toggle state for export ===== */
const EXPORT_TREND_SERIES = [
  { key: 'combined', label: 'Hadir+Terlambat', color: '#22c55e', borderDash: [], fill: true, bgColor: 'rgba(34,197,94,0.1)' },
  { key: 'hadir', label: 'Hadir', color: '#1e40af', borderDash: [], fill: false, bgColor: 'transparent' },
  { key: 'terlambat', label: 'Terlambat', color: '#f59e0b', borderDash: [5, 3], fill: false, bgColor: 'transparent' },
  { key: 'izin', label: 'Izin', color: '#3b82f6', borderDash: [], fill: false, bgColor: 'transparent' },
  { key: 'sakit', label: 'Sakit', color: '#a855f7', borderDash: [], fill: false, bgColor: 'transparent' },
  { key: 'tidak_hadir', label: 'Tidak Hadir', color: '#ef4444', borderDash: [], fill: false, bgColor: 'transparent' },
];
let exportTrendState = Object.fromEntries(EXPORT_TREND_SERIES.map(s => [s.key, true]));
let exportPresensiConfig = {};
let classPicker = null;
let exportFilterReq = 0;

export async function initExport() {
  const years = await getAvailableYears();
  const currentAY = getCurrentAcademicYear(years);

  const yearSelect = document.getElementById('export-year');
  yearSelect.innerHTML = '';
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y.label;
    opt.textContent = y.label;
    if (y.label === currentAY.label) opt.selected = true;
    yearSelect.appendChild(opt);
  });

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  document.getElementById('export-start').value = fmtD(firstDay);
  document.getElementById('export-end').value = fmtD(now);

  document.getElementById('export-btn').onclick = doExport;
  document.getElementById('export-type').onchange = updateExportClassFilter;
  document.getElementById('export-year').onchange = updateExportClassFilter;
  renderExportTrendToggles();
  // Load presensi config for active-day filtering
  try {
    const config = await api.getPresensiConfig();
    config.forEach(c => { exportPresensiConfig[c.presensi_type] = (c.allowed_days || '').split(',').map(Number).filter(n => !isNaN(n)); });
  } catch(e) { exportPresensiConfig = {}; }
  // Populate class filter initially
  await updateExportClassFilter();
}

function renderExportTrendToggles() {
  const container = document.getElementById('export-trend-toggles');
  if (!container) return;
  container.innerHTML = '';
  EXPORT_TREND_SERIES.forEach(series => {
    const chip = document.createElement('button');
    chip.className = 'chart-toggle-chip active';
    chip.type = 'button';
    chip.style.setProperty('--toggle-color', series.color);
    chip.innerHTML = `
      <span class="toggle-dot" style="background:${series.color}"></span>
      <span class="toggle-label">${series.label}</span>
    `;
    chip.onclick = () => {
      exportTrendState[series.key] = !exportTrendState[series.key];
      chip.classList.toggle('active');
    };
    container.appendChild(chip);
  });
}

async function updateExportClassFilter() {
  const mount = document.getElementById('export-class-ms');
  const label = document.getElementById('export-class-label');
  if (!mount) return;
  const req = ++exportFilterReq;
  const type = document.getElementById('export-type').value;
  const isSiswa = CONFIG.isSiswaType(type);
  const yearLabel = document.getElementById('export-year').value;

  if (label) label.textContent = isSiswa ? 'Kelas' : 'Divisi';
  const allLabel = isSiswa ? 'Semua Kelas' : 'Semua Divisi';

  let groups = [];
  try {
    if (isSiswa) {
      const students = await api.getKFStudents({ academicYear: yearLabel, active: 'true' });
      groups = buildClassGroups(students.map(s => s.class).filter(Boolean));
    } else {
      // Untuk tipe guru, kelompokkan pilihan per divisi karyawan aktif
      const years = await getAvailableYears();
      const yearObj = years.find(y => y.label === yearLabel);
      if (yearObj) {
        const emps = await loadKaryawanData(yearObj, type);
        const divisions = [...new Set(emps.map(e => e.division).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, 'id', { numeric: true }))
          .map(v => ({ value: v, label: v }));
        groups = divisions.length ? [{ label: '', items: divisions }] : [];
      }
    }
  } catch (e) {
    console.error('Gagal memuat data filter jenjang:', e);
  }
  if (req !== exportFilterReq) return;

  if (!classPicker) {
    classPicker = createMultiSelect(mount, { allLabel, labelledBy: 'export-class-label' });
  }
  classPicker.setGroups(groups, { allLabel });
}

function getExportPresensiType() {
  const sel = document.getElementById('export-type');
  return sel ? sel.value : 'renungan_harian';
}

async function doExport() {
  window.showLoading();
  const startDate = document.getElementById('export-start').value;
  const endDate = document.getElementById('export-end').value;
  const academicYear = document.getElementById('export-year').value;
  const presensiType = getExportPresensiType();
  const btn = document.getElementById('export-btn');
  const preview = document.getElementById('export-preview');

  if (!startDate || !endDate) {
    preview.innerHTML = '<p style="color:var(--red)">Pilih rentang tanggal.</p>';
    window.hideLoading();
    return;
  }

  const typeLabel = CONFIG.PRESENSI_TYPE_LABELS[presensiType] || 'Presensi';
  btn.disabled = true;
  btn.textContent = 'Memproses...';
  preview.innerHTML = `<p>Memuat data presensi ${typeLabel}...</p>`;

  let records = [];
  try {
    records = await api.getAttendance({ startDate, endDate, academicYear, presensiType });
  } catch (e) {
    preview.innerHTML = `<p style="color:var(--red)">Gagal memuat data: ${e.message}</p>`;
    btn.disabled = false;
    btn.textContent = 'Export Laporan';
    return;
  }

  // Filter out inactive employees
  try {
    const years = await getAvailableYears();
    const yearObj = years.find(y => y.label === academicYear);
    if (yearObj) {
      const activeEmps = await loadKaryawanData(yearObj, presensiType);
      const activeNames = new Set(activeEmps.map(e => e.name));
      records = records.filter(r => activeNames.has(r.employee_name));
    }
  } catch (e) {
    console.error('Failed to filter inactive employees:', e);
  }

  // Filter by class/jenjang yang dipilih (kosong = semua)
  const selectedClasses = classPicker ? classPicker.getSelected() : [];
  if (selectedClasses.length) {
    records = records.filter(r => selectedClasses.includes(r.employee_division));
  }

  if (records.length === 0) {
    preview.innerHTML = '<p style="color:var(--amber)">Tidak ada data presensi pada rentang tanggal ini.</p>';
    btn.disabled = false;
    btn.textContent = 'Export Laporan';
    return;
  }

  // Ensure presensi config is loaded for day filtering
  if (Object.keys(exportPresensiConfig).length === 0) {
    try {
      const config = await api.getPresensiConfig();
      config.forEach(c => { exportPresensiConfig[c.presensi_type] = (c.allowed_days || '').split(',').map(Number).filter(n => !isNaN(n)); });
    } catch(e) { /* keep empty */ }
  }
  const allowedDays = exportPresensiConfig[presensiType] || [1,2,3,4,5];

  preview.innerHTML = '<p>Membuat grafik...</p>';
  const chartImages = await renderChartImages(records, startDate, endDate);

  preview.innerHTML = '<p>Membuat file Excel...</p>';

  try {
    const blob = await createExcelFile(records, chartImages, { startDate, endDate, academicYear, presensiType, allowedDays, employee: selectedClasses.length && classPicker ? classPicker.getSummary() : '' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const typeSlugMap = {
      renungan_harian: 'Renungan_Harian',
      ibadah_mingguan: 'Ibadah_Mingguan',
      kanaan_fellowship_guru: 'Kanaan_Fellowship_Guru',
      kanaan_fellowship_siswa: 'Kanaan_Fellowship_Siswa'
    };
    const typeSlug = typeSlugMap[presensiType] || 'Presensi';
    const filterLabel = selectedClasses.length && classPicker ? classPicker.getSummary() : '';
    const slugSource = filterLabel
      ? (filterLabel.length <= 40 ? filterLabel : `${selectedClasses.length} pilihan`)
      : '';
    const filterSlug = slugSource
      ? '_' + slugSource.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '')
      : '';
    a.download = `Laporan_${typeSlug}${filterSlug}_${startDate}_${endDate}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    preview.innerHTML = `<p style="color:var(--green);font-weight:600">File Excel berhasil dibuat dengan ${records.length} record${filterLabel ? ` (${filterLabel})` : ''} dan grafik.</p>`;
  } catch (e) {
    preview.innerHTML = `<p style="color:var(--red)">Gagal membuat Excel: ${e.message}</p>`;
  }

  btn.disabled = false;
  btn.textContent = 'Export Laporan';
  window.hideLoading();
}

export async function renderChartImages(records, startDate, endDate) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(container);
  const images = {};

  const counts = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0 };
  records.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

  const byDate = {};
  const statusKeys = ['hadir', 'terlambat', 'izin', 'sakit', 'tidak_hadir_tk'];
  records.forEach(r => {
    if (!byDate[r.attendance_date]) {
      byDate[r.attendance_date] = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0, total: 0 };
    }
    if (statusKeys.includes(r.status)) byDate[r.attendance_date][r.status]++;
    byDate[r.attendance_date].total++;
  });

  const byDivision = {};
  records.forEach(r => {
    const div = r.employee_division || 'N/A';
    if (!byDivision[div]) byDivision[div] = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0, total: 0 };
    if (byDivision[div][r.status] !== undefined) byDivision[div][r.status]++;
    byDivision[div].total++;
  });

  // Distribution doughnut
  const c1 = document.createElement('canvas');
  c1.width = 400; c1.height = 300;
  container.appendChild(c1);
  const ch1 = new Chart(c1.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: CONFIG.ATTENDANCE_STATUSES.map(s => s.label),
      datasets: [{ data: CONFIG.ATTENDANCE_STATUSES.map(s => counts[s.value]), backgroundColor: CONFIG.ATTENDANCE_STATUSES.map(s => s.color) }]
    },
    options: { responsive: false, animation: false, plugins: { legend: { position: 'bottom' } } }
  });
  images.distribution = ch1.toBase64Image();
  ch1.destroy();

  // Trend line — series based on export toggle state
  const dates = Object.keys(byDate).sort();
  const calcRate = (v, status) => v.total > 0 ? Math.round((v[status] / v.total) * 100) : 0;
  const calcCombined = v => v.total > 0 ? Math.round(((v.hadir + v.terlambat) / v.total) * 100) : 0;
  const trendDatasets = [];
  EXPORT_TREND_SERIES.forEach(series => {
    if (!exportTrendState[series.key]) return;
    const data = [];
    const counts = [];
    dates.forEach(d => {
      const v = byDate[d];
      if (series.key === 'combined') {
        data.push(calcCombined(v));
        counts.push(v.hadir + v.terlambat);
      } else {
        const statusKey = series.key === 'tidak_hadir' ? 'tidak_hadir_tk' : series.key;
        data.push(calcRate(v, statusKey));
        counts.push(v[statusKey]);
      }
    });
    trendDatasets.push({
      label: series.key === 'combined' ? 'Hadir+Terlambat' : series.label,
      data,
      _counts: counts,
      borderColor: series.color,
      backgroundColor: series.bgColor,
      fill: series.fill,
      tension: 0.3,
      borderWidth: series.key === 'combined' ? 2.5 : 2,
      borderDash: series.borderDash,
      pointRadius: 2,
    });
  });
  const c2 = document.createElement('canvas');
  c2.width = 700; c2.height = 300;
  container.appendChild(c2);
  const ch2 = new Chart(c2.getContext('2d'), {
    type: 'line',
    data: { labels: dates, datasets: trendDatasets },
    options: { responsive: false, animation: false, scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, usePointStyle: true } } } }
  });
  images.trend = ch2.toBase64Image();
  ch2.destroy();

  // Division bar
  const divisions = Object.keys(byDivision).sort();
  const c3 = document.createElement('canvas');
  c3.width = 700; c3.height = 300;
  container.appendChild(c3);
  const datasets = CONFIG.ATTENDANCE_STATUSES.map(s => ({
    label: s.label, backgroundColor: s.color,
    data: divisions.map(d => byDivision[d][s.value])
  }));
  const ch3 = new Chart(c3.getContext('2d'), {
    type: 'bar',
    data: { labels: divisions, datasets },
    options: { responsive: false, animation: false, scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { legend: { position: 'bottom' } } }
  });
  images.division = ch3.toBase64Image();
  ch3.destroy();

  document.body.removeChild(container);
  return images;
}

export async function createExcelFile(records, chartImages, meta) {
  const ExcelJS = window.ExcelJS;
  if (!ExcelJS) throw new Error('ExcelJS library tidak tersedia');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pastoral Hub SKKKR';
  wb.created = new Date();

  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const statusShort = { hadir: 'H', terlambat: 'T', izin: 'I', sakit: 'S', tidak_hadir_tk: 'TH' };
  const statusColorHex = { hadir: '22C55E', terlambat: 'F59E0B', izin: '3B82F6', sakit: 'A855F7', tidak_hadir_tk: 'EF4444' };
  const fmtKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  // Generate dates based on presensi config allowed days (not hardcoded Mon-Fri)
  const allowedDays = meta.allowedDays || [1,2,3,4,5];
  const startDate = new Date(meta.startDate + 'T00:00:00');
  const endDate = new Date(meta.endDate + 'T00:00:00');
  const dates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    if (allowedDays.includes(d.getDay())) dates.push(new Date(d));
  }

  // Build lookup: empName_dateStr → status
  const isSiswa = CONFIG.isSiswaType(meta.presensiType);
  const identityLabel = isSiswa ? 'NIS' : 'Jabatan';
  const groupLabel = isSiswa ? 'Kelas' : 'Divisi';
  const lookup = {};
  const empMap = new Map();
  records.forEach(r => {
    const dateKey = (r.attendance_date || '').split('T')[0];
    const division = r.employee_division || '';
    const empKey = `${r.employee_name}||${division}`;
    lookup[`${empKey}||${dateKey}`] = r.status;
    if (!empMap.has(empKey)) {
      empMap.set(empKey, {
        name: r.employee_name,
        position: r.employee_position || '',
        division,
        status: r.employee_status || '',
      });
    }
  });

  // Unique employees sorted by name
  const employees = [...empMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  const statusOf = (emp, d) => lookup[`${emp.name}||${emp.division}||${fmtKey(d)}`] || '';

  // ===== Sheet 1: Rekap Presensi (pivot table) =====
  const ws1 = wb.addWorksheet('Rekap Presensi', { views: [{ state: 'frozen', xSplit: 4, ySplit: 1 }] });

  // Build columns
  const fixedCols = [
    { header: 'No', key: 'no', width: 5 },
    { header: 'Nama', key: 'name', width: 28 },
    { header: identityLabel, key: 'identity', width: 16 },
    { header: groupLabel, key: 'group', width: 14 },
  ];
  const dateCols = dates.map((d, i) => {
    const dayName = dayNames[d.getDay()];
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return { header: `${dayName}\n${dd}/${mm}`, key: `d${i}`, width: 7 };
  });
  const summaryCols = [
    { header: 'Total\nH', key: 'totalH', width: 7 },
    { header: 'Total\nT', key: 'totalT', width: 7 },
    { header: 'Total\nI', key: 'totalI', width: 7 },
    { header: 'Total\nS', key: 'totalS', width: 7 },
    { header: 'Total\nTH', key: 'totalTH', width: 7 },
  ];
  ws1.columns = [...fixedCols, ...dateCols, ...summaryCols];

  // Style header
  const headerRow = ws1.getRow(1);
  headerRow.height = 32;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };
  });

  // Style date header cells with blue background for all active days
  dates.forEach((d, i) => {
    const cell = headerRow.getCell(5 + i);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
  });

  // Style summary header cells
  const summaryColors = ['FF22C55E', 'FFF59E0B', 'FF3B82F6', 'FFA855F7', 'FFEF4444'];
  summaryColors.forEach((color, i) => {
    const cell = headerRow.getCell(5 + dates.length + i);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  });

  // Data rows
  employees.forEach((emp, i) => {
    const rowData = {
      no: i + 1,
      name: emp.name,
      identity: (isSiswa ? emp.status : emp.position) || '—',
      group: emp.division,
    };
    let tH = 0, tT = 0, tI = 0, tS = 0, tTH = 0;

    dates.forEach((d, j) => {
      const status = statusOf(emp, d);
      rowData[`d${j}`] = statusShort[status] || '';
      if (status === 'hadir') tH++;
      else if (status === 'terlambat') tT++;
      else if (status === 'izin') tI++;
      else if (status === 'sakit') tS++;
      else if (status === 'tidak_hadir_tk') tTH++;
    });

    rowData.totalH = tH;
    rowData.totalT = tT;
    rowData.totalI = tI;
    rowData.totalS = tS;
    rowData.totalTH = tTH;

    const row = ws1.addRow(rowData);
    row.height = 20;

    // Style data cells
    dates.forEach((d, j) => {
      const status = statusOf(emp, d);
      const cell = row.getCell(5 + j);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (status && statusColorHex[status]) {
        cell.font = { bold: true, color: { argb: 'FF' + statusColorHex[status] }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1A' + statusColorHex[status] } };
      }
    });

    // Style summary cells
    const totals = [tH, tT, tI, tS, tTH];
    totals.forEach((val, j) => {
      const cell = row.getCell(5 + dates.length + j);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (val > 0) {
        cell.font = { bold: true, color: { argb: 'FF' + summaryColors[j].slice(2) }, size: 10 };
      }
    });

    // Alternating row color
    if (i % 2 === 1) {
      row.eachCell((cell, colNum) => {
        if (colNum <= 4) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
      });
    }
  });

  ws1.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ===== Sheet 2: Ringkasan + Charts =====
  const ws2 = wb.addWorksheet('Ringkasan');
  ws2.getColumn(1).width = 30;
  ws2.getColumn(2).width = 15;
  ws2.getColumn(3).width = 15;

  ws2.mergeCells('A1:C1');
  ws2.getCell('A1').value = 'LAPORAN PRESENSI PASTORAL HUB SKKKR';
  ws2.getCell('A1').font = { bold: true, size: 16 };
  ws2.getCell('A1').alignment = { horizontal: 'center' };

  ws2.mergeCells('A2:C2');
  const typeLabelExcel = (CONFIG.PRESENSI_TYPE_LABELS[meta.presensiType] || 'Presensi')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  ws2.getCell('A2').value = `Sekolah Kristen Kanaan Kubu Raya — ${typeLabelExcel}`;
  ws2.getCell('A2').font = { size: 11, italic: true };
  ws2.getCell('A2').alignment = { horizontal: 'center' };

  ws2.getCell('A4').value = 'Rentang Tanggal:';
  ws2.getCell('B4').value = `${meta.startDate} s/d ${meta.endDate}`;
  ws2.getCell('A5').value = 'Hari Kerja:';
  const allowedDayLabels = allowedDays.map(d => dayNames[d]).join(', ');
  ws2.getCell('B5').value = `${dates.length} hari (${allowedDayLabels})`;
  ws2.getCell('A6').value = 'Tahun Ajaran:';
  ws2.getCell('B6').value = meta.academicYear;
  ws2.getCell('A7').value = 'Total Record:';
  ws2.getCell('B7').value = records.length;
  ws2.getCell('A8').value = 'Filter:';
  ws2.getCell('B8').value = meta.employee || 'Semua';
  for (const r of ['A4','A5','A6','A7','A8']) ws2.getCell(r).font = { bold: true };

  const counts = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0 };
  records.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
  const total = records.length;

  ws2.getCell('A9').value = 'RINGKASAN STATUS';
  ws2.getCell('A9').font = { bold: true, size: 13 };
  ws2.getCell('A10').value = 'Status'; ws2.getCell('B10').value = 'Jumlah'; ws2.getCell('C10').value = 'Persentase';
  ws2.getRow(10).font = { bold: true };
  CONFIG.ATTENDANCE_STATUSES.forEach((s, i) => {
    const rowN = 11 + i;
    ws2.getCell(`A${rowN}`).value = s.label;
    ws2.getCell(`B${rowN}`).value = counts[s.value];
    ws2.getCell(`C${rowN}`).value = total > 0 ? (counts[s.value] / total * 100).toFixed(1) + '%' : '0%';
    ws2.getCell(`A${rowN}`).font = { color: { argb: 'FF' + s.color.replace('#', '').toUpperCase() }, bold: true };
  });

  if (chartImages.distribution) {
    const imgId = wb.addImage({ base64: chartImages.distribution, extension: 'png' });
    ws2.addImage(imgId, { tl: { col: 4, row: 2 }, ext: { width: 350, height: 260 } });
  }
  if (chartImages.trend) {
    const imgId2 = wb.addImage({ base64: chartImages.trend, extension: 'png' });
    ws2.addImage(imgId2, { tl: { col: 0, row: 18 }, ext: { width: 600, height: 260 } });
  }
  if (chartImages.division) {
    const imgId3 = wb.addImage({ base64: chartImages.division, extension: 'png' });
    ws2.addImage(imgId3, { tl: { col: 0, row: 34 }, ext: { width: 600, height: 260 } });
  }

  // ===== Rekap per kelas/divisi + sheet detail per kelas =====
  const groupMap = new Map();
  employees.forEach(emp => {
    const key = emp.division || (isSiswa ? 'Tanpa Kelas' : 'Tanpa Divisi');
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(emp);
  });
  const jenjangRank = { TK: 0, SD: 1, SMP: 2, Lainnya: 3 };
  const groupKeys = [...groupMap.keys()].sort((a, b) =>
    (jenjangRank[jenjangOfClass(a)] - jenjangRank[jenjangOfClass(b)])
    || a.localeCompare(b, 'id', { numeric: true })
  );

  const sumStatuses = list => {
    const t = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0, total: 0 };
    list.forEach(emp => {
      dates.forEach(d => {
        const st = statusOf(emp, d);
        if (st && t[st] !== undefined) { t[st]++; t.total++; }
      });
    });
    return t;
  };
  const rateOf = s => s.total ? (((s.hadir + s.terlambat) / s.total) * 100).toFixed(1) + '%' : '0%';

  const recapName = isSiswa ? 'Rekap per Kelas' : 'Rekap per Divisi';
  const wsRekap = wb.addWorksheet(recapName, { views: [{ state: 'frozen', ySplit: 1 }] });
  wsRekap.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: groupLabel, key: 'group', width: 24 },
    { header: isSiswa ? 'Jumlah Siswa' : 'Jumlah Karyawan', key: 'jumlah', width: 16 },
    { header: 'Hadir', key: 'hadir', width: 9 },
    { header: 'Terlambat', key: 'terlambat', width: 11 },
    { header: 'Izin', key: 'izin', width: 8 },
    { header: 'Sakit', key: 'sakit', width: 8 },
    { header: 'Tidak Hadir', key: 'tidak_hadir_tk', width: 12 },
    { header: 'Total Record', key: 'total', width: 13 },
    { header: '% Kehadiran', key: 'rate', width: 12 },
  ];
  const recapHeader = wsRekap.getRow(1);
  recapHeader.height = 30;
  recapHeader.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  const recapTotal = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0, total: 0 };
  groupKeys.forEach((key, i) => {
    const list = groupMap.get(key);
    const s = sumStatuses(list);
    Object.keys(recapTotal).forEach(k => { recapTotal[k] += s[k]; });
    const row = wsRekap.addRow([
      i + 1, key, list.length, s.hadir, s.terlambat, s.izin, s.sakit, s.tidak_hadir_tk, s.total, rateOf(s),
    ]);
    row.height = 18;
    row.eachCell((cell, col) => {
      cell.alignment = { horizontal: col === 2 ? 'left' : 'center', vertical: 'middle' };
    });
    if (i % 2 === 1) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }
  });
  const recapFooter = wsRekap.addRow([
    '', 'TOTAL', employees.length, recapTotal.hadir, recapTotal.terlambat, recapTotal.izin,
    recapTotal.sakit, recapTotal.tidak_hadir_tk, recapTotal.total, rateOf(recapTotal),
  ]);
  recapFooter.font = { bold: true };
  recapFooter.eachCell((cell, col) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
    cell.alignment = { horizontal: col === 2 ? 'left' : 'center', vertical: 'middle' };
  });
  if (groupKeys.length) {
    wsRekap.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + groupKeys.length, column: 10 } };
  }
  wsRekap.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const usedSheetNames = new Set(['rekap presensi', 'ringkasan', recapName.toLowerCase()]);
  const uniqueSheetName = raw => {
    let base = String(raw || 'Lainnya').replace(/[\\/*?:\[\]]/g, '-').replace(/^'+|'+$/g, '').trim() || 'Lainnya';
    base = base.slice(0, 31);
    let name = base;
    let n = 2;
    while (usedSheetNames.has(name.toLowerCase())) {
      const suffix = ` (${n++})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    usedSheetNames.add(name.toLowerCase());
    return name;
  };

  const dateLabels = dates.map(d => `${dayNames[d.getDay()]}\n${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`);

  groupKeys.forEach(groupKey => {
    const list = groupMap.get(groupKey).sort((a, b) => a.name.localeCompare(b.name, 'id'));
    const ws = wb.addWorksheet(uniqueSheetName(groupKey), { views: [{ state: 'frozen', xSplit: 4, ySplit: 5 }] });
    const heads = ['No', 'Nama', identityLabel, groupLabel, ...dateLabels, 'H', 'T', 'I', 'S', 'TH', '% Hadir'];
    const colCount = heads.length;
    const widths = [5, 28, 16, 14, ...dates.map(() => 6.5), 5, 5, 5, 5, 5, 9];
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    ws.addRow([`LAPORAN PRESENSI — ${groupLabel.toUpperCase()} ${groupKey}`]);
    ws.mergeCells(1, 1, 1, colCount);
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF1E40AF' } };
    ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 26;

    ws.addRow([`Sekolah Kristen Kanaan Kubu Raya — ${typeLabelExcel}`]);
    ws.mergeCells(2, 1, 2, colCount);
    ws.getCell(2, 1).font = { size: 11, italic: true };
    ws.getCell(2, 1).alignment = { horizontal: 'center' };

    ws.addRow([`Periode: ${meta.startDate} s/d ${meta.endDate} · Tahun Ajaran: ${meta.academicYear} · Hari Aktif: ${dates.length}`]);
    ws.mergeCells(3, 1, 3, colCount);
    ws.getCell(3, 1).alignment = { horizontal: 'center' };

    ws.addRow([]);

    const headerRow = ws.addRow(heads);
    headerRow.height = 32;
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };
    });
    dates.forEach((d, i) => {
      headerRow.getCell(5 + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    });
    summaryColors.forEach((color, i) => {
      headerRow.getCell(5 + dates.length + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    });

    const groupTotals = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0 };
    list.forEach((emp, i) => {
      let h = 0, t = 0, iz = 0, s = 0, th = 0;
      const statuses = dates.map(d => statusOf(emp, d));
      statuses.forEach(st => {
        if (st === 'hadir') h++;
        else if (st === 'terlambat') t++;
        else if (st === 'izin') iz++;
        else if (st === 'sakit') s++;
        else if (st === 'tidak_hadir_tk') th++;
      });
      groupTotals.hadir += h;
      groupTotals.terlambat += t;
      groupTotals.izin += iz;
      groupTotals.sakit += s;
      groupTotals.tidak_hadir_tk += th;
      const totalRec = h + t + iz + s + th;
      const rate = totalRec ? (((h + t) / totalRec) * 100).toFixed(1) + '%' : '0%';
      const row = ws.addRow([
        i + 1,
        emp.name,
        (isSiswa ? emp.status : emp.position) || '—',
        emp.division,
        ...statuses.map(st => statusShort[st] || ''),
        h, t, iz, s, th, rate,
      ]);
      row.height = 18;
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      dates.forEach((d, j) => {
        const st = statuses[j];
        const cell = row.getCell(5 + j);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (st && statusColorHex[st]) {
          cell.font = { bold: true, color: { argb: 'FF' + statusColorHex[st] }, size: 10 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1A' + statusColorHex[st] } };
        }
      });
      for (let j = 0; j < 5; j++) {
        row.getCell(5 + dates.length + j).alignment = { horizontal: 'center', vertical: 'middle' };
      }
      row.getCell(colCount).alignment = { horizontal: 'center', vertical: 'middle' };
      if (i % 2 === 1) {
        row.eachCell((cell, colNum) => {
          if (colNum <= 4) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        });
      }
    });

    const grandTotal = groupTotals.hadir + groupTotals.terlambat + groupTotals.izin + groupTotals.sakit + groupTotals.tidak_hadir_tk;
    const footer = ws.addRow([
      '', 'TOTAL', '', '', ...dates.map(() => ''),
      groupTotals.hadir, groupTotals.terlambat, groupTotals.izin, groupTotals.sakit, groupTotals.tidak_hadir_tk,
      grandTotal ? (((groupTotals.hadir + groupTotals.terlambat) / grandTotal) * 100).toFixed(1) + '%' : '0%',
    ]);
    footer.font = { bold: true };
    footer.eachCell((cell, colNum) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
      if (colNum >= 5) cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    if (list.length) {
      ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + list.length, column: colCount } };
    }
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function exportRecords(records, meta, fileName) {
  const chartImages = await renderChartImages(records, meta.startDate, meta.endDate);
  const blob = await createExcelFile(records, chartImages, meta);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || `Laporan_Presensi_${meta.startDate}_${meta.endDate}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
