import { CONFIG } from './config.js';
import { api, isDemoMode } from './api.js';

/* ===== Calendar State ===== */
let currentMonth, currentYear;
let scheduleData = {};    // { sheetKey: { columns, rows, accessible, error } }
let visibility = {};      // { sheetKey: boolean }
let calendarViewMode = 'grid'; // 'grid' | 'list'
let calendarSheets = [];  // Loaded from API (or fallback to CONFIG)
let currentAcademicYear = CONFIG.ACADEMIC_YEAR_CURRENT || '2026-2027';

/* ===== Month names (Indonesian) ===== */
const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export async function initCalendar() {
  const now = new Date();
  currentMonth = now.getMonth();
  currentYear = now.getFullYear();

  // Load calendar sheet configs from API (or fallback to CONFIG)
  await loadCalendarConfig();

  // Init visibility from loaded config
  calendarSheets.forEach(sheet => {
    if (!(sheet.key in visibility)) visibility[sheet.key] = true;
  });

  // Populate AY dropdown
  await loadAYSelector();

  // Wire up navigation
  document.getElementById('cal-prev-month').onclick = () => navigateMonth(-1);
  document.getElementById('cal-next-month').onclick = () => navigateMonth(1);
  document.getElementById('cal-today').onclick = () => {
    const now = new Date();
    currentMonth = now.getMonth();
    currentYear = now.getFullYear();
    renderCalendar();
  };

  // Wire up AY selector
  const aySelect = document.getElementById('cal-academic-year');
  if (aySelect) {
    aySelect.onchange = async () => {
      currentAcademicYear = aySelect.value;
      scheduleData = {};
      visibility = {};
      await loadCalendarConfig();
      calendarSheets.forEach(s => { visibility[s.key] = true; });
      renderFilters();
      renderCalendar();
      fetchAllSchedules();
    };
  }

  // View toggle (mobile)
  const gridBtn = document.getElementById('cal-view-grid');
  const listBtn = document.getElementById('cal-view-list');
  if (gridBtn) gridBtn.onclick = () => switchViewMode('grid');
  if (listBtn) listBtn.onclick = () => switchViewMode('list');

  // Event modal close
  document.getElementById('cal-event-close').onclick = closeEventModal;
  document.getElementById('calendar-event-modal').onclick = (e) => {
    if (e.target === document.getElementById('calendar-event-modal')) closeEventModal();
  };
  // Search filter
  const searchInput = document.getElementById('cal-search');
  if (searchInput) {
    searchInput.oninput = () => {
      if (calendarViewMode === 'grid') renderCalendarGrid();
      else renderListView();
    };
    // Clear search on Escape
    const origKeyHandler = document.onkeydown;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!document.getElementById('calendar-event-modal').classList.contains('hidden')) {
          closeEventModal();
        } else if (searchInput.value) {
          searchInput.value = '';
          searchInput.oninput();
        }
      }
    });
  }

  renderCalendar();
  fetchAllSchedules();
}

async function loadCalendarConfig() {
  try {
    const configs = await api.getCalendarConfig(currentAcademicYear);
    if (configs && configs.length > 0) {
      calendarSheets = configs.map(c => ({
        key: c.sheet_key,
        label: c.sheet_label,
        sheetId: c.sheet_id,
        gid: c.gid || '0',
        color: c.color || '#3b82f6',
        defaultVisible: true
      }));
      return;
    }
  } catch (e) {
    console.warn('Failed to load calendar config from API, using defaults:', e.message);
  }
  // Fallback to hardcoded config
  calendarSheets = calendarSheets || [];
}

async function loadAYSelector() {
  const select = document.getElementById('cal-academic-year');
  if (!select) return;
  try {
    const years = await api.getCalendarConfigYears();
    select.innerHTML = '';
    const allYears = years.length > 0 ? years : [CONFIG.ACADEMIC_YEAR_CURRENT];
    allYears.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === currentAcademicYear) opt.selected = true;
      select.appendChild(opt);
    });
  } catch (e) {
    select.innerHTML = `<option value="${currentAcademicYear}">${currentAcademicYear}</option>`;
  }
}

function switchViewMode(mode) {
  calendarViewMode = mode;
  const gridBtn = document.getElementById('cal-view-grid');
  const listBtn = document.getElementById('cal-view-list');
  const gridEl = document.querySelector('.calendar-wrapper');
  const listEl = document.getElementById('calendar-list-view');

  if (mode === 'grid') {
    gridBtn.classList.add('btn-primary'); gridBtn.classList.remove('btn-secondary');
    listBtn.classList.add('btn-secondary'); listBtn.classList.remove('btn-primary');
    if (gridEl) gridEl.style.display = '';
    if (listEl) listEl.classList.add('hidden');
  } else {
    listBtn.classList.add('btn-primary'); listBtn.classList.remove('btn-secondary');
    gridBtn.classList.add('btn-secondary'); gridBtn.classList.remove('btn-primary');
    if (gridEl) gridEl.style.display = 'none';
    if (listEl) { listEl.classList.remove('hidden'); renderListView(); }
  }
}

/* ===== Fetch ===== */
async function fetchAllSchedules() {
  const statusEl = document.getElementById('calendar-status');
  showStatus('Memuat data jadwal...', 'info');

  const promises = calendarSheets.map(async (sheet) => {
    try {
      const data = await api.getCalendarSchedules(sheet.sheetId, sheet.gid);
      scheduleData[sheet.key] = {
        columns: data.columns || [],
        rows: data.rows || [],
        accessible: data.accessible !== false,
        error: data.error || null
      };
    } catch (e) {
      scheduleData[sheet.key] = {
        columns: [], rows: [], accessible: false,
        error: e.message || 'Gagal mengambil data'
      };
    }
  });

  await Promise.all(promises);

  // Debug: log fetch + parse results with sample data
  calendarSheets.forEach(sheet => {
    const data = scheduleData[sheet.key];
    if (data) {
      const events = parseSheetEvents(sheet, data.columns, data.rows);
      // For chapel/komsel, show first data rows (skip title/subtitle/header = first 3)
      const startIdx = (sheet.key === 'ibadah_mingguan_karyawan' || sheet.key === 'komsel_karyawan') ? 3 : 0;
      const sampleRows = data.rows ? data.rows.slice(startIdx, startIdx + 3) : [];
      console.log(`[Kalender] ${sheet.key}: accessible=${data.accessible}, rows=${data.rows ? data.rows.length : 0}, cols=${data.columns ? data.columns.length : 0}, events=${events.length}`,
        data.error || '',
        '\n  cols:', JSON.stringify(data.columns),
        '\n  sample rows:', JSON.stringify(sampleRows),
        '\n  sample events:', JSON.stringify(events.slice(0, 3).map(e => ({ d: e.dateStr, s: e.shortLabel }))));
    }
  });

  hideStatus();

  // Update filter chips with status
  renderFilters();
  renderCalendar();
}

/* ===== Filters (Show/Hide Toggles) ===== */
function renderFilters() {
  const container = document.getElementById('calendar-filter-chips');
  if (!container) return;

  container.innerHTML = '';
  calendarSheets.forEach(sheet => {
    const data = scheduleData[sheet.key];
    const isVisible = visibility[sheet.key];
    const isAccessible = data && data.accessible !== false;

    const chip = document.createElement('button');
    chip.className = 'filter-chip' + (isVisible ? ' active' : '');
    chip.style.setProperty('--chip-color', sheet.color);
    chip.type = 'button';
    chip.innerHTML = `
      <span class="chip-dot" style="background:${sheet.color}"></span>
      <span class="chip-label">${sheet.label}</span>
      ${!isAccessible ? '<span class="chip-warn" title="Sheet tidak dapat diakses. Publikasikan ke web terlebih dahulu.">⚠️</span>' : ''}
    `;
    chip.onclick = (e) => {
      e.preventDefault();
      visibility[sheet.key] = !visibility[sheet.key];
      renderFilters();
      if (calendarViewMode === 'grid') renderCalendarGrid();
      else renderListView();
    };
    container.appendChild(chip);
  });

  // Render legend
  const legend = document.getElementById('calendar-legend');
  if (legend) {
    legend.innerHTML = calendarSheets.map(s => {
      const data = scheduleData[s.key];
      const warnIcon = (data && data.accessible === false) ? ' ⚠️' : '';
      return `<span class="legend-item">
        <span class="legend-dot" style="background:${s.color}"></span> ${s.label}${warnIcon}
      </span>`;
    }).join('');
  }
}

/* ===== Calendar Grid Rendering ===== */
function renderCalendar() {
  document.getElementById('cal-month-year').textContent =
    `${MONTH_NAMES[currentMonth]} ${currentYear}`;

  if (calendarViewMode === 'grid') {
    document.querySelector('.calendar-wrapper').style.display = '';
    document.getElementById('calendar-list-view').classList.add('hidden');
    renderCalendarGrid();
  } else {
    document.querySelector('.calendar-wrapper').style.display = 'none';
    document.getElementById('calendar-list-view').classList.remove('hidden');
    renderListView();
  }
}

function renderCalendarGrid() {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;

  // Build event map: dateStr → [{ sheetKey, color, label, detail }]
  const eventMap = buildEventMap();

  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const daysInMonth = lastDay.getDate();

  // Start day of week (0=Sun, 1=Mon, ..., 6=Sat). We want Mon=0, Sun=6
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const today = new Date();
  const todayStr = fmtDate(today);

  let html = '';
  let cellCount = 0;

  // Previous month filler cells
  const prevLastDay = new Date(currentYear, currentMonth, 0).getDate();
  for (let i = startDow - 1; i >= 0; i--) {
    const day = prevLastDay - i;
    const d = new Date(currentYear, currentMonth - 1, day);
    const dStr = fmtDate(d);
    html += renderDayCell(day, dStr, 'other-month', eventMap, todayStr);
    cellCount++;
  }

  // Current month cells
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(currentYear, currentMonth, day);
    const dStr = fmtDate(d);
    const isToday = dStr === todayStr;
    const isWeekend = d.getDay() === 0; // Sunday
    let cls = isToday ? 'today' : '';
    if (isWeekend) cls += (cls ? ' ' : '') + 'weekend';
    html += renderDayCell(day, dStr, cls, eventMap, todayStr);
    cellCount++;
  }

  // Next month filler cells
  const remaining = (7 - (cellCount % 7)) % 7;
  for (let day = 1; day <= remaining; day++) {
    const d = new Date(currentYear, currentMonth + 1, day);
    const dStr = fmtDate(d);
    html += renderDayCell(day, dStr, 'other-month', eventMap, todayStr);
  }

  grid.innerHTML = html;

  // Wire up day cell clicks
  grid.querySelectorAll('.calendar-day:not(.empty)').forEach(cell => {
    cell.onclick = () => {
      const dateStr = cell.dataset.date;
      const events = eventMap[dateStr] || [];
      if (events.length > 0) showEventDetail(dateStr, events);
    };
  });
}

function renderDayCell(day, dateStr, cls, eventMap, todayStr) {
  const events = eventMap[dateStr] || [];
  // Build small event label chips — deduplicate by sheetKey, show up to 3 labels
  const MAX_LABELS = 6;  // 3 rows × 2 columns
  // Show ALL events (not deduplicated by sheetKey) for better coverage
  const labels = [];
  for (const evt of events) {
    if (labels.length >= MAX_LABELS) break;
    const labelText = (evt.shortLabel || evt.summary.split(' | ')[0]).replace(/^(📖|⛪|🙏|🤝)\s*/, '').substring(0, 18);
    labels.push({ color: evt.color, label: labelText, key: evt.sheetKey });
  }

  const labelsHtml = labels.map(l =>
    `<span class="day-label" style="background:${l.color};color:#fff" title="${l.label}">${l.label}</span>`
  ).join('');

  const remaining = events.length - labels.length;
  const moreBadge = remaining > 0
    ? `<span class="day-more">+${remaining}</span>` : '';

  return `<div class="calendar-day ${cls}" data-date="${dateStr}">
    <span class="day-num">${day}</span>
    <span class="day-labels">${labelsHtml}${moreBadge}</span>
  </div>`;
}

/* ===== List / Agenda View (all events, chronological) ===== */
function renderListView() {
  const container = document.getElementById('calendar-list-view');
  if (!container) return;

  const eventMap = buildEventMap();
  const today = new Date();
  const todayStr = fmtDate(today);

  // Flatten all events into sorted list by date
  const allEvents = [];
  Object.entries(eventMap).forEach(([dateStr, events]) => {
    events.forEach(evt => {
      allEvents.push({ dateStr, ...evt });
    });
  });
  allEvents.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

  if (allEvents.length === 0) {
    container.innerHTML = '<div class="list-empty">Tidak ada jadwal yang sesuai filter</div>';
    return;
  }

  let html = '';
  let lastDate = '';
  allEvents.forEach(evt => {
    const d = new Date(evt.dateStr + 'T00:00:00');
    const dayName = CONFIG.DAY_NAMES[d.getDay()];
    const isToday = evt.dateStr === todayStr;
    const dateLabel = `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;

    // Show date header when date changes
    if (evt.dateStr !== lastDate) {
      lastDate = evt.dateStr;
      html += `<div class="list-day ${isToday ? 'list-today' : ''}">
        <div class="list-day-header">
          <span class="list-date">${dateLabel}</span>
          <span class="list-dayname">${dayName}</span>
          ${isToday ? '<span class="list-today-badge">Hari Ini</span>' : ''}
        </div>`;
    }

    html += `<div class="list-event" style="border-left:3px solid ${evt.color};cursor:pointer" data-date="${evt.dateStr}" data-key="${evt.sheetKey}">
      <span class="list-event-source" style="color:${evt.color}">${evt.shortLabel || evt.summary.split(' | ')[0]}</span>
      <span class="list-event-desc">${evt.summary}</span>
    </div>`;
  });

  container.innerHTML = html;

  // Wire up click to open detail modal
  container.querySelectorAll('.list-event').forEach(el => {
    el.onclick = () => {
      const dateStr = el.dataset.date;
      const events = eventMap[dateStr] || [];
      if (events.length > 0) showEventDetail(dateStr, events);
    };
  });
}

/* ===== Event Map Builder ===== */
function buildEventMap() {
  const eventMap = {}; // dateStr → [{ sheetKey, color, sourceLabel, summary, detailHtml }]
  const searchQuery = (document.getElementById('cal-search')?.value || '').trim().toLowerCase();

  calendarSheets.forEach(sheet => {
    if (!visibility[sheet.key]) return;
    const data = scheduleData[sheet.key];
    if (!data || !data.rows || data.rows.length === 0) return;

    const events = parseSheetEvents(sheet, data.columns, data.rows);
    events.forEach(evt => {
      // Apply search filter: match shortLabel, summary, or detailHtml
      if (searchQuery) {
        const haystack = (evt.shortLabel + ' ' + evt.summary + ' ' + (evt.detailHtml || '').replace(/<[^>]*>/g, ' ')).toLowerCase();
        if (!haystack.includes(searchQuery)) return;
      }
      if (!eventMap[evt.dateStr]) eventMap[evt.dateStr] = [];
      eventMap[evt.dateStr].push(evt);
    });
  });

  return eventMap;
}

/* ===== Sheet-Specific Parsers ===== */
function parseSheetEvents(sheet, columns, rows) {
  switch (sheet.key) {
    case 'renungan_harian_siswa': return parseRenunganSiswa(sheet, columns, rows);
    case 'ibadah_mingguan_siswa': return parseIbadahSiswa(sheet, columns, rows);
    case 'ibadah_mingguan_karyawan': return parseChapelKaryawan(sheet, columns, rows);
    case 'komsel_karyawan': return parseKomselKaryawan(sheet, columns, rows);
    default: return parseDefaultSheet(sheet, columns, rows, sheet.label);
  }
}

// Renungan Harian Siswa: Cols = [Tanggal, Jadwal, Petugas TK-SD, Petugas SMP, Keterangan]
function parseRenunganSiswa(sheet, columns, rows) {
  const events = [];
  let currentYear = null;

  rows.forEach(row => {
    if (!row || row.length === 0 || !row[0]) return;

    // Try to extract date from first column
    const dateVal = row[0];
    const parsed = parseDateFlexible(dateVal);

    if (parsed) {
      // If only month is given (e.g., "Juli 2026"), use as reference
      if (parsed.monthOnly) {
        currentYear = parsed.year;
        return; // Skip header rows
      }
      currentYear = parsed.year || currentYear || currentYear;

      const dateStr = fmtDate(new Date(parsed.year || currentYear, parsed.month - 1, parsed.day));

      const petugasTkSd = row[2] ? String(row[2]).trim() : '';
      const petugasSmp = row[3] ? String(row[3]).trim() : '';
      const keterangan = row[4] ? String(row[4]).trim() : '';
      const jadwal = row[1] ? String(row[1]).trim() : '';

      const isHoliday = keterangan && /libur|merah|break|holiday/i.test(keterangan);
      if (isHoliday && !petugasTkSd && !petugasSmp) return;

      // Common detail HTML for the day
      const commonDetail = '<div class="event-detail">' +
        `<div class="event-source" style="color:${sheet.color}">${sheet.label}</div>` +
        (jadwal ? `<div class="event-field"><strong>Jadwal:</strong> ${jadwal}</div>` : '') +
        (keterangan ? `<div class="event-field"><strong>Keterangan:</strong> ${keterangan}</div>` : '');

      // Split into 2 events: TK-SD and SMP (separate labels in calendar cell)
      if (petugasTkSd) {
        const detailHtml = commonDetail +
          `<div class="event-field"><strong>Jenjang:</strong> TK-SD</div>` +
          `<div class="event-field"><strong>Petugas:</strong> ${petugasTkSd}</div></div>`;
        events.push({ dateStr, sheetKey: sheet.key, color: sheet.color, sourceLabel: sheet.label,
          summary: `Renungan TK-SD: ${petugasTkSd}`, shortLabel: `TK-SD: ${petugasTkSd}`, detailHtml });
      }
      if (petugasSmp) {
        const detailHtml = commonDetail +
          `<div class="event-field"><strong>Jenjang:</strong> SMP</div>` +
          `<div class="event-field"><strong>Petugas:</strong> ${petugasSmp}</div></div>`;
        events.push({ dateStr, sheetKey: sheet.key, color: sheet.color, sourceLabel: sheet.label,
          summary: `Renungan SMP: ${petugasSmp}`, shortLabel: `SMP: ${petugasSmp}`, detailHtml });
      }
    }
  });

  return events;
}

// Ibadah Mingguan Siswa:
// Cols: A=Tema, B=SubTema, C=Bulan, D=Tanggal(range), E=CeritaAlkitab, F=AlkitabBacaan,
// G=ArahanCerita, H=Pengajaran(TK-SD), I=Diskusi(Sec-JC),
// J+K=Kelas1(date+officer), L+M=Kelas2-4(date+officer), N+O=Kelas5-6(date+officer),
// P+Q=TK(date+officer), R+S=SMP(date+officer)
// Each class has its OWN specific day within the week range.
function parseIbadahSiswa(sheet, columns, rows) {
  const events = [];
  let currentYear = new Date().getFullYear();
  const now = new Date();
  if (now.getMonth() >= 6) currentYear = now.getFullYear();
  else currentYear = now.getFullYear();

  // Build month reference from bulan column (Col C = index 2)
  let bulanIdx = columns.findIndex(c => c && /bulan/i.test(c));
  if (bulanIdx < 0 && columns.length > 2) bulanIdx = 2; // fallback

  // Class schedule column pairs: [dateCol, officerCol, fullLabel, shortPrefix]
  const classSlots = [
    { dateIdx: 9,  officerIdx: 10, label: 'Kelas 1',   short: 'K1' },
    { dateIdx: 11, officerIdx: 12, label: 'Kelas 2-4', short: 'K2-4' },
    { dateIdx: 13, officerIdx: 14, label: 'Kelas 5-6', short: 'K5-6' },
    { dateIdx: 15, officerIdx: 16, label: 'TK',        short: 'TK' },
    { dateIdx: 17, officerIdx: 18, label: 'SMP',       short: 'SMP' },
  ];

  rows.forEach(row => {
    if (!row || row.length === 0) return;
    // Skip header rows
    const firstVal = String(row[0] || '').trim();
    if (!firstVal || /^tema$/i.test(firstVal)) return;

    // Parse month from column C (or bulanIdx)
    const bulanRaw = row[bulanIdx] || row[2] || '';
    const month = parseMonthShort(String(bulanRaw).trim());
    if (!month) return;

    // Core info
    const tema = row[0] ? String(row[0]).trim() : '';
    const subTema = row[1] ? String(row[1]).trim() : '';
    const ceritaAlkitab = row[4] ? String(row[4]).trim() : '';
    const alkitabBacaan = row[5] ? String(row[5]).trim() : '';
    const pengajaran = row[7] ? String(row[7]).trim() : '';

    // Process each class slot — each has its own specific date
    classSlots.slice(0, 5).forEach(slot => {
      const dateRaw = row[slot.dateIdx] ? String(row[slot.dateIdx]).trim() : '';
      const officer = row[slot.officerIdx] ? String(row[slot.officerIdx]).trim() : '';

      // Skip if no date or officer
      if (!dateRaw || !officer) return;

      // Parse the specific date (e.g., "Selasa, 21/07/2026" or "Jumat, 24/07/2026")
      const parsed = parseDateFlexible(dateRaw);
      if (!parsed || parsed.monthOnly) return;
      const dateStr = fmtDate(new Date(parsed.year || currentYear, parsed.month - 1, parsed.day));

      // Build summary & short label with class prefix
      const shortLabel = `${slot.short}: ${officer}`;
      const summary = `⛪ ${slot.label} — ${tema} | ${officer}`;

      // Build detail HTML
      let detailHtml = '<div class="event-detail">';
      detailHtml += `<div class="event-source" style="color:${sheet.color}">${sheet.label}</div>`;
      detailHtml += `<div class="event-field"><strong>Kelas:</strong> ${slot.label}</div>`;
      if (tema) detailHtml += `<div class="event-field"><strong>Tema:</strong> ${tema}</div>`;
      if (subTema) detailHtml += `<div class="event-field"><strong>Sub Tema:</strong> ${subTema}</div>`;
      if (ceritaAlkitab) detailHtml += `<div class="event-field"><strong>Cerita Alkitab:</strong> ${ceritaAlkitab}</div>`;
      if (alkitabBacaan) detailHtml += `<div class="event-field"><strong>Bacaan Alkitab:</strong> ${alkitabBacaan}</div>`;
      if (pengajaran) detailHtml += `<div class="event-field"><strong>Pengajaran:</strong> ${pengajaran}</div>`;
      detailHtml += `<div class="event-field"><strong>Petugas:</strong> ${officer}</div>`;
      detailHtml += '</div>';

      events.push({ dateStr, sheetKey: sheet.key, color: sheet.color, sourceLabel: sheet.label, summary, shortLabel, detailHtml });
    });
  });

  return events;
}

// Ibadah Mingguan Karyawan (Chapel):
// Sheets API returns: No.(0), Hari/Tanggal(1), Tema(2), Judul(3), Indikator(4),
//   Lokasi(5), Pemimpin Pujian(6), Pemimpin Firman(7), Sumbangan Pujian(8)
// NOTE: "No." column at index 0 shifts everything by +1 vs the archive Excel
function parseChapelKaryawan(sheet, columns, rows) {
  const events = [];
  if (!rows || rows.length === 0) return events;

  let rowIdx = 0;
  rows.forEach(row => {
    rowIdx++;
    if (!row || row.length === 0) return;
    // Date is at index 1 (index 0 = "No." column)
    const rawDate = row[1] ? String(row[1]).trim() : '';
    if (!rawDate) return;
    // Skip header/subtitle rows
    if (/^(No\.|Hari\/Tanggal|Tema|Judul|Indikator|Lokasi|Pemimpin|Sumbangan)/i.test(rawDate)) return;
    if (/jadwal ibadah|setiap|ruang|character building|minggu ke/i.test(rawDate)) return;

    const parsed = parseDateFlexible(rawDate);
    if (!parsed || parsed.monthOnly) {
      if (rowIdx <= 6) console.log(`[Chapel] row ${rowIdx} date parse failed:`, JSON.stringify(rawDate), 'parsed:', JSON.stringify(parsed));
      return;
    }

    // Avoid subtitle rows with year range
    const fullText = row.slice(1, 5).map(c => String(c || '')).join(' ');
    if (/\d{4}\s*[-–]\s*\d{4}/.test(fullText)) {
      if (rowIdx <= 6) console.log(`[Chapel] row ${rowIdx} year range skip:`, fullText.substring(0, 80));
      return;
    }

    const dateStr = fmtDate(new Date(parsed.year || new Date().getFullYear(), parsed.month - 1, parsed.day));
    if (rowIdx <= 6) console.log(`[Chapel] row ${rowIdx} OK: date=${dateStr} firman=${String(row[7] || '').trim()}`);

    // Column indices shifted by +1 due to "No." at index 0
    const tema = row[2] ? String(row[2]).trim() : '';
    const judul = row[3] ? String(row[3]).trim() : '';
    const pemimpinPujian = row[6] ? String(row[6]).trim() : '';
    const pemimpinFirman = row[7] ? String(row[7]).trim() : '';
    const sumbanganPujian = row[8] ? String(row[8]).trim() : '';

    const shortLabel = pemimpinFirman || pemimpinPujian || (judul ? judul.substring(0, 18) : 'Ibadah');
    const summary = judul ? `🙏 ${judul}` : 'Ibadah Karyawan';

    let detailHtml = '<div class="event-detail">';
    detailHtml += `<div class="event-source" style="color:${sheet.color}">${sheet.label}</div>`;
    if (tema) detailHtml += `<div class="event-field"><strong>Tema:</strong> ${tema}</div>`;
    if (judul) detailHtml += `<div class="event-field"><strong>Judul:</strong> ${judul}</div>`;
    if (pemimpinPujian) detailHtml += `<div class="event-field"><strong>Pemimpin Pujian:</strong> ${pemimpinPujian}</div>`;
    if (pemimpinFirman) detailHtml += `<div class="event-field"><strong>Pemimpin Firman:</strong> ${pemimpinFirman}</div>`;
    if (sumbanganPujian) detailHtml += `<div class="event-field"><strong>Sumbangan Pujian:</strong> ${sumbanganPujian}</div>`;
    detailHtml += '</div>';

    events.push({ dateStr, sheetKey: sheet.key, color: sheet.color, sourceLabel: sheet.label, summary, shortLabel, detailHtml });
  });

  return events;
}

// Komsel Karyawan:
// Sheets API returns: Hari/Tanggal(0), Jenjang(1), Petugas Pujian(2), Petugas Firman(3),
//   Tema Utama(4), Tagline(5), Judul(6), Tujuan(7), Ayat(8), PAMS(9), Link(10)
// NOTE: "Judul" column at index 6 shifts Tujuan→7, Ayat→8 vs the archive Excel
function parseKomselKaryawan(sheet, columns, rows) {
  const events = [];
  if (!rows || rows.length === 0) return events;

  rows.forEach(row => {
    if (!row || row.length === 0 || !row[0]) return;
    const rawDate = String(row[0] || '').trim();
    // Skip header/subtitle rows
    if (!rawDate) return;
    if (/^(Hari\/Tanggal|Jenjang|Petugas|Tema|Tagline|Judul|Tujuan|Ayat|PAMS|Link)/i.test(rawDate)) return;
    if (/jadwal komsel|setiap|character building|minggu ke|bahan pams/i.test(rawDate)) return;

    const parsed = parseDateFlexible(rawDate);
    if (!parsed || parsed.monthOnly) return;

    // Avoid subtitle rows with year range
    const fullText = row.slice(0, 4).map(c => String(c || '')).join(' ');
    if (/\d{4}\s*[-–]\s*\d{4}/.test(fullText)) return;

    const dateStr = fmtDate(new Date(parsed.year || new Date().getFullYear(), parsed.month - 1, parsed.day));

    const jenjang = row[1] ? String(row[1]).trim() : '';
    const petugasPujian = row[2] ? String(row[2]).trim() : '';
    const petugasFirman = row[3] ? String(row[3]).trim() : '';
    const tema = row[4] ? String(row[4]).trim() : '';
    const tagline = row[5] ? String(row[5]).trim() : '';
    const judul = row[6] ? String(row[6]).trim() : '';
    const tujuan = row[7] ? String(row[7]).trim() : '';
    const ayat = row[8] ? String(row[8]).trim() : '';

    const shortLabel = petugasFirman || petugasPujian || jenjang || 'Komsel';
    let summary = 'Komsel Karyawan';
    if (tema) summary = `🤝 ${tema}`;
    if (jenjang) summary += ` | ${jenjang}`;

    let detailHtml = '<div class="event-detail">';
    detailHtml += `<div class="event-source" style="color:${sheet.color}">${sheet.label}</div>`;
    if (jenjang) detailHtml += `<div class="event-field"><strong>Jenjang:</strong> ${jenjang}</div>`;
    if (tema) detailHtml += `<div class="event-field"><strong>Tema:</strong> ${tema}</div>`;
    if (tagline) detailHtml += `<div class="event-field"><strong>Tagline:</strong> ${tagline}</div>`;
    if (judul) detailHtml += `<div class="event-field"><strong>Judul:</strong> ${judul}</div>`;
    if (petugasPujian) detailHtml += `<div class="event-field"><strong>Petugas Pujian:</strong> ${petugasPujian}</div>`;
    if (petugasFirman) detailHtml += `<div class="event-field"><strong>Petugas Firman:</strong> ${petugasFirman}</div>`;
    if (tujuan) detailHtml += `<div class="event-field"><strong>Tujuan:</strong> ${tujuan}</div>`;
    if (ayat) detailHtml += `<div class="event-field"><strong>Ayat:</strong> ${ayat}</div>`;
    detailHtml += '</div>';

    events.push({ dateStr, sheetKey: sheet.key, color: sheet.color, sourceLabel: sheet.label, summary, shortLabel, detailHtml });
  });

  return events;
}

// Default/generic parser for sheets we don't know the exact structure of
function parseDefaultSheet(sheet, columns, rows, fallbackLabel) {
  const events = [];
  if (!rows || rows.length === 0) return events;

  // Try to find date column(s)
  let dateColIdx = -1;
  let bulanColIdx = -1;
  let tanggalColIdx = -1;

  columns.forEach((col, i) => {
    if (!col) return;
    const label = String(col).toLowerCase();
    if (/tanggal|date/.test(label) && dateColIdx < 0) dateColIdx = i;
    if (/bulan|month/.test(label) && bulanColIdx < 0) bulanColIdx = i;
    if (/tanggal/.test(label) && tanggalColIdx < 0) tanggalColIdx = i;
  });

  // Fallback: use first column as date
  if (dateColIdx < 0 && bulanColIdx < 0 && tanggalColIdx < 0) dateColIdx = 0;

  let currentYear = new Date().getFullYear();
  const now = new Date();
  if (now.getMonth() >= 6) currentYear = now.getFullYear();

  rows.forEach(row => {
    if (!row || row.length === 0) return;

    let dateStr = null;

    if (bulanColIdx >= 0 && tanggalColIdx >= 0) {
      const month = parseMonthShort(String(row[bulanColIdx] || '').trim());
      const dateRange = String(row[tanggalColIdx] || '').trim();
      if (month && dateRange) {
        const dates = parseDateRange(dateRange, month, currentYear);
        if (dates.length > 0) dateStr = fmtDate(dates[0]); // Use first date
      }
    } else if (dateColIdx >= 0) {
      const parsed = parseDateFlexible(row[dateColIdx]);
      if (parsed && !parsed.monthOnly) {
        dateStr = fmtDate(new Date(parsed.year || currentYear, parsed.month - 1, parsed.day));
      }
    }

    if (!dateStr) return;

    // Build summary from first text-heavy column
    let summary = fallbackLabel;
    let detailHtml = `<div class="event-detail"><div class="event-source" style="color:${sheet.color}">${sheet.label}</div>`;

    row.forEach((val, i) => {
      if (val && String(val).trim() && i !== dateColIdx && i !== bulanColIdx && i !== tanggalColIdx) {
        const label = columns[i] || `Kolom ${i + 1}`;
        detailHtml += `<div class="event-field"><strong>${label}:</strong> ${String(val).trim()}</div>`;
        if (!summary || summary === fallbackLabel) summary = `${fallbackLabel}: ${String(val).trim()}`;
      }
    });
    detailHtml += '</div>';

    events.push({ dateStr, sheetKey: sheet.key, color: sheet.color, sourceLabel: sheet.label, summary, shortLabel: summary.substring(0, 22), detailHtml });
  });

  return events;
}

/* ===== Date Parsing Utilities ===== */
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseMonthShort(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase().slice(0, 3);
  const idx = MONTH_SHORT.findIndex(m => m.toLowerCase() === s);
  return idx >= 0 ? idx + 1 : null;
}

function parseDateRange(raw, monthNum, year) {
  const dates = [];
  if (!raw) return dates;

  // Handle "20-24" or "27-31"
  const rangeMatch = raw.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    for (let d = start; d <= end; d++) {
      dates.push(new Date(year, monthNum - 1, d));
    }
    return dates;
  }

  // Handle single day "7" or "20"
  const singleMatch = raw.match(/^(\d{1,2})$/);
  if (singleMatch) {
    dates.push(new Date(year, monthNum - 1, parseInt(singleMatch[1], 10)));
    return dates;
  }

  return dates;
}

function parseDateFlexible(val) {
  if (!val) return null;
  let str = String(val).trim();

  // Strip day-name prefix: "Jumat, 17 July 2026" → "17 July 2026"
  // Indonesian & English day names
  str = str.replace(/^(Senin|Selasa|Rabu|Kamis|Jumat|Jum'at|Sabtu|Minggu|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*,\s*/i, '');

  // Try "YYYY-MM-DD" or "MM/DD/YYYY"
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return { year: parseInt(isoMatch[1]), month: parseInt(isoMatch[2]), day: parseInt(isoMatch[3]) };
  }

  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const a = parseInt(slashMatch[1]), b = parseInt(slashMatch[2]), y = parseInt(slashMatch[3]);
    // Indonesian format: DD/MM/YYYY. If first > 12 it's definitely DD/MM.
    if (a > 12) return { year: y, month: b, day: a };
    // If second > 12, it's MM/DD (non-Indonesian, but handle gracefully)
    if (b > 12) return { year: y, month: a, day: b };
    // Both ≤ 12: assume DD/MM/YYYY (Indonesian convention)
    return { year: y, month: b, day: a };
  }

  // Try Google Sheets date serial number (days since 1899-12-30)
  const numVal = Number(val);
  if (!isNaN(numVal) && numVal > 40000 && numVal < 80000) {
    const d = new Date(1899, 11, 30);
    d.setDate(d.getDate() + Math.floor(numVal));
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }

  // Try "Date(YYYY, MM, DD, ...)" — Google's gviz date format
  const gDateMatch = str.match(/Date\s*\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})/);
  if (gDateMatch) {
    return { year: parseInt(gDateMatch[1]), month: parseInt(gDateMatch[2]) + 1, day: parseInt(gDateMatch[3]) };
  }

  const allMonthNames = [
    ...MONTH_NAMES,           // Januari, Februari, ...
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  const allMonthPattern = allMonthNames.join('|');

  // Try "DD Month YYYY" FIRST (before month-only) — like "17 July 2026"
  const ddMonthRegex = new RegExp(`(\\d{1,2})\\s+(${allMonthPattern})\\s+(\\d{4})`, 'i');
  const ddMonthMatch = str.match(ddMonthRegex);
  if (ddMonthMatch) {
    const monthStr = ddMonthMatch[2].toLowerCase().slice(0, 3);
    const mi = MONTH_SHORT.findIndex(m => m.toLowerCase() === monthStr);
    const enMonths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const emi = enMonths.indexOf(monthStr);
    const month = mi >= 0 ? mi + 1 : (emi >= 0 ? emi + 1 : null);
    if (month) {
      return { year: parseInt(ddMonthMatch[3]), month, day: parseInt(ddMonthMatch[1]) };
    }
  }

  // Try month-only patterns like "Juli 2026", "July 2026" (only for title rows)
  for (let i = 0; i < allMonthNames.length; i++) {
    const pattern = new RegExp(`^(${allMonthNames[i]})\\s*(\\d{4})`, 'i');
    const m = str.match(pattern);
    if (m) {
      const monthIdx = i < 12 ? i : (i - 12);
      return { month: monthIdx + 1, day: 1, year: parseInt(m[2]), monthOnly: true };
    }
  }
  return null;
}

/* ===== Event Detail Modal ===== */
function showEventDetail(dateStr, events) {
  const d = new Date(dateStr + 'T00:00:00');
  const dayName = CONFIG.DAY_NAMES[d.getDay()];
  const dateDisplay = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()} — ${dayName}`;

  document.getElementById('cal-event-title').textContent = dateDisplay;

  const body = document.getElementById('cal-event-body');
  body.innerHTML = events.map(evt => evt.detailHtml).join('<hr class="event-separator" />');

  document.getElementById('calendar-event-modal').classList.remove('hidden');
}

function closeEventModal() {
  document.getElementById('calendar-event-modal').classList.add('hidden');
}

/* ===== Navigation ===== */
function navigateMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderCalendar();
}

/* ===== Status Messages ===== */
function showStatus(msg, type) {
  const el = document.getElementById('calendar-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'info-msg';
  if (type === 'error') {
    el.style.background = '#fee2e2';
    el.style.color = '#991b1b';
  } else if (type === 'success') {
    el.style.background = '#dcfce7';
    el.style.color = '#166534';
  } else {
    el.style.background = '#dbeafe';
    el.style.color = '#1e40af';
  }
  el.classList.remove('hidden');
}

function hideStatus() {
  const el = document.getElementById('calendar-status');
  if (el) el.classList.add('hidden');
}

/* ===== Window resize handler ===== */
window.addEventListener('resize', () => {
  // No longer auto-switch to grid on resize — user choice respected
});
