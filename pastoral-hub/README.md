# Pastoral Hub SKKKR

Web-based attendance system for **Sekolah Kristen Kanaan Kubu Raya** — Presensi Renungan Harian guru/karyawan.

## Fitur

- **Presensi harian** dengan 5 status: Hadir, Terlambat, Izin, Sakit, Tidak Hadir
- **Dashboard** dengan statistik real-time, grafik distribusi, tren harian, dan breakdown per divisi
- **Export laporan Excel** (.xlsx) lengkap dengan grafik embedded
- **Auto-detect data karyawan** per tahun ajaran dari folder `Karyawan/` (format: `Data Karyawan AY2627.xlsx`)
- **Login terenkripsi** — password di-hash dengan PBKDF2 (120K iterations, SHA-256)
- **Role-based access**: Pastoral, Guru Agama, Administrator
- **Database TiDB Cloud Serverless** via Cloudflare Workers (serverless proxy)
- **Demo mode** — berjalan tanpa backend (localStorage) untuk testing

## Struktur

```
PAS-Presensi/
├── index.html              # Frontend SPA
├── css/style.css
├── js/
│   ├── config.js           # Konfigurasi (API URL, repo info, status presensi)
│   ├── api.js              # API client (TiDB via worker / localStorage demo)
│   ├── auth.js             # Autentikasi
│   ├── data-loader.js      # Load data karyawan dari Excel (auto-detect tahun)
│   ├── attendance.js       # Form presensi
│   ├── dashboard.js        # Dashboard + grafik (Chart.js)
│   ├── export.js           # Export Excel (ExcelJS + Chart.js)
│   └── app.js              # Main app, routing, admin
├── Karyawan/               # Data karyawan per tahun ajaran
│   └── Data Karyawan AY2627.xlsx
├── worker/                 # Cloudflare Worker (backend proxy ke TiDB)
│   ├── src/
│   │   ├── index.js        # API endpoints + routing
│   │   ├── db.js           # Koneksi TiDB (@tidbcloud/serverless)
│   │   └── auth.js         # PBKDF2 hashing + JWT (Web Crypto API)
│   ├── schema.sql          # Database schema
│   ├── package.json
│   └── wrangler.toml
└── .nojekyll               # Disable Jekyll untuk GitHub Pages
```

## Setup

### 1. Frontend (GitHub Pages)

Frontend sudah siap di-deploy. GitHub Actions workflow ada di `.github/workflows/deploy-presensi.yml` — akan otomatis deploy folder `PAS-Presensi/` ke GitHub Pages setiap push ke `master`.

**Aktifkan GitHub Pages:**
1. Buka repo Settings → Pages → Source: **GitHub Actions**
2. Push ke master, workflow akan otomatis berjalan
3. Akses di: `https://<username>.github.io/<repo>/`

**Tanpa backend (Demo Mode):**
- Jangan isi `API_BASE_URL` di `js/config.js`
- Data disimpan di browser localStorage
- Saat pertama buka, buat akun admin via form "Demo Mode"

### 2. Backend (Cloudflare Worker + TiDB)

#### a. Setup TiDB Cloud Serverless
1. Daftar di [tidbcloud.com](https://tidbcloud.com) (login dengan Google: thengilbert@gmail.com)
2. Buat cluster **Serverless** (free tier) di project **PastoralSKKKR**
3. Dapatkan connection string: format `mysql://<user>:<password>@<host>:4000/<db>?sslaccept=strict`
4. (Opsional) Jalankan `worker/schema.sql` di TiDB Cloud SQL Editor

#### b. Deploy Cloudflare Worker
```bash
cd PAS-Presensi/worker
npm install
npx wrangler login
npx wrangler secret put TIDB_DATABASE_URL    # paste TiDB connection string
npx wrangler secret put JWT_SECRET            # paste random string (e.g. openssl rand -hex 32)
npx wrangler secret put CORS_ORIGIN           # paste GitHub Pages URL (https://thengb.github.io)
npm run deploy
```
Worker URL: `https://pas-presensi-api.<your-subdomain>.workers.dev`

#### c. Hubungkan Frontend ke Backend
Edit `js/config.js`:
```javascript
API_BASE_URL: 'https://pas-presensi-api.<your-subdomain>.workers.dev',
```

#### d. Setup Akun Admin
- Buka app di GitHub Pages
- Saat belum ada user, form setup akan muncul
- Buat akun admin pertama
- Setelah itu, login normal dan tambah user via menu "Manajemen User"

### 3. Data Karyawan per Tahun Ajaran

- Format file: `Data Karyawan AY{YY}{YY}.xlsx` (contoh: `AY2627` = 2026-2027)
- Kolom: **Nama** | **Jabatan** | **Divisi** | **Status** (tanpa header row)
- Letakkan di folder `PAS-Presensi/Karyawan/`
- App otomatis mendeteksi file baru via GitHub API
- Untuk tahun ajaran baru, tambahkan file baru dengan penamaan yang sama

## Keamanan

- **Password**: PBKDF2 hash (120,000 iterations, SHA-256, 16-byte salt) — tidak disimpan plain text
- **JWT**: HS256 signed tokens, 7 hari expiry
- **TiDB connection**: TLS/SSL wajib, kredensial di Cloudflare Worker secrets (tidak exposed ke client)
- **CORS**: Hanya origin yang diizinkan yang bisa akses API
- **Encryption at rest**: TiDB Cloud Serverless menyediakan ini secara default

## Teknologi

- Frontend: HTML/CSS/JS (vanilla, ES modules), Chart.js, SheetJS, ExcelJS
- Backend: Cloudflare Workers, @tidbcloud/serverless
- Database: TiDB Cloud Serverless
- Hosting: GitHub Pages (frontend), Cloudflare Workers (backend)
