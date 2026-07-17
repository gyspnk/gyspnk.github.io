# 🔧 SOLUSI MASALAH CORS - Google Apps Script

## ❌ **Error yang Anda Alami:**
```
Permintaan Lintas Asal Diblokir: Kebijakan Asal yang Sama melarang membaca sumber daya jarak jauh
CORS 'Access-Control-Allow-Origin' header tidak ada
Kode status: 405
```

## 🎯 **Penyebab Utama:**
1. **Apps Script belum di-deploy** dengan benar
2. **Permission deployment salah** (bukan "Anyone")
3. **Method tidak diizinkan** (405 error)

---

## 🛠️ **LANGKAH PERBAIKAN LENGKAP:**

### **1. Pastikan Apps Script Code Benar**
✅ Gunakan kode dari file `apps-script.js` yang sudah diupdate
✅ Pastikan ada function `doPost()` dan `doGet()`
✅ Pastikan tidak ada syntax error

### **2. DEPLOYMENT YANG BENAR** ⚠️ **KRITIS!**

#### **Step-by-step Deployment:**

1. **Buka Google Apps Script** → https://script.google.com
2. **Paste Code** dari `apps-script.js` ke Code.gs
3. **Save Project** (Ctrl+S)
4. **Klik Deploy** → **New deployment**
5. **Settings WAJIB:**
   ```
   Type: Web app
   Execute as: Me (your-email@gmail.com)
   Who has access: Anyone  ⚠️ KRITIS: HARUS "Anyone"!
   ```
6. **Klik Deploy**
7. **Authorize** semua permissions yang diminta
8. **Copy Web App URL** (format: https://script.google.com/macros/s/SCRIPT_ID/exec)

### **3. Verifikasi Deployment**

#### **Test Manual di Browser:**
```
https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
```

✅ **Berhasil jika:** Muncul halaman HTML dengan info script
❌ **Gagal jika:** Error 404, 403, atau tidak load

#### **Test dengan Parameter:**
```
https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?info=true
```

✅ **Berhasil jika:** Response JSON dengan info script

### **4. Update URL di Web App**

1. Buka admin panel web app Anda
2. Masukkan Web App URL ke field "Apps Script Web App URL"
3. Klik "💾 Simpan URL"
4. Klik "🧪 Test Koneksi"

---

## 🔍 **TROUBLESHOOTING UMUM:**

### **Error 405 - Method Not Allowed**
- ✅ Pastikan ada function `doPost(e)` di script
- ✅ Pastikan deployment "Execute as: Me"
- ✅ Re-deploy jika perlu

### **CORS Error**
- ✅ Pastikan "Who has access: Anyone"
- ✅ Jangan gunakan "Only myself"
- ✅ Re-authorize permissions

### **NetworkError/Failed to fetch**
- ✅ Periksa URL format
- ✅ Pastikan script aktif (tidak suspend)
- ✅ Coba akses URL langsung di browser

### **Permission Denied**
- ✅ Re-authorize semua permissions
- ✅ Pastikan Google Drive API enabled
- ✅ Check quota limits

---

## 🧪 **TESTING SEQUENCE:**

### **1. Test Browser Langsung:**
```
1. Buka: https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
2. Harus tampil: HTML page dengan info script
3. Status: ✅ PASS / ❌ FAIL
```

### **2. Test API dengan Postman/curl:**
```bash
curl -X POST "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec" \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### **3. Test dari Web App:**
```
1. Admin Panel → Apps Script Config
2. Masukkan URL
3. Klik "Test Koneksi"
4. Status: ✅ PASS / ❌ FAIL
```

---

## 📝 **CHECKLIST DEPLOYMENT:**

- [ ] Code `apps-script.js` sudah di-copy ke Google Apps Script
- [ ] Project sudah di-save
- [ ] Deployment: Type = "Web app"
- [ ] Deployment: Execute as = "Me"
- [ ] Deployment: Who has access = "Anyone" ⚠️
- [ ] Semua permissions sudah diauthorize
- [ ] Web App URL sudah di-copy
- [ ] URL berhasil diakses di browser
- [ ] Test koneksi dari admin panel berhasil

---

## 🚀 **SETELAH BERHASIL:**

✅ **CORS error hilang**
✅ **Status 405 tidak muncul lagi**
✅ **Test koneksi berhasil**
✅ **Data bisa tersimpan ke Google Sheets**
✅ **Gambar bisa terupload ke Google Drive**

---

## 📞 **Jika Masih Error:**

1. **Check Logs:** Google Apps Script → Execution → View logs
2. **Check Quotas:** Google Cloud Console → APIs & Services → Quotas
3. **Re-deploy:** Buat deployment baru dengan version baru
4. **Check Network:** Pastikan tidak ada firewall/proxy blocking

**URL Script Anda saat ini:**
```
https://script.google.com/macros/s/AKfycbzmUGvJAlgH8_W_O8kPZhYxtWqmUOqXvd7OANXEFfOy0xLRFlq5apFJtYRzJxFdAufFaA/exec
```

Coba langsung akses URL ini di browser untuk memastikan script berjalan! 🎯