# Presensi Guru Sekolah Minggu - GYS Pontianak

Aplikasi **Presensi Guru Sekolah Minggu** adalah sistem pencatatan kehadiran berbasis web (Web App) yang dirancang khusus untuk memudahkan pengurus dan guru dalam mencatat, memantau, serta merekap kegiatan absensi. Aplikasi ini dibangun guna memastikan pelaporan yang efisien dan minim kesalahan (seperti kesalahan pada zona waktu, rekapan kosong, dan laporan akhir).

## 🚀 Fitur Utama

1. **Sistem Login Terpusat (Single Sign-On)**
   Terintegrasi langsung dengan Firebase Google Authentication. Pengguna hanya perlu masuk menggunakan akun Google mereka, tanpa perlu mendaftar atau menghafal password baru.

2. **Deteksi Status Kehadiran Otomatis**
   Sistem membedakan status absensi secara otomatis (Hadir Tepat Waktu, Terlambat) berdasarkan jam jadwal yang sudah ditentukan.

3. **Pengajuan Izin & Cuti**
   Guru dapat dengan mudah mengirimkan status "Izin" atau "Cuti", disertai dengan alasan pendukung.

4. **Algoritma "Tidak Hadir" Pintar (Auto-Absent)**
   Jika seorang guru melewatkan absensi pada hari jadwal piketnya, sistem secara otomatis akan mengisi data "Tidak Hadir" di riwayatnya. Sistem ini cukup cerdas untuk memeriksa kapan guru pertama kali hadir (menggunakan *Global Limit Query*), sehingga akun baru yang belum pernah aktif tidak akan dipenuhi oleh peringatan "Tidak Hadir" palsu.

5. **Panel Admin (Dashboard Eksekutif)**
   *   **Manajemen Pengguna:** Melihat riwayat absen semua pengguna, beserta filter tanggal (harian, mingguan, bulanan, tahunan, kustom).
   *   **Dashboard Statistik:** Cincin progress (donut chart) untuk mendeteksi rasio kehadiran.
   *   **Manajemen Hari Libur:** Mendaftarkan hari libur nasional atau acara khusus agar sistem otomatis melewatinya.
   *   **Export Rekapitulasi (Excel / XLSX):** Mampu mengunduh rekap berformat tabel kalender yang mendukung format (H: Hadir, X: Izin/Cuti/Tidak Hadir, -: Kosong). Didukung enkripsi karakter Unicode bebas *glitch*.

6. **UI Tema Kustom & Ringan Base-Native**
   Tanpa menggunakan library berat seperti Bootstrap atau jQuery. Menggunakan CSS murni (Vanilla) dengan warna dan fitur picker bawaan browser HTML5 `<input type="color">`. Menjamin aplikasi cepat dimuat bahkan di koneksi internet lambat.

---

## 📁 Struktur Direktori Proyek

Proyek ini menggunakan struktur web standar *frontend* dengan interaksi berbasis Modul JS ke Firestore.

```text
/ (Root)
├── LICENSE           # Dokumen Lisensi Proyek
├── README.md         # Dokumentasi (File ini)
└── /docs             # Root Folder untuk Web App (Siap deploy ke Github Pages / Hosting)
    ├── index.html    # Kerangka antarmuka pengguna (UI/DOM)
    ├── style.css     # Tata letak, warna, responsivitas layar (Mobile Friendly)
    └── app.js        # Otak aplikasi: logika Firebase, pengaturan waktu, dan kalkulasi data
```

---

## 💻 Teknologi yang Digunakan

*   **HTML5 & CSS3:** Kerangka dan desain antarmuka, ramah di *smartphone* maupun dekstop (*responsive design*).
*   **Vanilla / ES6 JavaScript:** Logika utama aplikasi berformat modular (`type="module"`).
*   **Firebase / Firestore (v11):** Sebagai pangkalan data interaktif (menyimpan jam presensi, profil pengguna, role/jabatan) dan otentikasi login.
*   **ExcelJS / Spreadsheet Exports:** Skrip bawaan untuk mencetak file absensi bulanan.

---

## ⚙️ Cara Penggunaan & Instalasi (Bagi Developer/Admin)

Aplikasi ini berjalan tanpa menggunakan sistem *backend server* seperti PHP/Node.js karena semuanya ditenagai oleh Firebase (*Serverless Frontend*). 

**Penting:** Karena aplikasi memanggil *module* `import` dari luar, Anda **tidak bisa** hanya mengklik dua kali `index.html` (akan terjadi *CORS policy error*).

### Menjalankan di Komputer Lokal:
1. Pasang [Node.js](https://nodejs.org/) & NPM, atau gunakan ekstensi VS Code seperti **Live Server**.
2. Jika menggunakan Python, buka terminal/CMD arahkan ke folder proyek, dan ketik: `python -m http.server 8080`.
3. Buka peramban (browser) dan akses `http://localhost:8080/docs/`.
4. Anda akan disajikan dengan halaman Login Google.

### Pengaturan Data Pangkalan (Database):
Bagi Admin, Firebase Firestore harus memiliki koleksi (`collections`) setidaknya sebagai berikut:
*   `/artifacts/{appId}/users/`: Berisi dokumen *email* pengguna, hak akses (Teacher/Admin).
*   `/artifacts/{appId}/users/{email}/presensi/`: Berisi jejak waktu per-kehadiran individu.
*   `/artifacts/{appId}/holidays/`: Menyimpan konfigurasi tanggal kalender libur.
Sistem secara otomatis akan membuat tabel-tabel tersebut di Firebase ketika pengguna berinteraksi di aplikasi.

---

## 👥 Hak Akses (Role Permissions)

Secara bawaan, entitas login terbagi dua:
1. **Guru (Standard User):**
   * Hanya dapat melihat halaman absensinya sendiri.
   * Modifikasi izin, cuti, dan melihat riwayat bulanannya.
2. **Admin:**
   * Diatur langsung dari pangkalan data Firebase (memasukkan _string_ `"Admin"` di parameter akun).
   * Mendapat tombol ekstra "Admin Menu".
   * Bisa mencetak Excel, melihat/menghapus catatan guru dengan alasan yang meragukan.

---

## 💡 Detail Teknis Tambahan (Best Practices)

*   **Performa:* Menggunakan metode cache DOM dalam JavaScript dan `limit(1)` di Firebase untuk mencegah tagihan bacaan (*read quota*) Firebase yang membengkak di kalender pengguna.
*   **Tanpa Ketergantungan Eksternal (Zero Dependencies):** Menghapus pustaka memori seperti jQuery dan Spectrum Color Picker. Semua kontrol grafis memanfaatkan fungsi asli (*Native API*) pada Browser.

---
_Aplikasi Dibuat & Dipelihara untuk Efisiensi Guru Pelayanan GYS Pontianak._
