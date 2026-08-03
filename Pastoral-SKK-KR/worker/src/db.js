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
    `CREATE TABLE IF NOT EXISTS calendar_custom_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      academic_year VARCHAR(20) NOT NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      color VARCHAR(20) DEFAULT '#ef4444',
      created_by VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ay (academic_year)
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
    // Employee ↔ Presensi type active flags (replaces hardcoded is_active_rh/im/kf)
    `CREATE TABLE IF NOT EXISTS employee_presensi_active (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id INT NOT NULL,
      presensi_type VARCHAR(50) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_emp_presensi (employee_id, presensi_type),
      INDEX idx_emp (employee_id),
      INDEX idx_type (presensi_type)
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
    `INSERT IGNORE INTO roles (role_key, role_label, default_permissions) VALUES ('admin', 'Administrator', '{"renungan_harian":{"level":"write","divisions":[],"classes":[]},"ibadah_mingguan":{"level":"write","divisions":[],"classes":[]},"kanaan_fellowship_guru":{"level":"write","divisions":[],"classes":[]},"kanaan_fellowship_siswa":{"level":"write","divisions":[],"classes":[]},"_kalender_pastoral":true}')`,
    `INSERT IGNORE INTO roles (role_key, role_label, default_permissions) VALUES ('pastoral', 'Pastoral', '{"renungan_harian":{"level":"write","divisions":[],"classes":[]},"ibadah_mingguan":{"level":"write","divisions":[],"classes":[]},"kanaan_fellowship_guru":{"level":"write","divisions":[],"classes":[]},"kanaan_fellowship_siswa":{"level":"write","divisions":[],"classes":[]},"_kalender_pastoral":true}')`,
    // Update existing admin & pastoral roles with calendar access (migration)
    `UPDATE roles SET default_permissions = JSON_SET(default_permissions, '$.\"_kalender_pastoral\"', true) WHERE role_key IN ('admin', 'pastoral') AND default_permissions IS NOT NULL AND JSON_EXTRACT(default_permissions, '$.\"_kalender_pastoral\"') IS NULL`,
    `INSERT IGNORE INTO roles (role_key, role_label, default_permissions) VALUES ('guru_agama', 'Guru Agama', '{"renungan_harian":{"level":"write","divisions":[],"classes":[]},"ibadah_mingguan":{"level":"view","divisions":[],"classes":[]},"kanaan_fellowship_guru":{"level":"view","divisions":[],"classes":[]},"kanaan_fellowship_siswa":{"level":"view","divisions":[],"classes":[]}}')`,
    `INSERT IGNORE INTO roles (role_key, role_label, default_permissions) VALUES ('kepala_sekolah', 'Kepala Sekolah', '{"renungan_harian":{"level":"view","divisions":[],"classes":[]},"ibadah_mingguan":{"level":"view","divisions":[],"classes":[]},"kanaan_fellowship_guru":{"level":"view","divisions":[],"classes":[]},"kanaan_fellowship_siswa":{"level":"view","divisions":[],"classes":[]}}')`,
    `INSERT IGNORE INTO roles (role_key, role_label, default_permissions) VALUES ('gereja', 'Gereja', '{"renungan_harian":{"level":"view","divisions":[],"classes":[]},"ibadah_mingguan":{"level":"view","divisions":[],"classes":[]},"kanaan_fellowship_guru":{"level":"view","divisions":[],"classes":[]},"kanaan_fellowship_siswa":{"level":"view","divisions":[],"classes":[]}}')`,
    // Seed default calendar sheet configs for AY2627
    `INSERT IGNORE INTO calendar_sheet_configs (academic_year, sheet_key, sheet_label, sheet_id, gid, color, sort_order) VALUES ('2026-2027', 'renungan_harian_siswa', '📖 Renungan Harian Siswa', '1ojbcrwsnlnrzwp1RyqjUmYMmoo3XKsuKRfffU_vOTl4', '0', '#3b82f6', 1)`,
    `INSERT IGNORE INTO calendar_sheet_configs (academic_year, sheet_key, sheet_label, sheet_id, gid, color, sort_order) VALUES ('2026-2027', 'renungan_harian_guru', '📖 Renungan Harian Guru/Karyawan', '141GNZXGXayJc-3PUUZMoJcccxbhUhbivGYOR5aLZwY4', '0', '#6366f1', 5)`,
    `INSERT IGNORE INTO calendar_sheet_configs (academic_year, sheet_key, sheet_label, sheet_id, gid, color, sort_order) VALUES ('2026-2027', 'ibadah_mingguan_siswa', '⛪ Ibadah Mingguan Siswa', '1UBUPnNqvx8nbDzaUZNG0m7WfhQkvx5-Js5gKilhhEvY', '0', '#22c55e', 2)`,
    `INSERT IGNORE INTO calendar_sheet_configs (academic_year, sheet_key, sheet_label, sheet_id, gid, color, sort_order) VALUES ('2026-2027', 'ibadah_mingguan_karyawan', '🙏 Ibadah Mingguan Karyawan', '1Xkhum8q8c8RvJy3Vck4qm54P0ik7d6y6zaxR_XO4gc4', '1467382719', '#a855f7', 3)`,
    `INSERT IGNORE INTO calendar_sheet_configs (academic_year, sheet_key, sheet_label, sheet_id, gid, color, sort_order) VALUES ('2026-2027', 'komsel_karyawan', '🤝 Komsel Karyawan', '1NLyFjTCflD3qZ0e9LqCMLkupMwtjpMCs_1E2yE3P1B0', '843795037', '#f59e0b', 4)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_active_rh BOOLEAN DEFAULT TRUE AFTER employment_status`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_active_im BOOLEAN DEFAULT TRUE AFTER is_active_rh`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_active_kf BOOLEAN DEFAULT TRUE AFTER is_active_im`,
    // Data migration: sync old is_active → is_active_rh + is_active_im, then drop old column
    // Unconditional sync — idempotent, and handles DEFAULT TRUE overriding old FALSE values
    `UPDATE employees SET is_active_rh = is_active, is_active_im = is_active`,
    `ALTER TABLE employees DROP COLUMN IF EXISTS is_active`,
    `ALTER TABLE employees DROP INDEX IF EXISTS idx_active`,
    // Add column_config for per-sheet column definitions
    `ALTER TABLE calendar_sheet_configs ADD COLUMN IF NOT EXISTS column_config TEXT DEFAULT NULL AFTER color`,
    // Seed default column configs for standard sheets (admin can override via UI)
    `UPDATE calendar_sheet_configs SET column_config = '[{"idx":0,"label":"No.","type":"ignore"},{"idx":1,"label":"Hari/Tanggal","type":"date"},{"idx":2,"label":"Tema","type":"text"},{"idx":3,"label":"Lokasi","type":"text"},{"idx":4,"label":"Pemimpin Pujian","type":"text"},{"idx":5,"label":"Pemimpin Firman","type":"text","short":true},{"idx":6,"label":"Sumbangan Pujian","type":"text"}]' WHERE sheet_key = 'ibadah_mingguan_karyawan' AND column_config IS NULL`,
    `UPDATE calendar_sheet_configs SET column_config = '[{"idx":0,"label":"Hari/Tanggal","type":"date"},{"idx":1,"label":"Jenjang","type":"text"},{"idx":2,"label":"Petugas Pujian","type":"text"},{"idx":3,"label":"Petugas Firman","type":"text","short":true},{"idx":4,"label":"Tema","type":"text"},{"idx":5,"label":"Tagline","type":"text"},{"idx":6,"label":"Bahan PAMS","type":"link"},{"idx":7,"label":"Link Dokumen","type":"link"}]' WHERE sheet_key = 'komsel_karyawan' AND column_config IS NULL`,
    `UPDATE calendar_sheet_configs SET column_config = '[{"idx":0,"label":"Tanggal","type":"date"},{"idx":1,"label":"Jadwal","type":"text"},{"idx":2,"label":"Petugas TK-SD","type":"text","short":true},{"idx":3,"label":"Petugas SMP","type":"text","short":true},{"idx":4,"label":"Keterangan","type":"text"}]' WHERE sheet_key = 'renungan_harian_siswa' AND column_config IS NULL`,
    `UPDATE calendar_sheet_configs SET column_config = '[{"idx":0,"label":"Tanggal","type":"date"},{"idx":1,"label":"Hari","type":"text"},{"idx":2,"label":"Petugas TK-Manajemen","type":"text","short":true},{"idx":3,"label":"Petugas SD","type":"text","short":true},{"idx":4,"label":"Petugas SMP","type":"text"},{"idx":5,"label":"Keterangan","type":"text"}]' WHERE sheet_key = 'renungan_harian_guru' AND column_config IS NULL`,
    `UPDATE calendar_sheet_configs SET column_config = '[{"idx":0,"label":"Tema","type":"text"},{"idx":1,"label":"Sub Tema","type":"text"},{"idx":2,"label":"Bulan","type":"text"},{"idx":4,"label":"Cerita Alkitab","type":"text"},{"idx":5,"label":"Alkitab Bacaan","type":"text"},{"idx":7,"label":"Pengajaran","type":"text"},{"idx":9,"label":"Kelas 1","type":"date","group":1},{"idx":10,"label":"Petugas K1","type":"text","short":true,"group":1},{"idx":11,"label":"Kelas 2-4","type":"date","group":2},{"idx":12,"label":"Petugas K2-4","type":"text","short":true,"group":2},{"idx":13,"label":"Kelas 5-6","type":"date","group":3},{"idx":14,"label":"Petugas K5-6","type":"text","short":true,"group":3},{"idx":15,"label":"TK","type":"date","group":4},{"idx":16,"label":"Petugas TK","type":"text","short":true,"group":4},{"idx":17,"label":"SMP","type":"date","group":5},{"idx":18,"label":"Petugas SMP","type":"text","short":true,"group":5}]' WHERE sheet_key = 'ibadah_mingguan_siswa' AND column_config IS NULL`,
    // Add repeat support for custom events
    `ALTER TABLE calendar_custom_events ADD COLUMN IF NOT EXISTS is_repeating BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE calendar_custom_events ADD COLUMN IF NOT EXISTS repeat_days TEXT DEFAULT NULL`,
    // Notes for sheet-level keterangan (shown on every event from this sheet)
    `ALTER TABLE calendar_sheet_configs ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT NULL AFTER column_config`,
    // Telegram bot groups management
    `CREATE TABLE IF NOT EXISTS bot_groups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      chat_id VARCHAR(50) UNIQUE NOT NULL,
      group_name VARCHAR(200) DEFAULT '',
      is_enabled BOOLEAN DEFAULT TRUE,
      announce_hour INT DEFAULT 13,
      announce_minute INT DEFAULT 0,
      last_sent_date VARCHAR(20) DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS bot_config (
      id INT AUTO_INCREMENT PRIMARY KEY,
      config_key VARCHAR(50) UNIQUE NOT NULL,
      config_value TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    // Seed default bot config
    `INSERT IGNORE INTO bot_config (config_key, config_value) VALUES ('sheet_id', '141GNZXGXayJc-3PUUZMoJcccxbhUhbivGYOR5aLZwY4')`,
    `INSERT IGNORE INTO bot_config (config_key, config_value) VALUES ('sheet_range', 'Jadwal Renungan Guru!A6:F1000')`,
    // Active schedules per group (JSON array of sheet_key + 'custom_event')
    `ALTER TABLE bot_groups ADD COLUMN IF NOT EXISTS active_schedules TEXT DEFAULT NULL`,
    `ALTER TABLE bot_groups ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT NULL`,
  ];
  for (const sql of statements) {
    try {
      await execute(env, sql);
    } catch (e) {
      // Migration statements may fail on existing schemas — safe to ignore
      console.warn('Schema statement warning:', e.message);
    }
  }

  // ===== Attendance unique key (self-healing) =====
  // Migrasi lama DROP+ADD index setiap deploy; jika ADD gagal (mis. karena sudah
  // ada duplikat), index hilang → save berulang malah MENAMBAH baris baru dan
  // jumlah murid/karyawan di Lihat Presensi jadi dobel. Kini: cek definisi index
  // dulu; hanya bila rusak/tidak ada → bersihkan duplikat (pertahankan record
  // terbaru) lalu buat index-nya. Idempoten, aman dijalankan setiap init.
  try {
    const idxRows = await query(env,
      `SELECT COLUMN_NAME FROM information_schema.statistics
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance' AND INDEX_NAME = 'uq_attendance'
       ORDER BY SEQ_IN_INDEX`);
    const wantCols = ['employee_name', 'attendance_date', 'academic_year', 'presensi_type'];
    const haveCols = (idxRows || []).map(r => r.COLUMN_NAME);
    const indexOk = wantCols.length === haveCols.length && wantCols.every((c, i) => c === haveCols[i]);
    if (!indexOk) {
      await execute(env,
        `DELETE FROM attendance WHERE id NOT IN (
           SELECT keep_id FROM (
             SELECT MAX(id) AS keep_id FROM attendance
             GROUP BY employee_name, attendance_date, academic_year, presensi_type
           ) t
         )`);
      await execute(env, 'ALTER TABLE attendance DROP INDEX IF EXISTS uq_attendance');
      await execute(env,
        'ALTER TABLE attendance ADD UNIQUE INDEX uq_attendance (employee_name, attendance_date, academic_year, presensi_type)');
      console.log('Attendance unique index restored (duplicates cleaned).');
    }
  } catch (e) {
    console.warn('Attendance unique index check skipped:', e.message);
  }
}
