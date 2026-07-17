async function showSetInitialBalanceModal({ uid, name, currentBalance, currentYear }) {
    const content = `
        <p class="muted" style="margin:0 0 16px 0;">${name}</p>
        <div class="row">
            <div class="col">
                <label>Mulai Tahun</label>
                <div class="field"><select id="initialBalanceYearInput">
                    ${generateYearOptions(currentYear)}
                </select></div>
            </div>
            <div class="col">
                <label>Saldo Awal (Rp)</label>
                <div class="field"><input id="initialBalanceAmountInput" type="text" inputmode="numeric" placeholder="0" value="${currentBalance.toLocaleString('id-ID')}"></div>
            </div>
        </div>
        <div style="display:flex; gap:12px; margin-top:12px;">
            <button class="btn btn-filled" id="saveInitialBalanceBtn"><i class="fas fa-save"></i> Simpan</button>
            <button class="btn btn-outlined" id="cancelInitialBalanceBtn"><i class="fas fa-times"></i> Batal</button>
        </div>
    `;

    const { close } = createModal({ 
        title: 'Set Saldo Awal Titipan', 
        content,
        onClose: () => renderUserManagement()
    });

    const amtInput = qs('#initialBalanceAmountInput');
    const formatAmt = () => {
        const raw = amtInput.value.replace(/\D/g,'');
        amtInput.value = raw ? Number(raw).toLocaleString('id-ID') : '';
    };
    amtInput.addEventListener('input', formatAmt);

    qs('#cancelInitialBalanceBtn').onclick = close;
    qs('#saveInitialBalanceBtn').onclick = async () => {
        const newYear = parseInt(qs('#initialBalanceYearInput').value, 10);
        const newBalance = Number(amtInput.value.replace(/\D/g,''));
        
        if (!validators.year(newYear)) return showToast('Tahun tidak valid.', 'error');
        if (!validators.amount(newBalance)) return showToast('Jumlah tidak valid.', 'error');
        
        try {
            await updateUser(uid, { initialBalance: newBalance, initialBalanceYear: newYear });
            await processInitialBalance(uid, newBalance, newYear);
            showToast('Saldo awal berhasil diperbarui.', 'success');
            close();
        } catch (error) {
            handleError(error, 'Gagal mengatur saldo awal');
        }
    };
}

async function showPaymentStartOverrideModal({ uid, name }) {
    // Get current user overrides and global settings
    const userOverride = await getUserPaymentStartOverride(uid);
    const globalSettings = await getContributionSettings();
    const availableYears = Object.keys(globalSettings).map(Number).sort((a, b) => a - b);
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    
    const content = `
        <p class="muted" style="margin:0 0 16px 0;">${name}</p>
        <p class="muted" style="margin:0 0 16px 0; font-size: 0.9rem;">
            Set bulan mulai pembayaran khusus untuk user ini. Jika tidak diset, akan menggunakan pengaturan global admin.
        </p>
        
        <div id="override-container">
            ${availableYears.map(year => {
                const globalMonth = parseInt(globalSettings[year]) || 1;
                const userMonth = userOverride[year] ? parseInt(userOverride[year]) : null;
                return `
                    <div class="row override-row" style="margin-bottom: 12px; align-items: center;">
                        <div class="col" style="flex: 0 0 60px;">
                            <label style="font-weight: 500;">${year}</label>
                        </div>
                        <div class="col" style="flex: 1;">
                            <div class="field">
                                    <select data-year="${year}" class="override-select">
                                        <option value="">Gunakan Default (${months[globalMonth - 1]})</option>
                                        ${generateMonthOptions(months, userMonth)}
                                    </select>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        
        <div style="display:flex; gap:12px; margin-top:20px; justify-content: flex-end;">
            <button class="btn btn-outlined" id="cancelOverrideBtn"><i class="fas fa-times"></i> Batal</button>
            <button class="btn btn-filled" id="saveOverrideBtn"><i class="fas fa-save"></i> Simpan Override</button>
        </div>
    `;

    const { close } = createModal({ 
        title: 'Override Bulan Mulai Pembayaran', 
        content,
        maxWidth: '640px',
        onClose: () => renderUserManagement()
    });

    qs('#cancelOverrideBtn').onclick = close;

    qs('#saveOverrideBtn').onclick = async () => {
        try {
            const newOverrides = {};
            qsa('.override-select').forEach(select => {
                const year = select.dataset.year;
                const value = select.value;
                if (value) {
                    newOverrides[year] = parseInt(value);
                }
            });
            
            await updateUserPaymentStartOverride(uid, newOverrides);
            showToast('Override bulan mulai pembayaran berhasil disimpan.', 'success');
            close();
        } catch (error) {
            handleError(error, 'Gagal menyimpan override');
        }
    };
}

// ==========================================================================
// Firebase Setup
// ==========================================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy, getDoc, setDoc, Timestamp, deleteField } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyAtmzeYt2gtl_veyugqjaUl7uiUp62RP60",
    authDomain: "kaspemudagyspnk.firebaseapp.com",
    projectId: "kaspemudagyspnk",
    storageBucket: "kaspemudagyspnk.firebasestorage.app",
    messagingSenderId: "50641754630",
    appId: "1:50641754630:web:a6d08ce2b164e575154187",
    measurementId: "G-VFD8760GSH"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const provider = new GoogleAuthProvider();
const ADMIN_EMAIL = 'thengilbert@gmail.com';

// Global State
let selectedYear = new Date().getUTCFullYear();
let allUsersCache = [];
let allBanksCache = [];
let globalClickListener = null;
let allTransactionsCache = []; // Cache for all transactions to speed up calculations


// ==========================================================================
// UI Helpers & DOM Manipulation
// ==========================================================================
const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));
const appElement = qs('#app');
const money = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

// Modal Factory - Reusable modal creation
function createModal({ title, content, maxWidth = '540px', onClose = null }) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop user-history entering';
    modal.innerHTML = `
        <div class="card" style="width:90%; max-width:${maxWidth};">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <h3 style="margin:0;">${title}</h3>
                <button class="image-modal-close" id="closeModal"><i class="fas fa-times"></i></button>
            </div>
            ${content}
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.remove('entering'), 300);

    const close = () => { 
        modal.classList.add('exiting'); 
        setTimeout(() => modal.remove(), 250);
        if (onClose) onClose();
    };
    
    qs('#closeModal').onclick = close;
    modal.onclick = (e) => { if(e.target === modal) close(); };
    
    return { modal, close };
}

// Error Handler Factory - Centralized error handling
function handleError(error, context = '', customMessage = null) {
    console.error(`${context}:`, error);
    
    if (customMessage) {
        showToast(customMessage, 'error');
        return;
    }
    
    if (error.code === 'permission-denied' || error.code === 'PERMISSION_DENIED') {
        showToast('Gagal: Izin ditolak. Pastikan aturan keamanan Firestore sudah diperbarui.', 'error', 5000);
    } else {
        showToast(`Terjadi kesalahan: ${error.message}`, 'error');
    }
}

// Async wrapper with error handling
async function safeAsync(fn, context = '', customErrorMsg = null) {
    try {
        return await fn();
    } catch (error) {
        handleError(error, context, customErrorMsg);
        throw error;
    }
}

// Validation Helpers
const validators = {
    year: (year) => year && year >= 2000 && year <= 3000,
    amount: (amount) => !isNaN(amount) && amount > 0,
    required: (value) => value && (typeof value === 'string' ? value.trim() !== '' : !!value),
    file: (file) => file && file.size <= 5 * 1024 * 1024,
    image: (file) => file && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type),
    minAmount: (amount, min = 10000) => !isNaN(amount) && amount >= min
};

// Validation with error messages
function validateForm(fields) {
    for (const [field, value, validator, errorMsg] of fields) {
        if (!validator(value)) {
            showToast(errorMsg, 'error');
            return false;
        }
    }
    return true;
}

// HTML Generation Helpers
function generateYearOptions(currentYear, range = 5) {
    return Array.from({length: range * 2 + 1}, (_, i) => currentYear - range + i)
        .map(year => `<option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>`)
        .join('');
}

function generateMonthOptions(months, selectedMonth = null) {
    return months.map((month, i) => 
        `<option value="${i + 1}" ${selectedMonth === (i + 1) ? 'selected' : ''}>${month}</option>`
    ).join('');
}

function generateSelectOptions(options, valueKey = 'value', textKey = 'text', selectedValue = null) {
    return options.map(option => {
        const value = typeof option === 'object' ? option[valueKey] : option;
        const text = typeof option === 'object' ? option[textKey] : option;
        const selected = selectedValue === value ? 'selected' : '';
        return `<option value="${value}" ${selected}>${text}</option>`;
    }).join('');
}
const toDate = (timestamp) => {
    if (!timestamp) return new Date();
    if (timestamp.toDate) return timestamp.toDate();
    if (timestamp instanceof Date) return timestamp;
    return new Date(timestamp);
}

// Date formatting functions for tables
const formatFullDate = (timestamp) => {
    const date = toDate(timestamp);
    return new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    }).format(date);
};

// Responsive date formatting - compact format for smaller screens
const formatResponsiveDate = (timestamp) => {
    const date = toDate(timestamp);
    const isSmallScreen = window.innerWidth <= 768;
    
    if (isSmallScreen) {
        // DD MMM YY format for small screens (e.g., "23 Sep 25")
        return new Intl.DateTimeFormat('en-GB', {
            day: '2-digit',
            month: 'short',
            year: '2-digit'
        }).format(date);
    } else {
        // Full format for larger screens
        return formatFullDate(timestamp);
    }
};

// Function to refresh table content when screen size changes (without full re-render)
let resizeTimeout;
function handleResponsiveDateResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Update date/period formats in existing tables without full re-render
        updateTableDateFormats();
    }, 250);
}

// Function to update date formats in existing tables
function updateTableDateFormats() {
    // Update all date cells in tables
    const dateCells = qsa('td[data-date]');
    dateCells.forEach(cell => {
        const originalDate = cell.getAttribute('data-date');
        if (originalDate && originalDate !== 'N/A') {
            try {
                // Parse and reformat the date
                const date = new Date(originalDate);
                if (!isNaN(date.getTime())) {
                    cell.textContent = formatResponsiveDate(date);
                }
            } catch (e) {
                // Keep original text if parsing fails
            }
        }
    });

    // Update all period cells in tables - handle both simple and chip formats
    const periodCells = qsa('td[data-period]');
    periodCells.forEach(cell => {
        const originalPeriod = cell.getAttribute('data-period');
        if (originalPeriod && originalPeriod !== 'N/A') {
            // Check if cell contains chip structure
            const chipPeriod = cell.querySelector('.chip-period');
            if (chipPeriod) {
                // Update the chip period format
                const periodLines = chipPeriod.querySelectorAll('.period-line');
                const periods = originalPeriod.split(' → ');
                if (periods.length >= 2 && periodLines.length >= 2) {
                    periodLines[0].textContent = formatResponsivePeriod(periods[0]);
                    periodLines[1].textContent = formatResponsivePeriod(periods[1]);
                }
            } else {
                // Simple text format - update the entire cell content
                const periods = originalPeriod.split(' → ');
                if (periods.length >= 2) {
                    cell.textContent = `${formatResponsivePeriod(periods[0])} → ${formatResponsivePeriod(periods[1])}`;
                } else {
                    cell.textContent = formatResponsivePeriod(originalPeriod);
                }
            }
        }
    });
}

// Add resize listener for responsive date formatting
window.addEventListener('resize', handleResponsiveDateResize);

// Responsive period formatting - compact format for smaller screens
const formatResponsivePeriod = (periodStr) => {
    if (!periodStr) return 'N/A';
    
    const isSmallScreen = window.innerWidth <= 768;
    
    if (isSmallScreen) {
        // Convert "MMM YYYY" to "MMM YY" format (e.g., "Jul 2025" → "Jul 25")
        return periodStr.replace(/(\w{3}) (\d{4})/g, (match, month, year) => {
            return `${month} ${year.slice(-2)}`;
        });
    } else {
        // Keep full format for larger screens
        return periodStr;
    }
};

// Get responsive arrow direction for period chips
const getResponsiveArrow = () => {
    const isWideScreen = window.innerWidth > 768;
    return isWideScreen ? '<i class="fas fa-arrow-right"></i>' : '<i class="fas fa-arrow-down"></i>';
};

// Keep CSS variable in sync with actual app bar height to prevent overlap
function updateAppbarHeightVariable() {
    const appbar = qs('.appbar');
    if (!appbar) return;
    const height = Math.round(appbar.getBoundingClientRect().height || 60);
    document.documentElement.style.setProperty('--appbar-h', `${height}px`);
}

// Initialize header height observer
(function initAppbarHeightObserver() {
    // Initial set after next frame to ensure fonts/styles applied
    requestAnimationFrame(updateAppbarHeightVariable);

    // Resize observer for dynamic changes (e.g., year filter shown/hidden)
    const appbar = qs('.appbar');
    if (window.ResizeObserver && appbar) {
        const ro = new ResizeObserver(() => updateAppbarHeightVariable());
        ro.observe(appbar);
    }

    // Also update on window resize/orientation changes
    let resizeThrottle;
    window.addEventListener('resize', () => {
        if (resizeThrottle) return;
        resizeThrottle = setTimeout(() => {
            resizeThrottle = null;
            updateAppbarHeightVariable();
            // Update CSS --vh unit for mobile viewport height
            const vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', `${vh}px`);
        }, 150);
    });
    // Initial --vh set
    const setVh = () => {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    setVh();
    window.addEventListener('orientationchange', () => {
        setTimeout(setVh, 250);
    });
})();

const formatPeriodDate = (timestamp) => {
    const date = toDate(timestamp);
    return new Intl.DateTimeFormat('id-ID', {
        month: 'long',
        year: 'numeric'
    }).format(date);
};

// Helper function to parse period strings (supports both old and new formats)
const parsePeriod = (periodStr) => {
    if (!periodStr) return { month: null, year: null };
    
    // Check if it's the old format (MM/YYYY)
    if (periodStr.includes('/')) {
        const [month, year] = periodStr.split('/').map(Number);
        return { month, year };
    }
    
    // New format (MMM YYYY)
    const monthAbbrevs = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    const parts = periodStr.split(' ');
    if (parts.length >= 2) {
        const monthIndex = monthAbbrevs.indexOf(parts[0]);
        const year = parseInt(parts[1]);
        return { month: monthIndex + 1, year };
    }
    
    return { month: null, year: null };
};

// Google Drive URL utilities
const GOOGLE_DRIVE_REGEX = /drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/;

function getGoogleDriveFileId(driveUrl) {
    if (!driveUrl || typeof driveUrl !== 'string') return null;
    const match = driveUrl.match(GOOGLE_DRIVE_REGEX);
    return match ? match[1] : null;
}

function getGoogleDriveEmbedUrl(driveUrl) {
    if (!driveUrl || typeof driveUrl !== 'string') return '';
    const fileId = getGoogleDriveFileId(driveUrl);
    if (fileId) {
        return `https://drive.google.com/uc?export=view&id=${fileId}`;
    }
    return driveUrl.replace('/view', '/preview').replace('?usp=drivesdk', '');
}

function getGoogleDriveThumbnail(driveUrl) {
    if (!driveUrl || typeof driveUrl !== 'string') return '';
    const fileId = getGoogleDriveFileId(driveUrl);
    if (fileId) {
        return `https://lh3.googleusercontent.com/d/${fileId}=s220`; // s220 is a good thumbnail size
    }
    return driveUrl;
}

function getGoogleDriveFullImage(driveUrl) {
    return getGoogleDriveEmbedUrl(driveUrl);
}

// Show simulated progress for cached images
async function showSimulatedProgress(progressFill, progressText) {
    return new Promise((resolve) => {
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 25 + 15; // Fast progress: 15-40% per step
            progress = Math.min(progress, 100);
            
            if (progressFill) {
                progressFill.style.width = `${Math.round(progress)}%`;
                progressFill.style.display = 'block';
                progressFill.style.visibility = 'visible';
                progressFill.style.opacity = '1';
                progressFill.style.height = '100%';
                // Force reflow to ensure visibility
                progressFill.offsetHeight;
            }
            if (progressText) {
                progressText.textContent = `${Math.round(progress)}%`;
                progressText.style.display = 'block';
                progressText.style.visibility = 'visible';
                progressText.style.opacity = '1';
                progressText.style.zIndex = '101';
                progressText.style.position = 'relative';
            }
            
            if (progress >= 100) {
                clearInterval(interval);
                setTimeout(resolve, 100); // Small delay at 100%
            }
        }, 50); // Fast 50ms intervals for cached images
    });
}

// Fetch image as base64 from Apps Script with detailed progress tracking
async function fetchImageFromAppsScript(fileId, onProgress = null) {
    try {
        onProgress && onProgress(5, 'Memulai...');

        const appsScriptUrl = await getAppSettings().then(settings => settings.appsScriptUrl);
        if (!appsScriptUrl) {
            throw new Error('Apps Script URL not configured');
        }

        onProgress && onProgress(10, 'Menyiapkan request...');

        const url = `${appsScriptUrl}?action=getImage&fileId=${fileId}`;

        // Use XMLHttpRequest for better progress tracking
        const xhr = new XMLHttpRequest();
        let progressTimeout;
        let currentProgress = 15;

        return new Promise((resolve, reject) => {
            xhr.open('GET', url, true);

            // Start progress simulation immediately
            if (!progressTimeout) {
                progressTimeout = setInterval(() => {
                    currentProgress = Math.min(currentProgress + Math.random() * 15 + 5, 80);
                    onProgress && onProgress(Math.round(currentProgress), `Mengunduh... ${Math.round(currentProgress)}%`);
                    if (currentProgress >= 80) {
                        clearInterval(progressTimeout);
                    }
                }, 300);
            }

            xhr.onprogress = (event) => {
                if (event.lengthComputable) {
                    // Calculate download progress (20% - 80% of total)
                    const downloadProgress = Math.round((event.loaded / event.total) * 60) + 20;
                    currentProgress = Math.max(currentProgress, downloadProgress);
                    onProgress && onProgress(currentProgress, `Mengunduh... ${Math.round((event.loaded / event.total) * 100)}%`);
                    
                    // Clear timeout if we have real progress
                    if (progressTimeout) {
                        clearInterval(progressTimeout);
                        progressTimeout = null;
                    }
                }
            };

            xhr.onloadstart = () => {
                onProgress && onProgress(15, 'Memulai unduhan...');
            };

            xhr.onload = async () => {
                try {
                    // Clear any remaining timeout
                    if (progressTimeout) {
                        clearInterval(progressTimeout);
                        progressTimeout = null;
                    }
                    
                    onProgress && onProgress(85, 'Memproses response...');

                    if (xhr.status !== 200) {
                        throw new Error(`HTTP ${xhr.status}: ${xhr.statusText}`);
                    }

                    const data = JSON.parse(xhr.responseText);
                    onProgress && onProgress(90, 'Mengkonversi data...');
                    
                    await new Promise(resolve => setTimeout(resolve, 200));

                    if (data.success && data.base64Data) {
                        onProgress && onProgress(95, 'Finalisasi...');
                        await new Promise(resolve => setTimeout(resolve, 200));

                        onProgress && onProgress(100, 'Selesai');
                        await new Promise(resolve => setTimeout(resolve, 100));

                        resolve({
                            success: true,
                            dataUrl: `data:${data.mimeType};base64,${data.base64Data}`,
                            fileName: data.fileName,
                            mimeType: data.mimeType
                        });
                    } else {
                        throw new Error(data.error || 'Failed to fetch image');
                    }
                } catch (error) {
                    reject(error);
                }
            };

            xhr.onerror = () => {
                reject(new Error('Network error occurred'));
            };

            xhr.timeout = 30000; // 30 second timeout
            xhr.ontimeout = () => {
                reject(new Error('Request timed out'));
            };

            xhr.send();
        });

    } catch (error) {
        console.error('❌ fetchImageFromAppsScript error:', error);
        throw error;
    }
}

// Pre-load image for display in table
async function preloadImageForDisplay(driveUrl) {
    const fileId = getGoogleDriveFileId(driveUrl);
    if (!fileId) return null;
    
    const cacheKey = `image_${fileId}`;
    let imageData = sessionStorage.getItem(cacheKey);
    
    if (!imageData) {
        const result = await fetchImageFromAppsScript(fileId);
        if (result.success) {
            imageData = result.dataUrl;
            sessionStorage.setItem(cacheKey, imageData);
        }
    }
    
    return imageData;
}

// Create image element with pre-loaded data
function createProofImageElement(driveUrl, maxWidth = 200, maxHeight = 150) {
    const container = document.createElement('div');
    container.className = 'proof-image-container';
    container.style.cssText = `
        position: relative;
        display: inline-block;
        width: ${maxWidth}px;
        height: ${maxHeight}px;
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--radius-md);
        overflow: hidden;
        cursor: pointer;
        background: var(--md-surface-container);
    `;
    
    const img = document.createElement('img');
    img.className = 'proof-image';
    img.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: none;
    `;
    img.dataset.fullUrl = driveUrl;
    img.alt = 'bukti';
    img.style.display = 'none'; // Initially hidden for animation
    
    const loading = document.createElement('div');
    loading.className = 'image-loading';
    loading.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: var(--md-on-surface);
        font-size: 12px;
        font-weight: 500;
        text-align: center;
        z-index: 100;
        pointer-events: none;
        background: var(--md-surface-container-high);
        padding: 12px;
        border-radius: 8px;
        border: 1px solid var(--md-outline);
    `;
    
    // Add progress bar for image loading
    const progressBar = document.createElement('div');
    progressBar.className = 'image-progress-bar';
    progressBar.style.cssText = `
        width: 80px;
        height: 6px;
        background-color: var(--md-surface-variant);
        border-radius: 3px;
        overflow: hidden;
        border: 1px solid var(--md-outline);
        position: relative;
        margin: 4px 0;
        opacity: 1;
        visibility: visible;
        display: block;
    `;
    
    const progressFill = document.createElement('div');
    progressFill.className = 'image-progress-fill';
    progressFill.style.cssText = `
        height: 100%;
        background: linear-gradient(90deg, #00C851, #007E33);
        border-radius: 2px;
        width: 0%;
        transition: width 0.3s ease;
        position: absolute;
        top: 0;
        left: 0;
        opacity: 1;
        visibility: visible;
        box-shadow: 0 2px 4px rgba(0, 200, 81, 0.3);
    `;
    
    const progressText = document.createElement('div');
    progressText.className = 'image-progress-text';
    progressText.style.cssText = `
        font-size: 12px;
        color: var(--md-on-surface);
        margin-top: 6px;
        font-weight: 600;
        text-shadow: 0 1px 2px var(--md-shadow);
        background: var(--md-surface);
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid var(--md-outline);
    `;
    progressText.textContent = '0%';
    
    // Ensure elements are visible from start (setor kas approach)
    progressBar.style.display = 'block';
    progressBar.style.visibility = 'visible';
    progressBar.style.opacity = '1';
    progressFill.style.display = 'block';
    progressFill.style.visibility = 'visible';
    progressFill.style.opacity = '1';
    progressFill.style.height = '100%';
    progressFill.style.width = '0%';
    progressText.style.display = 'block';
    progressText.style.visibility = 'visible';
    progressText.style.opacity = '1';
    progressText.style.zIndex = '101';
    
    // Force reflow to ensure visibility (setor kas approach)
    progressFill.offsetHeight;
    progressText.offsetHeight;
    
    progressBar.appendChild(progressFill);
    loading.appendChild(progressBar);
    loading.appendChild(progressText);
    
    container.appendChild(img);
    container.appendChild(loading);
    
    // Load the image with progress tracking
    const loadImageWithProgress = async () => {
        // Show loading overlay
        loading.style.display = 'flex';
        
        console.log('🎯 Loading overlay details:', {
            display: loading.style.display,
            visibility: loading.style.visibility,
            opacity: loading.style.opacity,
            rect: loading.getBoundingClientRect(),
            containerRect: container.getBoundingClientRect(),
            progressBar: !!progressBar,
            progressFill: !!progressFill,
            progressText: !!progressText
        });

        console.log('🎯 Loading overlay should be visible:', {
            display: loading.style.display,
            zIndex: loading.style.zIndex,
            position: loading.style.position,
            rect: loading.getBoundingClientRect(),
            containerRect: container.getBoundingClientRect()
        });

        const fileId = getGoogleDriveFileId(driveUrl);
        if (!fileId) {
            console.error('❌ No fileId found for URL:', driveUrl);
            progressFill.style.backgroundColor = 'var(--md-danger)';
            progressFill.style.width = '100%';
            progressText.textContent = 'Error';
            progressText.style.color = 'var(--md-danger)';
            
            // Show error state for 2 seconds then fade out
            setTimeout(() => {
                loading.classList.add('exit');
                progressBar.classList.add('exit');
                setTimeout(() => {
                    loading.style.display = 'none';
                }, 300);
            }, 2000);
            return;
        }
        
        const cacheKey = `image_${fileId}`;
        let imageData = sessionStorage.getItem(cacheKey);
        
        // Check if image is cached
        if (imageData) {
            // Show simulated progress for cached images
            await showSimulatedProgress(progressFill, progressText);
            img.src = imageData;
            img.onload = () => {
                // Trigger exit animation for loading overlay
                loading.classList.add('exit');
                progressBar.classList.add('exit');
                
                setTimeout(() => {
                    loading.style.display = 'none';
                    img.classList.add('proof-image-entry');
                    img.style.display = 'block';
                }, 300); // Wait for exit animation to complete
            };
            return;
        }
        
        // Fetch from server with progress
        try {
            const result = await fetchImageFromAppsScript(fileId, (progress, message) => {
                // Force update progress bar with immediate visibility (setor kas approach)
                if (progressFill) {
                    progressFill.style.width = `${progress}%`;
                    progressFill.style.display = 'block';
                    progressFill.style.visibility = 'visible';
                    progressFill.style.opacity = '1';
                    progressFill.style.height = '100%';
                    // Force reflow to ensure visibility (setor kas approach)
                    progressFill.offsetHeight;
                }
                if (progressText) {
                    progressText.textContent = `${progress}%`;
                    progressText.style.display = 'block';
                    progressText.style.visibility = 'visible';
                    progressText.style.opacity = '1';
                    progressText.style.zIndex = '101';
                    progressText.style.position = 'relative';
                }

                // Ensure loading overlay stays visible
                loading.style.display = 'flex';
            });
            if (result.success) {
                progressFill.style.width = '100%';
                progressText.textContent = '100%';
                imageData = result.dataUrl;
                sessionStorage.setItem(cacheKey, imageData);
                img.src = imageData;
                img.onload = () => {
                    // Trigger exit animation for loading overlay
                    loading.classList.add('exit');
                    progressBar.classList.add('exit');
                    
                    setTimeout(() => {
                        loading.style.display = 'none';
                        img.classList.add('proof-image-entry');
                        img.style.display = 'block';
                    }, 300); // Wait for exit animation to complete
                };
            } else {
                console.error('❌ Image fetch failed:', result.error);
                progressFill.style.backgroundColor = 'var(--md-danger)';
                progressFill.style.width = '100%';
                progressText.textContent = 'Error';
                progressText.style.color = 'var(--md-danger)';
                
                // Show error state for 2 seconds then fade out
                setTimeout(() => {
                    loading.classList.add('exit');
                    progressBar.classList.add('exit');
                    setTimeout(() => {
                        loading.style.display = 'none';
                    }, 300);
                }, 2000);
            }
        } catch (error) {
            console.error('❌ Image load error:', error);
            progressFill.style.backgroundColor = 'var(--md-danger)';
            progressFill.style.width = '100%';
            progressText.textContent = 'Error';
            progressText.style.color = 'var(--md-danger)';
            
            // Show error state for 2 seconds then fade out
            setTimeout(() => {
                loading.classList.add('exit');
                progressBar.classList.add('exit');
                setTimeout(() => {
                    loading.style.display = 'none';
                }, 300);
            }, 2000);
        }
    };
    
    loadImageWithProgress();
    
    // Add click handler for modal
    container.onclick = () => {
        const fileId = getGoogleDriveFileId(driveUrl);
        if (fileId) {
            const cacheKey = `image_${fileId}`;
            const cachedData = sessionStorage.getItem(cacheKey);
            if (cachedData) {
                // Use cached data directly with animation
                showImageModal(cachedData, false);
            } else {
                // Fallback to proxy loading with animation
                showImageModalWithProxy(driveUrl);
            }
        }
    };
    
    return container;
}

// Helper function to create proof image HTML for templates
function createProofImageHTML(driveUrl, maxWidth = 200, maxHeight = 150) {
    if (!driveUrl) return '—';
    
    const containerId = `proof-container-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create the element asynchronously
    setTimeout(() => {
        const container = document.getElementById(containerId);
        if (container) {
            const imgElement = createProofImageElement(driveUrl, maxWidth, maxHeight);
            container.innerHTML = '';
            container.appendChild(imgElement);
        }
    }, 100); // Increase delay to ensure DOM is ready
    
    return `<div id="${containerId}" class="proof-placeholder" style="width: ${maxWidth}px; height: ${maxHeight}px; display: flex; align-items: center; justify-content: center; background: var(--md-surface-container); border: 1px solid var(--md-outline-variant); border-radius: var(--radius-md);"><div style="color: var(--md-on-surface-variant); font-size: 12px;">Loading image...</div></div>`;
}

// Display image from Google Drive URL with Apps Script proxy
async function displayImageFromProxy(driveUrl, imgElement, spinnerElement, onSuccess = null) {
    if (!driveUrl || !imgElement) return;
    
    // Show spinner
    if (spinnerElement) {
        spinnerElement.style.display = 'flex';
    }
    imgElement.style.display = 'none';
    
    try {
        const fileId = getGoogleDriveFileId(driveUrl);
        if (!fileId) {
            throw new Error('Invalid Google Drive URL');
        }
        
        // Check if we already have the base64 data cached
        const cacheKey = `image_${fileId}`;
        let imageData = sessionStorage.getItem(cacheKey);
        
        if (!imageData) {
            // Fetch from Apps Script
            const result = await fetchImageFromAppsScript(fileId);
            if (!result.success) {
                throw new Error(result.error);
            }
            imageData = result.dataUrl;
            // Cache the base64 data
            sessionStorage.setItem(cacheKey, imageData);
        }
        
        // Set the image source
        imgElement.src = imageData;
        imgElement.onload = () => {
            if (spinnerElement) {
                spinnerElement.style.display = 'none';
            }
            imgElement.style.display = 'block';
            
            // Call success callback if provided
            if (onSuccess && typeof onSuccess === 'function') {
                onSuccess();
            }
        };
        imgElement.onerror = () => {
            showImageError(imgElement, spinnerElement, 'Failed to load image from server');
        };
        
    } catch (error) {
        console.error('Error loading image:', error);
        showImageError(imgElement, spinnerElement, `Image loading failed: ${error.message}`);
    }
}

function showImageError(imgElement, spinnerElement, message) {
    if (spinnerElement) {
        spinnerElement.style.display = 'none';
    }
    imgElement.style.display = 'none';
    
    // Create error message element
    const errorDiv = document.createElement('div');
    errorDiv.className = 'image-error-message';
    errorDiv.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--md-error); background: var(--md-error-container); border-radius: 8px;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style="margin-bottom: 12px; opacity: 0.7;">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
            <p style="margin: 0; font-weight: 500;">${message}</p>
            <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.8;">The image may be private or blocked by browser security policies.</p>
        </div>
    `;
    
    // Replace image with error message
    imgElement.parentNode.replaceChild(errorDiv, imgElement);
}


// Global state for transition
let isTransitioning = false;

async function smoothTransition(renderFunction) {
    const panel = qs('#panel');
    if (!panel || isTransitioning) {
        return await renderFunction();
    }
    
    if (globalClickListener) {
        document.removeEventListener('click', globalClickListener);
        globalClickListener = null;
    }

    isTransitioning = true;
    
    try {
        panel.classList.remove('fade-in');
        panel.classList.add('fade-out');
        await new Promise(resolve => setTimeout(resolve, 150));
        
        panel.innerHTML = '';
        await renderFunction();
        
        panel.offsetHeight; 
        
        panel.classList.remove('fade-out');
        panel.classList.add('fade-in');
        
        await new Promise(resolve => setTimeout(resolve, 400));
    } catch (error) {
        console.error("Transition failed:", error);
        if (error.code === 'permission-denied') {
            showToast('Gagal memuat: Izin ditolak. Pastikan aturan keamanan Firestore sudah diperbarui.', 'error', 5000);
        }
        await renderFunction(); 
    } finally {
        isTransitioning = false;
    }
}

function showToast(message, type = 'info', duration = 3000) {
    const container = qs('#toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
}

function formatNumberInput(input) {
    if (!input) return;
    let value = input.value.replace(/\D/g, '');
    input.value = value ? parseInt(value, 10).toLocaleString('id-ID') : '';
}

function updateActiveMenu(activeMenuId) {
    qsa('.nav-item').forEach(btn => {
        // Don't remove active state from theme toggle button
        if (btn.id !== 'themeToggle') {
            btn.classList.remove('active');
        }
    });
    const activeBtn = qs(`#${activeMenuId}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
}

function setupSidebar() {
    const sidebarToggle = qs('#sidebarToggle');
    const sidebar = qs('#sidebar');
    const overlay = qs('#sidebarOverlay');
    const mainContent = qs('#mainContent');
    
    if (!sidebarToggle || !sidebar || !overlay || !mainContent) return;

    // Dynamically size sidebar to full document height (not just viewport)
    const updateSidebarHeight = () => {
        const appbar = qs('.appbar');
        const headerHeight = appbar ? appbar.offsetHeight : 0;
        const docEl = document.documentElement;
        const body = document.body;
        const docHeight = Math.max(
            body.scrollHeight, body.offsetHeight,
            docEl.clientHeight, docEl.scrollHeight, docEl.offsetHeight
        );
        const target = Math.max(0, docHeight - headerHeight);
        sidebar.style.height = `${target}px`;
    };
    
    // Observe DOM changes to keep height in sync with content
    const mo = new MutationObserver(() => {
        // Debounce with microtask
        Promise.resolve().then(updateSidebarHeight);
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', updateSidebarHeight);
    window.addEventListener('load', updateSidebarHeight);
    // Initial sizing
    updateSidebarHeight();

    // Move the year filter between header and sidebar based on orientation (portrait -> navbar/sidebar)
    const yearContainer = qs('#year-filter-container');
    const appbar = qs('.appbar');
    const sidebarContent = qs('#sidebar .sidebar-content');

    const relocateYearFilter = () => {
        if (!yearContainer) return;
        const isSmallScreen = window.innerWidth <= 768;
        
        if (isSmallScreen) {
            // Move to navbar area (below header) on small screens
            const mainContent = qs('#mainContent');
            if (mainContent && !mainContent.contains(yearContainer)) {
                yearContainer.style.display = 'flex';
                yearContainer.style.margin = '8px 12px 0 12px';
                mainContent.insertBefore(yearContainer, mainContent.firstChild);
            }
        } else {
            // Keep in header on larger screens
            if (appbar && !appbar.contains(yearContainer)) {
                yearContainer.style.margin = '';
                appbar.insertBefore(yearContainer, appbar.lastChild);
            }
        }
    };
    relocateYearFilter();
    window.addEventListener('resize', relocateYearFilter);
    
    // Toggle sidebar
    function toggleSidebar() {
        const isOpen = sidebar.classList.contains('open');
        
        if (isOpen) {
            // Close sidebar
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
            mainContent.classList.remove('sidebar-open');
            document.body.classList.remove('no-scroll');
        } else {
            // Open sidebar
            sidebar.classList.add('open');
            if (window.innerWidth <= 1024) {
                overlay.classList.add('visible');
                // Lock background scroll so sidebar position is stable
                document.body.classList.add('no-scroll');
            } else {
                mainContent.classList.add('sidebar-open');
            }
        }
        
        // Ensure logout button is visible when sidebar is opened
        showLogoutButton();
    }
    
    // Close sidebar
    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible'); 
        mainContent.classList.remove('sidebar-open');
        document.body.classList.remove('no-scroll');
    }
    
    // Event listeners
    sidebarToggle.addEventListener('click', toggleSidebar);
    overlay.addEventListener('click', closeSidebar);
    
    // Note: Sidebar closing for nav-items is now handled in the individual menu button onclick handlers
    // This prevents timing conflicts between addEventListener and onclick assignment
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (window.innerWidth > 1024) {
            overlay.classList.remove('visible');
            if (sidebar.classList.contains('open')) {
                mainContent.classList.add('sidebar-open');
            }
        } else {
            mainContent.classList.remove('sidebar-open');
            if (sidebar.classList.contains('open')) {
                overlay.classList.add('visible');
            }
        }
    });
    
    // Initialize - sidebar closed by default
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    mainContent.classList.remove('sidebar-open');
}

// ==========================================================================
// Theme Modal Functions
// ==========================================================================

function setupThemeModal() {
    const themeModal = qs('#themeModalBackdrop');
    const themeModalClose = qs('#themeModalClose');
    const themeCancel = qs('#themeCancel');
    const themeApply = qs('#themeApply');
    const themeModeBtns = qsa('.theme-mode-btn');
    const colorSwatches = qsa('.color-swatch-modal');
    
    let selectedTheme = document.documentElement.getAttribute('data-theme') || 'light';
    let selectedSeed = document.documentElement.getAttribute('data-seed') || 'indigo';
    let isClosing = false;
    
    // Open theme modal when theme button is clicked
    const themeToggle = qs('#themeToggle');
    if (themeToggle) {
        themeToggle.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Add click animation
            themeToggle.style.transform = 'scale(0.95)';
            setTimeout(() => {
                themeToggle.style.transform = '';
            }, 150);
            
            openThemeModal();
        };
    }
    
    // Close modal functions
    function closeThemeModal() {
        if (themeModal && !isClosing) {
            isClosing = true;
            
            // Remove any existing animation classes
            themeModal.classList.remove('entering');
            
            // Add exiting class and start animation
            themeModal.classList.add('exiting');
            
            // Wait for exit animation to complete before hiding
            setTimeout(() => {
                if (themeModal && themeModal.classList.contains('exiting')) {
                    themeModal.classList.add('hidden');
                    themeModal.classList.remove('exiting');
                    document.body.classList.remove('no-scroll');
                    isClosing = false;
                }
            }, 250);
        }
    }
    
    function openThemeModal() {
        if (themeModal && !isClosing) {
            isClosing = false;
            // Reset to current values
            selectedTheme = document.documentElement.getAttribute('data-theme') || 'light';
            selectedSeed = document.documentElement.getAttribute('data-seed') || 'indigo';
            
            // Update UI to current values
            updateThemeModeUI();
            updateColorSwatchUI();
            
            themeModal.classList.remove('hidden');
            themeModal.classList.add('entering');
            document.body.classList.add('no-scroll');
            
            // Remove entering class after animation completes
            setTimeout(() => {
                themeModal.classList.remove('entering');
            }, 300);
        }
    }
    
    function updateThemeModeUI() {
        themeModeBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === selectedTheme);
        });
    }
    
    function updateColorSwatchUI() {
        colorSwatches.forEach(swatch => {
            swatch.classList.toggle('selected', swatch.dataset.seed === selectedSeed);
        });
    }
    
    // Theme mode selection
    themeModeBtns.forEach(btn => {
        btn.onclick = () => {
            selectedTheme = btn.dataset.mode;
            btn.classList.add('selecting');
            updateThemeModeUI();
            
            // Remove selecting class after animation
            setTimeout(() => {
                btn.classList.remove('selecting');
            }, 200);
        };
    });
    
    // Color swatch selection
    colorSwatches.forEach(swatch => {
        swatch.onclick = () => {
            selectedSeed = swatch.dataset.seed;
            swatch.classList.add('selecting');
            updateColorSwatchUI();
            
            // Remove selecting class after animation
            setTimeout(() => {
                swatch.classList.remove('selecting');
            }, 300);
        };
    });
    
    // Apply theme changes
    if (themeApply) {
        themeApply.onclick = () => {
            // Add theme transition animation
            document.body.classList.add('theme-transitioning');
            
            // Apply theme
            document.documentElement.setAttribute('data-theme', selectedTheme);
            document.documentElement.setAttribute('data-seed', selectedSeed);
            
            // Save to localStorage
            localStorage.setItem('kas_theme_v5', selectedTheme);
            localStorage.setItem('kas_seed_v5', selectedSeed);
            
            // Update sidebar color swatches
            qsa('.color-swatch').forEach(swatch => {
                swatch.classList.toggle('selected', swatch.dataset.seed === selectedSeed);
            });
            
            // Remove transition class after animation completes
            setTimeout(() => {
                document.body.classList.remove('theme-transitioning');
            }, 300);
            
            closeThemeModal();
            
            // Show success message
            showToast('Tema berhasil diperbarui!', 'success');
        };
    }
    
    // Cancel changes
    if (themeCancel) {
        themeCancel.onclick = closeThemeModal;
    }
    
    // Close modal
    if (themeModalClose) {
        themeModalClose.onclick = closeThemeModal;
    }
    
    // Close on backdrop click
    if (themeModal) {
        themeModal.onclick = (e) => {
            if (e.target === themeModal) {
                closeThemeModal();
            }
        };
    }
    
    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && themeModal && !themeModal.classList.contains('hidden')) {
            closeThemeModal();
        }
    });
}

// ==========================================================================
// Firestore Operations
// ==========================================================================
async function getUser(uid) {
    try {
        const docRef = doc(db, 'users', uid);
        let docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            const user = auth.currentUser;
            if (!user) {
                throw new Error("Cannot create user profile: No authenticated user found.");
            }
            console.log(`User document for UID ${uid} not found. Creating a new one.`);
            
            const role = user.email === ADMIN_EMAIL ? 'admin' : 'user';
            const newUserProfile = {
                email: user.email,
                displayName: user.displayName || user.email.split('@')[0],
                role,
                balance: 0,
                initialBalance: 0,
                createdAt: Timestamp.now(),
                googleUid: uid
            };
            
            await setDoc(docRef, newUserProfile);
            docSnap = await getDoc(docRef);
        }

        return { id: docSnap.id, ...docSnap.data() };
    } catch (error) {
        console.error('Error in getUser:', error);
        if (error.code === 'permission-denied') {
            showToast('Permission denied. Please check Firestore rules.', 'error');
        }
        throw error;
    }
}


async function updateUser(uid, data) {
    await updateDoc(doc(db, 'users', uid), data);
}

async function getTransactions(uid = null, year = null, startDateStr = null, endDateStr = null) {
    try {
        let constraints = [];
        if (uid) {
            constraints.push(where('userId', '==', uid));
        }

        if (startDateStr && endDateStr) {
            const [sYear, sMonth, sDay] = startDateStr.split('-').map(Number);
            const startDate = Timestamp.fromDate(new Date(Date.UTC(sYear, sMonth - 1, sDay)));
            const [eYear, eMonth, eDay] = endDateStr.split('-').map(Number);
            const endDate = Timestamp.fromDate(new Date(Date.UTC(eYear, eMonth - 1, eDay, 23, 59, 59, 999)));
            constraints.push(where('t', '>=', startDate));
            constraints.push(where('t', '<=', endDate));
        } else if (year) {
            const startDate = Timestamp.fromDate(new Date(Date.UTC(year, 0, 1)));
            const endDate = Timestamp.fromDate(new Date(Date.UTC(year, 11, 31, 23, 59, 59)));
            constraints.push(where('t', '>=', startDate));
            constraints.push(where('t', '<=', endDate));
        }

        const q = query(collection(db, 'transactions'), ...constraints);
        const querySnapshot = await getDocs(q);
        
        const transactions = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        transactions.sort((a, b) => toDate(b.t) - toDate(a.t));
        
        return transactions;

    } catch (error) {
        console.error('Error getting transactions:', error);
        return [];
    }
}


async function addTransaction(tx) {
    await addDoc(collection(db, 'transactions'), tx);
}

async function deleteTransaction(transactionId) {
    await deleteDoc(doc(db, 'transactions', transactionId));
}

// ==========================================================================
// Pro-rated Calculation Functions
// ==========================================================================

function calculateUserDepositsForYearProRated(userTransactions, targetYear) {
    let total = 0;
    const monthlyAmount = 10000;
    userTransactions.forEach(tx => {
        if (!tx.from || !tx.to) return;

        const { month: fromMonth, year: fromYear } = parsePeriod(tx.from);
        const { month: toMonth, year: toYear } = parsePeriod(tx.to);
        
        let currentDate = new Date(fromYear, fromMonth - 1, 1);
        const endDate = new Date(toYear, toMonth - 1, 1);

        while (currentDate <= endDate) {
            if (currentDate.getFullYear() === targetYear) {
                total += monthlyAmount;
            }
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
    });
    return total;
}


async function calculateTotalDepositsForYearProRated(targetYear) {
    if (allTransactionsCache.length === 0) {
        const q = query(collection(db, 'transactions'), where('type', 'in', ['deposit', 'deposit-initial']));
        const querySnapshot = await getDocs(q);
        allTransactionsCache = querySnapshot.docs.map(doc => doc.data());
    }

    let total = 0;
    const monthlyAmount = 10000;

    allTransactionsCache.forEach(tx => {
        if (!tx.from || !tx.to) return;
        const { month: fromMonth, year: fromYear } = parsePeriod(tx.from);
        const { month: toMonth, year: toYear } = parsePeriod(tx.to);
        
        let currentDate = new Date(fromYear, fromMonth - 1, 1);
        const endDate = new Date(toYear, toMonth - 1, 1);

        while (currentDate <= endDate) {
            if (currentDate.getFullYear() === targetYear) {
                total += monthlyAmount;
            }
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
    });
    return total;
}

async function calculateTotalDepositsUpToProRated(endYear) {
    if (allTransactionsCache.length === 0) {
        const q = query(collection(db, 'transactions'), where('type', 'in', ['deposit', 'deposit-initial']));
        const querySnapshot = await getDocs(q);
        allTransactionsCache = querySnapshot.docs.map(doc => doc.data());
    }

    let total = 0;
    const monthlyAmount = 10000;

    allTransactionsCache.forEach(tx => {
        if (!tx.from || !tx.to) return;
        const { month: fromMonth, year: fromYear } = parsePeriod(tx.from);
        const { month: toMonth, year: toYear } = parsePeriod(tx.to);
        let currentDate = new Date(fromYear, fromMonth - 1, 1);
        const endDate = new Date(toYear, toMonth - 1, 1);

        while (currentDate <= endDate) {
            if (currentDate.getFullYear() <= endYear) {
                total += monthlyAmount;
            }
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
    });
    return total;
}


async function getDeductionsForYear(year) {
    const startDate = Timestamp.fromDate(new Date(Date.UTC(year, 0, 1)));
    const endDate = Timestamp.fromDate(new Date(Date.UTC(year, 11, 31, 23, 59, 59)));
    const q = query(collection(db, 'deductions'), 
        orderBy('timestamp', 'desc'),
        where('timestamp', '>=', startDate),
        where('timestamp', '<=', endDate)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
async function addDeduction(deduction) {
    await addDoc(collection(db, 'deductions'), deduction);
}

async function getTotalDeductionsForYear(year) {
    const startDate = Timestamp.fromDate(new Date(Date.UTC(year, 0, 1)));
    const endDate = Timestamp.fromDate(new Date(Date.UTC(year, 11, 31, 23, 59, 59)));
    const q = query(collection(db, 'deductions'),
        where('timestamp', '>=', startDate),
        where('timestamp', '<=', endDate)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.reduce((sum, doc) => sum + (doc.data().amount || 0), 0);
}

async function getTotalDeductionsUpTo(endYear) {
    const endDate = Timestamp.fromDate(new Date(endYear, 11, 31, 23, 59, 59));
    const q = query(collection(db, 'deductions'),
        where('timestamp', '<=', endDate)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.reduce((sum, doc) => sum + (doc.data().amount || 0), 0);
}

async function getNetBalanceUpTo(year) {
    if (year < 2023) return 0;
    allTransactionsCache = []; // Reset cache before recalculating
    const totalDeposits = await calculateTotalDepositsUpToProRated(year);
    const totalDeductions = await getTotalDeductionsUpTo(year);
    return totalDeposits - totalDeductions;
}


// Bank Management
async function getBanks() {
    const querySnapshot = await getDocs(query(collection(db, 'banks'), orderBy('name')));
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
async function addBank(bank) {
    await addDoc(collection(db, 'banks'), { ...bank, createdAt: Timestamp.now() });
}

async function deleteBank(bankId) {
    await deleteDoc(doc(db, 'banks', bankId));
}

// Settings Management
async function getAppSettings() {
    const settingsSnapshot = await getDoc(doc(db, 'settings', 'app'));
    if (settingsSnapshot.exists()) {
        return settingsSnapshot.data();
    }
    const defaultSettings = { appsScriptUrl: '', lastUpdated: Timestamp.now(), updatedBy: 'system' };
    await setDoc(doc(db, 'settings', 'app'), defaultSettings);
    return defaultSettings;
}
async function updateAppSettings(settings) {
    const user = auth.currentUser;
    const updatedSettings = { ...settings, lastUpdated: Timestamp.now(), updatedBy: user ? user.email : 'unknown' };
    await setDoc(doc(db, 'settings', 'app'), updatedSettings);
}
// Contribution Settings
async function getContributionSettings() {
    const docRef = doc(db, 'settings', 'contribution');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return docSnap.data();
    }
    return {};
}
async function updateContributionSettings(settings) {
    const settingsRef = doc(db, 'settings', 'contribution');
    const currentSettings = await getContributionSettings();
    const updateData = { ...settings };

    for (const year in currentSettings) {
        if (!updateData[year]) {
            updateData[year] = deleteField();
        }
    }
    await setDoc(settingsRef, updateData);
}

// User Payment Start Override Management
async function getUserPaymentStartOverride(userId) {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (userDoc.exists()) {
        return userDoc.data().paymentStartOverride || {};
    }
    return {};
}

async function updateUserPaymentStartOverride(userId, overrides) {
    await updateUser(userId, { paymentStartOverride: overrides });
}

// Get effective payment start month for a user (with override fallback)
async function getEffectivePaymentStartMonth(userId, year) {
    // First, check if user has override for this year
    const userOverride = await getUserPaymentStartOverride(userId);
    if (userOverride[year]) {
        return parseInt(userOverride[year]);
    }
    
    // Fallback to global settings
    const globalSettings = await getContributionSettings();
    return parseInt(globalSettings[year]) || 1; // Default to January if not set
}


// ==========================================================================
// Google Apps Script & OCR
// ==========================================================================

async function submitToGoogleAppsScript(data, onProgress = null) {
    try {
        const settings = await getAppSettings();
        const APPS_SCRIPT_URL = settings.appsScriptUrl;
        if (!APPS_SCRIPT_URL) {
            console.warn('Google Apps Script URL is not set.');
            return { success: false, error: 'URL not configured' };
        }

        // Progress breakdown:
        // 0-5%: Initial setup
        // 5-45%: File reading (base64 conversion)
        // 45-50%: Data preparation
        // 50-55%: Final preparation
        // 55-75%: Sending to server
        // 75-85%: Upload processing
        // 85-90%: Response processing
        // 90-100%: Data saving (handled in handleSetorSubmit)

        const fileToBase64 = (file, progressCallback) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onloadstart = () => progressCallback && progressCallback(5, 'Memulai pembacaan file...');
            reader.onprogress = (e) => {
                if (e.lengthComputable) {
                    // File reading progress: 5-45% of total progress
                    const readProgress = 5 + Math.round((e.loaded / e.total) * 40);
                    progressCallback && progressCallback(readProgress, `Membaca file... ${Math.round((e.loaded / e.total) * 100)}%`);
                }
            };
            reader.onload = () => {
                progressCallback && progressCallback(45, 'File berhasil dibaca');
                resolve(reader.result);
            };
            reader.onerror = error => reject(error);
        });

        const payload = {
            timestamp: new Date().toISOString(),
            userEmail: data.userEmail,
            userName: data.userName,
            amount: data.amount,
            fromMonth: data.fromMonth,
            fromYear: data.fromYear,
            toMonth: data.toMonth,
            toYear: data.toYear,
            description: data.description,
            fileName: data.file ? data.file.name : null,
            fileSize: data.file ? data.file.size : null,
            imageFile: data.file ? await fileToBase64(data.file, onProgress) : null,
        };
        
        onProgress && onProgress(50, 'Mempersiapkan data...');
        
        // Add delay to make progress visible
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const params = new URLSearchParams();
        params.append('json', JSON.stringify(payload));

        onProgress && onProgress(55, 'Mengirim ke server...');
        
        // Add delay to make progress visible
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params
        });

        onProgress && onProgress(75, 'Mengunggah data...');
        
        // Add delay to make progress visible
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (response.ok) {
            onProgress && onProgress(85, 'Memproses respons...');
            const result = await response.json();
            console.log('Apps Script response:', result);
            return result;
        } else {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }        if (response.ok) {
            const result = await response.json();
            console.log('Apps Script response:', result);
            return result;
        } else {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
    } catch (error) {
        console.error('Google Apps Script submission failed:', error);
        showToast('Gagal mengirim ke Google Apps Script.', 'error');
        return { success: false, error: error.message };
    }
}





async function processOCR(file) {
    const ocrIndicator = qs('#ocrProcessing');
    const ocrProgress = qs('#ocrProgress');

    try {
        ocrIndicator.classList.remove('hidden');
        ocrProgress.textContent = 'Menganalisis gambar...';

        const { data: { text } } = await Tesseract.recognize(file, 'ind', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    ocrProgress.textContent = `Memproses: ${Math.round(m.progress * 100)}%`;
                }
            }
        });

        console.log('OCR Result:', text);
        await autoFillFromOCR(text);
        
        const panel = qs('#panel');
        if (panel && !panel.querySelector('.ocr-warning')) {
            const warning = document.createElement('div');
            warning.className = 'ocr-warning';
            warning.innerHTML = '⚠️ <strong>Periksa Kembali!</strong> Hasil OCR mungkin tidak 100% akurat. Pastikan data sudah benar.';
            panel.insertBefore(warning, panel.querySelector('h2').nextSibling);
        }

    } catch (error) {
        console.error('OCR Error:', error);
        showToast('Gagal memproses OCR. Silakan isi manual.', 'error');
    } finally {
        ocrIndicator.classList.add('hidden');
    }
}

function parseIndonesianNumber(text) {
    if (!text) return 0;
    const currencyRegex = /(?:Rp\s?|)\s?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+,\d{1,2}|\d+)/g;
    let matches;
    let maxAmount = 0;
    
    while ((matches = currencyRegex.exec(text)) !== null) {
        let amountStr = matches[1];
        amountStr = amountStr.replace(/\./g, '').replace(',', '.');
        const amount = parseFloat(amountStr);
        if (!isNaN(amount) && amount > maxAmount) {
            maxAmount = amount;
        }
    }
    return Math.round(maxAmount);
}

async function autoFillFromOCR(text) {
    const amountValue = parseIndonesianNumber(text);
    if (amountValue > 0) {
        const amountField = qs('#amt');
        amountField.value = amountValue.toLocaleString('id-ID');
        amountField.dispatchEvent(new Event('input', { bubbles: true }));
        console.log(`OCR Amount Parsed: ${amountValue}`);
    }

    const banks = await getBanks();
    if (banks.length > 0) {
        let bestMatch = null;
        let highestScore = 0;
        const textLower = text.toLowerCase();
        const lines = textLower.split('\n');
        
        const recipientKeywords = ['ke:', 'penerima', 'kepada', 'ke rekening', 'transfer ke'];
        let recipientContext = '';
        let recipientLineIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const trimmedLine = lines[i].trim();
            if (recipientKeywords.some(kw => trimmedLine.startsWith(kw)) || trimmedLine.startsWith('ke ')) {
                recipientLineIndex = i;
                break;
            }
        }

        if (recipientLineIndex !== -1) {
            recipientContext = lines.slice(recipientLineIndex, recipientLineIndex + 3).join('\n');
            console.log("Recipient context found:", recipientContext);
        } else {
            recipientContext = textLower;
            console.log("No recipient keyword found, searching in full text.");
        }

        banks.forEach(bank => {
            let score = 0;
            const bankNameLower = bank.name.toLowerCase();
            const accountNum = bank.accountNumber.replace(/\s/g, '');
            const accountNameLower = (bank.accountName || '').toLowerCase();

            if (recipientContext.replace(/\s/g, '').includes(accountNum)) score += 5;
            if (recipientContext.includes(bankNameLower)) score += 3;
            if (accountNameLower && recipientContext.includes(accountNameLower)) score += 2;
            if (bankNameLower.includes("jago") && recipientContext.includes("jago")) score += 2; 

            if (score > highestScore) {
                highestScore = score;
                bestMatch = bank;
            }
        });

        if (bestMatch) {
            const matchingOption = qsa('#bank_transfer option').find(opt => {
                try {
                    return opt.value && JSON.parse(opt.value).id === bestMatch.id;
                } catch { return false; }
            });
            if (matchingOption) {
                qs('#bank_transfer').value = matchingOption.value;
                console.log(`OCR Bank Selected: ${bestMatch.name} with score ${highestScore}`);
            }
        }
    }
}


// ==========================================================================
// Page Render Functions
// ==========================================================================

async function renderDashboard(){
    const user = auth.currentUser; if(!user) return;
    const me = await getUser(user.uid);
    if(!me) return; 

    const panel = qs('#panel');
    panel.setAttribute('data-current-view', 'dashboard');
    
    // Show year filter for dashboard
    const yearFilter = qs('#year-filter-container');
    if (yearFilter) {
        yearFilter.style.display = 'flex';
        // Force reflow on mobile to ensure visibility change takes effect
        if (window.innerWidth <= 768) {
            yearFilter.offsetHeight; // Force reflow
        }
    }
    
    // Ensure logout button is visible
    showLogoutButton();
    const loadingHTML = `<div class="loading-placeholder"><div class="spinner"></div><p>Memuat data untuk tahun ${selectedYear}...</p></div>`;
    panel.innerHTML = loadingHTML;
    
    // Fetch all user transactions once for calculation
    const userTransactions = await getTransactions(user.uid);
    const totalUserDeposit = calculateUserDepositsForYearProRated(userTransactions, selectedYear);
    
    let adminDashboardHTML = '';
    if (me.role === 'admin') {
        allTransactionsCache = []; // Reset admin cache for fresh calculation
        const startingBalance = await getNetBalanceUpTo(selectedYear - 1);
        const totalDeposits = await calculateTotalDepositsForYearProRated(selectedYear);
        const totalDeductions = await getTotalDeductionsForYear(selectedYear);
        const netBalance = startingBalance + totalDeposits - totalDeductions;
        adminDashboardHTML = `
        <h3 style="margin-top:24px;">Ringkasan Kas Umum ${selectedYear}</h3>
        <div class="admin-dashboard-grid">
            <div class="dashboard-card card-saldo-awal">
                <div class="muted">Saldo Awal Tahun</div>
                <h2 class="rupiah-amount">${money(startingBalance)}</h2>
            </div>
            <div class="dashboard-card card-total-setoran">
                <div class="muted">Total Setoran Anggota</div>
                <h2 class="rupiah-amount">${money(totalDeposits)}</h2>
            </div>
            <div class="dashboard-card card-total-pengeluaran">
                <div class="muted">Total Pengeluaran</div>
                <h2 class="rupiah-amount" style="color:var(--md-danger);">${money(totalDeductions)}</h2>
            </div>
            <div class="dashboard-card card-saldo-akhir">
                <div class="muted">Saldo Bersih Akhir Tahun</div>
                <h2 class="rupiah-amount">${money(netBalance)}</h2>
            </div>
        </div>`;
    }

    panel.innerHTML=`
      <h2>Dashboard</h2>
      <div class="dashboard-card card-setoran-user" style="margin-bottom: 24px;">
        <div class="muted">Setoran Anda (${selectedYear}), ${me.displayName}</div>
        <h2 class="rupiah-amount">${money(totalUserDeposit)}</h2>
      </div>
      ${adminDashboardHTML}
      <h3 style="margin-top:24px;">Transaksi Terbaru Anda (${selectedYear})</h3>
      <div id="recentList" class="table-container"></div>`;

    const recentTx = await getTransactions(user.uid, selectedYear);
    const recent = recentTx.slice(0, 5);
    qs('#recentList').innerHTML = recent.length ? `
        <table>
            <thead><tr><th>Tanggal</th><th>Periode</th><th>Bank</th><th>Jumlah</th></tr></thead>
            <tbody>
                ${recent.map(r=>`<tr>
                    <td data-label="Tanggal" data-date="${r.t?.toDate ? r.t.toDate().toISOString() : r.t}">${formatResponsiveDate(r.t)}</td>
                    <td data-label="Periode" data-period="${r.from || 'N/A'} → ${r.to || 'N/A'}">
                        <span class="chip chip-period">
                            <span class="period-line">${formatResponsivePeriod(r.from)}</span>
                            <span class="period-arrow">${getResponsiveArrow()}</span>
                            <span class="period-line">${formatResponsivePeriod(r.to)}</span>
                        </span>
                    </td>
                    <td>${r.bank ? r.bank.name : '—'}</td>
                    <td>${money(r.amount)}</td>
                </tr>`).join('')}
            </tbody>
        </table>` : `<p class="muted" style="padding: 24px; text-align: center;">Belum ada transaksi di tahun ${selectedYear}.</p>`;
}


async function renderSetor() {
    const panel = qs('#panel');
    
    // Ensure logout button is visible
    showLogoutButton();
    
    // Hide year filter for this page
    qs('#year-filter-container').style.display = 'none';
    
    const banks = await getBanks();
    panel.innerHTML = `
        <h2>Setor Kas</h2>
        <div class="row setor-row" id="setorRow">
            <div class="col" id="setorLeftCol">
                <label for="fileInput">Bukti (gambar) <span style="color:var(--md-danger)">*</span></label>
                <div class="file-upload-area" id="fileUploadArea">
                    <div class="file-upload-text">Klik atau seret gambar ke sini</div>
                    <div class="file-upload-hint">JPG, PNG, WebP (Maks 5MB)</div>
                    <input id="fileInput" type="file" accept="image/*" class="hidden">
                </div>
                <div class="file-preview-container hidden" id="filePreviewContainer">
                    <div class="file-preview-wrapper">
                        <img id="preview" class="file-preview-image" alt="Preview bukti" />
                        <button class="file-remove-btn" id="removeFileBtn" type="button"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="file-info">
                        <div class="file-name" id="fileName"></div>
                        <div class="file-size" id="fileSize"></div>
                    </div>
                </div>
            </div>
            <div class="col" id="setorRightCol">
                <label for="bank_transfer">Transfer ke Bank <span style="color:var(--md-danger)">*</span></label>
                <div class="field"><select id="bank_transfer">
                    <option value="">Pilih Bank Penerima</option>
                    ${banks.map(bank => `<option value='${JSON.stringify(bank)}'>${bank.name} - ${bank.accountNumber}</option>`).join('')}
                </select></div>
                
                <label for="amt">Jumlah (Rp) <span style="color:var(--md-danger)">*</span></label>
                <div class="field"><input id="amt" type="text" placeholder="10.000" inputmode="numeric"></div>

                <div class="row">
                    <div class="col">
                        <label>Tahun Setoran</label>
                        <div class="field"><select id="paymentYear"></select></div>
                    </div>
                </div>
                
                <label>Periode Pembayaran (Otomatis)</label>
                <div id="payment-period-info" class="field-display">Memuat...</div>
                
                <label for="ket">Keterangan</label>
                <div class="field"><input id="ket" placeholder="Keterangan tambahan (opsional)"></div>

                <div class="upload-progress-container hidden" id="uploadProgressContainer">
                    <div class="upload-progress-bar">
                        <div class="upload-progress-fill" id="uploadProgressFill"></div>
                    </div>
                    <div class="upload-progress-text" id="uploadProgressText">Mengunggah...</div>
                </div>
            </div>
        </div>
        
        <!-- Submit button outside the row to span full width -->
        <button class="btn btn-filled setor-submit-btn" id="submitSetor">
            <i class="material-icons">account_balance_wallet</i>
            <span>Setor Kas</span>
        </button>`;
    
    await populateMonthYearSelectors();
    setupSetorEventListeners();

    // Sync left upload area height with right column
    const rightCol = qs('#setorRightCol');
    const uploadArea = qs('#fileUploadArea');
    const measureRightColHeight = () => {
        if (!rightCol) return 0;
        // Temporarily force final layout to avoid later jumps
        const prev = rightCol.style.minHeight;
        rightCol.style.minHeight = '0px';
        const h = rightCol.getBoundingClientRect().height;
        rightCol.style.minHeight = prev;
        return Math.round(h);
    };
    const syncHeights = () => {
        if (!rightCol || !uploadArea) return;
        if (window.innerWidth >= 1025) {
            const rightHeight = measureRightColHeight();
            const adjustment = 24; // reduce a bit so it matches visual content height
            uploadArea.classList.add('no-transition');
            uploadArea.style.minHeight = `${Math.max(120, rightHeight - adjustment)}px`;
            // Force reflow, then remove the class to avoid visible change
            uploadArea.offsetHeight; // reflow
            uploadArea.classList.remove('no-transition');
        } else {
            uploadArea.style.minHeight = '120px';
        }
    };
    // Pre-calc before any potential images/fonts affect layout
    syncHeights();
    // Recalc once after fonts/styles settle
    requestAnimationFrame(syncHeights);
    window.addEventListener('resize', () => { requestAnimationFrame(syncHeights); });
}

async function handleSetorSubmit() {
    console.log('🚀 handleSetorSubmit called at:', new Date().toISOString());
    const user = auth.currentUser;
    const file = qs('#fileInput').files[0];
    const amount = Number(qs('#amt').value.replace(/\D/g, '') || 0);
    const bank = qs('#bank_transfer').value;
    const periodInfo = qs('#payment-period-info');
    const { from, to } = periodInfo.dataset;

    console.log('Form data:', { user: user?.email, file: file?.name, amount, bank, from, to });


    // Validate form data
    if (!validateForm([
        ['file', file, validators.required, 'Harap unggah gambar bukti transfer.'],
        ['amount', amount, (val) => validators.minAmount(val, 10000), 'Jumlah setoran minimal Rp 10.000.'],
        ['bank', bank, validators.required, 'Harap pilih bank penerima.'],
        ['period', from && to, validators.required, 'Periode pembayaran tidak valid.']
    ])) return;

    const btn = qs('#submitSetor');
    const progressContainer = qs('#uploadProgressContainer');
    const progressFill = qs('#uploadProgressFill');
    const progressText = qs('#uploadProgressText');
    
    // Create progress callback function
    const updateProgress = (progress, message) => {
        if (progressFill && progressText) {
            progressFill.style.width = progress + '%';
            progressText.textContent = message;
            // Force reflow to ensure visibility
            progressFill.offsetHeight;
        }
    };

    // Initial progress test - show immediately when clicked
    updateProgress(0, 'Memulai...');
    
    btn.disabled = true;
    btn.textContent = 'Memproses...';
    
    // Show progress bar with animation
    if (progressContainer) {
        // Remove hidden class and add visible class for animation
        progressContainer.classList.remove('hidden');
        
        // Use setTimeout to trigger the animation after the element is shown
        setTimeout(() => {
            progressContainer.classList.add('visible');
        }, 50);
        
        // Scroll into view if needed
        setTimeout(() => {
            const rect = progressContainer.getBoundingClientRect();
            const isVisible = rect.top >= 0 && rect.left >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) && rect.right <= (window.innerWidth || document.documentElement.clientWidth);
            
            if (!isVisible) {
                progressContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }
    if (progressFill) {
        progressFill.style.width = '0%';
        // Force visibility
        progressFill.style.opacity = '1';
        progressFill.style.visibility = 'visible';
        progressFill.style.height = '100%';
    }
    if (progressText) {
        progressText.textContent = 'Memproses gambar...';
        // Force visibility
        progressText.style.opacity = '1';
        progressText.style.visibility = 'visible';
    }

    try {
        const me = await getUser(user.uid);

        const { month: fromMonth, year: fromYear } = parsePeriod(from);
        const { month: toMonth, year: toYear } = parsePeriod(to);
        
        const appsScriptResult = await submitToGoogleAppsScript({
            userEmail: me.email,
            userName: me.displayName,
            amount,
            fromMonth: fromMonth.toString(),
            fromYear: fromYear.toString(),
            toMonth: toMonth.toString(),
            toYear: toYear.toString(),
            description: qs('#ket').value || 'Setor kas',
            file
        }, updateProgress);

        if (!appsScriptResult.success || !appsScriptResult.fileUrl) {
            throw new Error(appsScriptResult.error || "Gagal mendapatkan URL gambar dari Apps Script.");
        }

        const tx = {
            t: Timestamp.now(),
            userId: user.uid,
            username: me.email,
            amount: amount,
            from,
            to,
            ket: qs('#ket').value || 'Setor kas',
            description: qs('#ket').value || 'Setor kas',
            type: 'deposit',
            bank: JSON.parse(bank),
            fileUrl: appsScriptResult.fileUrl
        };
        
        await addTransaction(tx);
        
        updateProgress(90, 'Menyimpan data...');
        // Add longer delay to ensure visibility
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const currentBalance = (me.balance || 0);
        await updateUser(user.uid, { balance: currentBalance + amount });
        
        updateProgress(100, 'Selesai!');
        // Keep progress bar visible for a moment to ensure it's seen
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        showToast('Setor berhasil & bukti diunggah!', 'success');
        updateActiveMenu('menu_dashboard'); // Fix menu highlighting
        await smoothTransition(renderDashboard);    } catch (error) {
        showToast(`Terjadi kesalahan: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="material-icons">account_balance_wallet</i><span>Setor Kas</span>';
        // Keep progress bar visible for 2 seconds after completion
        setTimeout(() => {
            if (progressContainer) {
                progressContainer.classList.remove('visible');
                // Hide completely after animation
                setTimeout(() => {
                    progressContainer.classList.add('hidden');
                }, 400);
            }
        }, 2000);
    }
}

// ==========================================================================
// Image Modal Zoom Functions (Global scope)
// ==========================================================================

// Zoom state
let zoomLevel = 1;
let panX = 0;
let panY = 0;
let isDragging = false;
let startX, startY;

// Update zoom display
function updateZoomDisplay() {
    const zoomLevelDisplay = qs('#zoomLevel');
    if (zoomLevelDisplay) {
        zoomLevelDisplay.textContent = Math.round(zoomLevel * 100) + '%';
    }
}

// Apply zoom and pan transforms
function applyTransform() {
    const modalImage = qs('#modalImage');
    const container = qs('.image-modal-content');
    if (modalImage) {
        // Ensure no CSS animation overrides our inline transform
        modalImage.style.animation = 'none';
        // Clamp pan so the image doesn't drift completely out of view
        if (container) {
            const containerRect = container.getBoundingClientRect();
            const imgNaturalW = modalImage.naturalWidth || containerRect.width;
            const imgNaturalH = modalImage.naturalHeight || containerRect.height;
            const fittedScale = Math.min(
                containerRect.width / imgNaturalW,
                containerRect.height / imgNaturalH
            );
            const baseW = imgNaturalW * fittedScale;
            const baseH = imgNaturalH * fittedScale;
            const zoomedW = baseW * zoomLevel;
            const zoomedH = baseH * zoomLevel;
            const maxPanX = Math.max(0, (zoomedW - baseW) / 2);
            const maxPanY = Math.max(0, (zoomedH - baseH) / 2);
            panX = Math.min(Math.max(panX, -maxPanX), maxPanX);
            panY = Math.min(Math.max(panY, -maxPanY), maxPanY);
        }
        modalImage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel}) translateZ(0)`;
    }
}

// Reset zoom and pan
function resetZoom() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyTransform();
    updateZoomDisplay();
    const modalImage = qs('#modalImage');
    if (modalImage) modalImage.style.cursor = 'default';
}

// Zoom in
function zoomIn() {
    if (zoomLevel < 3) {
        zoomLevel = Math.min(+(zoomLevel * 1.2).toFixed(3), 3);
        applyTransform();
        updateZoomDisplay();
        const modalImage = qs('#modalImage');
        if (modalImage) modalImage.style.cursor = zoomLevel > 1 ? 'grab' : 'default';
    }
}

// Zoom out
function zoomOut() {
    if (zoomLevel > 0.5) {
        zoomLevel = Math.max(+(zoomLevel / 1.2).toFixed(3), 0.5);
        applyTransform();
        updateZoomDisplay();
        const modalImage = qs('#modalImage');
        if (modalImage) modalImage.style.cursor = zoomLevel > 1 ? 'grab' : 'default';
    }
}

// Enhanced image modal functions with animations
function showImageModal(imageSrc, isLocalFile = false) {
    const modalBackdrop = qs('#imageModalBackdrop');
    const modalImage = qs('#modalImage');
    const modalSpinner = qs('#modalSpinner');
    const zoomControls = qs('#zoomControls');
    
    if (!modalBackdrop || !modalImage || !modalSpinner || !zoomControls) {
        console.error('Modal elements not found');
        return;
    }
    
    // Prevent body scrolling
    document.body.style.overflow = 'hidden';
    
    // Reset states
    modalImage.classList.remove('loaded');
    modalImage.classList.add('loading');
    modalSpinner.style.display = 'flex';
    modalImage.style.display = 'none';
    
    // Show modal with entrance animation
    modalBackdrop.classList.remove('hidden', 'exiting');
    // Prepare for entry animation; class will be added after insert
    
    // Show zoom controls
    zoomControls.classList.remove('hidden');
    resetZoom();

    // Rebind zoom controls to ensure listeners active
    const zoomInBtn = qs('#zoomIn');
    const zoomOutBtn = qs('#zoomOut');
    const zoomResetBtn = qs('#zoomReset');
    if (zoomInBtn) zoomInBtn.onclick = zoomIn;
    if (zoomOutBtn) zoomOutBtn.onclick = zoomOut;
    if (zoomResetBtn) zoomResetBtn.onclick = resetZoom;
    
    // Clear any existing event handlers to prevent conflicts
    modalImage.onload = null;
    modalImage.onerror = null;
    
    // Load image with animation
    modalImage.src = imageSrc;
    modalImage.onload = () => {
        // Hide spinner and show image with animation
        modalSpinner.style.display = 'none';
        modalImage.style.display = 'block';
        
        // Add loaded animation after a small delay
        setTimeout(() => {
            modalImage.classList.remove('loading');
            modalImage.classList.add('loaded');
            // After loaded animation, ensure transform is applied and no animation interferes
            modalImage.style.animation = 'none';
            applyTransform();
            updateZoomDisplay();
        }, 50);
    };
    
    modalImage.onerror = () => {
        modalSpinner.style.display = 'none';
        modalImage.style.display = 'block';
        modalImage.alt = 'Failed to load image';
        showToast('Gagal memuat gambar', 'error');
    };
    
    // Focus management for accessibility
    modalBackdrop.focus();
    modalBackdrop.setAttribute('tabindex', '-1');
    
    // Clean up animation classes
    setTimeout(() => {
        modalBackdrop.classList.remove('entering');
    }, 500);
}

function closeImageModal() {
    const modalBackdrop = qs('#imageModalBackdrop');
    const modalImage = qs('#modalImage');
    const zoomControls = qs('#zoomControls');
    
    if (!modalBackdrop || !modalImage || !zoomControls) {
        console.error('Modal elements not found for closing');
        return;
    }
    
    // Restore body scrolling
    document.body.style.overflow = '';
    
    // Start exit animation
    modalBackdrop.classList.remove('entering');
    modalBackdrop.classList.add('exiting');
    
    // Hide zoom controls
    zoomControls.classList.add('hidden');
    
    // Complete the close after animation
    setTimeout(() => {
        modalBackdrop.classList.add('hidden');
        modalBackdrop.classList.remove('exiting');
        
        // Clear event handlers before changing src to prevent error toast
        modalImage.onload = null;
        modalImage.onerror = null;
        modalImage.src = 'about:blank'; // Clear image to stop loading
        
        modalImage.classList.remove('loaded', 'loading');
        modalBackdrop.removeAttribute('tabindex');
        resetZoom(); // Reset zoom when closing
    }, 300);
}

function showImageModalWithProxy(driveUrl) {
    const modalBackdrop = qs('#imageModalBackdrop');
    const modalImage = qs('#modalImage');
    const modalSpinner = qs('#modalSpinner');
    const zoomControls = qs('#zoomControls');
    
    // Reset states
    modalImage.classList.remove('loaded');
    modalImage.classList.add('loading');
    modalSpinner.style.display = 'flex';
    modalImage.style.display = 'none';
    
    // Show modal with entrance animation
    modalBackdrop.classList.remove('hidden', 'exiting');
    modalBackdrop.classList.add('entering');
    
    // Show zoom controls
    zoomControls.classList.remove('hidden');
    resetZoom();

    // Rebind zoom controls to ensure listeners active
    const zoomInBtn = qs('#zoomIn');
    const zoomOutBtn = qs('#zoomOut');
    const zoomResetBtn = qs('#zoomReset');
    if (zoomInBtn) zoomInBtn.onclick = zoomIn;
    if (zoomOutBtn) zoomOutBtn.onclick = zoomOut;
    if (zoomResetBtn) zoomResetBtn.onclick = resetZoom;
    
    // Load image via proxy
    displayImageFromProxy(driveUrl, modalImage, modalSpinner, () => {
        // Success callback - add loaded animation
        setTimeout(() => {
            modalImage.classList.remove('loading');
            modalImage.classList.add('loaded');
            modalImage.style.animation = 'none';
            applyTransform();
            updateZoomDisplay();
        }, 50);
    });
    
    // Clean up animation classes
    setTimeout(() => {
        modalBackdrop.classList.remove('entering');
    }, 500);
}


function setupSetorEventListeners() {
    const debouncedPopulate = debounce(populateMonthYearSelectors, 500);
    qs('#amt').oninput = () => {
        formatNumberInput(qs('#amt'));
        debouncedPopulate();
    };
    qs('#paymentYear').onchange = populateMonthYearSelectors;
    
    const fileArea = qs('#fileUploadArea'), fileInput = qs('#fileInput'),
        previewContainer = qs('#filePreviewContainer'), previewImage = qs('#preview');

    const handleFile = async (file) => {
        // Basic validation
        if (!file) {
            return showToast('Tidak ada file yang dipilih.', 'error');
        }
        
        // Check file size (5MB limit)
        if (file.size > 5 * 1024 * 1024) {
            return showToast('Ukuran file terlalu besar. Maksimal 5MB.', 'error');
        }
        
        // Check if it's an image file
        const isImage = file.type.startsWith('image/');
        
        if (!isImage) {
            return showToast('File tidak valid. Pilih gambar (JPG, PNG, WebP) maks 5MB.', 'error');
        }
        
        let processedFile = file;
        
        // Show preview
        fileArea.classList.add('hidden');
        previewContainer.classList.remove('hidden');
        
        // Update file display
        const fileNameElement = qs('#fileName');
        const fileSizeElement = qs('#fileSize');
        
        fileNameElement.textContent = processedFile.name;
        fileSizeElement.textContent = `${(processedFile.size / 1024 / 1024).toFixed(2)} MB`;
        
        previewImage.src = URL.createObjectURL(processedFile);
        
        // Process OCR with the converted file
        processOCR(processedFile);
    };
    
    previewImage.onclick = () => {
        // Use the processed image source instead of original file
        if (previewImage.src && previewImage.src !== '') {
            showImageModal(previewImage.src, true);
        }
    };

    fileArea.onclick = () => fileInput.click();
    fileInput.onchange = async (e) => await handleFile(e.target.files[0]);
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => fileArea.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
    fileArea.addEventListener('dragover', () => fileArea.classList.add('dragover'));
    fileArea.addEventListener('dragleave', () => fileArea.classList.remove('dragover'));
    fileArea.addEventListener('drop', async (e) => {
      fileArea.classList.remove('dragover');
      if (e.dataTransfer.files.length) { 
        fileInput.files = e.dataTransfer.files; 
        await handleFile(e.dataTransfer.files[0]); 
      }
    });
    qs('#removeFileBtn').onclick = () => {
        fileInput.value = '';
        previewContainer.classList.add('hidden');
        fileArea.classList.remove('hidden');
        previewImage.src = '';
    };
    qs('#submitSetor').onclick = handleSetorSubmit;
}

async function populateMonthYearSelectors(){
    const user = auth.currentUser;
    if (!user) return;

    const yearEl = qs('#paymentYear');
    const periodInfoEl = qs('#payment-period-info');

    if (!periodInfoEl) return;
    
    const settings = await getContributionSettings();
    const availableYears = Object.keys(settings).sort((a,b) => b-a);
    
    if (availableYears.length === 0) {
        periodInfoEl.textContent = 'Admin belum mengatur tahun setoran.';
        qs('#submitSetor').disabled = true;
        return;
    }

    if (!yearEl.innerHTML) {
        yearEl.innerHTML = availableYears.map(y => `<option value="${y}">${y}</option>`).join('');
        yearEl.value = new Date().getFullYear();
    }
    
    const allUserTransactions = await getTransactions(user.uid);
    
    const paidMonths = new Set();
    allUserTransactions.forEach(tx => {
        if (!tx.from || !tx.to) return;
        const { month: fromMonth, year: fromYear } = parsePeriod(tx.from);
        const { month: toMonth, year: toYear } = parsePeriod(tx.to);
        
        let currentDate = new Date(fromYear, fromMonth - 1, 1);
        const endDate = new Date(toYear, toMonth - 1, 1);
        
        while (currentDate <= endDate) {
            paidMonths.add(`${currentDate.getFullYear()}-${currentDate.getMonth() + 1}`);
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
    });

    let firstUnpaidMonth = -1;
    let firstUnpaidYear = -1;

    const allYearsSorted = Object.keys(settings).sort((a, b) => a - b);
    for (const yearStr of allYearsSorted) {
        const year = parseInt(yearStr);
        // Use effective payment start month (with user override consideration)
        const startMonth = await getEffectivePaymentStartMonth(user.uid, year);
        for (let m = startMonth; m <= 12; m++) {
            if (!paidMonths.has(`${year}-${m}`)) {
                firstUnpaidMonth = m;
                firstUnpaidYear = year;
                break;
            }
        }
        if (firstUnpaidMonth !== -1) break;
    }
    
    if (firstUnpaidMonth === -1) {
        periodInfoEl.textContent = `Semua iuran sudah lunas.`;
        periodInfoEl.dataset.from = '';
        periodInfoEl.dataset.to = '';
        qs('#submitSetor').disabled = true;
        return;
    }

    yearEl.value = firstUnpaidYear;

    qs('#submitSetor').disabled = false;
    const amount = Number(qs('#amt').value.replace(/\D/g, '')) || 0;
    const monthsToPay = Math.max(1, Math.floor(amount / 10000));
    const monthNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    
    const startDate = new Date(firstUnpaidYear, firstUnpaidMonth - 1, 1);
    const endDate = new Date(startDate);
    endDate.setMonth(startDate.getMonth() + monthsToPay - 1);
    
    const fromStr = `${monthNames[startDate.getMonth()]} ${startDate.getFullYear()}`;
    const toStr = `${monthNames[endDate.getMonth()]} ${endDate.getFullYear()}`;
    
    periodInfoEl.textContent = `${monthNames[startDate.getMonth()]} ${startDate.getFullYear()} - ${monthNames[endDate.getMonth()]} ${endDate.getFullYear()}`;
    periodInfoEl.dataset.from = fromStr;
    periodInfoEl.dataset.to = toStr;
}

async function renderHistory() {
    const panel = qs('#panel');
    panel.setAttribute('data-current-view', 'history');
    
    // Ensure logout button is visible
    showLogoutButton();
    
    // Hide year filter for this page
    qs('#year-filter-container').style.display = 'none';
    const currentYear = new Date().getFullYear();
    const firstDayOfYear = `${currentYear}-01-01`;
    const lastDayOfYear = `${currentYear}-12-31`;

    panel.innerHTML = `
        <h2>Riwayat Transaksi Anda</h2>
        <div class="card" style="margin-bottom: 24px;">
            <h3>Filter Riwayat</h3>
            <div class="row">
                <div class="col">
                    <label for="startDate">Dari Tanggal</label>
                    <div class="field"><input type="date" id="startDate" value="${firstDayOfYear}"></div>
                </div>
                <div class="col">
                    <label for="endDate">Sampai Tanggal</label>
                    <div class="field"><input type="date" id="endDate" value="${lastDayOfYear}"></div>
                </div>
            </div>
        </div>
        <div id="history-table-container">
            <div class="loading-placeholder"><div class="spinner"></div></div>
        </div>
    `;

    const displayHistoryTable = async () => {
        const user = auth.currentUser;
        if (!user) return;

        const container = qs('#history-table-container');
        
        // Add smooth transition effect
        container.style.opacity = '0.6';
        container.style.transform = 'translateY(10px)';
        container.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

        const startDate = qs('#startDate').value;
        const endDate = qs('#endDate').value;

        const txs = await getTransactions(user.uid, null, startDate, endDate);

        container.innerHTML = `
            <div class="table-container">
                ${txs.length ? `
                    <table>
                        <thead><tr><th>Tanggal</th><th>Periode</th><th>Jumlah</th><th>Bank</th><th>Bukti</th></tr></thead>
                        <tbody>
                            ${txs.map(tx => `
                                <tr>
                                    <td data-label="Tanggal" data-date="${tx.t?.toDate ? tx.t.toDate().toISOString() : tx.t}">${formatResponsiveDate(tx.t)}</td>
                                    <td data-label="Periode" data-period="${tx.from || 'N/A'} → ${tx.to || 'N/A'}">
                                        <span class="chip chip-period">
                                            <span class="period-line">${formatResponsivePeriod(tx.from)}</span>
                                            <span class="period-arrow">${getResponsiveArrow()}</span>
                                            <span class="period-line">${formatResponsivePeriod(tx.to)}</span>
                                        </span>
                                    </td>
                                    <td data-label="Jumlah">${money(tx.amount)}</td>
                                    <td data-label="Bank">${tx.bank ? tx.bank.name : '—'}</td>
                                    <td data-label="Bukti" class="proof-cell">
                                        ${tx.fileUrl ? createProofImageHTML(tx.fileUrl, 150, 100) : '—'}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : '<p class="muted" style="padding: 24px; text-align: center;">Tidak ada riwayat transaksi pada rentang tanggal ini.</p>'}
            </div>
        `;

        // Complete the smooth transition
        setTimeout(() => {
            container.style.opacity = '1';
            container.style.transform = 'translateY(0)';
        }, 50);

        // Click handlers are now handled by createProofImageElement
    };

    // Auto-update when date inputs change
    qs('#startDate').onchange = debounce(displayHistoryTable, 300);
    qs('#endDate').onchange = debounce(displayHistoryTable, 300);
    
    await displayHistoryTable(); // Initial load
}


async function handleDeleteTransaction(e) {
    const { txId, userId, amount } = e.target.dataset;
    if (!confirm('Anda yakin ingin menghapus transaksi ini? Saldo pengguna akan dikembalikan.')) return;

    try {
        await deleteTransaction(txId);
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
            const newBalance = (userDoc.data().balance || 0) - Number(amount);
            await updateUser(userId, { balance: newBalance });
        }
        showToast('Transaksi berhasil dihapus.', 'success');
        
        if (qs('#user-management-table')) {
            await renderUserManagement();
        } else {
            await renderHistory();
        }
    } catch (error) {
        showToast(`Gagal menghapus: ${error.message}`, 'error');
    }
}

async function renderUserHistoryModal(userId, userName) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop user-history'; // Add class for z-index
    modalBackdrop.classList.add('entering');

    const transactions = await getTransactions(userId);
    
    let tableHTML = `<p class="muted" style="text-align:center; padding: 24px;">Belum ada transaksi untuk pengguna ini.</p>`;
    if (transactions.length > 0) {
        tableHTML = `
            <div class="table-container" style="max-height: 60vh; overflow-y: auto;">
                <table>
                    <thead>
                        <tr><th>Tanggal</th><th>Periode</th><th>Jumlah</th><th>Bank</th><th>Bukti</th><th>Aksi</th></tr>
                    </thead>
                    <tbody>
                        ${transactions.map(tx => `
                            <tr>
                                <td data-label="Tanggal" data-date="${tx.t?.toDate ? tx.t.toDate().toISOString() : tx.t}">${formatResponsiveDate(tx.t)}</td>
                                <td data-label="Periode" data-period="${tx.from || 'N/A'} → ${tx.to || 'N/A'}">
                                    <span class="chip chip-period">
                                        <span class="period-line">${formatResponsivePeriod(tx.from)}</span>
                                        <span class="period-arrow">${getResponsiveArrow()}</span>
                                        <span class="period-line">${formatResponsivePeriod(tx.to)}</span>
                                    </span>
                                </td>
                                <td data-label="Jumlah">${money(tx.amount)}</td>
                                <td data-label="Bank">${tx.bank ? tx.bank.name : '—'}</td>
                                <td data-label="Bukti">${tx.fileUrl ? createProofImageHTML(tx.fileUrl, 150, 100) : '—'}</td>
                                <td data-label="Aksi"><button class="btn btn-outlined danger delete-tx-btn-modal" data-tx-id="${tx.id}" data-user-id="${userId}" data-amount="${tx.amount}" data-user-name="${userName}"><i class="fas fa-trash"></i> Hapus</button></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    modalBackdrop.innerHTML = `
        <div class="card image-modal" style="width: 90%; max-width: 800px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin:0;">Riwayat Transaksi: ${userName}</h3>
                <button class="image-modal-close" id="closeUserHistoryModal"><i class="fas fa-times"></i></button>
            </div>
            ${tableHTML}
        </div>
    `;

    document.body.appendChild(modalBackdrop);

    // Trigger entry animation
    requestAnimationFrame(() => {
        modalBackdrop.classList.add('entering');
        setTimeout(() => modalBackdrop.classList.remove('entering'), 500);
    });


    const closeModalWithAnimation = () => {
        modalBackdrop.classList.add('exiting');
        setTimeout(() => modalBackdrop.remove(), 320);
    };
    qs('#closeUserHistoryModal').onclick = closeModalWithAnimation;
    modalBackdrop.onclick = e => {
        if (e.target === modalBackdrop) {
            closeModalWithAnimation();
        }
    };
    
    modalBackdrop.querySelectorAll('.delete-tx-btn-modal').forEach(btn => {
        btn.onclick = async (e) => {
            const { txId, userId: uId, amount, userName: uName } = e.target.dataset;
            if (!confirm('Anda yakin ingin menghapus transaksi ini? Saldo pengguna akan dikembalikan.')) return;

            try {
                await deleteTransaction(txId);
                const userDoc = await getDoc(doc(db, 'users', uId));
                if (userDoc.exists()) {
                    const newBalance = (userDoc.data().balance || 0) - Number(amount);
                    await updateUser(uId, { balance: newBalance });
                }
                showToast('Transaksi berhasil dihapus.', 'success');
                
                modalBackdrop.remove();
                await renderUserHistoryModal(uId, uName);
                
                if (qs('#user-management-table')) {
                    await renderUserManagement();
                }

            } catch (error) {
                showToast(`Gagal menghapus: ${error.message}`, 'error');
            }
        };
    });
    
    // Click handlers are now handled by createProofImageElement
}

async function renderUserManagement() {
    const panel = qs('#panel');
    
    // Show year filter for user management
    const yearFilter = qs('#year-filter-container');
    if (yearFilter) {
        yearFilter.style.display = 'flex';
        // Force reflow on mobile to ensure visibility change takes effect
        if (window.innerWidth <= 768) {
            yearFilter.offsetHeight; // Force reflow
        }
    }
    
    // Ensure logout button is visible
    showLogoutButton();
    
    panel.innerHTML = `<h2>Kelola Pengguna</h2>`;
    
    const usersSnapshot = await getDocs(query(collection(db, 'users'), orderBy('displayName')));
    allUsersCache = usersSnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
    const allTransactions = await getTransactions(null, selectedYear); // Fetch transactions for selected year

    panel.innerHTML += `
        <h3 style="margin-top: 24px;">Daftar Pengguna</h3>
        <p class="muted">Pengguna baru akan muncul di sini setelah mereka login untuk pertama kali menggunakan akun Google mereka.</p>
        <div class="field" style="margin-bottom: 16px;">
             <input id="userSearchInput" type="search" placeholder="Cari pengguna berdasarkan nama atau email...">
        </div>
        <div class="table-container">
            <table id="user-management-table">
                <thead>
                    <tr><th>Email</th><th>Nama</th><th>Admin</th><th>Saldo Titipan</th><th>Total Setoran (${selectedYear})</th><th>Override Pembayaran</th><th>Aksi</th></tr>
                </thead>
                <tbody>` + allUsersCache.map(u => {
                    const userTransactions = allTransactions.filter(tx => tx.userId === u.id);
                    const totalSetoranTahunIni = calculateUserDepositsForYearProRated(userTransactions, selectedYear);
                    const hasOverride = u.paymentStartOverride && Object.keys(u.paymentStartOverride).length > 0;
                    const overrideCount = hasOverride ? Object.keys(u.paymentStartOverride).length : 0;
                    return `
                    <tr class="user-row" data-name="${u.displayName.toLowerCase()}" data-email="${(u.email || u.id).toLowerCase()}">
                        <td data-label="Email">${u.email || u.id}</td>
                        <td data-label="Nama">${u.displayName}</td>
                        <td data-label="Admin">
                           <label class="switch">
                             <input type="checkbox" class="admin-toggle" data-uid="${u.id}" ${u.role === 'admin' ? 'checked' : ''} ${u.id === auth.currentUser.uid ? 'disabled' : ''}>
                             <span class="slider"></span>
                           </label>
                        </td>
                        <td data-label="Saldo Titipan">${money(u.initialBalance || 0)} (${u.initialBalanceYear || 'N/A'})</td>
                        <td data-label="Total Setoran (${selectedYear})">${money(totalSetoranTahunIni)}</td>
                        <td data-label="Override Pembayaran">
                            ${hasOverride ? `<span class="badge" style="background: var(--md-primary); color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem;">${overrideCount} tahun</span>` : '<span class="muted">Tidak ada</span>'}
                        </td>
                        <td class="user-actions">
                            <button class="btn btn-outlined viewUserHistoryBtn" data-uid="${u.id}" data-name="${u.displayName}">Riwayat</button>
                            <button class="btn btn-outlined setInitialBalanceBtn" data-uid="${u.id}" data-name="${u.displayName}">Set Saldo</button>
                            <button class="btn btn-outlined overridePaymentBtn" data-uid="${u.id}" data-name="${u.displayName}">Override Pembayaran</button>
                            <button class="btn btn-outlined danger delUser" data-uid="${u.id}"><i class="fas fa-trash"></i> Hapus</button>
                        </td>
                    </tr>`
                }).join('') + `
                </tbody>
            </table>
        </div>`;
    
    qs('#userSearchInput').oninput = debounce(e => {
        const searchTerm = e.target.value.toLowerCase();
        qsa('.user-row').forEach(row => {
            const name = row.dataset.name;
            const email = row.dataset.email;
            row.style.display = (name.includes(searchTerm) || email.includes(searchTerm)) ? '' : 'none';
        });
    }, 300);
    
    qsa('.admin-toggle').forEach(toggle => {
        toggle.onchange = async (e) => {
            const { uid } = e.target.dataset;
            const newRole = e.target.checked ? 'admin' : 'user';
            try {
                await updateUser(uid, { role: newRole });
                showToast('Peran pengguna berhasil diperbarui.', 'success');
            } catch (error) {
                showToast(`Gagal memperbarui peran: ${error.message}`, 'error');
                e.target.checked = !e.target.checked; // Revert checkbox on failure
            }
        };
    });

    qsa('.viewUserHistoryBtn').forEach(btn => {
        btn.onclick = e => {
            const { uid, name } = e.target.dataset;
            renderUserHistoryModal(uid, name);
        };
    });

    qsa('.delUser').forEach(b => {
        b.onclick = async e => {
            if (!confirm('Hapus pengguna ini? Semua data terkait akan hilang.')) return;
            await deleteDoc(doc(db, 'users', e.target.dataset.uid));
            showToast('Pengguna berhasil dihapus.', 'success');
            await renderUserManagement();
        }
    });

    qsa('.setInitialBalanceBtn').forEach(btn => {
        btn.onclick = async (e) => {
            const { uid, name } = e.target.dataset;
            const user = allUsersCache.find(u => u.id === uid);
            const currentBalance = user.initialBalance || 0;
            const currentYear = user.initialBalanceYear || new Date().getFullYear();
            await showSetInitialBalanceModal({ uid, name, currentBalance, currentYear });
        };
    });

    qsa('.overridePaymentBtn').forEach(btn => {
        btn.onclick = async (e) => {
            const { uid, name } = e.target.dataset;
            await showPaymentStartOverrideModal({ uid, name });
        };
    });
}

async function processInitialBalance(userId, balance, year) {
    const userDocRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userDocRef);
    if (!userSnap.exists()) {
        console.error("User not found for initial balance processing");
        return;
    }
    const userData = userSnap.data();

    const startDateOfYear = new Date(Date.UTC(year, 0, 1));
    const endDateOfYear = new Date(Date.UTC(year, 11, 31, 23, 59, 59));

    const existingTxQuery = query(collection(db, 'transactions'),
        where('userId', '==', userId),
        where('t', '>=', Timestamp.fromDate(startDateOfYear)),
        where('t', '<=', Timestamp.fromDate(endDateOfYear))
    );
    const existingTxSnap = await getDocs(existingTxQuery);
    
    let amountFromDeletedTxs = 0;
    if (!existingTxSnap.empty) {
        const transactionsToDelete = existingTxSnap.docs.filter(doc => {
            const type = doc.data().type;
            return type === 'deposit' || type === 'deposit-initial';
        });

        if (transactionsToDelete.length > 0) {
            console.log(`Deleting ${transactionsToDelete.length} old deposit transactions for ${year}.`);
            const deletePromises = transactionsToDelete.map(d => {
                amountFromDeletedTxs += d.data().amount || 0;
                return deleteDoc(d.ref);
            });
            await Promise.all(deletePromises);
        }
    }
    
    let newTxAmount = 0;
    if (balance >= 10000) {
        const settings = await getContributionSettings();
        // Use effective payment start month (with user override consideration)
        const startMonth = await getEffectivePaymentStartMonth(userId, year);
        const monthsToPay = Math.floor(balance / 10000);

        if (monthsToPay > 0) {
            const startDate = new Date(Date.UTC(year, startMonth - 1, 1));
            const endDate = new Date(startDate);
            endDate.setMonth(startDate.getMonth() + monthsToPay - 1);
            
            newTxAmount = monthsToPay * 10000;

            const monthAbbrevs = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
            const tx = {
                t: Timestamp.fromDate(startDate),
                userId: userId,
                username: userData.email,
                amount: newTxAmount, 
                from: `${monthAbbrevs[startDate.getMonth()]} ${startDate.getFullYear()}`,
                to: `${monthAbbrevs[endDate.getMonth()]} ${endDate.getFullYear()}`,
                ket: 'Pelunasan dari Saldo Awal Titipan',
                type: 'deposit-initial',
                initialBalanceYear: year,
                bank: { name: 'Saldo Awal' },
                adminCreator: auth.currentUser.email
            };
            await addTransaction(tx);
        }
    }
    
    const currentTotalBalance = userData.balance || 0;
    const newTotalBalance = (currentTotalBalance - amountFromDeletedTxs) + newTxAmount;
    await updateUser(userId, { balance: newTotalBalance });
}


async function renderDeductionManagement(){
    const user = auth.currentUser; if(!user) return;
    const me = await getUser(user.uid);
    if(me.role !== 'admin') return renderDashboard();
    
    // Show year filter for deduction management
    const yearFilter = qs('#year-filter-container');
    if (yearFilter) {
        yearFilter.style.display = 'flex';
        // Force reflow on mobile to ensure visibility change takes effect
        if (window.innerWidth <= 768) {
            yearFilter.offsetHeight; // Force reflow
        }
    }
    
    // Ensure logout button is visible
    showLogoutButton();

    const totalBalance = await calculateTotalDepositsForYearProRated(selectedYear);
    const totalDeductions = await getTotalDeductionsForYear(selectedYear);
    const netBalance = totalBalance - totalDeductions;
    const deductionsHistory = await getDeductionsForYear(selectedYear);
      
    qs('#panel').innerHTML=`
        <h2>Kelola Pengeluaran (${selectedYear})</h2>
        <div class="admin-dashboard-grid admin-dashboard-grid-3">
            <div class="dashboard-card card-total-setoran"><div class="muted">Total Setoran Anggota</div><h2 class="rupiah-amount">${money(totalBalance)}</h2></div>
            <div class="dashboard-card card-total-pengeluaran"><div class="muted">Total Pengeluaran</div><h2 class="rupiah-amount" style="color:var(--md-danger)">${money(totalDeductions)}</h2></div>
            <div class="dashboard-card card-saldo-akhir"><div class="muted">Saldo Bersih</div><h2 class="rupiah-amount">${money(netBalance)}</h2></div>
        </div>
        <div style="margin-top:24px" class="card">
          <h3>Tambah Pengeluaran Baru</h3>
            <label>Tanggal Pengeluaran</label><div class="field"><input type="date" id="ded_date"></div>
            <label>Jumlah (Rp)</label><div class="field"><input id="ded_amount" type="text" inputmode="numeric"></div>
            <label>Keterangan</label><div class="field"><input id="ded_desc" placeholder="Mis: Beli sound system"></div>
            <button class="btn btn-filled" id="addDedBtn" style="margin-top:16px;">Tambah</button>
        </div>
        <h3 style="margin-top:24px">Riwayat Pengeluaran (${selectedYear})</h3>
        <div class="table-container">
            ${deductionsHistory.length ? `<table><thead><tr><th>Tanggal</th><th>Keterangan</th><th>Jumlah</th><th>Admin</th></tr></thead><tbody>` + deductionsHistory.map(d=>`<tr><td>${formatResponsiveDate(d.timestamp)}</td><td>${d.description}</td><td style="color:var(--md-danger)">${money(d.amount)}</td><td>${d.adminEmail}</td></tr>`).join('') + '</tbody></table>' : `<p class="muted" style="padding:24px;">Belum ada pengeluaran di tahun ${selectedYear}.</p>`}
        </div>`;
    
    const dateInput = qs('#ded_date');
    dateInput.min = `${selectedYear}-01-01`;
    dateInput.max = `${selectedYear}-12-31`;
    dateInput.value = new Date().toISOString().split('T')[0];


    qs('#ded_amount').oninput = () => formatNumberInput(qs('#ded_amount'));
    qs('#addDedBtn').onclick = async () => {
        const amount = Number(qs('#ded_amount').value.replace(/\D/g, ''));
        const description = qs('#ded_desc').value.trim();
        const date = qs('#ded_date').value;
        
        if (!validateForm([
            ['amount', amount, validators.amount, 'Jumlah tidak valid.'],
            ['description', description, validators.required, 'Deskripsi harus diisi.'],
            ['date', date, validators.required, 'Tanggal harus diisi.']
        ])) return;
        
        await addDeduction({ amount, description, timestamp: Timestamp.fromDate(new Date(date)), adminEmail: user.email });
        await renderDeductionManagement();
    };
}

async function renderBankManagement() {
    const user = auth.currentUser; if(!user) return;
    const me = await getUser(user.uid);
    if(me.role !== 'admin') return renderDashboard();
    
    // Ensure logout button is visible
    showLogoutButton();
    
    const banks = await getBanks();
    qs('#panel').innerHTML = `
        <h2>List Bank Penerima</h2>
        <div class="card" style="margin-top:24px;">
            <h3>Tambah Bank Baru</h3>
            <label>Nama Bank</label><div class="field"><input id="new_bank_name" placeholder="mis: BCA"></div>
            <label>Nomor Rekening</label><div class="field"><input id="new_acc_number" placeholder="1234567890"></div>
            <label>Atas Nama</label><div class="field"><input id="new_acc_name" placeholder="Kas Pemuda GYS"></div>
            <button class="btn btn-filled" id="addBankBtn" style="margin-top:16px;">Tambah Bank</button>
        </div>
        <h3 style="margin-top:24px;">Daftar Bank</h3>
        <div class="table-container">
            ${banks.length ? `<table><thead><tr><th>Nama Bank</th><th>Nomor</th><th>Atas Nama</th><th>Aksi</th></tr></thead><tbody>
            ${banks.map(b => `<tr><td>${b.name}</td><td>${b.accountNumber}</td><td>${b.accountName}</td><td><button class="btn btn-outlined danger del-bank-btn" data-id="${b.id}"><i class="fas fa-trash"></i> Hapus</button></td></tr>`).join('')}
            </tbody></table>` : '<p class="muted" style="padding:24px;">Belum ada bank.</p>'}
        </div>
    `;

    qs('#addBankBtn').onclick = async () => {
        const name = qs('#new_bank_name').value.trim();
        const accountNumber = qs('#new_acc_number').value.trim();
        const accountName = qs('#new_acc_name').value.trim();
        
        if (!validateForm([
            ['name', name, validators.required, 'Nama bank wajib diisi.'],
            ['accountNumber', accountNumber, validators.required, 'Nomor rekening wajib diisi.']
        ])) return;
        
        await addBank({ name, accountNumber, accountName });
        await renderBankManagement();
    };

    qsa('.del-bank-btn').forEach(btn => btn.onclick = async (e) => {
        if (!confirm('Hapus bank ini?')) return;
        await deleteBank(e.target.dataset.id);
        await renderBankManagement();
    });
}

async function renderAppsScriptSetup() {
    // Hide year filter for this page
    qs('#year-filter-container').style.display = 'none';
    
    const settings = await getAppSettings();
    qs('#panel').innerHTML = `
        <h2>Integrasi Google Apps Script</h2>
        <div class="card" style="margin-top:24px;">
            <p class="muted">Hubungkan aplikasi ini ke Google Sheets untuk pencatatan otomatis. URL yang disimpan akan digunakan oleh semua pengguna.</p>
            <label for="appsScriptUrl">URL Web App Google Apps Script</label>
            <div class="field"><input type="url" id="appsScriptUrl" value="${settings.appsScriptUrl || ''}" placeholder="https://script.google.com/macros/s/..."></div>
            <button class="btn btn-filled" id="saveAppsScriptUrl" style="margin-top:16px;"><i class="fas fa-save"></i> Simpan URL</button>
            ${settings.lastUpdated ? `<p class="muted" style="margin-top:10px;">Terakhir diupdate oleh ${settings.updatedBy} pada ${formatFullDate(settings.lastUpdated)}</p>` : ''}
        </div>
    `;

    qs('#saveAppsScriptUrl').onclick = async () => {
        const url = qs('#appsScriptUrl').value.trim();
        try { new URL(url); } catch (e) { return showToast('URL tidak valid.', 'error'); }
        await updateAppSettings({ appsScriptUrl: url });
        showToast('URL berhasil disimpan!', 'success');
    };
}


async function renderExportReport() {
    const panel = qs('#panel');
    
    // Ensure logout button is visible
    showLogoutButton();
    
    // Hide year filter for this page
    qs('#year-filter-container').style.display = 'none';
    
    panel.innerHTML = `
        <h2>Ekspor Laporan</h2>
        <div class="card" style="margin-top:24px;">
            <h3>Filter Laporan</h3>
            <div class="row">
                <div class="col">
                    <label>Anggota</label>
                    <div class="multi-select-container">
                        <div class="multi-select-input" id="multiSelectInput">
                            <span class="multi-select-placeholder">Pilih anggota...</span>
                            <div id="user-pills-container"></div>
                        </div>
                        <div class="multi-select-dropdown hidden" id="multiSelectDropdown">
                            <label class="select-all-label">
                                <input type="checkbox" id="selectAllUsers"> Pilih Semua Anggota
                            </label>
                        </div>
                    </div>
                </div>
                <div class="col">
                    <label>Bank</label>
                    <div class="multi-select-container">
                        <div class="multi-select-input" id="bankMultiSelectInput">
                            <span class="multi-select-placeholder">Pilih bank...</span>
                            <div id="bank-pills-container"></div>
                        </div>
                        <div class="multi-select-dropdown hidden" id="bankMultiSelectDropdown">
                            <label class="select-all-label">
                                <input type="checkbox" id="selectAllBanks"> Pilih Semua Bank
                            </label>
                        </div>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col">
                    <label>Dari Tanggal</label>
                    <div class="field"><input type="date" id="startDate"></div>
                </div>
                <div class="col">
                    <label>Sampai Tanggal</label>
                    <div class="field"><input type="date" id="endDate"></div>
                </div>
            </div>
            <div class="row" style="margin-top: 16px;">
                <div class="col" style="text-align: right;">
                    <div style="display:flex; gap:12px; justify-content: flex-end;">
                        <button class="btn btn-outlined" id="exportBtnHTML">Ekspor ke HTML</button>
                        <button class="btn btn-filled" id="exportBtnExcel">Ekspor ke Excel</button>
                    </div>
                </div>
            </div>
        </div>
        <div id="report-preview-container" class="card" style="margin-top: 24px;"></div>
    `;

    setupExportEventListeners();
    updateReportPreview();
}

async function updateReportPreview() {
    const previewContainer = qs('#report-preview-container');
    
    // Add smooth transition effect
    previewContainer.style.opacity = '0.6';
    previewContainer.style.transform = 'translateY(10px)';
    previewContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

    const selectedUserIds = Array.from(qsa('.user-checkbox:checked')).map(cb => cb.value);
    const startDate = qs('#startDate').value;
    const endDate = qs('#endDate').value;

    let constraints = [orderBy('t', 'desc')];
    if (selectedUserIds.length > 0) {
        constraints.push(where('userId', 'in', selectedUserIds));
    }
    if (startDate) {
        const [year, month, day] = startDate.split('-').map(Number);
        const startDateUTC = new Date(Date.UTC(year, month - 1, day));
        constraints.push(where('t', '>=', Timestamp.fromDate(startDateUTC)));
    }
    if (endDate) {
        const [year, month, day] = endDate.split('-').map(Number);
        const endOfDayUTC = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
        constraints.push(where('t', '<=', Timestamp.fromDate(endOfDayUTC)));
    }

    const q = query(collection(db, 'transactions'), ...constraints);
    const querySnapshot = await getDocs(q);
    const transactions = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (transactions.length === 0) {
        previewContainer.innerHTML = `<p class="muted" style="text-align:center; padding: 24px;">Tidak ada data yang cocok dengan filter.</p>`;
        return;
    }

    const totalAmount = transactions.reduce((sum, tx) => sum + tx.amount, 0);

    previewContainer.innerHTML = `
        <h3>Pratinjau Laporan</h3>
        <div class="report-summary">
            <div><strong>Total Transaksi:</strong> ${transactions.length}</div>
            <div><strong>Total Setoran:</strong> ${money(totalAmount)}</div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Tanggal</th><th>Nama</th><th>Periode</th><th>Bank</th><th>Jumlah</th><th>Bukti</th></tr></thead>
                <tbody>
                    ${transactions.slice(0, 10).map(tx => `
                        <tr>
                            <td data-label="Tanggal" data-date="${tx.t?.toDate ? tx.t.toDate().toISOString() : tx.t}">${formatResponsiveDate(tx.t)}</td>
                            <td data-label="Nama">${allUsersCache.find(u => u.id === tx.userId)?.displayName || 'N/A'}</td>
                            <td data-label="Periode" data-period="${tx.from || 'N/A'} → ${tx.to || 'N/A'}">
                                <span class="chip chip-period">
                                    <span class="period-line">${formatResponsivePeriod(tx.from)}</span>
                                    <span class="period-arrow">${getResponsiveArrow()}</span>
                                    <span class="period-line">${formatResponsivePeriod(tx.to)}</span>
                                </span>
                            </td>
                            <td data-label="Bank">${tx.bank ? tx.bank.name : '—'}</td>
                            <td data-label="Jumlah">${money(tx.amount)}</td>
                            <td data-label="Bukti" class="proof-cell">${tx.fileUrl ? createProofImageHTML(tx.fileUrl, 150, 100) : '—'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            ${transactions.length > 10 ? `<p class="muted" style="text-align:center; margin-top:12px;">Menampilkan 10 dari ${transactions.length} transaksi...</p>` : ''}
        </div>
    `;
    
    // Complete the smooth transition
    setTimeout(() => {
        previewContainer.style.opacity = '1';
        previewContainer.style.transform = 'translateY(0)';
    }, 50);
    
    // Click handlers are now handled by createProofImageElement
}

function setupExportEventListeners() {
    let selectedUserIds = [];
    let selectedBankIds = [];
    const multiSelectInput = qs('#multiSelectInput');
    const multiSelectDropdown = qs('#multiSelectDropdown');
    const bankMultiSelectInput = qs('#bankMultiSelectInput');
    const bankMultiSelectDropdown = qs('#bankMultiSelectDropdown');
    const startDateInput = qs('#startDate');
    const endDateInput = qs('#endDate');
    
    multiSelectDropdown.insertAdjacentHTML('afterbegin', `
        <div style="padding: 8px; border-bottom: 1px solid var(--md-outline-variant); position: sticky; top: -1px; background: var(--md-surface-container); z-index: 1;">
            <input type="search" id="exportUserSearch" placeholder="Cari anggota..." class="field" style="width: 100%; padding: 8px !important;">
        </div>
    `);

    const updateUserPills = () => {
        const container = qs('#user-pills-container');
        const placeholder = qs('.multi-select-placeholder');
        container.innerHTML = '';
        if (selectedUserIds.length === 0) {
            placeholder.style.display = 'block';
        } else {
            placeholder.style.display = 'none';
            selectedUserIds.forEach(userId => {
                const user = allUsersCache.find(u => u.id === userId);
                if (user) {
                    const pill = document.createElement('div');
                    pill.className = 'selected-item-pill';
                    pill.textContent = user.displayName;
                    const removeBtn = document.createElement('button');
                    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
                    removeBtn.onclick = (e) => {
                        e.stopPropagation();
                        selectedUserIds = selectedUserIds.filter(id => id !== userId);
                        const checkbox = qs(`input[value="${userId}"]`);
                        if (checkbox) checkbox.checked = false;
                        updateUserPills();
                        debounce(updateReportPreview, 300)();
                    };
                    pill.appendChild(removeBtn);
                    container.appendChild(pill);
                }
            });
        }
    };
    
    multiSelectDropdown.insertAdjacentHTML('beforeend', allUsersCache.map(user => `
        <label><input type="checkbox" class="user-checkbox" value="${user.id}"> ${user.displayName}</label>
    `).join(''));

    // Bank filter setup
    const updateBankPills = () => {
        const container = qs('#bank-pills-container');
        const placeholder = qs('#bankMultiSelectInput .multi-select-placeholder');
        container.innerHTML = '';
        if (selectedBankIds.length === 0) {
            placeholder.style.display = 'block';
        } else {
            placeholder.style.display = 'none';
            selectedBankIds.forEach(bankId => {
                const bank = allBanksCache.find(b => b.id === bankId);
                if (bank) {
                    const pill = document.createElement('div');
                    pill.className = 'selected-item-pill';
                    pill.textContent = bank.name;
                    const removeBtn = document.createElement('button');
                    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
                    removeBtn.onclick = (e) => {
                        e.stopPropagation();
                        selectedBankIds = selectedBankIds.filter(id => id !== bankId);
                        const checkbox = qs(`input[value="${bankId}"]`);
                        if (checkbox) checkbox.checked = false;
                        updateBankPills();
                        debounce(updateReportPreview, 300)();
                    };
                    pill.appendChild(removeBtn);
                    container.appendChild(pill);
                }
            });
        }
    };

    // Load banks and populate bank dropdown
    getBanks().then(banks => {
        allBanksCache = banks;
        bankMultiSelectDropdown.insertAdjacentHTML('afterbegin', `
            <div style="padding: 8px; border-bottom: 1px solid var(--md-outline-variant); position: sticky; top: -1px; background: var(--md-surface-container); z-index: 1;">
                <input type="search" id="exportBankSearch" placeholder="Cari bank..." class="field" style="width: 100%; padding: 8px !important;">
            </div>
        `);
        
        bankMultiSelectDropdown.insertAdjacentHTML('beforeend', banks.map(bank => `
            <label><input type="checkbox" class="bank-checkbox" value="${bank.id}"> ${bank.name}</label>
        `).join(''));

        // Bank search functionality
        qs('#exportBankSearch').oninput = debounce(e => {
            const searchTerm = e.target.value.toLowerCase();
            bankMultiSelectDropdown.querySelectorAll('label:not(.select-all-label)').forEach(label => {
                label.style.display = label.textContent.toLowerCase().includes(searchTerm) ? 'flex' : 'none';
            });
        }, 300);
        qs('#exportBankSearch').onclick = e => e.stopPropagation();
    });
    
    qs('#exportUserSearch').oninput = debounce(e => {
        const searchTerm = e.target.value.toLowerCase();
        multiSelectDropdown.querySelectorAll('label:not(.select-all-label)').forEach(label => {
            label.style.display = label.textContent.toLowerCase().includes(searchTerm) ? 'flex' : 'none';
        });
    }, 300);
    qs('#exportUserSearch').onclick = e => e.stopPropagation();

    // FIX: Set default date range to the current year
    const today = new Date();
    const currentYear = today.getUTCFullYear(); // Use UTC year for server time
    const firstDayOfYear = new Date(Date.UTC(currentYear, 0, 1));
    const lastDayOfYear = new Date(Date.UTC(currentYear, 11, 31));

    startDateInput.value = firstDayOfYear.toISOString().split('T')[0];
    endDateInput.value = lastDayOfYear.toISOString().split('T')[0];

    multiSelectInput.onclick = () => multiSelectDropdown.classList.toggle('hidden');
    bankMultiSelectInput.onclick = () => bankMultiSelectDropdown.classList.toggle('hidden');
    
    qs('#selectAllUsers').onchange = (e) => {
        const isChecked = e.target.checked;
        qsa('.user-checkbox').forEach(checkbox => checkbox.checked = isChecked);
        selectedUserIds = isChecked ? allUsersCache.map(u => u.id) : [];
        updateUserPills();
        debounce(updateReportPreview, 300)();
    };

    qs('#selectAllBanks').onchange = (e) => {
        const isChecked = e.target.checked;
        qsa('.bank-checkbox').forEach(checkbox => checkbox.checked = isChecked);
        selectedBankIds = isChecked ? allBanksCache.map(b => b.id) : [];
        updateBankPills();
        debounce(updateReportPreview, 300)();
    };
    
    multiSelectDropdown.addEventListener('change', e => {
        if (e.target.classList.contains('user-checkbox')) {
            const userId = e.target.value;
            if (e.target.checked) {
                if (!selectedUserIds.includes(userId)) selectedUserIds.push(userId);
            } else {
                selectedUserIds = selectedUserIds.filter(id => id !== userId);
            }
            updateUserPills();
            debounce(updateReportPreview, 300)();
        }
    });

    bankMultiSelectDropdown.addEventListener('change', e => {
        if (e.target.classList.contains('bank-checkbox')) {
            const bankId = e.target.value;
            if (e.target.checked) {
                if (!selectedBankIds.includes(bankId)) selectedBankIds.push(bankId);
            } else {
                selectedBankIds = selectedBankIds.filter(id => id !== bankId);
            }
            updateBankPills();
            debounce(updateReportPreview, 300)();
        }
    });

    globalClickListener = (e) => {
        const userContainer = qs('#multiSelectInput').closest('.multi-select-container');
        const bankContainer = qs('#bankMultiSelectInput').closest('.multi-select-container');
        
        if (userContainer && !userContainer.contains(e.target)) {
            const dropdown = qs('#multiSelectDropdown');
            if(dropdown) dropdown.classList.add('hidden');
        }
        
        if (bankContainer && !bankContainer.contains(e.target)) {
            const dropdown = qs('#bankMultiSelectDropdown');
            if(dropdown) dropdown.classList.add('hidden');
        }
    };
    document.addEventListener('click', globalClickListener);

    startDateInput.onchange = debounce(updateReportPreview, 300);
    endDateInput.onchange = debounce(updateReportPreview, 300);

    qs('#exportBtnExcel').onclick = () => handleExport(selectedUserIds, selectedBankIds, 'excel');
    qs('#exportBtnHTML').onclick = () => handleExport(selectedUserIds, selectedBankIds, 'html');
}

function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}


async function handleExport(selectedUserIds, selectedBankIds, format) {
    const startDate = qs('#startDate').value;
    const endDate = qs('#endDate').value;
    
    let constraints = [orderBy('t', 'desc')];
    if (selectedUserIds.length > 0) {
        constraints.push(where('userId', 'in', selectedUserIds));
    }
    if (startDate) {
        constraints.push(where('t', '>=', Timestamp.fromDate(new Date(startDate))));
    }
    if (endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        constraints.push(where('t', '<=', Timestamp.fromDate(endOfDay)));
    }

    const q = query(collection(db, 'transactions'), ...constraints);
    const querySnapshot = await getDocs(q);
    let transactions = querySnapshot.docs.map(doc => doc.data());

    // Filter by bank if bank filter is applied
    if (selectedBankIds.length > 0) {
        transactions = transactions.filter(tx => 
            tx.bank && selectedBankIds.includes(tx.bank.id)
        );
    }

    if (transactions.length === 0) {
        return showToast('Tidak ada data transaksi yang cocok dengan filter.', 'warning');
    }

    if (format === 'excel') {
        const excelData = transactions.map(tx => ({
            'Tanggal': formatResponsiveDate(tx.t),
            'Email': tx.username,
            'Nama': allUsersCache.find(u => u.id === tx.userId)?.displayName || 'N/A',
            'Periode': `${tx.from} - ${tx.to}`,
            'Jumlah': tx.amount,
            'Bank': tx.bank ? tx.bank.name : '—',
            'No. Rekening': tx.bank ? tx.bank.accountNumber : '—',
            'Keterangan': tx.ket || '—',
            'Link Bukti': tx.fileUrl || '—'
        }));
        downloadExcel(excelData, `laporan-kas-${new Date().toISOString().split('T')[0]}.xlsx`);
    } else {
        downloadHTML(transactions, {startDate, endDate, selectedUserIds, selectedBankIds});
    }
}

function downloadCSV(data, filename) {
    const header = Object.keys(data[0]).join(',');
    const rows = data.map(row => Object.values(row).map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const csvContent = `data:text/csv;charset=utf-8,${header}\n${rows}`;
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function downloadExcel(data, filename) {
    // Create a new workbook
    const wb = XLSX.utils.book_new();
    
    // Convert data to worksheet
    const ws = XLSX.utils.json_to_sheet(data);
    
    // Set column widths for better readability
    const colWidths = [
        { wch: 12 }, // Tanggal
        { wch: 25 }, // Email
        { wch: 20 }, // Nama
        { wch: 15 }, // Periode
        { wch: 12 }, // Jumlah
        { wch: 15 }, // Bank
        { wch: 18 }, // No. Rekening
        { wch: 30 }, // Keterangan
        { wch: 40 }  // Link Bukti
    ];
    ws['!cols'] = colWidths;
    
    // Add header styling
    const headerRange = XLSX.utils.decode_range(ws['!ref']);
    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        if (!ws[cellAddress]) continue;
        
        // Set header cell properties
        ws[cellAddress].s = {
            font: { bold: true, color: { rgb: "FFFFFF" } },
            fill: { fgColor: { rgb: "4472C4" } },
            alignment: { horizontal: "center", vertical: "center" },
            border: {
                top: { style: "thin", color: { rgb: "000000" } },
                bottom: { style: "thin", color: { rgb: "000000" } },
                left: { style: "thin", color: { rgb: "000000" } },
                right: { style: "thin", color: { rgb: "000000" } }
            }
        };
    }
    
    // Style data cells
    for (let row = 1; row <= headerRange.e.r; row++) {
        for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
            if (!ws[cellAddress]) continue;
            
            // Alternate row colors
            const isEvenRow = row % 2 === 0;
            ws[cellAddress].s = {
                fill: { fgColor: { rgb: isEvenRow ? "F2F2F2" : "FFFFFF" } },
                alignment: { vertical: "center" },
                border: {
                    top: { style: "thin", color: { rgb: "CCCCCC" } },
                    bottom: { style: "thin", color: { rgb: "CCCCCC" } },
                    left: { style: "thin", color: { rgb: "CCCCCC" } },
                    right: { style: "thin", color: { rgb: "CCCCCC" } }
                }
            };
            
            // Special formatting for specific columns
            if (col === 4) { // Jumlah column
                ws[cellAddress].s.numFmt = '#,##0';
                ws[cellAddress].s.alignment = { horizontal: "right", vertical: "center" };
            } else if (col === 8) { // Link Bukti column
                ws[cellAddress].s.font = { color: { rgb: "0066CC" }, underline: true };
            }
        }
    }
    
    // Add the worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, "Laporan Kas");
    
    // Generate and download the file
    XLSX.writeFile(wb, filename);
}

function downloadHTML(data, filters) {
    const totalAmount = data.reduce((sum, tx) => sum + tx.amount, 0);
    const memberNames = filters.selectedUserIds.length > 0 && filters.selectedUserIds.length < allUsersCache.length
        ? filters.selectedUserIds.map(id => allUsersCache.find(u => u.id === id)?.displayName).join(', ') 
        : 'Semua Anggota';

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Laporan Kas Pemuda</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f9fafb; color: #1f2937; }
                .container { max-width: 800px; margin: auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                h1, h2 { text-align: center; color: #111827; }
                h1 { margin-bottom: 5px; }
                h2 { font-size: 1.1rem; color: #6b7280; font-weight: 500; margin-top: 0; margin-bottom: 30px; }
                .summary { display: flex; justify-content: space-around; background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
                .summary-item { text-align: center; }
                .summary-item .label { font-size: 0.9rem; color: #4b5563; }
                .summary-item .value { font-size: 1.5rem; font-weight: 600; color: #1f2937; }
                table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
                th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #e5e7eb; }
                thead th { background-color: #f3f4f6; font-weight: 600; color: #374151; }
                tbody tr:nth-child(even) { background-color: #f9fafb; }
                tbody tr:hover { background-color: #f0f9ff; }
                .amount { font-weight: 500; }
                .link a { color: #2563eb; text-decoration: none; }
                .link a:hover { text-decoration: underline; }
                @media print { body { background: none; } .container { box-shadow: none; } }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Laporan Kas Pemuda</h1>
                <h2>Periode: ${filters.startDate || 'Awal'} - ${filters.endDate || 'Akhir'}</h2>
                
                <div class="summary">
                    <div class="summary-item">
                        <div class="label">Total Transaksi</div>
                        <div class="value">${data.length}</div>
                    </div>
                    <div class="summary-item">
                        <div class="label">Total Setoran</div>
                        <div class="value">${money(totalAmount)}</div>
                    </div>
                     <div class="summary-item">
                        <div class="label">Anggota</div>
                        <div class="value" style="font-size: 1rem; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${memberNames}</div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Tanggal</th>
                            <th>Nama</th>
                            <th>Periode</th>
                            <th>Bank</th>
                            <th>No. Rekening</th>
                            <th style="text-align: right;">Jumlah</th>
                            <th>Bukti</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(tx => `
                            <tr>
                                <td data-date="${tx.t?.toDate ? tx.t.toDate().toISOString() : tx.t}">${formatResponsiveDate(tx.t)}</td>
                                <td>${allUsersCache.find(u => u.id === tx.userId)?.displayName || 'N/A'}</td>
                                <td>${formatResponsivePeriod(tx.from)} → ${formatResponsivePeriod(tx.to)}</td>
                                <td>${tx.bank ? tx.bank.name : '—'}</td>
                                <td>${tx.bank ? tx.bank.accountNumber : '—'}</td>
                                <td class="amount" style="text-align: right;">${money(tx.amount)}</td>
                                <td class="link">${tx.fileUrl ? `<a href="${tx.fileUrl}" target="_blank"><i class="fas fa-external-link-alt"></i> Lihat</a>` : '—'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </body>
        </html>
    `;
    const reportWindow = window.open('', '_blank');
    reportWindow.document.write(htmlContent);
    reportWindow.document.close();
}


// ==========================================================================
// App Shell & Auth
// ==========================================================================

// Helper function to show logout button with responsive display
function showLogoutButton() {
    const logoutBtn = qs('#logoutBtn');
    if (logoutBtn) {
        logoutBtn.style.display = window.innerWidth <= 768 ? 'flex' : 'inline-flex';
    }
}
function renderLogin() {
    qs('#year-filter-container').style.display = 'none';
    const sidebarToggle = qs('#sidebarToggle');
    if (sidebarToggle) sidebarToggle.style.display = 'none';
    
    // Hide logout button on login page
    const logoutBtn = qs('#logoutBtn');
    if (logoutBtn) logoutBtn.style.display = 'none';
    appElement.innerHTML = `
        <div class="login-container">
            <div class="card login-card">
                <h2>Selamat Datang</h2>
                <p class="muted">Masuk dengan akun Google Anda untuk mengelola kas pemuda.</p>
                <button class="btn btn-filled" id="googleSignIn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"></path><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"></path><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"></path><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"></path></svg>
                    <span>Masuk dengan Google</span>
                </button>
            </div>
        </div>`;

    qs('#googleSignIn').onclick = async () => {
        try { await signInWithPopup(auth, provider); } 
        catch (error) { showToast(`Login gagal: ${error.message}`, 'error'); }
    };
}

async function renderApp() {
    const user = auth.currentUser; if (!user) return renderLogin();
    
    allUsersCache = [];
    
    const me = await getUser(user.uid);
    if (!me) {
        appElement.innerHTML = `<div class="card"><p class="muted">Gagal memuat data pengguna. Coba refresh halaman.</p></div>`;
        return;
    }
    
    if (me.role === 'admin' && allUsersCache.length === 0) {
        const usersSnapshot = await getDocs(query(collection(db, 'users'), orderBy('displayName')));
        allUsersCache = usersSnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
    }


    appElement.innerHTML=`
        <div class="sidebar-overlay" id="sidebarOverlay"></div>
        <div class="app-layout">
          <aside class="sidebar" id="sidebar">
            <div class="sidebar-body">
              <nav class="sidebar-nav">
                <div class="nav-section">
                  <h3 class="nav-section-title">Menu Utama</h3>
                  <div class="nav-items">
                    <button class="nav-item active" id="menu_dashboard" data-icon="dashboard">
                      <span class="nav-item-icon"><i class="material-icons">dashboard</i></span>
                      <span class="nav-item-text">Dashboard</span>
                    </button>
                    <button class="nav-item" id="menu_setor" data-icon="account_balance_wallet">
                      <span class="nav-item-icon"><i class="material-icons">account_balance_wallet</i></span>
                      <span class="nav-item-text">Setor Kas</span>
                    </button>
                    <button class="nav-item" id="menu_history" data-icon="history">
                      <span class="nav-item-icon"><i class="material-icons">history</i></span>
                      <span class="nav-item-text">Riwayat Transaksi</span>
                    </button>
                  </div>
                </div>
                
                ${me.role==='admin'?`
                <div class="nav-section">
                  <h3 class="nav-section-title">Admin</h3>
                  <div class="nav-items">
                    <button class="nav-item" id="menu_users" data-icon="people">
                      <span class="nav-item-icon"><i class="material-icons">people</i></span>
                      <span class="nav-item-text">Kelola Pengguna</span>
                    </button>
                    <button class="nav-item" id="menu_deductions" data-icon="money_off">
                      <span class="nav-item-icon"><i class="material-icons">money_off</i></span>
                      <span class="nav-item-text">Kelola Pengeluaran</span>
                    </button>
                    <button class="nav-item" id="menu_banks" data-icon="account_balance">
                      <span class="nav-item-icon"><i class="material-icons">account_balance</i></span>
                      <span class="nav-item-text">List Bank</span>
                    </button>
                    <button class="nav-item" id="menu_export" data-icon="file_download">
                      <span class="nav-item-icon"><i class="material-icons">file_download</i></span>
                      <span class="nav-item-text">Ekspor Laporan</span>
                    </button>
                    <button class="nav-item" id="menu_settings" data-icon="settings">
                      <span class="nav-item-icon"><i class="material-icons">settings</i></span>
                      <span class="nav-item-text">Pengaturan Kas</span>
                    </button>
                    <button class="nav-item" id="menu_appscript" data-icon="code">
                      <span class="nav-item-icon"><i class="material-icons">code</i></span>
                      <span class="nav-item-text">Apps Script</span>
                    </button>
                  </div>
                </div>`:''}
                
                <div class="nav-section">
                  <h3 class="nav-section-title">Tampilan</h3>
                  <div class="nav-items">
                    <button class="nav-item" id="themeToggle" data-icon="palette">
                      <span class="nav-item-icon"><i class="material-icons">palette</i></span>
                      <span class="nav-item-text">Ubah Tema</span>
                    </button>
                  </div>
                </div>
              </nav>
            </div>
          </aside>
          
          <main class="main-content" id="mainContent">
            <section id="panel">
                <div class="loading-placeholder">
                  <div class="spinner"></div>
                </div>
            </section>
          </main>
        </div>`;
    
    await setupHeader();

    // Setup logout button in header
    const logoutBtn = qs('#logoutBtn');
    if (logoutBtn) {
        logoutBtn.onclick = () => signOut(auth);
        showLogoutButton(); // Show logout button when authenticated
    }
    
    // Show sidebar toggle button
    const sidebarToggle = qs('#sidebarToggle');
    if (sidebarToggle) sidebarToggle.style.display = 'inline-flex';

    // Setup sidebar toggle functionality
    setupSidebar();

    // Initialize theme controls in sidebar
    initTheme();
    
    // Setup theme modal
    setupThemeModal();
    
    // Ensure color picker is properly initialized for mobile/portrait
    setTimeout(() => {
        const colorPalette = qs('#colorPalette');
        const colorControls = qs('.color-controls');
        if (colorPalette && colorControls) {
            // Force visibility for mobile/portrait
            const isPortrait = window.matchMedia('(orientation: portrait)').matches;
            const isMobile = window.innerWidth <= 1024;
            
            if (isPortrait || isMobile) {
                colorControls.style.display = 'flex';
                colorControls.style.visibility = 'visible';
                colorPalette.style.display = 'flex';
                colorPalette.style.visibility = 'visible';
                colorPalette.style.opacity = '1';
            }
            
            // Re-initialize swatch event handlers to ensure they work
            qsa('.color-swatch').forEach(el => {
                if (!el.onclick) {
                    el.onclick = (e) => {
                        e.stopPropagation();
                        const seed = el.dataset.seed;
                        // Apply seed color
                        document.documentElement.setAttribute('data-seed', seed);
                        localStorage.setItem('kas_seed_v5', seed);
                        // Update selected swatch
                        qsa('.color-swatch').forEach(swatch => 
                            swatch.classList.toggle('selected', swatch.dataset.seed === seed)
                        );
                    };
                }
            });
        }
    }, 100);
    
    // Add orientation change listener to ensure color picker visibility
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            const colorPalette = qs('#colorPalette');
            const colorControls = qs('.color-controls');
            if (colorPalette && colorControls) {
                const isPortrait = window.matchMedia('(orientation: portrait)').matches;
                const isMobile = window.innerWidth <= 1024;
                
                if (isPortrait || isMobile) {
                    colorControls.style.display = 'flex';
                    colorControls.style.visibility = 'visible';
                    colorPalette.style.display = 'flex';
                    colorPalette.style.visibility = 'visible';
                    colorPalette.style.opacity = '1';
                }
            }
        }, 200);
    });

    const menuActions = {
        menu_dashboard: renderDashboard,
        menu_setor: renderSetor,
        menu_history: renderHistory,
        ...(me.role === 'admin' && {
            menu_users: renderUserManagement,
            menu_deductions: renderDeductionManagement,
            menu_banks: renderBankManagement,
            menu_export: renderExportReport,
            menu_settings: renderSettingsManagement,
            menu_appscript: renderAppsScriptSetup,
        }),
    };

    Object.entries(menuActions).forEach(([id, action]) => {
        const button = qs(`#${id}`);
        if(button) {
            button.onclick = async () => {
                updateActiveMenu(id);
                const isDashboard = id === 'menu_dashboard' || id === 'menu_deductions' || id === 'menu_users';
                const yearFilter = qs('#year-filter-container');
                if (yearFilter) {
                    yearFilter.style.display = isDashboard ? 'flex' : 'none';
                    // Force reflow on mobile to ensure visibility change takes effect
                    if (window.innerWidth <= 768) {
                        yearFilter.offsetHeight; // Force reflow
                    }
                }
                await smoothTransition(action);
                
                // Close sidebar on mobile after navigation is complete
                if (window.innerWidth <= 1024) {
                    const sidebar = qs('#sidebar');
                    const overlay = qs('#sidebarOverlay');
                    const mainContent = qs('.main-content');
                    
                    if (sidebar && sidebar.classList.contains('open')) {
                        sidebar.classList.remove('open');
                        overlay.classList.remove('visible');
                        mainContent.classList.remove('sidebar-open');
                        document.body.classList.remove('no-scroll');
                    }
                }
            };
        }
    });
    
    await smoothTransition(renderDashboard);
}

async function setupHeader() {
    // Year filter visibility will be controlled by menu navigation
    const yearFilter = qs('#yearFilter');
    
    const settings = await getContributionSettings();
    const availableYears = Object.keys(settings).sort((a,b) => b-a);
    
    if (availableYears.length > 0) {
        yearFilter.innerHTML = availableYears.map(y => `<option value="${y}">${y}</option>`).join('');
        const currentYear = new Date().getFullYear();
        selectedYear = availableYears.includes(String(currentYear)) ? currentYear : parseInt(availableYears[0]);
        yearFilter.value = selectedYear;
    } else {
        const currentYear = new Date().getFullYear();
        yearFilter.innerHTML = `<option value="${currentYear}">${currentYear}</option>`;
        selectedYear = currentYear;
    }


    yearFilter.onchange = () => {
        selectedYear = parseInt(yearFilter.value, 10);
        if (qs('#menu_dashboard').classList.contains('active')) {
            smoothTransition(renderDashboard);
        } else if (qs('#menu_deductions')?.classList.contains('active')) {
            smoothTransition(renderDeductionManagement);
        } else if (qs('#menu_users')?.classList.contains('active')) {
            smoothTransition(renderUserManagement);
        }
    };
}

async function renderSettingsManagement() {
    const panel = qs('#panel');
    
    // Ensure logout button is visible
    showLogoutButton();
    
    // Hide year filter for this page
    qs('#year-filter-container').style.display = 'none';
    
    const settings = await getContributionSettings();
    let years = Object.keys(settings).length > 0 ? Object.keys(settings).map(Number).sort((a, b) => a - b) : [new Date().getFullYear()];
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    let selectedYear = years[0] || new Date().getFullYear();

    const render = () => {
        panel.innerHTML = `
            <h2>Pengaturan Kas</h2>
            <div class="card" style="margin-top:24px;">
                <h3>Bulan Mulai Setoran per Tahun</h3>
                <p class="muted">Tentukan bulan pertama periode setoran untuk setiap tahun. Tahun yang terdaftar di sini akan muncul di menu Setor Kas.</p>
                
                <div class="row" style="margin-bottom: 24px; align-items: center;">
                    <div class="col">
                        <label for="yearSelector">Pilih Tahun:</label>
                        <div class="field">
                            <select id="yearSelector">
                                ${years.map(year => `
                                    <option value="${year}" ${year === selectedYear ? 'selected' : ''}>${year}</option>
                                `).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="col">
                        <label for="monthSelector">Bulan Mulai Setoran:</label>
                        <div class="field">
                            <select id="monthSelector">
                                ${months.map((month, i) => `
                                    <option value="${i + 1}" ${(settings[selectedYear] || 1) == (i + 1) ? 'selected' : ''}>${month}</option>
                                `).join('')}
                            </select>
                        </div>
                    </div>
                </div>
                
                <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    <button id="addYearBtn" class="btn btn-outlined"><i class="fas fa-plus"></i> Tambah Tahun</button>
                    <button id="removeYearBtn" class="btn btn-outlined danger" ${years.length <= 1 ? 'disabled' : ''}><i class="fas fa-trash"></i> Hapus Tahun</button>
                    <button id="saveSettingsBtn" class="btn btn-filled"><i class="fas fa-save"></i> Simpan Pengaturan</button>
                </div>
            </div>
        `;

        // Year selector change handler
        qs('#yearSelector').onchange = (e) => {
            selectedYear = parseInt(e.target.value, 10);
            // Update month selector to show current setting for selected year
            const monthSelect = qs('#monthSelector');
            monthSelect.value = settings[selectedYear] || 1;
        };

        // Month selector change handler
        qs('#monthSelector').onchange = (e) => {
            settings[selectedYear] = parseInt(e.target.value, 10);
        };

        // Add year button
        qs('#addYearBtn').onclick = () => {
            showAddYearModal(years, (newYear) => {
                if (!years.includes(newYear)) {
                    years.push(newYear);
                    years.sort((a, b) => a - b);
                    settings[newYear] = 1; // Default to January
                    selectedYear = newYear;
                    render();
                } else {
                    showToast('Tahun tersebut sudah ada dalam daftar.', 'warning');
                }
            });
        };

        // Remove year button
        qs('#removeYearBtn').onclick = () => {
            if (years.length <= 1) {
                showToast('Harus ada minimal satu tahun pengaturan.', 'warning');
                return;
            }
            
            if (confirm(`Yakin ingin menghapus tahun ${selectedYear}?`)) {
                years = years.filter(y => y !== selectedYear);
                delete settings[selectedYear];
                selectedYear = years[0];
                render();
            }
        };

        // Save settings button
        qs('#saveSettingsBtn').onclick = async () => {
            // Update current year's setting before saving
            settings[selectedYear] = parseInt(qs('#monthSelector').value, 10);
            
            await updateContributionSettings(settings);
            showToast('Pengaturan berhasil disimpan.', 'success');
            await setupHeader(); // Refresh header after saving
        };
    };

    render();
}

// Modal for adding new year
function showAddYearModal(existingYears, callback) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop';
    modalBackdrop.style.zIndex = '10000';
    
    const currentYear = new Date().getFullYear();
    const yearOptions = [];
    
    // Generate year options from 2020 to current year + 5
    for (let year = 2020; year <= currentYear + 5; year++) {
        if (!existingYears.includes(year)) {
            yearOptions.push(year);
        }
    }
    
    modalBackdrop.innerHTML = `
        <div class="modal" style="max-width: 400px;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Tambah Tahun Baru</h3>
                    <button class="modal-close" id="closeAddYearModal">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p class="muted" style="margin-bottom: 16px;">Pilih tahun yang ingin ditambahkan ke pengaturan kas:</p>
                    <div class="field">
                        <select id="newYearSelect" style="width: 100%;">
                            ${yearOptions.map(year => `
                                <option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outlined" id="cancelAddYear">Batal</button>
                    <button class="btn btn-filled" id="confirmAddYear">Tambah Tahun</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modalBackdrop);
    document.body.classList.add('no-scroll');
    
    // Event handlers
    const closeModal = () => {
        document.body.removeChild(modalBackdrop);
        document.body.classList.remove('no-scroll');
    };
    
    qs('#closeAddYearModal').onclick = closeModal;
    qs('#cancelAddYear').onclick = closeModal;
    qs('#confirmAddYear').onclick = () => {
        const selectedYear = parseInt(qs('#newYearSelect').value, 10);
        callback(selectedYear);
        closeModal();
    };
    
    // Close on backdrop click
    modalBackdrop.onclick = (e) => {
        if (e.target === modalBackdrop) {
            closeModal();
        }
    };
    
    // Close on Escape key
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}


// ==========================================================================
// Hidden Cache Clear Feature
// ==========================================================================

let redButtonClickCount = 0;
let redClickTimeout = null;

function setupHiddenCacheClear() {
    // Add event listener to red theme color swatch (rose) and danger buttons
    document.addEventListener('click', (e) => {
        const isRedThemeColor = e.target.classList.contains('swatch') && e.target.dataset.seed === 'rose';
        const isDangerButton = e.target.classList.contains('danger') && e.target.classList.contains('btn');
        
        if (isRedThemeColor || isDangerButton) {
            redButtonClickCount++;
            
            // Reset counter after 3 seconds of no clicks
            if (redClickTimeout) {
                clearTimeout(redClickTimeout);
            }
            redClickTimeout = setTimeout(() => {
                redButtonClickCount = 0;
            }, 3000);
            
            // Trigger cache clear after 5 clicks
            if (redButtonClickCount >= 5) {
                redButtonClickCount = 0;
                clearTimeout(redClickTimeout);
                
                // Clear all image caches from sessionStorage
                const keysToRemove = [];
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    if (key && key.startsWith('image_')) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(key => sessionStorage.removeItem(key));
                
                const location = isRedThemeColor ? 'red theme color' : 'danger button';
                showToast(`🗑️ Hidden feature activated via ${location}: Cache gambar dibersihkan (${keysToRemove.length} gambar)`, 'info');
                
                // Refresh current view to show progress bars
                if (window.location.hash.includes('riwayat')) {
                    renderRiwayat();
                } else if (window.location.hash.includes('dashboard') || !window.location.hash) {
                    renderDashboard();
                }
            }
        }
    });
}

// ==========================================================================
// Initialization
// ==========================================================================

function initApp() {
    // Set up global event listeners for the modal that persist across renders
    const modalBackdrop = qs('#imageModalBackdrop');
    const modalImage = qs('#modalImage');

    // Zoom controls
    const zoomInBtn = qs('#zoomIn');
    const zoomOutBtn = qs('#zoomOut');
    const zoomResetBtn = qs('#zoomReset');

    // Mouse wheel zoom
    if (modalImage) {
        modalImage.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) {
                zoomIn();
            } else {
                zoomOut();
            }
        });

        // Pan functionality
        modalImage.addEventListener('mousedown', (e) => {
            if (zoomLevel > 1) {
                isDragging = true;
                startX = e.clientX - panX;
                startY = e.clientY - panY;
                modalImage.style.cursor = 'grabbing';
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging && zoomLevel > 1) {
                panX = e.clientX - startX;
                panY = e.clientY - startY;
                applyTransform();
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            modalImage.style.cursor = zoomLevel > 1 ? 'grab' : 'default';
        });

        // Touch support for pan
        modalImage.addEventListener('touchstart', (e) => {
            if (zoomLevel > 1 && e.touches.length === 1) {
                const t = e.touches[0];
                isDragging = true;
                startX = t.clientX - panX;
                startY = t.clientY - panY;
            }
        }, { passive: false });
        modalImage.addEventListener('touchmove', (e) => {
            if (isDragging && zoomLevel > 1 && e.touches.length === 1) {
                e.preventDefault();
                const t = e.touches[0];
                panX = t.clientX - startX;
                panY = t.clientY - startY;
                applyTransform();
            }
        }, { passive: false });
        modalImage.addEventListener('touchend', () => {
            isDragging = false;
        });
    }

    // Zoom button event listeners
    if (zoomInBtn) zoomInBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); zoomIn(); });
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); zoomOut(); });
    if (zoomResetBtn) zoomResetBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); resetZoom(); });

    // Close button listener
    qs('#closeModal').onclick = () => {
        closeImageModal();
    };

    // Backdrop click listener
    modalBackdrop.onclick = e => {
        if (e.target === modalBackdrop) {
            closeImageModal();
        }
    };
    
    // Keyboard navigation for modal
    document.addEventListener('keydown', (e) => {
        const modal = qs('#imageModalBackdrop');
        if (!modal.classList.contains('hidden')) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeImageModal();
            } else if (e.key === '+') {
                e.preventDefault();
                zoomIn();
            } else if (e.key === '-') {
                e.preventDefault();
                zoomOut();
            } else if (e.key.toLowerCase && e.key.toLowerCase() === 'r') {
                e.preventDefault();
                resetZoom();
            }
        }
    });

    // Delegated zoom clicks to handle re-renders
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        if (t.id === 'zoomIn') { e.preventDefault(); e.stopPropagation(); zoomIn(); }
        if (t.id === 'zoomOut') { e.preventDefault(); e.stopPropagation(); zoomOut(); }
        if (t.id === 'zoomReset') { e.preventDefault(); e.stopPropagation(); resetZoom(); }
    });

}

function initTheme() {
    const KEY_THEME='kas_theme_v5', KEY_SEED='kas_seed_v5';
    const savedTheme = localStorage.getItem(KEY_THEME) || 'light';
    const savedSeed = localStorage.getItem(KEY_SEED) || 'indigo';
    
    // Cache reset tracking
    let redClickCount = 0;
    let redClickTimeout = null;
    const RED_CLICK_RESET_TIME = 3000; // 3 seconds to reset counter
    const RED_CLICKS_NEEDED = 5;
    
    const applyTheme = mode => { document.documentElement.setAttribute('data-theme', mode); localStorage.setItem(KEY_THEME, mode); };
    const applySeed = seed => { document.documentElement.setAttribute('data-seed', seed); localStorage.setItem(KEY_SEED, seed); updateSelectedSwatch(); };
    const updateSelectedSwatch = () => { qsa('.swatch').forEach(el=>el.classList.toggle('selected', el.dataset.seed === document.documentElement.getAttribute('data-seed'))); };
    
    // Cache reset function
    const resetImageCache = async () => {
        try {
            // Clear browser cache for images
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                await Promise.all(
                    cacheNames.map(cacheName => caches.delete(cacheName))
                );
            }
            
            // Clear localStorage cache entries
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.includes('image') || key.includes('cache') || key.includes('blob'))) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
            
            // Clear sessionStorage image caches used by this app
            const sessionKeysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key && (key.startsWith('image_') || key.includes('image') || key.includes('cache'))) {
                    sessionKeysToRemove.push(key);
                }
            }
            sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key));
            
            // Clear any blob URLs
            if (window.URL && window.URL.revokeObjectURL) {
                // This is a best effort - we can't track all blob URLs
                console.log('Clearing blob URLs...');
            }
            // Silent reload after a short delay
            setTimeout(() => {
                window.location.reload();
            }, 300);
            
        } catch (error) {
            // Silent failure; log for diagnostics only
            console.error('Error resetting cache:', error);
        }
    };
    
    applyTheme(savedTheme);
    applySeed(savedSeed);

    qs('#themeToggle').onclick = (e) => {
        e.stopPropagation();
        applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    };
    
    qsa('.swatch').forEach(el => el.onclick = (e) => {
        e.stopPropagation();
        const seed = el.dataset.seed;
        
        // Check if it's the red color (rose)
        if (seed === 'rose') {
            redClickCount++;
            
            // Clear existing timeout
            if (redClickTimeout) {
                clearTimeout(redClickTimeout);
            }
            
            // Progress is silent to keep feature hidden
            
            // Set timeout to reset counter
            redClickTimeout = setTimeout(() => {
                redClickCount = 0;
            }, RED_CLICK_RESET_TIME);
            
            // Check if we've reached the required clicks
            if (redClickCount >= RED_CLICKS_NEEDED) {
                redClickCount = 0;
                if (redClickTimeout) {
                    clearTimeout(redClickTimeout);
                }
                resetImageCache();
                return; // Don't apply the color change
            }
        }
        
        // Apply the color change normally
        applySeed(seed);
    });
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const me = await getUser(user.uid);
            if (!me) {
                throw new Error("User profile could not be created or fetched.");
            }
            renderApp();
        } catch (error) {
            console.error("Authentication State Change Error:", error);
            showToast("Gagal memuat profil. Pastikan aturan keamanan sudah benar.", 'error', 6000);
            appElement.innerHTML = `
                <div class="login-container">
                    <div class="card login-card">
                        <h2 style="color:var(--md-danger);">Gagal Masuk</h2>
                        <p class="muted">Terjadi kesalahan izin saat memuat profil Anda. Ini biasanya terjadi jika aturan keamanan database salah. Silakan hubungi administrator.</p>
                        <button id="errorLogoutBtn" class="btn btn-outlined danger">Logout</button>
                    </div>
                </div>`;
            qs('#errorLogoutBtn').onclick = () => signOut(auth);
            qs('#logoutBtn').style.display = 'none';
            qs('#year-filter-container').style.display = 'none';
            const sidebarToggle = qs('#sidebarToggle');
            if (sidebarToggle) sidebarToggle.style.display = 'none';
        }
    } else {
        renderLogin();
    }
});

initApp(); // Use the new initializer
setupHiddenCacheClear(); // Set up hidden cache clear feature

