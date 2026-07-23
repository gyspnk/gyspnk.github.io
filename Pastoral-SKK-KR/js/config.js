export const CONFIG = {
  API_BASE_URL: 'https://pas-presensi-api.pas-presensi.workers.dev',
  REPO_OWNER: 'ThenGB',
  REPO_NAME: 'Pastoral-SKK-KR',
  REPO_KARYAWAN_PATH: 'PAS-Presensi/Karyawan',
  KARYAWAN_DIR: './Karyawan',
  APP_NAME: 'Pastoral Hub SKKKR',
  SCHOOL_NAME: 'Sekolah Kristen Kanaan Kubu Raya',
  ACADEMIC_YEAR_CURRENT: '2026-2027',
  ATTENDANCE_STATUSES: [
    { value: 'hadir', label: 'Hadir On Time', color: '#22c55e', short: 'H' },
    { value: 'terlambat', label: 'Hadir Terlambat', color: '#f59e0b', short: 'T' },
    { value: 'izin', label: 'Izin', color: '#3b82f6', short: 'I' },
    { value: 'sakit', label: 'Sakit', color: '#a855f7', short: 'S' },
    { value: 'tidak_hadir_tk', label: 'Tidak Hadir', color: '#ef4444', short: 'TH' }
  ],
  ROLES: {
    pastoral: 'Pastoral',
    guru_agama: 'Guru Agama',
    kepala_sekolah: 'Kepala Sekolah',
    gereja: 'Gereja',
    admin: 'Administrator'
  },
  TOKEN_KEY: 'pas_presensi_token',
  USER_KEY: 'pas_presensi_user',
  DATA_CACHE_KEY: 'pas_presensi_karyawan_cache',
  PRESENSI_TYPES: [
    { value: 'renungan_harian', label: 'Renungan Harian', icon: '📖', group: 'Guru', category: 'guru' },
    { value: 'ibadah_mingguan', label: 'Ibadah Mingguan (Tiap Jumat)', icon: '⛪', group: 'Guru', category: 'guru' },
    { value: 'kanaan_fellowship_guru', label: 'Kanaan Fellowship (Sabat Ceria) - Guru', icon: '🧑‍🏫', group: 'Guru', category: 'guru' },
    { value: 'kanaan_fellowship_siswa', label: 'Kanaan Fellowship (Sabat Ceria) - Siswa', icon: '🎓', group: 'Siswa', category: 'siswa' }
  ],
  PRESENSI_TYPE_LABELS: {
    renungan_harian: 'Renungan Harian',
    ibadah_mingguan: 'Ibadah Mingguan (Tiap Jumat)',
    kanaan_fellowship_guru: 'Kanaan Fellowship (Sabat Ceria) Guru',
    kanaan_fellowship_siswa: 'Kanaan Fellowship (Sabat Ceria) Siswa'
  },
  PRESENSI_ICONS: { guru: '👤', siswa: '🎓' },
  // Dynamic presensi types (loaded from API, falls back to PRESENSI_TYPES)
  _presensiTypes: null,
  // Helper: check if a presensi type is for students
  isSiswaType(typeKey) {
    const t = this.PRESENSI_TYPES.find(p => p.value === typeKey);
    return t ? t.category === 'siswa' : typeKey === 'kanaan_fellowship_siswa';
  },
  IBADAH_MINGGUAN_DAY: 5, // Friday (0=Sun, 1=Mon, ..., 5=Fri, 6=Sat)
  DAY_NAMES: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
  DAY_SHORT: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'],
  PERMISSION_LEVELS: ['none', 'view', 'write'],
  PERMISSION_LABELS: { none: 'Tidak Ada', view: 'Lihat', write: 'Tulis' },
  PERMISSION_DEFAULTS: {
    pastoral: { renungan_harian: 'write', ibadah_mingguan: 'write', kanaan_fellowship_guru: 'write', kanaan_fellowship_siswa: 'write', _kalender_pastoral: true },
    guru_agama: { renungan_harian: 'write', ibadah_mingguan: 'view', kanaan_fellowship_guru: 'view', kanaan_fellowship_siswa: 'view', _kalender_pastoral: false },
    kepala_sekolah: { renungan_harian: 'view', ibadah_mingguan: 'view', kanaan_fellowship_guru: 'view', kanaan_fellowship_siswa: 'view', _kalender_pastoral: false },
    gereja: { renungan_harian: 'view', ibadah_mingguan: 'view', kanaan_fellowship_guru: 'view', kanaan_fellowship_siswa: 'view', _kalender_pastoral: false },
    admin: { renungan_harian: 'write', ibadah_mingguan: 'write', kanaan_fellowship_guru: 'write', kanaan_fellowship_siswa: 'write', _kalender_pastoral: true }
  },

  // Kalender Pastoral — Google Sheets sources
  CALENDAR_SHEETS: [
    {
      key: 'renungan_harian_siswa',
      label: '📖 Renungan Harian Siswa',
      sheetId: '1ojbcrwsnlnrzwp1RyqjUmYMmoo3XKsuKRfffU_vOTl4',
      gid: '0',
      color: '#3b82f6',
      defaultVisible: true
    },
    {
      key: 'ibadah_mingguan_siswa',
      label: '⛪ Ibadah Mingguan Siswa',
      sheetId: '1UBUPnNqvx8nbDzaUZNG0m7WfhQkvx5-Js5gKilhhEvY',
      gid: '0',
      color: '#22c55e',
      defaultVisible: true
    },
    {
      key: 'ibadah_mingguan_karyawan',
      label: '🙏 Ibadah Mingguan Karyawan',
      sheetId: '1Xkhum8q8c8RvJy3Vck4qm54P0ik7d6y6zaxR_XO4gc4',
      gid: '1467382719',
      color: '#a855f7',
      defaultVisible: true
    },
    {
      key: 'komsel_karyawan',
      label: '🤝 Komsel Karyawan',
      sheetId: '1NLyFjTCflD3qZ0e9LqCMLkupMwtjpMCs_1E2yE3P1B0',
      gid: '843795037',
      color: '#f59e0b',
      defaultVisible: true
    }
  ],

  // Calendar cache TTL in milliseconds (5 minutes)
  CALENDAR_CACHE_TTL: 5 * 60 * 1000
};
