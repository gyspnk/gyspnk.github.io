# 📖 Google Apps Script Setup Guide - Step by Step

## Overview
This guide will help you set up Google Apps Script to automatically save form submissions to Google Sheets, completely bypassing Google Forms.

---

## 🚀 Step 1: Create Google Sheet

1. **Open Google Sheets**
   - Go to [sheets.google.com](https://sheets.google.com)
   - Click "+" to create a new blank spreadsheet

2. **Name your sheet**
   - Click "Untitled spreadsheet" at the top
   - Rename it to: "Kas Pemuda GYSPNK Data"

3. **Get the Sheet ID**
   - Look at the URL in your browser
   - Copy the long ID between `/d/` and `/edit`
   - Example: `https://docs.google.com/spreadsheets/d/1ABC123xyz456DEF789/edit#gid=0`
   - Sheet ID is: `1ABC123xyz456DEF789`
   - **Save this Sheet ID - you'll need it later!**

---

## 🛠️ Step 2: Create Google Apps Script

1. **Open Google Apps Script**
   - Go to [script.google.com](https://script.google.com)
   - Make sure you're logged in with the same Google account

2. **Create New Project**
   - Click "New project" (blue + button)
   - You'll see a code editor with a default `myFunction()`

3. **Replace the Code**
   - Delete all existing code
   - Copy ALL the code from `apps-script.js` file
   - Paste it into the Apps Script editor

4. **Update the Sheet ID**
   - Find this line: `const GOOGLE_SHEET_ID = 'YOUR_GOOGLE_SHEET_ID';`
   - Replace `YOUR_GOOGLE_SHEET_ID` with your actual Sheet ID from Step 1
   - Example: `const GOOGLE_SHEET_ID = '1ABC123xyz456DEF789';`

5. **Save the Project**
   - Press `Ctrl+S` or click the save icon
   - Name your project: "Kas Pemuda Data Handler"

---

## 🚀 Step 3: Deploy as Web App

1. **Start Deployment**
   - Click "Deploy" button (top right)
   - Select "New deployment"

2. **Configure Deployment**
   - **Type**: Select "Web app" (gear icon)
   - **Execute as**: "Me (your-email@gmail.com)"
   - **Who has access**: "Anyone" 
   - **Description**: "Kas Pemuda Form Handler"

3. **Deploy**
   - Click "Deploy"
   - Google will ask for permissions - click "Authorize access"
   - If you see a warning "This app isn't verified":
     - Click "Advanced"
     - Click "Go to Kas Pemuda Data Handler (unsafe)"
     - Click "Allow"

4. **Copy the Web App URL**
   - After deployment, you'll get a URL like:
   - `https://script.google.com/macros/s/AKfycbxXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/exec`
   - **Copy this URL - you'll need it for your app!**

---

## ⚙️ Step 4: Configure Your Web App

1. **Refresh your localhost app** (http://localhost:8000)

2. **Go to "Setor Kas" section**

3. **Click "⚙️ Setup Apps Script" button**

4. **Paste the Web App URL**
   - Paste the URL you copied from Step 3
   - Click "💾 Simpan URL"

5. **Test the connection**
   - Click "🧪 Test Connection"
   - If successful, you'll see a green success message
   - Check your Google Sheet - you should see a test entry

---

## 🎯 Step 5: Test Complete Integration

1. **Fill out the form**
   - Enter amount: `100000`
   - Select dates
   - Add description: `Test submission`
   - Optionally add an image

2. **Submit the form**
   - Click "Setor" button
   - You should see: "Setor berhasil disimpan dan dikirim ke Google Sheets via Apps Script"

3. **Check Google Sheets**
   - Go back to your Google Sheet
   - You should see a new row with all the form data
   - Data includes: timestamp, email, amount, dates, description

---

## 🔧 Troubleshooting

### ❌ "URL tidak valid" error
- Make sure the URL contains `script.google.com`
- URL should end with `/exec`

### ❌ "Test gagal" error
- Check if you replaced `YOUR_GOOGLE_SHEET_ID` in the Apps Script code
- Make sure the Google Sheet exists and is accessible
- Verify deployment permissions are set to "Anyone"

### ❌ Data not appearing in sheets
- Check the Apps Script logs: Go to script.google.com → your project → "Executions"
- Make sure the sheet name matches: "Kas Pemuda Data"

### ❌ Permission errors
- Re-run the deployment process
- Make sure to authorize all requested permissions

---

## ✅ Success Indicators

- ✅ Apps Script URL saved successfully
- ✅ Test connection returns success
- ✅ Form submission shows green success message  
- ✅ Data appears in Google Sheets with proper formatting
- ✅ Both Firebase and Google Sheets contain the data

---

## 🎉 Benefits of This Approach

✅ **No CORS issues** - Direct server-to-server communication
✅ **100% reliable** - No complex entry ID mapping
✅ **File info capture** - Records file names and sizes
✅ **Automatic formatting** - Clean, organized data in sheets
✅ **Dual storage** - Data in both Firebase (for app) and Sheets (for analysis)
✅ **Easy maintenance** - All data management in familiar Google Sheets interface

---

## 📞 Need Help?

If you encounter any issues:
1. Check the troubleshooting section above
2. Verify all steps were followed exactly
3. Check Google Apps Script execution logs
4. Make sure all permissions are granted

The setup should take about 10-15 minutes total once you have all the pieces in place!