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
    { value: 'hadir', label: 'Hadir', color: '#22c55e', short: 'H' },
    { value: 'terlambat', label: 'Terlambat', color: '#f59e0b', short: 'T' },
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
    { value: 'renungan_harian', label: 'Renungan Harian', icon: '📖', group: 'Harian' },
    { value: 'ibadah_mingguan', label: 'Ibadah Mingguan', icon: '⛪', group: 'Mingguan' },
    { value: 'kanaan_fellowship_guru', label: 'Kanaan Fellowship - Guru', icon: '🧑‍🏫', group: 'Kanaan Fellowship' },
    { value: 'kanaan_fellowship_siswa', label: 'Kanaan Fellowship - Siswa', icon: '🎓', group: 'Kanaan Fellowship' }
  ],
  PRESENSI_TYPE_LABELS: {
    renungan_harian: 'Renungan Harian',
    ibadah_mingguan: 'Ibadah Mingguan',
    kanaan_fellowship_guru: 'Kanaan Fellowship Guru',
    kanaan_fellowship_siswa: 'Kanaan Fellowship Siswa'
  },
  IBADAH_MINGGUAN_DAY: 5, // Friday (0=Sun, 1=Mon, ..., 5=Fri, 6=Sat)
  DAY_NAMES: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
  DAY_SHORT: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'],
  PERMISSION_LEVELS: ['none', 'view', 'write'],
  PERMISSION_LABELS: { none: 'Tidak Ada', view: 'Lihat', write: 'Tulis' },
  PERMISSION_DEFAULTS: {
    pastoral: { renungan_harian: 'write', ibadah_mingguan: 'write', kanaan_fellowship_guru: 'write', kanaan_fellowship_siswa: 'write' },
    guru_agama: { renungan_harian: 'write', ibadah_mingguan: 'view', kanaan_fellowship_guru: 'view', kanaan_fellowship_siswa: 'view' },
    kepala_sekolah: { renungan_harian: 'view', ibadah_mingguan: 'view', kanaan_fellowship_guru: 'view', kanaan_fellowship_siswa: 'view' },
    gereja: { renungan_harian: 'view', ibadah_mingguan: 'view', kanaan_fellowship_guru: 'view', kanaan_fellowship_siswa: 'view' },
    admin: { renungan_harian: 'write', ibadah_mingguan: 'write', kanaan_fellowship_guru: 'write', kanaan_fellowship_siswa: 'write' }
  }
};
