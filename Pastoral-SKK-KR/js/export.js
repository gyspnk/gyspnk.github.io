import { CONFIG } from './config.js';
import { api } from './api.js';
import { getAvailableYears, getCurrentAcademicYear, loadKaryawanData } from './data-loader.js';

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
  renderExportTrendToggles();
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

  if (records.length === 0) {
    preview.innerHTML = '<p style="color:var(--amber)">Tidak ada data presensi pada rentang tanggal ini.</p>';
    btn.disabled = false;
    btn.textContent = 'Export Laporan';
    return;
  }

  preview.innerHTML = '<p>Membuat grafik...</p>';
  const chartImages = await renderChartImages(records, startDate, endDate);

  preview.innerHTML = '<p>Membuat file Excel...</p>';

  try {
    const blob = await createExcelFile(records, chartImages, { startDate, endDate, academicYear, presensiType });
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
    a.download = `Laporan_${typeSlug}_${startDate}_${endDate}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    preview.innerHTML = `<p style="color:var(--green);font-weight:600">File Excel berhasil dibuat dengan ${records.length} record dan grafik.</p>`;
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
    let data;
    if (series.key === 'combined') {
      data = dates.map(d => calcCombined(byDate[d]));
    } else {
      data = dates.map(d => calcRate(byDate[d], series.key === 'tidak_hadir' ? 'tidak_hadir_tk' : series.key));
    }
    trendDatasets.push({
      label: series.key === 'combined' ? 'Hadir+Terlambat (%)' : `${series.label} (%)`,
      data,
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

  // Generate weekday dates (Sen-Jum)
  const startDate = new Date(meta.startDate + 'T00:00:00');
  const endDate = new Date(meta.endDate + 'T00:00:00');
  const dates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) dates.push(new Date(d));
  }

  // Build lookup: empName_dateStr → status
  const lookup = {};
  const empMap = new Map();
  records.forEach(r => {
    const dateKey = (r.attendance_date || '').split('T')[0];
    lookup[`${r.employee_name}_${dateKey}`] = r.status;
    if (!empMap.has(r.employee_name)) {
      empMap.set(r.employee_name, { position: r.employee_position || '', division: r.employee_division || '' });
    }
  });

  // Unique employees sorted by name
  const employees = [...empMap.entries()].map(([name, info]) => ({ name, ...info })).sort((a, b) => a.name.localeCompare(b.name));

  // ===== Sheet 1: Rekap Presensi (pivot table) =====
  const ws1 = wb.addWorksheet('Rekap Presensi', { views: [{ state: 'frozen', xSplit: 4 }] });

  // Build columns
  const fixedCols = [
    { header: 'No', key: 'no', width: 5 },
    { header: 'Nama', key: 'name', width: 28 },
    { header: 'Jabatan', key: 'position', width: 20 },
    { header: 'Divisi', key: 'division', width: 12 },
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

  // Style date header cells with weekend indicator (none since we skip weekends, but style weekday)
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
    const rowData = { no: i + 1, name: emp.name, position: emp.position, division: emp.division };
    let tH = 0, tT = 0, tI = 0, tS = 0, tTH = 0;

    dates.forEach((d, j) => {
      const dateKey = fmtKey(d);
      const status = lookup[`${emp.name}_${dateKey}`] || '';
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
      const dateKey = fmtKey(d);
      const status = lookup[`${emp.name}_${dateKey}`] || '';
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
  const typeLabelExcel = CONFIG.PRESENSI_TYPE_LABELS[meta.presensiType]?.replace(/\s*\(.*?\)\s*/g, '').trim() || 'Presensi';
  ws2.getCell('A2').value = `Sekolah Kristen Kanaan Kubu Raya — ${typeLabelExcel}`;
  ws2.getCell('A2').font = { size: 11, italic: true };
  ws2.getCell('A2').alignment = { horizontal: 'center' };

  ws2.getCell('A4').value = 'Rentang Tanggal:';
  ws2.getCell('B4').value = `${meta.startDate} s/d ${meta.endDate}`;
  ws2.getCell('A5').value = 'Hari Kerja:';
  ws2.getCell('B5').value = `${dates.length} hari (Sen-Jum)`;
  ws2.getCell('A6').value = 'Tahun Ajaran:';
  ws2.getCell('B6').value = meta.academicYear;
  ws2.getCell('A7').value = 'Total Record:';
  ws2.getCell('B7').value = records.length;
  for (const r of ['A4','A5','A6','A7']) ws2.getCell(r).font = { bold: true };

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
