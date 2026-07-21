import { connect } from '@tidbcloud/serverless';

let _conn = null;

function getConnection(env) {
  if (!_conn) {
    _conn = connect({ url: env.TIDB_DATABASE_URL });
  }
  return _conn;
}

export async function query(env, sql, params = []) {
  const conn = getConnection(env);
  const rows = await conn.execute(sql, params);
  return rows;
}

export async function execute(env, sql, params = []) {
  const conn = getConnection(env);
  const result = await conn.execute(sql, params);
  return result;
}

export async function initSchema(env) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(500) NOT NULL,
      salt VARCHAR(100) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'guru_agama',
      full_name VARCHAR(200) NOT NULL,
      permissions TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS attendance (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_name VARCHAR(200) NOT NULL,
      employee_position VARCHAR(200),
      employee_division VARCHAR(100),
      employee_status VARCHAR(100),
      academic_year VARCHAR(20) NOT NULL,
      attendance_date DATE NOT NULL,
      presensi_type VARCHAR(30) NOT NULL DEFAULT 'renungan_harian',
      status VARCHAR(30) NOT NULL,
      notes TEXT,
      recorded_by VARCHAR(100) NOT NULL,
      recorded_by_role VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_attendance (employee_name, attendance_date, academic_year, presensi_type),
      INDEX idx_date (attendance_date),
      INDEX idx_year (academic_year),
      INDEX idx_status (status),
      INDEX idx_presensi_type (presensi_type)
    )`,
    `CREATE TABLE IF NOT EXISTS academic_years (
      id INT AUTO_INCREMENT PRIMARY KEY,
      year_code VARCHAR(20) UNIQUE NOT NULL,
      year_label VARCHAR(20) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS employees (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      position VARCHAR(200) DEFAULT '',
      division VARCHAR(100) DEFAULT '',
      employment_status VARCHAR(100) DEFAULT '',
      academic_year_id INT NOT NULL,
      is_active_rh BOOLEAN DEFAULT TRUE,
      is_active_im BOOLEAN DEFAULT TRUE,
      is_active_kf BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_year (academic_year_id),
      UNIQUE KEY uq_emp_year (name, academic_year_id)
    )`,
    `CREATE TABLE IF NOT EXISTS kanaan_fellowship_students (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nis VARCHAR(50),
      name VARCHAR(200) NOT NULL,
      class VARCHAR(50),
      gender VARCHAR(10),
      religion VARCHAR(50),
      academic_year_id INT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_year (academic_year_id),
      INDEX idx_active (is_active),
      INDEX idx_class (class),
      UNIQUE KEY uq_kf_student (name, class, academic_year_id)
    )`,
    `CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      role_key VARCHAR(50) UNIQUE NOT NULL,
      role_label VARCHAR(100) NOT NULL,
      default_permissions TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS presensi_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      type_key VARCHAR(50) UNIQUE NOT NULL,
      type_label VARCHAR(100) NOT NULL,
      category VARCHAR(10) NOT NULL DEFAULT 'guru',
      is_active BOOLEAN DEFAULT TRUE,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS presensi_config (
      id INT AUTO_INCREMENT PRIMARY KEY,
      presensi_type VARCHAR(30) UNIQUE NOT NULL,
      allowed_days VARCHAR(30) NOT NULL DEFAULT '1,2,3,4,5',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS divisions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS calendar_sheet_configs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      academic_year VARCHAR(20) NOT NULL,
      sheet_key VARCHAR(50) NOT NULL,
      sheet_label VARCHAR(200) NOT NULL,
      sheet_id VARCHAR(200) NOT NULL,
      gid VARCHAR(20) DEFAULT '0',
      color VARCHAR(20) DEFAULT '#3b82f6',
      is_active BOOLEAN DEFAULT TRUE,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cal_config (academic_year, sheet_key)
    )`,
    // Migration: add columns if they don't exist (for existing installations)
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT NULL AFTER full_name`,
    `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS presensi_type VARCHAR(30) NOT NULL DEFAULT 'renungan_harian' AFTER attendance_date`,
    // Seed default presensi types if table is empty
    `INSERT IGNORE INTO presensi_types (type_key, type_label, category, sort_order) VALUES ('renungan_harian', 'Renungan Harian', 'guru', 1)`,
    `INSERT IGNORE INTO presensi_types (type_key, type_label, category, sort_order) VALUES ('ibadah_mingguan', 'Ibadah Mingguan (Tiap Jumat)', 'guru', 2)`,
    `INSERT IGNORE INTO presensi_types (type_key, type_label, category, sort_order) VALUES ('kanaan_fellowship_guru', 'Kanaan Fellowship (Sabat Ceria) - Guru', 'guru', 3)`,
    `INSERT IGNORE INTO presensi_types (type_key, type_label, category, sort_order) VALUES ('kanaan_fellowship_siswa', 'Kanaan Fellowship (Sabat Ceria) - Siswa', 'siswa', 4)`,
    // Seed default roles if table is empty
    `INSERT IGNORE INTO roles (role_key, role_label, default_permissions) VALUES ('admin', 'Administrator', '{"renungan_harian":{"level":"write","divisions":[],"classes":[]},"ibadah_mingguan":{"level":"write","divisions":[],"classes":[]},"kanaan_fellowship_guru":{"level":"write","divisions":[],"classes":[]},"kanaan_fellowship_siswa":{"level":"write","divisions":[],"classes":[]}}')`,
    `INSERT IGNORE INTO roles (role_key, role_label, default_permissions) VALUES ('pastoral', 'Pastoral', '{"renungan_harian":{"level":"write","divisions":[],"classes":[]},"ibadah_mingguan":{"level":"write","divisions":[],"classes":[]},"kanaan_fellowship_guru":{"level":"write","divisions":[],"classes":[]},"kanaan_fellowship_siswa":{"level":"write","divisions":[],"classes":[]}}')`,
    `INSERT IGNORE INTO roles (role_key, role_label, default_permissions) VALUES ('guru_agama', 'Guru Agama', '{"renungan_harian":{"level":"write","divisions":[],"classes":[]},"ibadah_mingguan":{"level":"view","divisions":[],"classes":[]},"kanaan_fellowship_guru":{"level":"view","divisions":[],"classes":[]},"kanaan_fellowship_siswa":{"level":"view","divisions":[],"classes":[]}}')`,
    `INSERT IGNORE INTO roles (role_key, role_label, default_permissions) VALUES ('kepala_sekolah', 'Kepala Sekolah', '{"renungan_harian":{"level":"view","divisions":[],"classes":[]},"ibadah_mingguan":{"level":"view","divisions":[],"classes":[]},"kanaan_fellowship_guru":{"level":"view","divisions":[],"classes":[]},"kanaan_fellowship_siswa":{"level":"view","divisions":[],"classes":[]}}')`,
    `INSERT IGNORE INTO roles (role_key, role_label, default_permissions) VALUES ('gereja', 'Gereja', '{"renungan_harian":{"level":"view","divisions":[],"classes":[]},"ibadah_mingguan":{"level":"view","divisions":[],"classes":[]},"kanaan_fellowship_guru":{"level":"view","divisions":[],"classes":[]},"kanaan_fellowship_siswa":{"level":"view","divisions":[],"classes":[]}}')`,
    // Seed default calendar sheet configs for AY2627
    `INSERT IGNORE INTO calendar_sheet_configs (academic_year, sheet_key, sheet_label, sheet_id, gid, color, sort_order) VALUES ('2026-2027', 'renungan_harian_siswa', '📖 Renungan Harian Siswa', '1ojbcrwsnlnrzwp1RyqjUmYMmoo3XKsuKRfffU_vOTl4', '0', '#3b82f6', 1)`,
    `INSERT IGNORE INTO calendar_sheet_configs (academic_year, sheet_key, sheet_label, sheet_id, gid, color, sort_order) VALUES ('2026-2027', 'ibadah_mingguan_siswa', '⛪ Ibadah Mingguan Siswa', '1UBUPnNqvx8nbDzaUZNG0m7WfhQkvx5-Js5gKilhhEvY', '0', '#22c55e', 2)`,
    `INSERT IGNORE INTO calendar_sheet_configs (academic_year, sheet_key, sheet_label, sheet_id, gid, color, sort_order) VALUES ('2026-2027', 'ibadah_mingguan_karyawan', '🙏 Ibadah Mingguan Karyawan', '1Xkhum8q8c8RvJy3Vck4qm54P0ik7d6y6zaxR_XO4gc4', '1467382719', '#a855f7', 3)`,
    `INSERT IGNORE INTO calendar_sheet_configs (academic_year, sheet_key, sheet_label, sheet_id, gid, color, sort_order) VALUES ('2026-2027', 'komsel_karyawan', '🤝 Komsel Karyawan', '1NLyFjTCflD3qZ0e9LqCMLkupMwtjpMCs_1E2yE3P1B0', '843795037', '#f59e0b', 4)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_active_rh BOOLEAN DEFAULT TRUE AFTER employment_status`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_active_im BOOLEAN DEFAULT TRUE AFTER is_active_rh`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_active_kf BOOLEAN DEFAULT TRUE AFTER is_active_im`,
    // Drop old unique key and add new one that includes presensi_type
    `ALTER TABLE attendance DROP INDEX IF EXISTS uq_attendance`,
    `ALTER TABLE attendance ADD UNIQUE INDEX uq_attendance (employee_name, attendance_date, academic_year, presensi_type)`,
    // Data migration: sync old is_active → is_active_rh + is_active_im, then drop old column
    // Unconditional sync — idempotent, and handles DEFAULT TRUE overriding old FALSE values
    `UPDATE employees SET is_active_rh = is_active, is_active_im = is_active`,
    `ALTER TABLE employees DROP COLUMN IF EXISTS is_active`,
    `ALTER TABLE employees DROP INDEX IF EXISTS idx_active`,
  ];
  for (const sql of statements) {
    try {
      await execute(env, sql);
    } catch (e) {
      // Migration statements may fail on existing schemas — safe to ignore
      console.warn('Schema statement warning:', e.message);
    }
  }
}
