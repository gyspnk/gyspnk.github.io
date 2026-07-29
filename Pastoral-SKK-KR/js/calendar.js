import { CONFIG } from './config.js';
import { api, isDemoMode } from './api.js';

/* ===== Utilities ===== */
function safeParseJSON(str) {
  if (!str || typeof str !== 'string') return null;
  try { return JSON.parse(str); } catch (e) { return null; }
}

/** Parse repeat_days from DB — bisa string JSON atau array langsung */
function parseRepeatDays(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { const r = JSON.parse(val); return Array.isArray(r) ? r : []; } catch (e) { return []; }
  }
  return [];
}

/* ===== Calendar State ===== */
let currentMonth, currentYear;
let scheduleData = {};    // { sheetKey: { columns, rows, accessible, error } }
let visibility = {};      // { sheetKey: boolean }
let calendarViewMode = 'grid'; // 'grid' | 'list'
let calendarSheets = [];  // Loaded from API (or fallback to CONFIG)
let currentAcademicYear = CONFIG.ACADEMIC_YEAR_CURRENT || '2026-2027';
let customEvents = [];    // Custom events from API [{ id, title, description, start_date, end_date, color, ... }]

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
      loadCustomEvents();
    };
  }

  // View toggle
  document.getElementById('cal-view-grid').onclick = () => switchViewMode('grid');
  document.getElementById('cal-view-list').onclick = () => switchViewMode('list');

  // Add Event modal (+Event) — form only
  document.getElementById('cal-add-event-btn').onclick = () => openAddEventModal();
  document.getElementById('cal-custom-close').onclick = closeAddEventModal;
  document.getElementById('cev-cancel').onclick = closeAddEventModal;
  document.getElementById('cev-save').onclick = saveCustomEvent;
  document.getElementById('calendar-custom-modal').onclick = (e) => {
    if (e.target === document.getElementById('calendar-custom-modal')) closeAddEventModal();
  };
  // Repeat checkbox toggle
  document.getElementById('cev-repeat').onchange = function() {
    document.getElementById('cev-repeat-config').classList.toggle('hidden', !this.checked);
  };
  // Format toolbar for description editor
  document.querySelectorAll('.cev-fmt-btn').forEach(btn => {
    btn.onmousedown = (e) => {
      e.preventDefault(); // Prevent losing focus from editor
      document.getElementById('cev-desc').focus();
      document.execCommand(btn.dataset.fmt, false, null);
    };
  });

  // Manage Events modal (Kelola Event) — list saved events
  document.getElementById('cal-manage-events-btn').onclick = () => openManageEventsModal();
  document.getElementById('cal-manage-close').onclick = closeManageEventsModal;
  document.getElementById('cal-manage-close-btn').onclick = closeManageEventsModal;
  document.getElementById('calendar-manage-modal').onclick = (e) => {
    if (e.target === document.getElementById('calendar-manage-modal')) closeManageEventsModal();
  };

  // Event modal close
  document.getElementById('cal-event-close').onclick = closeEventModal;
  document.getElementById('calendar-event-modal').onclick = (e) => {
    if (e.target === document.getElementById('calendar-event-modal')) closeEventModal();
  };
  // Sheets list modal
  document.getElementById('cal-sheets-btn').onclick = openSheetsModal;
  document.getElementById('cal-sheets-close').onclick = closeSheetsModal;
  document.getElementById('cal-sheets-close-btn').onclick = closeSheetsModal;
  document.getElementById('calendar-sheets-modal').onclick = (e) => {
    if (e.target === document.getElementById('calendar-sheets-modal')) closeSheetsModal();
  };
  // Search filter
  const searchInput = document.getElementById('cal-search');
  if (searchInput) {
    searchInput.oninput = () => {
      if (calendarViewMode === 'grid') renderCalendarGrid();
      else renderListView();
    };
  }

  // Keyboard handling
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!document.getElementById('calendar-event-modal').classList.contains('hidden')) {
        closeEventModal();
      } else if (!document.getElementById('calendar-manage-modal').classList.contains('hidden')) {
        closeManageEventsModal();
      } else if (!document.getElementById('calendar-custom-modal').classList.contains('hidden')) {
        closeAddEventModal();
      } else if (!document.getElementById('calendar-sheets-modal').classList.contains('hidden')) {
        closeSheetsModal();
      } else if (searchInput && searchInput.value) {
        searchInput.value = '';
        searchInput.oninput();
      }
    }
  });

  renderCalendar();
  fetchAllSchedules();
  loadCustomEvents();
}

/** Re-fetch calendar config from API and re-render — called after column editor saves config/notes */
export async function reloadCalendarConfig() {
  await loadCalendarConfig();
  // Reset visibility for any new sheets
  calendarSheets.forEach(sheet => {
    if (!(sheet.key in visibility)) visibility[sheet.key] = true;
  });
  renderFilters();
  renderCalendar();
  fetchAllSchedules();
  loadCustomEvents();
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
        columnConfig: safeParseJSON(c.column_config),
        notes: c.notes || '',
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
  const gridWrapper = document.querySelector('.calendar-wrapper');
  const listEl = document.getElementById('calendar-list-view');

  if (mode === 'grid') {
    gridBtn.classList.add('btn-primary'); gridBtn.classList.remove('btn-secondary');
    listBtn.classList.add('btn-secondary'); listBtn.classList.remove('btn-primary');
    if (gridWrapper) gridWrapper.style.display = '';
    if (listEl) listEl.classList.add('hidden');
  } else {
    listBtn.classList.add('btn-primary'); listBtn.classList.remove('btn-secondary');
    gridBtn.classList.add('btn-secondary'); gridBtn.classList.remove('btn-primary');
    if (gridWrapper) gridWrapper.style.display = 'none';
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
    let legendHtml = calendarSheets.map(s => {
      const data = scheduleData[s.key];
      const warnIcon = (data && data.accessible === false) ? ' ⚠️' : '';
      return `<span class="legend-item">
        <span class="legend-dot" style="background:${s.color}"></span> ${s.label}${warnIcon}
      </span>`;
    }).join('');
    if (customEvents.length > 0) {
      legendHtml += `<span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span> ⭐ Event Khusus</span>`;
    }
    legend.innerHTML = legendHtml;
  }
}

/* ===== Calendar Grid Rendering ===== */
function renderCalendar() {
  document.getElementById('cal-month-year').textContent =
    `${MONTH_NAMES[currentMonth]} ${currentYear}`;

  if (calendarViewMode === 'grid') {
    renderCalendarGrid();
  } else {
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

  // Group events by date, sorted
  const dateGroups = [];
  Object.entries(eventMap).forEach(([dateStr, events]) => {
    if (events.length > 0) dateGroups.push({ dateStr, events });
  });
  dateGroups.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

  if (dateGroups.length === 0) {
    container.innerHTML = '<div class="list-empty">Tidak ada jadwal yang sesuai filter</div>';
    return;
  }

  let html = '';
  dateGroups.forEach(group => {
    const d = new Date(group.dateStr + 'T00:00:00');
    const dayName = CONFIG.DAY_NAMES[d.getDay()];
    const dateLabel = `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
    const isToday = group.dateStr === todayStr;
    const isPast = group.dateStr < todayStr;

    // Past dates: collapsed by default, with toggle
    const sectionId = `list-section-${group.dateStr}`;
    const collapsedClass = (isPast && !isToday) ? ' list-collapsed' : '';

    html += `<div class="list-day${isToday ? ' list-today' : ''}${collapsedClass}" data-date="${group.dateStr}">
      <div class="list-day-header" data-toggle="${sectionId}">
        <span class="list-expand-icon">${(isPast && !isToday) ? '▶' : '▼'}</span>
        <span class="list-date">${dateLabel}</span>
        <span class="list-dayname">${dayName}</span>
        ${isToday ? '<span class="list-today-badge">Hari Ini</span>' : ''}
        ${isPast && !isToday ? '<span class="list-past-badge">Lewat</span>' : ''}
      </div>
      <div class="list-events" id="${sectionId}">`;

    group.events.forEach(evt => {
      html += `<div class="list-event" style="border-left:3px solid ${evt.color};cursor:pointer" data-date="${evt.dateStr}">
        <span class="list-event-source" style="color:${evt.color}">${evt.shortLabel || evt.summary.split(' | ')[0]}</span>
        <span class="list-event-desc">${evt.summary.split(' | ').slice(1).join(' | ').substring(0, 60)}</span>
      </div>`;
    });

    html += '</div></div>';
  });

  container.innerHTML = html;

  // Wire up collapse toggle
  container.querySelectorAll('.list-day-header').forEach(header => {
    header.onclick = () => {
      const dayDiv = header.parentElement;
      dayDiv.classList.toggle('list-collapsed');
      const icon = header.querySelector('.list-expand-icon');
      if (icon) icon.textContent = dayDiv.classList.contains('list-collapsed') ? '▶' : '▼';
    };
  });

  // Wire up event click
  container.querySelectorAll('.list-event').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
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
    // Inject sheet notes into each event detail (append before closing event-detail)
    if (sheet.notes) {
      events.forEach(evt => {
        evt.detailHtml = evt.detailHtml.replace(/<\/div>\s*$/, `<hr class="event-separator" /><div class="event-notes">${sheet.notes}</div></div>`);
      });
    }
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

  // Add custom events
  customEvents.forEach(cev => {
    const start = new Date(cev.start_date + 'T00:00:00');
    const end = new Date(cev.end_date + 'T00:00:00');
    const isRepeating = cev.is_repeating == true;
    const repeatDays = parseRepeatDays(cev.repeat_days);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      // Skip if repeating and this day-of-week is not selected
      if (isRepeating && repeatDays.length > 0 && !repeatDays.includes(d.getDay())) continue;

      const ds = fmtDate(d);
      if (!eventMap[ds]) eventMap[ds] = [];
      eventMap[ds].push({
        dateStr: ds,
        sheetKey: '_custom',
        color: cev.color || '#ef4444',
        sourceLabel: 'Event Khusus',
        summary: cev.title,
        shortLabel: '⭐ ' + cev.title.substring(0, 16),
        detailHtml: `<div class="event-detail"><div class="event-source" style="color:${cev.color || '#ef4444'}">⭐ Event Khusus</div><div class="event-field"><strong>${cev.title}</strong></div>${cev.description ? `<div class="event-field">${cev.description}</div>` : ''}<div class="event-field"><strong>Tanggal:</strong> ${cev.start_date} – ${cev.end_date}</div></div>`
      });
    }
  });

  return eventMap;
}

/* ===== Generic Parser (uses configurable column config from DB) ===== */
function parseWithColumnConfig(sheet, columns, rows) {
  const events = [];
  const colConfig = sheet.columnConfig || [];
  if (!rows || rows.length === 0) return events;

  // Check for group-based multi-date columns (e.g., ibadah_mingguan_siswa)
  const groups = new Set();
  colConfig.forEach(c => { if (c.group && c.group > 0) groups.add(c.group); });

  if (groups.size > 0) {
    // Multi-group: iterate each group as a sub-event
    rows.forEach(row => {
      if (!row || row.length === 0) return;
      groups.forEach(g => {
        const gCols = colConfig.filter(c => c.group === g);
        const gDate = gCols.find(c => c.type === 'date');
        const gTexts = gCols.filter(c => (c.type === 'text' || c.type === 'link') && c.show_calendar !== false);
        if (!gDate) return;
        const rawDate = row[gDate.idx] !== undefined ? String(row[gDate.idx]).trim() : '';
        if (!rawDate) return;
        if (/^(No\.|Hari\/Tanggal|Tema|Lokasi|Pemimpin|Sumbangan|Jenjang|Petugas|Tagline|PAMS|Link|Tanggal|Jadwal|Keterangan)/i.test(rawDate)) return;
        if (/jadwal (ibadah|komsel)|setiap|ruang|character building|minggu ke|bahan pams/i.test(rawDate)) return;
        const parsed = parseDateFlexible(rawDate);
        if (!parsed || parsed.monthOnly) return;
        const dateStr = fmtDate(new Date(parsed.year || new Date().getFullYear(), parsed.month - 1, parsed.day));
        let shortLabel = gTexts.length > 0 ? String(row[gTexts[0].idx] || '').trim().substring(0, 22) : gDate.label;
        let summary = sheet.label;
        let detailHtml = '<div class="event-detail">';
        detailHtml += '<div class="event-source" style="color:' + sheet.color + '">' + sheet.label + '</div>';
        detailHtml += '<div class="event-field"><strong>' + (gDate.label || 'Kelas') + '</strong></div>';
        if (gDate.notes) detailHtml += '<div class="event-field event-notes-text">' + gDate.notes + '</div>';
        gTexts.forEach(tc => {
          const raw = row[tc.idx];
          const val = (raw !== null && raw !== undefined) ? String(raw).trim() : '';
          if (val) {
            detailHtml += '<div class="event-field"><strong>' + tc.label + ':</strong> ' + val + '</div>';
          }
          if (tc.notes) detailHtml += '<div class="event-field event-notes-text">' + tc.notes + '</div>';
        });
        detailHtml += '</div>';
        events.push({ dateStr, sheetKey: sheet.key, color: sheet.color, sourceLabel: sheet.label, summary, shortLabel, detailHtml });
      });
    });
    return events;
  }

  // Single-date mode
  const dateCol = colConfig.find(c => c.type === 'date');
  const shortCol = colConfig.find(c => c.short === true);
  const textCols = colConfig.filter(c => (c.type === 'text' || c.type === 'link') && c.show_calendar !== false);

  if (!dateCol) return events;

  const dateIdx = dateCol.idx;
  const shortIdx = shortCol ? shortCol.idx : null;

  rows.forEach(row => {
    if (!row || row.length === 0) return;
    const rawDate = row[dateIdx] !== undefined ? String(row[dateIdx]).trim() : '';
    if (!rawDate) return;
    if (/^(No\.|Hari\/Tanggal|Tema|Lokasi|Pemimpin|Sumbangan|Jenjang|Petugas|Tagline|PAMS|Link|Tanggal|Jadwal|Keterangan)/i.test(rawDate)) return;
    if (/jadwal (ibadah|komsel)|setiap|ruang|character building|minggu ke|bahan pams/i.test(rawDate)) return;
    const checkRange = colConfig.filter(c => c.type !== 'ignore').map(c => String(row[c.idx] || '')).join(' ');
    if (/\d{4}\s*[-–]\s*\d{4}/.test(checkRange)) return;
    const parsed = parseDateFlexible(rawDate);
    if (!parsed || parsed.monthOnly) return;
    const dateStr = fmtDate(new Date(parsed.year || new Date().getFullYear(), parsed.month - 1, parsed.day));
    let shortLabel = '';
    if (shortIdx !== null && row[shortIdx] != null && String(row[shortIdx]).trim()) {
      shortLabel = String(row[shortIdx]).trim().substring(0, 22);
    } else {
      for (const tc of textCols) {
        if (tc.type === 'ignore') continue;
        const raw = row[tc.idx];
        const val = (raw !== null && raw !== undefined) ? String(raw).trim() : '';
        if (val) { shortLabel = val.substring(0, 22); break; }
      }
    }
    if (!shortLabel) shortLabel = sheet.label.replace(/^[^\s]+\s/, '').substring(0, 18) || 'Ibadah';
    let summary = sheet.label;
    let detailHtml = '<div class="event-detail">';
    detailHtml += '<div class="event-source" style="color:' + sheet.color + '">' + sheet.label + '</div>';
    // Tampilkan notes dari kolom date (per-column notes di pengaturan kolom)
    if (dateCol.notes) detailHtml += '<div class="event-field event-notes-text">' + dateCol.notes + '</div>';
    textCols.forEach(tc => {
      const raw = row[tc.idx];
      const val = (raw !== null && raw !== undefined) ? String(raw).trim() : '';
      if (val) {
        if (tc.type === 'link') {
          const isUrl = /^https?:\/\//i.test(val);
          if (isUrl) {
            detailHtml += '<div class="event-field"><strong>' + tc.label + ':</strong> <a href="' + val + '" target="_blank" rel="noopener" style="color:var(--primary)">' + val + '</a></div>';
          } else {
            detailHtml += '<div class="event-field"><strong>' + tc.label + ':</strong> ' + val + '</div>';
          }
        } else {
          detailHtml += '<div class="event-field"><strong>' + tc.label + ':</strong> ' + val + '</div>';
        }
        if (summary === sheet.label && tc.type === 'text' && !shortCol) {
          summary = sheet.label + ': ' + val;
        }
      }
      if (tc.notes) detailHtml += '<div class="event-field event-notes-text">' + tc.notes + '</div>';
    });
    detailHtml += '</div>';
    events.push({ dateStr, sheetKey: sheet.key, color: sheet.color, sourceLabel: sheet.label, summary, shortLabel, detailHtml });
  });
  return events;
}

/* ===== Sheet-Specific Parsers ===== */
function parseSheetEvents(sheet, columns, rows) {
  // Generic parser when columnConfig is available
  if (sheet.columnConfig && sheet.columnConfig.length > 0) {
    return parseWithColumnConfig(sheet, columns, rows);
  }
  // Fallback to hardcoded parsers for backward compatibility
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
// Sheets API returns: No.(0), Hari/Tanggal(1), Tema(2),
//   Lokasi(3), Pemimpin Pujian(4), Pemimpin Firman(5), Sumbangan Pujian(6)
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
    if (/^(No\.|Hari\/Tanggal|Tema|Lokasi|Pemimpin|Sumbangan)/i.test(rawDate)) return;
    if (/jadwal ibadah|setiap|ruang|character building|minggu ke/i.test(rawDate)) return;

    const parsed = parseDateFlexible(rawDate);
    if (!parsed || parsed.monthOnly) {
      if (rowIdx <= 6) console.log(`[Chapel] row ${rowIdx} date parse failed:`, JSON.stringify(rawDate), 'parsed:', JSON.stringify(parsed));
      return;
    }

    // Avoid subtitle rows with year range
    const fullText = row.slice(1, 4).map(c => String(c || '')).join(' ');
    if (/\d{4}\s*[-–]\s*\d{4}/.test(fullText)) {
      if (rowIdx <= 6) console.log(`[Chapel] row ${rowIdx} year range skip:`, fullText.substring(0, 80));
      return;
    }

    const dateStr = fmtDate(new Date(parsed.year || new Date().getFullYear(), parsed.month - 1, parsed.day));
    if (rowIdx <= 6) console.log(`[Chapel] row ${rowIdx} OK: date=${dateStr} firman=${String(row[5] || '').trim()}`);

    // Column indices shifted by +1 due to "No." at index 0 (minus 2 removed columns: Judul, Indikator)
    const tema = row[2] ? String(row[2]).trim() : '';
    const pemimpinPujian = row[4] ? String(row[4]).trim() : '';
    const pemimpinFirman = row[5] ? String(row[5]).trim() : '';
    const sumbanganPujian = row[6] ? String(row[6]).trim() : '';

    const shortLabel = pemimpinFirman || pemimpinPujian || 'Ibadah';
    const summary = tema ? `🙏 ${tema}` : 'Ibadah Karyawan';

    let detailHtml = '<div class="event-detail">';
    detailHtml += `<div class="event-source" style="color:${sheet.color}">${sheet.label}</div>`;
    if (tema) detailHtml += `<div class="event-field"><strong>Tema:</strong> ${tema}</div>`;
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
//   Tema Utama(4), Tagline(5), PAMS(6), Link(7)
// NOTE: PAMS column contains reference to PAMS document / bahan
// NOTE: Link column contains URL to the PAMS document
function parseKomselKaryawan(sheet, columns, rows) {
  const events = [];
  if (!rows || rows.length === 0) return events;

  // Auto-detect column indices from header labels
  const colMap = { date: 0, jenjang: 1, petugasPujian: 2, petugasFirman: 3,
    tema: 4, tagline: 5, pams: 6, link: 7 };
  if (columns && columns.length > 0) {
    columns.forEach((col, idx) => {
      const label = (col || '').toLowerCase().trim();
      if (/hari|tanggal|date/i.test(label)) colMap.date = idx;
      else if (/jenjang/i.test(label)) colMap.jenjang = idx;
      else if (/pujian/i.test(label)) colMap.petugasPujian = idx;
      else if (/firman/i.test(label)) colMap.petugasFirman = idx;
      else if (/tema\s|^tema$/i.test(label) && !/tagline|sub/i.test(label)) colMap.tema = idx;
      else if (/tagline/i.test(label)) colMap.tagline = idx;
      else if (/pams/i.test(label)) colMap.pams = idx;
      else if (/link|url|http/i.test(label)) colMap.link = idx;
    });
  }

  const getCol = (row, key) => {
    const idx = colMap[key];
    return (idx !== undefined && row[idx] !== undefined && row[idx] !== null) ? String(row[idx]).trim() : '';
  };

  rows.forEach(row => {
    if (!row || row.length === 0 || !row[0]) return;
    const rawDate = String(row[colMap.date] || '').trim();
    // Skip header/subtitle rows
    if (!rawDate) return;
    if (/^(Hari\/Tanggal|Jenjang|Petugas|Tema|Tagline|PAMS|Link)/i.test(rawDate)) return;
    if (/jadwal komsel|setiap|character building|minggu ke|bahan pams/i.test(rawDate)) return;

    const parsed = parseDateFlexible(rawDate);
    if (!parsed || parsed.monthOnly) return;

    // Avoid subtitle rows with year range
    const fullText = row.slice(0, 4).map(c => String(c || '')).join(' ');
    if (/\d{4}\s*[-–]\s*\d{4}/.test(fullText)) return;

    const dateStr = fmtDate(new Date(parsed.year || new Date().getFullYear(), parsed.month - 1, parsed.day));

    const jenjang = getCol(row, 'jenjang');
    const petugasPujian = getCol(row, 'petugasPujian');
    const petugasFirman = getCol(row, 'petugasFirman');
    const tema = getCol(row, 'tema');
    const tagline = getCol(row, 'tagline');
    const pams = getCol(row, 'pams');
    const link = getCol(row, 'link');

    const shortLabel = petugasFirman || petugasPujian || jenjang || 'Komsel';
    let summary = 'Komsel Karyawan';
    if (tema) summary = `🤝 ${tema}`;
    if (jenjang) summary += ` | ${jenjang}`;

    let detailHtml = '<div class="event-detail">';
    detailHtml += `<div class="event-source" style="color:${sheet.color}">${sheet.label}</div>`;
    if (jenjang) detailHtml += `<div class="event-field"><strong>Jenjang:</strong> ${jenjang}</div>`;
    if (tema) detailHtml += `<div class="event-field"><strong>Tema:</strong> ${tema}</div>`;
    if (tagline) detailHtml += `<div class="event-field"><strong>Tagline:</strong> ${tagline}</div>`;
    if (petugasPujian) detailHtml += `<div class="event-field"><strong>Petugas Pujian:</strong> ${petugasPujian}</div>`;
    if (petugasFirman) detailHtml += `<div class="event-field"><strong>Petugas Firman:</strong> ${petugasFirman}</div>`;
    if (pams) {
      // If pams contains a URL, make it clickable; otherwise show as text
      const isUrl = /^https?:\/\//i.test(pams);
      detailHtml += isUrl
        ? `<div class="event-field"><strong>📄 Bahan PAMS:</strong> <a href="${pams}" target="_blank" rel="noopener" style="color:var(--primary)">${pams}</a></div>`
        : `<div class="event-field"><strong>📄 Bahan PAMS:</strong> ${pams}</div>`;
    }
    if (link) {
      detailHtml += `<div class="event-field"><strong>🔗 Link Dokumen:</strong> <a href="${link}" target="_blank" rel="noopener" style="color:var(--primary)">${link}</a></div>`;
    }
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

/* ===== Sheets List Modal ===== */
function openSheetsModal() {
  const list = document.getElementById('cal-sheets-list');
  if (!list) return;

  const activeSheets = calendarSheets.filter(s => {
    const data = scheduleData[s.key];
    return data && data.accessible !== false;
  });

  if (activeSheets.length === 0) {
    list.innerHTML = '<p class="muted" style="padding:20px;text-align:center">Belum ada data sheet aktif. Muat ulang halaman atau periksa konfigurasi kalender.</p>';
  } else {
    list.innerHTML = activeSheets.map(s => {
      const data = scheduleData[s.key];
      const url = `https://docs.google.com/spreadsheets/d/${s.sheetId}/edit#gid=${s.gid}`;
      const rowCount = data && data.rows ? data.rows.length : 0;
      return `<a href="${url}" target="_blank" rel="noopener" class="sheets-list-item" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;text-decoration:none;color:var(--text);transition:background 0.15s" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
        <span style="width:12px;height:12px;border-radius:3px;background:${s.color};flex-shrink:0"></span>
        <span style="flex:1;font-weight:500">${s.label}</span>
        <span style="font-size:11px;color:var(--text-muted)">${rowCount} baris</span>
        <span style="font-size:16px">↗</span>
      </a>`;
    }).join('');
  }

  document.getElementById('calendar-sheets-modal').classList.remove('hidden');
}

function closeSheetsModal() {
  document.getElementById('calendar-sheets-modal').classList.add('hidden');
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

/* ===== Custom Events ===== */
let editingEventId = null;   // null = add mode, number = edit mode

/** Open the +Event modal — add mode (default) or edit mode if event provided */
function openAddEventModal(event) {
  const isEdit = event && event.id;
  editingEventId = isEdit ? event.id : null;
  const titleEl = document.querySelector('#calendar-custom-modal .modal-header h3');
  if (titleEl) titleEl.textContent = isEdit ? '✏️ Edit Event Khusus' : 'Tambah Event Khusus';
  const saveBtn = document.getElementById('cev-save');
  if (saveBtn) saveBtn.textContent = isEdit ? 'Simpan Perubahan' : 'Simpan';

  // Parse repeat days
  const repeatDays = parseRepeatDays(isEdit ? event.repeat_days : null);
  const isRepeating = isEdit && event.is_repeating == true;

  if (isEdit) {
    document.getElementById('cev-title').value = event.title || '';
    document.getElementById('cev-desc').innerHTML = event.description || '';
    document.getElementById('cev-start').value = event.start_date || '';
    document.getElementById('cev-end').value = event.end_date || '';
    document.getElementById('cev-color').value = event.color || '#ef4444';
  } else {
    document.getElementById('cev-title').value = '';
    document.getElementById('cev-desc').innerHTML = '';
    document.getElementById('cev-color').value = '#ef4444';
    // Default date range: 1 Juli AY awal – 30 Juni AY akhir
    const ayMatch = currentAcademicYear.match(/^(\d{4})/);
    if (ayMatch) {
      const startYear = parseInt(ayMatch[1], 10);
      document.getElementById('cev-start').value = `${startYear}-07-01`;
      document.getElementById('cev-end').value = `${startYear + 1}-06-30`;
    } else {
      document.getElementById('cev-start').value = '';
      document.getElementById('cev-end').value = '';
    }
  }

  // Populate repeat state
  const repeatCb = document.getElementById('cev-repeat');
  repeatCb.checked = isRepeating;
  document.querySelectorAll('.cev-day-cb').forEach(cb => {
    cb.checked = repeatDays.includes(parseInt(cb.value, 10));
  });
  document.getElementById('cev-repeat-config').classList.toggle('hidden', !isRepeating);

  document.getElementById('cev-msg').classList.add('hidden');
  document.getElementById('calendar-custom-modal').classList.remove('hidden');
  // Focus the title field
  setTimeout(() => document.getElementById('cev-title')?.focus(), 100);
}

function closeAddEventModal() {
  editingEventId = null;
  document.getElementById('calendar-custom-modal').classList.add('hidden');
  // Reset title/button back to add mode for next open
  const titleEl = document.querySelector('#calendar-custom-modal .modal-header h3');
  if (titleEl) titleEl.textContent = 'Tambah Event Khusus';
  const saveBtn = document.getElementById('cev-save');
  if (saveBtn) saveBtn.textContent = 'Simpan';
  // Reset repeat state
  document.getElementById('cev-repeat').checked = false;
  document.getElementById('cev-repeat-config').classList.add('hidden');
  // Clear description editor
  document.getElementById('cev-desc').innerHTML = '';
}

/** Open the Kelola Event modal (list saved events) */
async function openManageEventsModal() {
  await loadCustomEvents();
  renderCustomEventList();
  document.getElementById('cal-manage-msg')?.classList.add('hidden');
  document.getElementById('calendar-manage-modal').classList.remove('hidden');
}

function closeManageEventsModal() {
  document.getElementById('calendar-manage-modal').classList.add('hidden');
  // Refresh calendar view in case events were changed
  if (calendarViewMode === 'grid') renderCalendarGrid(); else renderListView();
}

async function saveCustomEvent() {
  const title = document.getElementById('cev-title').value.trim();
  const descEl = document.getElementById('cev-desc');
  const description = (descEl.innerHTML === '<br>' || !descEl.innerHTML.trim()) ? '' : descEl.innerHTML;
  const startDate = document.getElementById('cev-start').value;
  const endDate = document.getElementById('cev-end').value;
  const color = document.getElementById('cev-color').value;
  const isRepeating = document.getElementById('cev-repeat').checked;
  const repeatDays = [];
  if (isRepeating) {
    document.querySelectorAll('.cev-day-cb:checked').forEach(cb => {
      repeatDays.push(parseInt(cb.value, 10));
    });
  }
  const msgEl = document.getElementById('cev-msg');
  const isEdit = editingEventId !== null;

  if (!title || !startDate || !endDate) {
    msgEl.textContent = 'Judul, Dari, dan Sampai wajib diisi.';
    msgEl.className = 'info-msg'; msgEl.style.background = '#fee2e2'; msgEl.style.color = '#991b1b';
    msgEl.classList.remove('hidden'); return;
  }
  if (endDate < startDate) {
    msgEl.textContent = 'Tanggal Sampai tidak boleh sebelum Dari.';
    msgEl.className = 'info-msg'; msgEl.style.background = '#fee2e2'; msgEl.style.color = '#991b1b';
    msgEl.classList.remove('hidden'); return;
  }
  if (isRepeating && repeatDays.length === 0) {
    msgEl.textContent = 'Pilih minimal satu hari untuk event berulang.';
    msgEl.className = 'info-msg'; msgEl.style.background = '#fee2e2'; msgEl.style.color = '#991b1b';
    msgEl.classList.remove('hidden'); return;
  }

  try {
    if (isEdit) {
      await api.updateCalendarEvent(editingEventId, { title, description, startDate, endDate, color, isRepeating, repeatDays });
      msgEl.textContent = '✅ Event berhasil diperbarui.';
    } else {
      await api.addCalendarEvent({ academicYear: currentAcademicYear, title, description, startDate, endDate, color, isRepeating, repeatDays });
      msgEl.textContent = '✅ Event berhasil ditambahkan.';
    }
    msgEl.className = 'info-msg'; msgEl.style.background = '#dcfce7'; msgEl.style.color = '#166534';
    msgEl.classList.remove('hidden');
    document.getElementById('cev-title').value = '';
    document.getElementById('cev-desc').innerHTML = '';
    document.getElementById('cev-start').value = '';
    document.getElementById('cev-end').value = '';
    await loadCustomEvents();
    // Refresh calendar display
    if (calendarViewMode === 'grid') renderCalendarGrid(); else renderListView();
    // Close modal after brief success message
    setTimeout(() => {
      closeAddEventModal();
    }, 1200);
  } catch (e) {
    msgEl.textContent = 'Gagal: ' + (e.message || 'Coba lagi');
    msgEl.className = 'info-msg'; msgEl.style.background = '#fee2e2'; msgEl.style.color = '#991b1b';
    msgEl.classList.remove('hidden');
  }
}

async function loadCustomEvents() {
  try {
    customEvents = await api.getCalendarEvents(currentAcademicYear) || [];
  } catch (e) {
    // Fallback silently — if API unavailable, no custom events
    customEvents = [];
  }
}

function renderCustomEventList() {
  const tbody = document.getElementById('cev-tbody');
  if (!tbody) return;
  const DAY_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  tbody.innerHTML = '';
  customEvents.forEach(evt => {
    const isRepeating = evt.is_repeating == true;
    let repeatLabel = '';
    const repeatDays = parseRepeatDays(evt.repeat_days);
    if (repeatDays.length > 0) {
      repeatLabel = ' 🔁 ' + repeatDays.map(d => DAY_LABELS[d]).join(', ');
    }
    const titleHtml = `<strong>${evt.title}</strong>${repeatLabel ? `<br><small style="color:var(--text-muted)">${repeatLabel}</small>` : ''}${evt.description ? `<br><small style="color:var(--text-muted)">${evt.description}</small>` : ''}`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${titleHtml}</td>
      <td>${evt.start_date}</td>
      <td>${evt.end_date}</td>
      <td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${evt.color};vertical-align:middle"></span></td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-secondary" data-edit-cev="${evt.id}" title="Edit event">✏️</button>
        <button class="btn btn-danger btn-sm" data-del-cev="${evt.id}" title="Hapus event">🗑</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  // Edit handlers
  tbody.querySelectorAll('[data-edit-cev]').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.editCev, 10);
      const evt = customEvents.find(e => e.id === id);
      if (!evt) return;
      closeManageEventsModal();
      // Small delay so manage modal closes before edit modal opens
      setTimeout(() => openAddEventModal(evt), 200);
    };
  });
  // Delete handlers
  tbody.querySelectorAll('[data-del-cev]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Hapus event ini?')) return;
      try {
        await api.deleteCalendarEvent(parseInt(btn.dataset.delCev, 10));
        await loadCustomEvents();
        renderCustomEventList();
        // Show success message inside manage modal
        const msgEl = document.getElementById('cev-manage-msg');
        if (msgEl) {
          msgEl.textContent = '✅ Event berhasil dihapus.';
          msgEl.className = 'info-msg';
          msgEl.style.background = '#dcfce7';
          msgEl.style.color = '#166534';
          msgEl.classList.remove('hidden');
          setTimeout(() => msgEl.classList.add('hidden'), 2000);
        }
        if (calendarViewMode === 'grid') renderCalendarGrid(); else renderListView();
      } catch (e) { alert('Gagal: ' + e.message); }
    };
  });
  if (tbody.children.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:12px">Belum ada event khusus</td></tr>';
  }
}

/* ===== Window resize handler ===== */
window.addEventListener('resize', () => {
  // No longer auto-switch to grid on resize — user choice respected
});
