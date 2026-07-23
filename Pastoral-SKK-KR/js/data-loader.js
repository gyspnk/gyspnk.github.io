import { CONFIG } from './config.js';
import { api, isDemoMode } from './api.js';
import { getPermissionFilter } from './auth.js';

function parseAcademicYearLabel(label) {
  const parts = label.split('-');
  if (parts.length !== 2) return null;
  const startYear = parseInt(parts[0], 10);
  const endYear = parseInt(parts[1], 10);
  if (isNaN(startYear) || isNaN(endYear)) return null;
  return {
    code: `AY${String(startYear).slice(-2)}${String(endYear).slice(-2)}`,
    label,
    startYear,
    endYear
  };
}

export async function getAvailableYears() {
  if (!isDemoMode()) {
    try {
      const years = await api.getAcademicYears();
      return years.map(y => ({
        id: y.id,
        code: y.year_code,
        label: y.year_label,
        isActive: y.is_active,
        sortOrder: y.sort_order
      })).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    } catch (e) {
      console.error('Failed to load academic years from API:', e);
      return [];
    }
  }

  const cached = localStorage.getItem(CONFIG.DATA_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed.timestamp && Date.now() - parsed.timestamp < 3600000) {
        return parsed.years;
      }
    } catch {}
  }

  let filenames = [];
  try {
    const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${CONFIG.REPO_KARYAWAN_PATH}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github.v3+json' } });
    if (res.ok) {
      const items = await res.json();
      filenames = items.filter(i => i.type === 'file' && /\.xlsx$/i.test(i.name) && /AY\d{4}/i.test(i.name)).map(i => i.name);
    }
  } catch {}

  const years = filenames.map(f => {
    const match = f.match(/AY(\d{2})(\d{2})/i);
    if (!match) return null;
    const startYear = 2000 + parseInt(match[1], 10);
    const endYear = 2000 + parseInt(match[2], 10);
    return { code: `AY${match[1]}${match[2]}`, label: `${startYear}-${endYear}`, startYear, endYear, filename: f };
  }).filter(Boolean).sort((a, b) => a.startYear - b.startYear);

  localStorage.setItem(CONFIG.DATA_CACHE_KEY, JSON.stringify({ years, timestamp: Date.now() }));
  return years;
}

export async function loadKaryawanData(year, presensiType) {
  if (typeof year === 'string') {
    const years = await getAvailableYears();
    const yr = years.find(y => y.label === year || y.code === year);
    if (yr) return loadKaryawanData(yr, presensiType);
    return [];
  }

  if (!isDemoMode() && year.id) {
    try {
      // Kanaan Fellowship — load students, not employees
      if (CONFIG.isSiswaType(presensiType)) {
        const students = await api.getKFStudents({ academicYear: year.label, active: 'true' });
        let result = students.map(s => ({
          id: s.id,
          name: s.name,
          position: s.class || '',
          division: s.class || '',
          status: s.nis || '',
          isActive: s.is_active != false,
          gender: s.gender || '',
          religion: s.religion || ''
        }));

        // Apply class filter from user permissions
        const filter = getPermissionFilter(presensiType);
        if (filter && filter.classes.length > 0) {
          result = result.filter(s => filter.classes.includes(s.division));
        }

        return result;
      }

      const params = { academicYear: year.label, active: 'true' };
      if (presensiType === 'ibadah_mingguan') {
        params.activeIM = 'true';
      } else if (presensiType === 'kanaan_fellowship_guru') {
        params.activeKF = 'true';
      } else {
        params.activeRH = 'true';
      }
      const employees = await api.getEmployees(params);
      let result = employees.map(e => ({
        id: e.id,
        name: e.name,
        position: e.position || '',
        division: e.division || '',
        status: e.employment_status || '',
        isActiveRH: e.is_active_rh != false,
        isActiveIM: e.is_active_im != false,
        isActiveKF: e.is_active_kf != false
      }));

      // Apply division filter from user permissions (for non-student presensi types)
      if (presensiType && presensiType !== 'kanaan_fellowship_siswa') {
        const filter = getPermissionFilter(presensiType);
        if (filter && filter.divisions.length > 0) {
          result = result.filter(e => filter.divisions.includes(e.division));
        }
      }

      return result;
    } catch (e) {
      console.error('Failed to load employees from API:', e);
      return [];
    }
  }

  if (year.filename) {
    const url = `${CONFIG.KARYAWAN_DIR}/${encodeURIComponent(year.filename)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gagal memuat ${year.filename}: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    return rows.filter(r => r[0] && String(r[0]).trim()).map((r, i) => ({
      idx: i,
      name: String(r[0]).trim(),
      position: String(r[1] || '').trim(),
      division: String(r[2] || '').trim(),
      status: String(r[3] || '').trim()
    }));
  }

  return [];
}

export function getCurrentAcademicYear(years) {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const adjStart = month >= 6 ? year : year - 1;
  const yy1 = String(adjStart).slice(-2);
  const yy2 = String(adjStart + 1).slice(-2);
  const code = `AY${yy1}${yy2}`;
  const label = `${adjStart}-${adjStart + 1}`;
  const found = years.find(y => y.code === code);
  if (found) return found;
  if (years.length) return years[years.length - 1];
  return { code, label, startYear: adjStart, endYear: adjStart + 1, filename: `Data Karyawan AY${yy1}${yy2}.xlsx` };
}
