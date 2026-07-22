import { CONFIG } from './config.js';
import { api } from './api.js';
import { getAvailableYears, getCurrentAcademicYear } from './data-loader.js';

let charts = {};
let currentData = [];

/* ===== Trend Chart Toggle State ===== */
const TREND_SERIES = [
  { key: 'combined', label: 'Hadir+Terlambat', color: '#22c55e', borderDash: [], fill: true, bgColor: 'rgba(34,197,94,0.1)' },
  { key: 'hadir', label: 'Hadir', color: '#1e40af', borderDash: [], fill: false, bgColor: 'transparent' },
  { key: 'terlambat', label: 'Terlambat', color: '#f59e0b', borderDash: [5, 3], fill: false, bgColor: 'transparent' },
  { key: 'izin', label: 'Izin', color: '#3b82f6', borderDash: [], fill: false, bgColor: 'transparent' },
  { key: 'sakit', label: 'Sakit', color: '#a855f7', borderDash: [], fill: false, bgColor: 'transparent' },
  { key: 'tidak_hadir', label: 'Tidak Hadir', color: '#ef4444', borderDash: [], fill: false, bgColor: 'transparent' },
];
// All enabled by default
let trendToggleState = Object.fromEntries(TREND_SERIES.map(s => [s.key, true]));

export async function initDashboard() {
  const years = await getAvailableYears();
  const currentAY = getCurrentAcademicYear(years);

  const yearSelect = document.getElementById('dash-academic-year');
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
  document.getElementById('dash-start-date').value = fmtD(firstDay);
  document.getElementById('dash-end-date').value = fmtD(now);

  document.getElementById('dash-refresh').onclick = loadDashboard;

  // Presensi type selector for dashboard
  const dashTypeSelect = document.getElementById('dash-presensi-type');
  if (dashTypeSelect) {
    dashTypeSelect.onchange = loadDashboard;
  }

  loadDashboard();
}

async function loadDashboard() {
  window.showLoading();
  const startDate = document.getElementById('dash-start-date').value;
  const endDate = document.getElementById('dash-end-date').value;
  const academicYear = document.getElementById('dash-academic-year').value;
  const presensiType = document.getElementById('dash-presensi-type')?.value || 'renungan_harian';

  try {
    currentData = await api.getAttendance({ startDate, endDate, academicYear, presensiType });
  } catch (e) {
    currentData = [];
    console.error('Dashboard load error:', e);
  }

  updateStats();
  renderDistributionChart();
  renderTrendChart();
  renderDivisionChart();
  renderDivisionCountChart();
  window.hideLoading();
}

function updateStats() {
  const counts = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0 };
  currentData.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

  document.getElementById('stat-hadir').textContent = counts.hadir;
  document.getElementById('stat-terlambat').textContent = counts.terlambat;
  document.getElementById('stat-izin').textContent = counts.izin;
  document.getElementById('stat-sakit').textContent = counts.sakit;
  document.getElementById('stat-tk').textContent = counts.tidak_hadir_tk;
  document.getElementById('stat-total').textContent = currentData.length;
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

function renderDistributionChart() {
  destroyChart('dist');
  const counts = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0 };
  currentData.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

  const ctx = document.getElementById('chart-distribution').getContext('2d');
  charts.dist = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: CONFIG.ATTENDANCE_STATUSES.map(s => s.label),
      datasets: [{
        data: CONFIG.ATTENDANCE_STATUSES.map(s => counts[s.value]),
        backgroundColor: CONFIG.ATTENDANCE_STATUSES.map(s => s.color),
        borderWidth: 2, borderColor: '#fff'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } }
    }
  });
}

function renderTrendChart() {
  destroyChart('trend');

  // Build per-date stats tracking ALL statuses
  const byDate = {};
  const statusKeys = ['hadir', 'terlambat', 'izin', 'sakit', 'tidak_hadir_tk'];
  currentData.forEach(r => {
    if (!byDate[r.attendance_date]) {
      byDate[r.attendance_date] = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0, total: 0 };
    }
    if (statusKeys.includes(r.status)) byDate[r.attendance_date][r.status]++;
    byDate[r.attendance_date].total++;
  });

  const dates = Object.keys(byDate).sort();
  const calcRate = (v, status) => v.total > 0 ? Math.round((v[status] / v.total) * 100) : 0;
  const calcCombined = v => v.total > 0 ? Math.round(((v.hadir + v.terlambat) / v.total) * 100) : 0;

  // Build datasets only for enabled toggles
  const datasets = [];
  TREND_SERIES.forEach(series => {
    if (!trendToggleState[series.key]) return;
    let data;
    if (series.key === 'combined') {
      data = dates.map(d => calcCombined(byDate[d]));
    } else {
      data = dates.map(d => calcRate(byDate[d], series.key === 'tidak_hadir' ? 'tidak_hadir_tk' : series.key));
    }
    datasets.push({
      label: series.key === 'combined' ? 'Hadir + Terlambat (%)' : `${series.label} (%)`,
      data,
      borderColor: series.color,
      backgroundColor: series.bgColor,
      fill: series.fill,
      tension: 0.3,
      pointRadius: series.key === 'combined' ? 4 : 3,
      pointHoverRadius: series.key === 'combined' ? 6 : 5,
      borderWidth: series.key === 'combined' ? 2.5 : 2,
      borderDash: series.borderDash,
    });
  });

  // Render toggles if not already rendered
  renderTrendToggles();

  const ctx = document.getElementById('chart-trend').getContext('2d');
  charts.trend = new Chart(ctx, {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } },
      plugins: { legend: { display: true, position: 'bottom', labels: { font: { size: 11 }, usePointStyle: true, padding: 16 } } }
    }
  });
}

function renderTrendToggles() {
  const container = document.getElementById('trend-toggles');
  if (!container || container.hasChildNodes()) return; // only render once

  container.innerHTML = '';
  TREND_SERIES.forEach(series => {
    const chip = document.createElement('button');
    chip.className = 'chart-toggle-chip active';
    chip.type = 'button';
    chip.style.setProperty('--toggle-color', series.color);
    chip.innerHTML = `
      <span class="toggle-dot" style="background:${series.color}"></span>
      <span class="toggle-label">${series.label}</span>
    `;
    chip.onclick = () => {
      trendToggleState[series.key] = !trendToggleState[series.key];
      chip.classList.toggle('active');
      renderTrendChart();
    };
    container.appendChild(chip);
  });
}

function renderDivisionChart() {
  destroyChart('division');
  const byDivision = {};
  currentData.forEach(r => {
    const div = r.employee_division || 'N/A';
    if (!byDivision[div]) byDivision[div] = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0, total: 0 };
    if (byDivision[div][r.status] !== undefined) byDivision[div][r.status]++;
    byDivision[div].total++;
  });

  const divisions = Object.keys(byDivision).sort();
  const datasets = CONFIG.ATTENDANCE_STATUSES.map(s => ({
    label: s.label,
    data: divisions.map(d => byDivision[d][s.value]),
    backgroundColor: s.color
  }));

  const ctx = document.getElementById('chart-division').getContext('2d');
  charts.division = new Chart(ctx, {
    type: 'bar',
    data: { labels: divisions, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } }
    }
  });
}

function renderDivisionCountChart() {
  destroyChart('divisionCount');
  const byDivision = {};
  currentData.forEach(r => {
    const div = r.employee_division || 'N/A';
    if (!byDivision[div]) byDivision[div] = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, tidak_hadir_tk: 0 };
    if (byDivision[div][r.status] !== undefined) byDivision[div][r.status]++;
  });

  const divisions = Object.keys(byDivision).sort();
  // Calculate total per division for count display
  const totalPerDivision = divisions.map(d => {
    const v = byDivision[d];
    return v.hadir + v.terlambat + v.izin + v.sakit + v.tidak_hadir_tk;
  });

  const datasets = CONFIG.ATTENDANCE_STATUSES.map(s => ({
    label: s.label,
    data: divisions.map(d => byDivision[d][s.value]),
    backgroundColor: s.color
  }));

  const canvas = document.getElementById('chart-division-count');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  charts.divisionCount = new Chart(ctx, {
    type: 'bar',
    data: { labels: divisions, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: true, title: { display: true, text: 'Divisi' } },
        y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Jumlah Record' }, ticks: { stepSize: 1 } }
      },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            footer: (items) => {
              const idx = items[0]?.dataIndex;
              return idx !== undefined ? `Total: ${totalPerDivision[idx]} record` : '';
            }
          }
        }
      }
    }
  });
}

export function getCurrentDashboardData() {
  return currentData;
}
