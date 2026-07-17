import { CONFIG } from './config.js';
import { api } from './api.js';
import { getAvailableYears, getCurrentAcademicYear } from './data-loader.js';

let charts = {};
let currentData = [];

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
  const byDate = {};
  currentData.forEach(r => {
    if (!byDate[r.attendance_date]) byDate[r.attendance_date] = { hadir: 0, terlambat: 0, total: 0 };
    if (byDate[r.attendance_date][r.status] !== undefined) byDate[r.attendance_date][r.status]++;
    byDate[r.attendance_date].total++;
  });

  const dates = Object.keys(byDate).sort();
  const combinedRates = dates.map(d => { const v = byDate[d]; return v.total > 0 ? Math.round(((v.hadir + v.terlambat) / v.total) * 100) : 0; });
  const hadirRates = dates.map(d => { const v = byDate[d]; return v.total > 0 ? Math.round((v.hadir / v.total) * 100) : 0; });
  const terlambatRates = dates.map(d => { const v = byDate[d]; return v.total > 0 ? Math.round((v.terlambat / v.total) * 100) : 0; });

  const ctx = document.getElementById('chart-trend').getContext('2d');
  charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        { label: 'Hadir + Terlambat (%)', data: combinedRates, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.1)', fill: true, tension: 0.3, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5 },
        { label: 'Hadir (%)', data: hadirRates, borderColor: '#1e40af', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2, borderDash: [] },
        { label: 'Terlambat (%)', data: terlambatRates, borderColor: '#f59e0b', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2, borderDash: [5, 3] }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } },
      plugins: { legend: { display: true, position: 'bottom', labels: { font: { size: 11 }, usePointStyle: true, padding: 16 } } }
    }
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

export function getCurrentDashboardData() {
  return currentData;
}
