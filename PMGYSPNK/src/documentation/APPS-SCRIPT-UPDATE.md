# Update Google Apps Script - Kas GYSPNK v3.0

## 🚀 Fitur Baru yang Ditambahkan

### 1. Google Drive Integration
- **Automatic Image Upload**: Semua bukti gambar otomatis terupload ke Google Drive
- **Folder Organization**: Folder terorganisir dengan struktur:
  ```
  Kas GYSPNK - Bukti Transfer/
  ├── 2024-01/
  ├── 2024-02/
  └── 2024-03/
  ```
- **Smart Naming**: File dinamai dengan format: `bukti_YYYYMMDD_HHMMSS_AMOUNT_USERNAME.jpg`
- **Metadata**: Setiap file memiliki deskripsi lengkap dengan informasi transaksi

### 2. Enhanced Data Structure
- **User Account Info**: Nama user dan status account (Merged/Existing)
- **Transaction Type**: Mendukung berbagai tipe transaksi (payment/income/deduction)
- **Period Tracking**: Bulan dan tahun periode terpisah untuk analisis lebih baik
- **OCR Recipient Detection**: Deteksi penerima transfer dari OCR

### 3. Spreadsheet Improvements
- **Clickable Links**: URL Google Drive menjadi link yang bisa diklik
- **Better Formatting**: Currency formatting untuk rupiah
- **Enhanced Columns**: 22 kolom data lengkap termasuk Drive info
- **Auto Organization**: Data terorganisir dengan color coding

## 📋 Struktur Data Baru

### Kolom Spreadsheet (22 kolom):
1. Timestamp
2. Tanggal Input
3. Email User
4. Nama User
5. Jumlah (Rp)
6. Tipe Transaksi
7. Periode Bulan
8. Periode Tahun
9. Keterangan
10. Bank Tujuan
11. No. Rekening
12. Atas Nama
13. Nama File
14. Ukuran File (bytes)
15. **Google Drive File ID** ⭐ NEW
16. **Google Drive URL** ⭐ NEW (Clickable)
17. **Google Drive Folder** ⭐ NEW
18. OCR Detected Amount
19. **OCR Recipient Match** ⭐ NEW
20. OCR Bank Match
21. Status
22. **User Account Type** ⭐ NEW

### JSON Data yang Didukung:
```json
{
  "userEmail": "user@example.com",
  "userName": "Nama User",
  "amount": 100000,
  "type": "payment",
  "month": 1,
  "year": 2024,
  "description": "Kas bulanan",
  "bank": {
    "name": "BCA",
    "accountNumber": "1234567890",
    "accountName": "Kas RT 01"
  },
  "imageFile": "data:image/jpeg;base64,/9j/4AAQ...", // Base64 image
  "fileName": "bukti.jpg",
  "fileSize": 256000,
  "ocrDetectedAmount": "100000",
  "ocrRecipientMatch": "Kas RT 01",
  "ocrBankMatch": "BCA",
  "user": {
    "name": "Nama User",
    "email": "user@example.com",
    "isNewUser": false
  }
}
```

## 🔧 Fungsi Baru

### `uploadImageToDrive(imageData, transactionData)`
- Upload gambar ke Google Drive
- Buat folder otomatis berdasarkan tanggal
- Return file ID, URL, dan metadata

### `getOrCreateFolder(folderName, parentFolder)`
- Buat atau ambil folder di Google Drive
- Support parent folder untuk struktur nested

### Enhanced `doPost(e)`
- Handle image upload sebelum save ke sheets
- Include Drive info dalam response
- Better error handling

### Enhanced `doGet(e)`
- Info page dengan status script
- API info untuk debugging
- Feature overview

## 📱 Integrasi dengan Web App

### Cara Mengirim Data dengan Gambar:
```javascript
const formData = {
  userEmail: user.email,
  userName: user.name,
  amount: parseInt(amount),
  type: transactionType,
  month: selectedMonth,
  year: selectedYear,
  description: description,
  bank: selectedBank,
  imageFile: base64ImageData, // Base64 string
  fileName: file.name,
  fileSize: file.size,
  // OCR results if available
  ocrDetectedAmount: ocrResult.amount,
  ocrRecipientMatch: ocrResult.recipient,
  ocrBankMatch: ocrResult.bank,
  user: {
    name: user.name,
    email: user.email,
    isNewUser: user.accountMerged || false
  }
};

// Send to Apps Script
fetch(APPS_SCRIPT_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(formData)
});
```

### Response Format:
```json
{
  "success": true,
  "message": "Data berhasil disimpan ke Google Sheets dan gambar berhasil diupload ke Google Drive",
  "rowNumber": 15,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "imageUpload": {
    "success": true,
    "fileId": "1ABC123...",
    "fileName": "bukti_20240115_103000_100000_username.jpg",
    "fileUrl": "https://drive.google.com/file/d/1ABC123.../view",
    "downloadUrl": "https://drive.google.com/uc?id=1ABC123...",
    "folderPath": "Kas GYSPNK - Bukti Transfer/2024-01"
  }
}
```

## 🛠️ Setup Instructions

### 1. Deploy ke Google Apps Script:
1. Copy seluruh kode dari `apps-script.js`
2. Paste ke Google Apps Script project baru
3. Deploy as Web App dengan permissions:
   - Execute as: "Me"
   - Access: "Anyone"
4. Copy Web App URL

### 2. Permissions yang Dibutuhkan:
- ✅ Google Sheets API
- ✅ Google Drive API (Automatic)
- ✅ Script execution permissions

### 3. Testing:
```javascript
// Test dengan doGet
https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?info=true

// Test dengan testDoPost()
// Run fungsi testDoPost() di Apps Script editor
```

## 🎯 Benefits

1. **Audit Trail Lengkap**: Semua bukti gambar tersimpan permanen di Drive
2. **Organization**: File terorganisir rapi berdasarkan tanggal
3. **Accessibility**: Link langsung dari spreadsheet ke file gambar
4. **Storage Efficient**: Duplikasi gambar dicegah otomatis
5. **Metadata Rich**: Setiap file memiliki konteks transaksi lengkap
6. **Account Merging Support**: Kompatibel dengan sistem merger akun
7. **Enhanced Analytics**: Data lebih terstruktur untuk analisis

## 🔄 Migration Notes

- Script otomatis kompatibel dengan data lama
- Kolom baru akan ditambahkan otomatis
- Data existing tetap utuh
- Tidak perlu migration manual

Apps Script sekarang ready untuk handle image upload dan sync dengan form terbaru! 🚀