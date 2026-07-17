// ===================================================================================
// PRESENSI GURU SEKOLAH MINGGU GYS PONTIANAK ? v4.0 (REFINED UI & SCHEDULE-AWARE EXPORT)
// Deskripsi: Calendar-layout XLSX export with H/T/X markers, schedule-aware columns,
//            and a complete UI rework for all views and admin modals.
// ===================================================================================

// --- IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, getDocs, doc, getDoc, updateDoc, deleteDoc, where, Timestamp, setDoc, orderBy, writeBatch, collectionGroup, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- FUNGSI UTAMA APLIKASI ---
async function main() {
    // =================================
    // 1. KONFIGURASI & STATE
    // =================================
    const firebaseConfig = {
        apiKey: "AIzaSyC5MwR62OCCj9EEisCSBLPQBlfPqM7Np2M",
        authDomain: "gyspnk.firebaseapp.com",
        projectId: "gyspnk",
        storageBucket: "gyspnk.appspot.com",
        messagingSenderId: "682252302187",
        appId: "1:682252302187:web:4c4cd3684c359d87753e2e",
        measurementId: "G-783GMMP7TD"
    };
    const appId = firebaseConfig.projectId;
    const DAYS_OF_WEEK = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    let app, auth, db;
    let currentUser = null, currentUserRoles = [], globalSettings = {}, presenceSchedule = { slots: [] }, rolesConfig = {}, allUsersCache = [], activeCustomRole = null, todayHistoryCache = [], currentUserClass = null;
    let currentActivityFilter = 'today';
    let holidaysCache = {}; // dateKey -> description
    let holidayListCache = []; // loaded raw array
    let currentHolidayFilter = 'month';
    let firstPresenceCache = {}; // userEmail -> first presence Date or null

    // =================================
    // 2. INISIALISASI FIREBASE
    // =================================
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        await setPersistence(auth, browserLocalPersistence);
    } catch (e) {
        console.error("Fatal Error: Firebase initialization failed.", e);
        document.body.innerHTML = 'Gagal memuat aplikasi. Silakan periksa konsol (F12) untuk detail.';
        return;
    }

    // =================================
    // 3. REFERENSI ELEMEN DOM
    // =================================
    const DOMElements = {
        preloader: document.getElementById('page-preloader'),
        loadingOverlay: document.getElementById('loading-overlay'),
        modalRoot: document.getElementById('modal-root'),
        loginView: document.getElementById('login-view'),
        mainView: document.getElementById('main-view'),
        loginBtn: document.getElementById('login-btn'),
        logoutBtn: document.getElementById('logout-btn'),
        presensiBtn: document.getElementById('presensi-btn'),
        statusMessage: document.getElementById('status-message'),
        historyContainer: document.getElementById('history-container'),
        userNameEl: document.getElementById('user-name'),
        userEmailEl: document.getElementById('user-email'),
        userPhotoEl: document.getElementById('user-photo'),
        userRoleEl: document.getElementById('user-role'),
        adminMenuContainer: document.getElementById('admin-menu-container'),
        adminMenuBtn: document.getElementById('admin-menu-btn'),
        adminDropdown: document.getElementById('admin-dropdown'),
        customRoleTogglesContainer: document.getElementById('custom-role-toggles-container'),
        themeSettingsBtn: document.getElementById('theme-settings-btn'),
        serverClock: document.getElementById('server-clock'),
        submitIzinCutiBtn: document.getElementById('submit-izin-cuti-btn'),
        activityTabsContainer: document.getElementById('activity-tabs-container'),
        activityFilterInputs: document.getElementById('activity-filter-inputs'),
        izinCutiDate: document.getElementById('izin-cuti-date'),
        izinCutiEndDate: document.getElementById('izin-cuti-end-date'),
        izinCutiToText: document.getElementById('izin-cuti-to-text'),
        izinCutiDateLabel: document.getElementById('izin-cuti-date-label'),
        izinCutiReason: document.getElementById('izin-cuti-reason'),
        holidayWidget: document.getElementById('holiday-widget'),
        addHolidayBtn: document.getElementById('add-holiday-btn'),
        holidayContainer: document.getElementById('holiday-container'),
        holidayTabsContainer: document.getElementById('holiday-tabs-container'),
        holidayFilterInputs: document.getElementById('holiday-filter-inputs'),
    };

    // =================================
    // 4. FUNGSI UTILITAS & HELPERS
    // =================================
    const setLoading = (isLoading) => DOMElements.loadingOverlay.classList.toggle('hidden', !isLoading);
    const createElement = (tag, options = {}) => {
        const el = document.createElement(tag);
        Object.entries(options).forEach(([key, value]) => {
            if (key === 'textContent' || key === 'innerHTML') { el[key] = value; }
            else if (key === 'dataset') { Object.entries(value).forEach(([dataKey, dataValue]) => el.dataset[dataKey] = dataValue); }
            else { el.setAttribute(key, value); }
        });
        return el;
    };
    const showAlert = (message, isError = false) => {
        const oldAlert = document.querySelector('.app-alert');
        if(oldAlert) oldAlert.remove();
        const alertBox = createElement('div', { textContent: message, class: `app-alert ${isError ? 'error' : 'success'}` });
        document.body.appendChild(alertBox);
        setTimeout(() => alertBox.classList.add('show'), 10);
        setTimeout(() => { alertBox.classList.remove('show'); setTimeout(() => alertBox.remove(), 500); }, 4000);
    };
    const getDistance = (lat1, lon1, lat2, lon2) => {
        if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
        const R = 6371e3;
        const f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180;
        const deltaPhi = (lat2 - lat1) * Math.PI / 180, deltaLambda = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };
    const autoResizeTextarea = (textarea) => {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    };
    const initBoxResizeAnimations = () => {
        // CSS transition alone often misses auto-size layout jumps.
        // This FLIP variant is intentionally subtle to avoid bouncy/brutal movement.
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof ResizeObserver === 'undefined') return;

        const animatedSelectors = [
            '.main-container',
            '.main-header',
            '.main-content',
            '#status-widget',
            '#history-widget',
            '#izin-cuti-widget',
            '.widget'
        ];

        const elements = document.querySelectorAll(animatedSelectors.join(', '));
        const previousRects = new WeakMap();

        elements.forEach((el) => {
            previousRects.set(el, el.getBoundingClientRect());
        });

        const observer = new ResizeObserver((entries) => {
            entries.forEach((entry) => {
                const el = entry.target;
                const prev = previousRects.get(el);
                const next = el.getBoundingClientRect();

                if (!prev || next.width <= 0 || next.height <= 0) {
                    previousRects.set(el, next);
                    return;
                }

                const deltaX = prev.left - next.left;
                const deltaY = prev.top - next.top;
                const scaleX = prev.width / next.width;
                const scaleY = prev.height / next.height;

                const moved = Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5;
                const resized = Math.abs(1 - scaleX) > 0.01 || Math.abs(1 - scaleY) > 0.01;
                if (moved || resized) {
                    // Clamp large layout jumps so orientation/viewport changes do not feel violent.
                    const maxShift = 48;
                    const clampedX = Math.max(-maxShift, Math.min(maxShift, deltaX));
                    const clampedY = Math.max(-maxShift, Math.min(maxShift, deltaY));

                    // Only allow very small scaling so resize feels soft, not springy.
                    const maxScaleDelta = 0.04;
                    const safeScaleX = Math.max(1 - maxScaleDelta, Math.min(1 + maxScaleDelta, scaleX));
                    const safeScaleY = Math.max(1 - maxScaleDelta, Math.min(1 + maxScaleDelta, scaleY));

                    // Prevent stacking animations when several resize events fire quickly.
                    el.getAnimations().forEach(animation => animation.cancel());

                    el.animate([
                        { transformOrigin: 'top left', transform: `translate(${clampedX}px, ${clampedY}px) scale(${safeScaleX}, ${safeScaleY})` },
                        { transformOrigin: 'top left', transform: 'translate(0, 0) scale(1, 1)' }
                    ], {
                        duration: 170,
                        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                        fill: 'both'
                    });
                }

                previousRects.set(el, next);
            });
        });

        elements.forEach((el) => observer.observe(el));
    };
    const toDateKey = (dateObj) => {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };
    const parseDateKey = (dateKey) => {
        const [y, m, d] = (dateKey || '').split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    };
    const getGeneralScheduledDays = () => {
        const days = new Set();
        (presenceSchedule.slots || []).forEach(slot => {
            if (Number.isInteger(slot.day)) days.add(slot.day);
        });
        return days;
    };
    const fetchAbsentReasonsMap = async (userEmail) => {
        const reasonsMap = {};
        try {
            const reasonsSnap = await getDocs(collection(db, `artifacts/${appId}/users/${userEmail}/absent_reasons`));
            reasonsSnap.forEach(reasonDoc => {
                const data = reasonDoc.data();
                if (data?.date) reasonsMap[data.date] = data.reason || '';
            });
        } catch (error) {
            console.error('Gagal memuat alasan tidak hadir:', error);
        }
        return reasonsMap;
    };
    const buildAutoAbsentEntries = async (userEmail, historyData, startDate, endDate) => {
        const scheduledDays = getGeneralScheduledDays();
        if (scheduledDays.size === 0) return [];

        let globalFirstDate = firstPresenceCache[userEmail];
        if (globalFirstDate === undefined) {
            try {
                const presensiRef = collection(db, `artifacts/${appId}/users/${userEmail}/presensi`);
                const firstPresenceQuery = query(presensiRef, orderBy("timestamp", "asc"), limit(1));
                const firstPresenceSnap = await getDocs(firstPresenceQuery);
                if (firstPresenceSnap.empty) {
                    firstPresenceCache[userEmail] = null;
                    globalFirstDate = null;
                } else {
                    globalFirstDate = firstPresenceSnap.docs[0].data().timestamp.toDate();
                    firstPresenceCache[userEmail] = globalFirstDate;
                }
            } catch (err) {
                console.error("Gagal mengambil presensi pertama:", err);
                return []; 
            }
        }

        if (globalFirstDate === null) {
            return []; // Jika user belum pernah absensi sama sekali, biarkan riwayatnya kosong murni
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const maxAbsentDate = new Date(todayStart);
        maxAbsentDate.setDate(maxAbsentDate.getDate() - 1);
        maxAbsentDate.setHours(23, 59, 59, 999);

        let rangeStart = startDate ? new Date(startDate) : new Date(globalFirstDate);
        if (rangeStart < globalFirstDate) {
            rangeStart = new Date(globalFirstDate);
        }
        rangeStart.setHours(0, 0, 0, 0);

        let rangeEnd = endDate ? new Date(endDate) : new Date();
        rangeEnd.setHours(23, 59, 59, 999);
        const effectiveEnd = rangeEnd > maxAbsentDate ? maxAbsentDate : rangeEnd;
        if (effectiveEnd < rangeStart) return [];

        const existingDates = new Set();
        historyData.forEach(item => {
            if (item.dates && Array.isArray(item.dates) && item.dates.length > 0) {
                item.dates.forEach(d => existingDates.add(d));
            } else {
                existingDates.add(toDateKey(item.timestamp.toDate()));
            }
        });
        const reasonsMap = await fetchAbsentReasonsMap(userEmail);
        const autoAbsentEntries = [];

        const cursor = new Date(rangeStart);
        while (cursor <= effectiveEnd) {
            const dateKey = toDateKey(cursor);
            if (scheduledDays.has(cursor.getDay()) && !existingDates.has(dateKey)) {
                const absentDate = new Date(cursor);
                absentDate.setHours(8, 0, 0, 0);
                
                if (holidaysCache[dateKey]) {
                    autoAbsentEntries.push({
                        id: `holiday-${dateKey}`,
                        type: 'Libur',
                        is_late: false,
                        is_holiday: true,
                        holiday_name: holidaysCache[dateKey],
                        timestamp: Timestamp.fromDate(absentDate),
                    });
                } else {
                    autoAbsentEntries.push({
                        id: `auto-absent-${dateKey}`,
                        type: 'Tidak Hadir',
                        is_late: false,
                        is_auto_absent: true,
                        absent_date_key: dateKey,
                        absent_reason: reasonsMap[dateKey] || '',
                        timestamp: Timestamp.fromDate(absentDate),
                    });
                }
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        return autoAbsentEntries;
    };
    
    const startServerClock = (element) => {
        if (!element) return;
        const updateClock = () => {
            const now = new Date();
            const options = {
                timeZone: 'Asia/Jakarta',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            };
            const timeString = now.toLocaleTimeString('id-ID', options).replace(/\./g, ':');
            element.innerHTML = `${timeString} <span style="font-weight:600;">WIB</span>`;
        };
        updateClock();
        setInterval(updateClock, 1000);
    };
      
    const prefillDateFilters = (modal, prefix) => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth(); 
        const todayString = now.toLocaleDateString('en-CA'); 

        const harianInput = modal.querySelector(`#${prefix}-harian-date`);
        if (harianInput) harianInput.value = todayString;

        const bulananMonthSelect = modal.querySelector(`#${prefix}-bulanan-month`);
        if (bulananMonthSelect) bulananMonthSelect.value = month;
        const bulananYearSelect = modal.querySelector(`#${prefix}-bulanan-year`);
        if (bulananYearSelect) bulananYearSelect.value = year;

        const tahunanYearSelect = modal.querySelector(`#${prefix}-tahunan-year`);
        if (tahunanYearSelect) tahunanYearSelect.value = year;

        const firstDayString = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const kustomStartInput = modal.querySelector(`#${prefix}-kustom-start`);
        if (kustomStartInput) kustomStartInput.value = firstDayString;
        
        const kustomEndInput = modal.querySelector(`#${prefix}-kustom-end`);
        if (kustomEndInput) kustomEndInput.value = todayString;
        
        if (window.initFlatpickrFor) {
            modal.querySelectorAll('input[type="date"]').forEach(el => { if (!el._flatpickr) window.initFlatpickrFor(el); });
        }
    };

    // =================================
    // 5. MANAJEMEN TEMA
    // =================================
    const themeManager = {
        init() {
            const savedTheme = localStorage.getItem('app-theme') || 'light';
            const savedAccent = localStorage.getItem('app-accent') || 'indigo';
            this.applyTheme(savedTheme);
            this.applyAccent(savedAccent);
            DOMElements.themeSettingsBtn.addEventListener('click', () => this.showThemeModal());
        },
        applyTheme(themeName) {
            document.documentElement.dataset.theme = themeName;
            localStorage.setItem('app-theme', themeName);
        },
        darkenColor(hex, percent) {
            hex = hex.replace(/^#/, '');
            let r = parseInt(hex.substring(0, 2), 16);
            let g = parseInt(hex.substring(2, 4), 16);
            let b = parseInt(hex.substring(4, 6), 16);
            const factor = 1 - (percent / 100);
            r = Math.floor(r * factor);
            g = Math.floor(g * factor);
            b = Math.floor(b * factor);
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        },
        applyAccent(accentName) {
            const root = document.documentElement;
            if (accentName.startsWith('#')) { // Kustom
                root.removeAttribute('data-accent');
                root.style.setProperty('--c-primary', accentName);
                root.style.setProperty('--c-primary-hover', this.darkenColor(accentName, 10));
            } else { // Pre-set
                root.style.removeProperty('--c-primary');
                root.style.removeProperty('--c-primary-hover');
                root.dataset.accent = accentName;
            }
            localStorage.setItem('app-accent', accentName);
        },
        showThemeModal() {
            const modalId = 'theme-modal';
            const currentTheme = localStorage.getItem('app-theme') || 'light';
            let currentAccent = localStorage.getItem('app-accent') || 'indigo';
            const isCustomColor = currentAccent.startsWith('#');

            const modalBody = createElement('div', { class: 'modal-body theme-options' });
            
            const themeGroup = createElement('div', { class: 'option-group' });
            themeGroup.appendChild(createElement('label', { for: 'theme-select', textContent: 'Mode:' }));
            const themeSelect = createElement('select', { id: 'theme-select', class: 'form-select' });
            themeSelect.innerHTML = `<option value="light" ${currentTheme === 'light' ? 'selected' : ''}>Terang</option><option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>Gelap</option>`;
            themeGroup.appendChild(themeSelect);

            const accentGroup = createElement('div', { class: 'option-group' });
            accentGroup.appendChild(createElement('label', { textContent: 'Warna Aksen:' }));
            const swatches = createElement('div', { class: 'color-swatches' });
            
            const colors = ['slate', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
            colors.forEach(color => {
                const swatch = createElement('div', { class: `color-swatch ${!isCustomColor && currentAccent === color ? 'active' : ''}`, dataset: { accent: color } });
                swatches.appendChild(swatch);
            });

            // Tambahkan color picker kustom
            const customSwatch = createElement('div', { id: 'custom-color-swatch', class: 'color-swatch' + (isCustomColor ? ' active' : '') });
            const colorInput = createElement('input', { type: 'color', id: 'custom-color-input', value: isCustomColor ? currentAccent : '#6366f1' });
            
            // Event listener native untuk update warna
            colorInput.addEventListener('input', (e) => {
                this.applyAccent(e.target.value);
            });
            colorInput.addEventListener('change', (e) => {
                this.applyAccent(e.target.value);
                currentAccent = e.target.value;
                modal.querySelector('.color-swatch.active')?.classList.remove('active');
                customSwatch.classList.add('active');
            });

            customSwatch.appendChild(colorInput);
            swatches.appendChild(customSwatch);

            accentGroup.appendChild(swatches);
            modalBody.append(themeGroup, accentGroup);
            showCustomModal("Pengaturan Tampilan", modalBody, modalId, 'sm');
        }
    };
    themeManager.init();

    // =================================
    // 6. RENDER & UPDATE UI
    // =================================
    const renderUserProfile = () => {
        DOMElements.userNameEl.textContent = currentUser.displayName;
        DOMElements.userEmailEl.textContent = currentUser.email;
    
        const userPhotoEl = DOMElements.userPhotoEl;
        const fallbackSrc = `https://placehold.co/100x100/EBF4FF/76A9FA?text=${currentUser.displayName.charAt(0).toUpperCase()}`;
    
        userPhotoEl.onerror = null;
        userPhotoEl.onerror = () => {
            console.warn('Gagal memuat foto profil Google. Menggunakan fallback avatar.');
            if (userPhotoEl.src !== fallbackSrc) {
                userPhotoEl.src = fallbackSrc;
            }
            userPhotoEl.onerror = null;
        };
        userPhotoEl.src = currentUser.photoURL || fallbackSrc;
    
        let baseText;
        if (currentUserClass && currentUserClass.category) {
            baseText = [currentUserClass.category, currentUserClass.class_name].filter(Boolean).join(' ');
        } else {
            baseText = 'Guru';
        }
    
        const additionalRoles = currentUserRoles.filter(role => role !== 'Admin' && role !== 'Guru').join(' / ');
    
        let fullDisplayText = baseText;
        if (additionalRoles) {
            fullDisplayText += ` / ${additionalRoles}`;
        }
    
        if (currentUserRoles.includes('Admin')) {
            fullDisplayText += ' (Admin)';
        }
        
        DOMElements.userRoleEl.textContent = fullDisplayText;
        
        DOMElements.adminMenuContainer.classList.toggle('hidden', !currentUserRoles.includes('Admin'));
        renderAdminDropdown();
    };

    const renderPresenceHistory = () => {
        if (todayHistoryCache.length === 0) {
            DOMElements.historyContainer.innerHTML = `
                <div class="empty-state">
                    <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <h4>Belum Ada Aktivitas</h4>
                    <p>Tidak ada riwayat untuk periode ini.</p>
                </div>`;
            return;
        }
        DOMElements.historyContainer.innerHTML = '';
        const trashSvg = '<svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>';
        todayHistoryCache.forEach(data => {
            const dateObj = data.timestamp.toDate();
            const timeString = dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            const dateString = currentActivityFilter !== 'today' ? dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) + ' \u2022 ' : '';
            const isIzinCuti = data.type === 'Izin' || data.type === 'Cuti';
            const isAbsent = data.type === 'Tidak Hadir' || data.is_auto_absent;
            const isHoliday = data.type === 'Libur' || data.is_holiday;
            const itemClass = isHoliday ? 'libur' : (isAbsent ? 'absent' : (isIzinCuti ? 'izincuti' : (data.is_late ? 'late' : 'ontime')));
            const item = createElement('div', { class: `history-item ${itemClass}` });
            const info = createElement('div', { class: 'history-item-info' });
            info.appendChild(createElement('p', { textContent: data.type || 'Hadir' }));
            if (isHoliday) {
                const holidayDate = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
                info.appendChild(createElement('p', { textContent: `${holidayDate}` }));
                if (data.holiday_name) info.appendChild(createElement('p', { class: 'late-reason-text', textContent: data.holiday_name }));
            } else if (isIzinCuti) {
                let izinDate = '';
                if (data.dates && data.dates.length > 1) {
                    const firstDate = new Date(data.dates[0]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
                    const lastDate = new Date(data.dates[data.dates.length - 1]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
                    izinDate = `${firstDate} - ${lastDate} (${data.dates.length} hr)`;
                } else {
                    izinDate = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
                }
                info.appendChild(createElement('p', { textContent: `${data.type} \u2022 ${izinDate}` }));
                if (data.izin_cuti_reason) {
                    info.appendChild(createElement('p', { class: 'late-reason-text', textContent: `Alasan: ${data.izin_cuti_reason}` }));
                }
            } else if (isAbsent) {
                const absentDate = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
                info.appendChild(createElement('p', { textContent: `Tidak hadir ? ${absentDate}` }));
                if (data.absent_reason) {
                    info.appendChild(createElement('p', { class: 'late-reason-text', textContent: `Alasan: ${data.absent_reason}` }));
                } else {
                    info.appendChild(createElement('button', { class: 'add-absent-reason-btn', textContent: 'Tambah Alasan Tidak Hadir', dataset: { dateKey: data.absent_date_key || toDateKey(dateObj) } }));
                }
            } else if (data.is_late) {
                if (data.late_reason) { info.appendChild(createElement('p', { class: 'late-reason-text', textContent: `Alasan: ${data.late_reason}` })); }
                else { info.appendChild(createElement('button', { class: 'add-late-reason-btn', textContent: 'Tambah Alasan', dataset: { docId: data.id } })); }
            } else { info.appendChild(createElement('p', { textContent: 'Tepat Waktu' })); }
            const actions = createElement('div', { class: 'history-item-actions' });
            const timeText = isHoliday ? 'Libur' : (isAbsent ? 'Tidak Hadir' : `${dateString}${timeString}`);
            const time = createElement('div', { class: 'history-item-time', textContent: timeText });
            actions.appendChild(time);
            // Only show delete for Izin/Cuti records
            if (isIzinCuti) {
                const deleteBtn = createElement('button', { class: 'delete-record-btn', innerHTML: trashSvg, title: 'Hapus data ini', dataset: { docId: data.id, deleteType: 'own' } });
                actions.appendChild(deleteBtn);
            }
            item.append(info, actions);
            DOMElements.historyContainer.appendChild(item);
        });
    };

    const renderHolidayList = () => {
        if (!currentUserRoles.includes('Admin')) {
            DOMElements.holidayWidget.classList.add('hidden');
            return;
        }
        DOMElements.holidayWidget.classList.remove('hidden');
        
        let filteredHolidays = [...holidayListCache];
        const now = new Date();
        
        if (currentHolidayFilter === 'month') {
            filteredHolidays = filteredHolidays.filter(h => {
                const hd = new Date(h.date);
                return hd.getMonth() === now.getMonth() && hd.getFullYear() === now.getFullYear();
            });
        } else if (currentHolidayFilter === 'year') {
            filteredHolidays = filteredHolidays.filter(h => {
                const hd = new Date(h.date);
                return hd.getFullYear() === now.getFullYear();
            });
        } else if (currentHolidayFilter === 'custom') {
            const startInput = document.getElementById('holiday-kustom-start');
            const endInput = document.getElementById('holiday-kustom-end');
            if (startInput && endInput && startInput.value && endInput.value) {
                const start = new Date(startInput.value);
                start.setHours(0,0,0,0);
                const end = new Date(endInput.value);
                end.setHours(23,59,59,999);
                filteredHolidays = filteredHolidays.filter(h => {
                    const hd = new Date(h.date);
                    return hd >= start && hd <= end;
                });
            }
        }
        
        if (filteredHolidays.length === 0) {
            DOMElements.holidayContainer.innerHTML = `
                <div class="empty-state">
                    <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                    </svg>
                    <h4>Belum Ada Hari Libur</h4>
                    <p>Tidak ada libur pada periode ini.</p>
                </div>`;
            return;
        }
        
        DOMElements.holidayContainer.innerHTML = '';
        const trashSvg = '<svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>';
        
        filteredHolidays.forEach(data => {
            const dateObj = new Date(data.date);
            const dateString = dateObj.toLocaleDateString('id-ID', { weekday: window.innerWidth < 380 ? 'short' : 'long', day: 'numeric', month: 'long', year: 'numeric' });
            
            const item = createElement('div', { class: 'history-item libur' });
            const info = createElement('div', { class: 'history-item-info' });
            info.appendChild(createElement('p', { textContent: data.name }));
            info.appendChild(createElement('p', { textContent: dateString }));
            
            const actions = createElement('div', { class: 'history-item-actions' });
            const deleteBtn = createElement('button', { class: 'delete-holiday-btn delete-record-btn', innerHTML: trashSvg, title: 'Hapus Hari Libur', dataset: { docId: data.id } });
            actions.appendChild(deleteBtn);
            
            item.append(info, actions);
            DOMElements.holidayContainer.appendChild(item);
        });
    };

    const renderCustomRoleToggles = () => {
        DOMElements.customRoleTogglesContainer.innerHTML = '';
        const customRoles = currentUserRoles.filter(role => rolesConfig[role]?.toggle_label);
        DOMElements.customRoleTogglesContainer.classList.toggle('hidden', customRoles.length === 0);
        if (customRoles.length > 0) {
            customRoles.forEach(role => {
                const label = createElement('label', { class: 'toggle-group-item' });
                label.appendChild(createElement('span', { textContent: rolesConfig[role].toggle_label }));
                const toggleDiv = createElement('div', { class: 'toggle-switch' });
                const input = createElement('input', { type: 'checkbox', class: 'sr-only custom-role-toggle', dataset: { roleName: role } });
                toggleDiv.appendChild(input);
                toggleDiv.appendChild(createElement('div', { class: 'toggle-bg' }));
                toggleDiv.appendChild(createElement('div', { class: 'dot' }));
                label.appendChild(toggleDiv);
                DOMElements.customRoleTogglesContainer.appendChild(label);
            });
        }
    };

    const updatePresenceStateUI = (status, message) => {
        const btn = DOMElements.presensiBtn;
        const msgEl = DOMElements.statusMessage;
        btn.disabled = true;
        msgEl.textContent = message;
        switch (status) {
            case 'loading': btn.textContent = 'Memeriksa Status...'; break;
            case 'ready': btn.disabled = false; btn.textContent = 'Check-in Sekarang'; break;
            case 'done': btn.textContent = 'Anda Sudah Presensi Hari Ini'; break;
            case 'error': btn.textContent = 'Presensi Tidak Tersedia'; break;
            default: btn.textContent = '...'; break;
        }
    };

    const resetUI = () => {
        currentUser = null; currentUserRoles = [];
        DOMElements.loginView.classList.remove('hidden');
        DOMElements.mainView.classList.add('hidden');
        DOMElements.adminDropdown.classList.add('hidden');
        DOMElements.preloader.style.opacity = '0';
        setTimeout(() => DOMElements.preloader.style.display = 'none', 500);
    };
    
    const renderAdminDropdown = () => {
        DOMElements.adminDropdown.innerHTML = `
            <a href="#" class="dropdown-item" data-action="view-attendance">Lihat Absensi Pengguna</a>
            <a href="#" class="dropdown-item" data-action="rekap-attendance">Rekap & Ekspor</a>
            <div class="dropdown-divider"></div>
            <a href="#" class="dropdown-item" data-action="schedule-settings">Atur Jadwal & Peran</a>
            <a href="#" class="dropdown-item" data-action="role-manager">Tugaskan Peran</a>
            <a href="#" class="dropdown-item" data-action="class-settings">Manajemen Kelas</a>
            <div class="dropdown-divider"></div>
            <label class="dropdown-item-toggle">
                <span>Absen Sekali Sehari</span>
                <div class="toggle-switch">
                    <input type="checkbox" id="single-presence-toggle" class="sr-only" ${globalSettings.single_presence_per_day ? 'checked' : ''}>
                    <div class="toggle-bg"></div><div class="dot"></div>
                </div>
            </label>
            <label class="dropdown-item-toggle">
                <span>Mode Diagnostik</span>
                 <div class="toggle-switch">
                    <input type="checkbox" id="diagnostics-toggle" class="sr-only" ${globalSettings.diagnostics_enabled ? 'checked' : ''}>
                    <div class="toggle-bg"></div><div class="dot"></div>
                </div>
            </label>
        `;
    };

    // ... (sisa kode dari sini hingga akhir sama persis, tidak perlu diubah)
    // =================================
    // 7. FUNGSI LOGIKA APLIKASI
    // =================================
    const fetchConfig = async (configName) => {
        try {
            const docSnap = await getDoc(doc(db, "app_config", configName));
            return docSnap.exists() ? docSnap.data() : null;
        } catch (error) { console.error(`Gagal memuat konfigurasi ${configName}:`, error); return null; }
    };

    const loadHolidays = async () => {
        try {
            const snap = await getDocs(collection(db, `artifacts/${appId}/holidays`));
            holidaysCache = {};
            holidayListCache = [];
            snap.forEach(doc => {
                const data = doc.data();
                if (data.date) {
                    holidaysCache[data.date] = data.name;
                    holidayListCache.push({ id: doc.id, ...data });
                }
            });
            holidayListCache.sort((a,b) => new Date(a.date) - new Date(b.date));
        } catch (e) {
            console.error("Gagal memuat libur:", e);
        }
    };

    const getUserRoles = async (email) => {
        let roles = ['Guru'];
        try {
            const [roleDoc, adminConfig] = await Promise.all([ getDoc(doc(db, "user_roles", email)), fetchConfig("roles") ]);
            if (roleDoc.exists()) { roles.push(...roleDoc.data().roles); }
            if (adminConfig?.admin_emails?.includes(email)) { roles.push('Admin'); }
        } catch (error) { console.error("Gagal memeriksa peran pengguna:", error); }
        return [...new Set(roles)];
    };

    const initializeUserSession = async () => {
        setLoading(true);
        await loadHolidays();
        const [settings, schedule, rConfig, roles, classDoc] = await Promise.all([ 
            fetchConfig("settings"), 
            fetchConfig("schedule"), 
            fetchConfig("roles_config"), 
            getUserRoles(currentUser.email),
            getDoc(doc(db, "user_classes", currentUser.email))
        ]);
        globalSettings = settings || { single_presence_per_day: true, allowed_radius_meters: 50, diagnostics_enabled: false };
        presenceSchedule = schedule || { slots: [] };
        rolesConfig = rConfig || {};
        currentUserRoles = roles;
        currentUserClass = classDoc.exists() ? classDoc.data() : null;
        if (globalSettings.diagnostics_enabled && currentUserRoles.includes('Admin')) {
            runAdminDiagnostics();
        }
        await loadPresenceHistory();
        renderUserProfile();
        renderCustomRoleToggles();
        renderHolidayList();
        updatePresenceState();
        startServerClock(DOMElements.serverClock);
        DOMElements.preloader.style.opacity = '0';
        setTimeout(() => DOMElements.preloader.style.display = 'none', 500);
        setLoading(false);
    };

    const loadPresenceHistory = async (filter = 'today', customParams = {}) => {
        if (!currentUser) return;
        currentActivityFilter = filter;
        let startDate, endDate;
        const now = new Date();
        switch (filter) {
            case 'today':
                startDate = new Date(now); startDate.setHours(0, 0, 0, 0);
                endDate = new Date(now); endDate.setHours(23, 59, 59, 999);
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
                break;
            case 'custom':
                if (!customParams.start || !customParams.end) return;
                startDate = new Date(customParams.start); startDate.setHours(0, 0, 0, 0);
                endDate = new Date(customParams.end); endDate.setHours(23, 59, 59, 999);
                break;
            default:
                startDate = new Date(now); startDate.setHours(0, 0, 0, 0);
                endDate = new Date(now); endDate.setHours(23, 59, 59, 999);
        }
        const collectionRef = collection(db, `artifacts/${appId}/users/${currentUser.email}/presensi`);
        const q = query(collectionRef, where("timestamp", ">=", Timestamp.fromDate(startDate)), where("timestamp", "<=", Timestamp.fromDate(endDate)), orderBy("timestamp", "desc"));
        try {
            const querySnapshot = await getDocs(q);
            const realHistoryData = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

            const autoAbsentEntries = await buildAutoAbsentEntries(currentUser.email, realHistoryData, startDate, endDate);
            todayHistoryCache = [...realHistoryData, ...autoAbsentEntries]
                .sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());
        } catch(e){ console.error("Failed to load history:", e); showAlert("Gagal memuat riwayat presensi.", true); }
        finally { renderPresenceHistory(); }
    };

    const updatePresenceState = async () => {
        updatePresenceStateUI('loading', 'Mengecek status...');
        try {
            const currentTimeObj = new Date();
            const dateKey = toDateKey(currentTimeObj);
            if (holidaysCache && holidaysCache[dateKey]) { updatePresenceStateUI('done', `Hari Libur: ${holidaysCache[dateKey]}`); return; }

            const position = await new Promise((resolve, reject) => { navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }); });
            const distance = getDistance( position.coords.latitude, position.coords.longitude, globalSettings.target_latitude, globalSettings.target_longitude );
            if (distance > globalSettings.allowed_radius_meters) { updatePresenceStateUI('error', `Anda berada ${distance.toFixed(0)}m dari lokasi.`); return; }

            const currentDay = currentTimeObj.getDay();
            const currentTime = `${currentTimeObj.getHours().toString().padStart(2, '0')}:${currentTimeObj.getMinutes().toString().padStart(2, '0')}`;
            const scheduleSource = activeCustomRole && rolesConfig[activeCustomRole]?.schedule ? rolesConfig[activeCustomRole].schedule : presenceSchedule;
            const activeSlot = (scheduleSource.slots || []).find(slot => slot.day === currentDay && currentTime >= slot.startTime && currentTime <= slot.endTime );
            if (!activeSlot) { updatePresenceStateUI('error', "Jadwal presensi tidak tersedia saat ini."); return; }
            if (globalSettings.single_presence_per_day && todayHistoryCache.length > 0) { updatePresenceStateUI('done', "Anda sudah melakukan presensi hari ini."); return; }
            updatePresenceStateUI('ready', "Anda berada di lokasi. Siap melakukan presensi.");
        } catch (error) {
            const message = error.code === 1 ? "Izin lokasi ditolak. Aktifkan di pengaturan browser." : "Tidak dapat mengakses lokasi Anda.";
            updatePresenceStateUI('error', message);
        }
    };

    const handlePresence = async () => {
        setLoading(true);
        try {
            const now = new Date();
            const dateKey = toDateKey(now);
            if (holidaysCache && holidaysCache[dateKey]) { showAlert(`Presensi ditolak. Hari ini adalah Hari Libur: ${holidaysCache[dateKey]}`, true); setLoading(false); return; }

            const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            const scheduleSource = activeCustomRole && rolesConfig[activeCustomRole]?.schedule ? rolesConfig[activeCustomRole].schedule : presenceSchedule;
            const activeSlot = (scheduleSource.slots || []).find(slot => slot.day === now.getDay() && currentTime >= slot.startTime && currentTime <= slot.endTime);
            if (!activeSlot) { showAlert("Sesi presensi sudah berakhir.", true); setLoading(false); return; }
            const isLate = activeSlot.late_feature_enabled && (currentTime > activeSlot.lateTime);
            const position = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej));
            await addDoc(collection(db, `artifacts/${appId}/users/${currentUser.email}/presensi`), {
                user_email: currentUser.email, user_name: currentUser.displayName, timestamp: Timestamp.fromDate(now),
                location: { latitude: position.coords.latitude, longitude: position.coords.longitude },
                is_late: isLate, late_reason: "", type: activeCustomRole ? rolesConfig[activeCustomRole].toggle_label : "Hadir"
            });
            showAlert("Presensi berhasil dicatat!");
            await loadPresenceHistory();
            updatePresenceState();
        } catch (error) { console.error("Gagal menyimpan presensi:", error); showAlert("Gagal menyimpan presensi. Coba lagi.", true); }
        finally { setLoading(false); }
    };

    const handleIzinCuti = async () => {
        const selectedType = document.querySelector('input[name="izin-cuti-type"]:checked')?.value;
        if (!selectedType) { showAlert("Pilih jenis Izin atau Cuti.", true); return; }
        const selectedDate = DOMElements.izinCutiDate.value;
        if (!selectedDate) { showAlert("Pilih tanggal Izin/Cuti.", true); return; }
        
        let endDate = null;
        if (selectedType === 'Cuti') {
            endDate = DOMElements.izinCutiEndDate?.value;
            if (!endDate) {
                showAlert("Pilih tanggal akhir Cuti.", true); return;
            }
        }

        const izinCutiReason = DOMElements.izinCutiReason.value.trim();
        if (!izinCutiReason) { showAlert(`Alasan ${selectedType.toLowerCase()} wajib diisi.`, true); return; }
        
        setLoading(true);
        try {
            const startDateObj = new Date(selectedDate);
            startDateObj.setHours(8, 0, 0, 0);

            let validDates = [];
            
            if (selectedType === 'Cuti') {
                const endDateObj = new Date(endDate);
                endDateObj.setHours(8, 0, 0, 0);
                if (endDateObj < startDateObj) {
                    showAlert("Tanggal akhir tidak valid.", true); setLoading(false); return;
                }

                // Build set of scheduled day-of-week numbers
                const scheduledDays = new Set();
                (presenceSchedule.slots || []).forEach(slot => scheduledDays.add(slot.day));
                Object.values(rolesConfig).forEach(config => {
                    (config.schedule?.slots || []).forEach(slot => scheduledDays.add(slot.day));
                });
                if (scheduledDays.size === 0) {
                    showAlert("Belum ada jadwal hari yang aktif untuk dihitung.", true); setLoading(false); return;
                }

                const cursor = new Date(startDateObj);
                while (cursor <= endDateObj) {
                    const dateKey = toDateKey(cursor);
                    // Skip if holiday or not scheduled
                    if (scheduledDays.has(cursor.getDay()) && !holidaysCache[dateKey]) {
                        validDates.push(dateKey);
                    }
                    cursor.setDate(cursor.getDate() + 1);
                }
                
                if (validDates.length === 0) {
                    showAlert("Tidak ada hari kerja pada rentang tanggal tersebut.", true);
                    setLoading(false); return;
                }
            } else {
                validDates = [selectedDate];
            }

            const deletePromises = validDates.map(dk => 
                deleteDoc(doc(db, `artifacts/${appId}/users/${currentUser.email}/absent_reasons`, dk)).catch(() => {})
            );
            await Promise.all(deletePromises);

            const payloadDateObj = new Date(validDates[0] || selectedDate);
            payloadDateObj.setHours(8, 0, 0, 0);

            await addDoc(collection(db, `artifacts/${appId}/users/${currentUser.email}/presensi`), {
                user_email: currentUser.email, user_name: currentUser.displayName, 
                timestamp: Timestamp.fromDate(payloadDateObj),
                location: { latitude: 0, longitude: 0 },
                is_late: false, late_reason: "", izin_cuti_reason: izinCutiReason, 
                type: selectedType,
                dates: validDates // Save the array
            });

            let successMsg = `${selectedType} untuk ${payloadDateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} berhasil dicatat!`;
            if (selectedType === 'Cuti' && validDates.length > 1) {
                successMsg = `Cuti (${validDates.length} hari kerja) berhasil dicatat!`;
            }

            showAlert(successMsg);
            DOMElements.izinCutiReason.value = '';
            autoResizeTextarea(DOMElements.izinCutiReason);
            await loadPresenceHistory(currentActivityFilter);
            updatePresenceState();
        } catch (error) { 
            console.error("Gagal menyimpan izin/cuti:", error); 
            showAlert("Gagal menyimpan data. Coba lagi.", true); 
        }
        finally { setLoading(false); }
    };

    const handleDeleteOwnRecord = async (docId) => {
        if (!confirm("Yakin ingin menghapus data Izin/Cuti ini?")) return;
        setLoading(true);
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/users/${currentUser.email}/presensi`, docId));
            showAlert("Data berhasil dihapus.");
            await loadPresenceHistory(currentActivityFilter);
        } catch (error) { console.error("Gagal menghapus data:", error); showAlert("Gagal menghapus data.", true); }
        finally { setLoading(false); }
    };

    const handleDeleteHoliday = async (docId) => {
        if (!confirm("Yakin ingin menghapus hari libur ini?")) return;
        setLoading(true);
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/holidays`, docId));
            showAlert("Hari libur berhasil dihapus.");
            await loadHolidays();
            renderHolidayList();
            await loadPresenceHistory(currentActivityFilter);
            updatePresenceState();
        } catch (error) { console.error("Gagal menghapus libur:", error); showAlert("Gagal menghapus data.", true); }
        finally { setLoading(false); }
    };

    const showAddHolidayModal = () => {
        const modalId = 'add-holiday-modal';
        const body = createElement('div', { class: 'modal-body' });
        
        body.innerHTML = `
            <div class="space-y-4">
                <div>
                    <label class="block mb-1 text-sm font-medium">Tanggal Libur:</label>
                    <input type="date" id="new-holiday-date" class="form-input w-full">
                </div>
                <div>
                    <label class="block mb-1 text-sm font-medium">Keterangan / Nama Libur:</label>
                    <input type="text" id="new-holiday-name" placeholder="Misal: Libur Nasional..." class="form-input w-full">
                </div>
            </div>
            <div class="modal-footer mt-4" style="margin: 0 -1.25rem -1rem -1.25rem;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('${modalId}').remove()">Batal</button>
                <button type="button" class="btn btn-primary" id="save-new-holiday-btn">Simpan</button>
            </div>
        `;
        showCustomModal("Tambah Hari Libur", body, modalId, 'sm', true); // hide default footer
        
        const saveBtn = body.querySelector('#save-new-holiday-btn');
        saveBtn.addEventListener('click', async () => {
            const dateVal = body.querySelector('#new-holiday-date').value;
            const nameVal = body.querySelector('#new-holiday-name').value.trim();
            if(!dateVal || !nameVal) {
                showAlert("Pilih tanggal dan masukkan nama libur", true);
                return;
            }
            setLoading(true);
            try {
                // Gunakan dateKey sebagai ID dokumen
                await setDoc(doc(db, `artifacts/${appId}/holidays`, dateVal), {
                    date: dateVal,
                    name: nameVal,
                    timestamp: Timestamp.fromDate(new Date(dateVal))
                });
                document.getElementById(modalId).remove();
                showAlert("Hari libur berhasil ditambahkan.");
                await loadHolidays();
                renderHolidayList();
                await loadPresenceHistory(currentActivityFilter);
                updatePresenceState();
            } catch(error) {
                showAlert("Gagal menambah hari libur.", true);
                console.error(error);
            } finally {
                setLoading(false);
            }
        });
    };

    const showAbsentReasonModal = (dateKey) => {
        const modalId = 'absent-reason-modal';
        const body = createElement('div', { class: 'modal-body' });
        const footer = createElement('div', { class: 'modal-footer' });
        const dateLabel = parseDateKey(dateKey).toLocaleDateString('id-ID', { weekday: window.innerWidth < 380 ? 'short' : 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const helper = createElement('p', { textContent: `Tambahkan alasan tidak hadir untuk ${dateLabel}.` });
        helper.style.marginBottom = '0.5rem';
        helper.style.fontSize = '0.85rem';
        helper.style.color = 'var(--c-text-secondary)';

        const textarea = createElement('textarea', { id: 'absent-reason-input', class: 'form-textarea', placeholder: 'Tuliskan alasan tidak hadir...', rows: '3' });
        autoResizeTextarea(textarea);
        textarea.addEventListener('input', () => autoResizeTextarea(textarea));

        const cancelBtn = createElement('button', { class: 'btn btn-secondary', textContent: 'Batal' });
        const submitBtn = createElement('button', { class: 'btn btn-primary', textContent: 'Simpan' });
        cancelBtn.onclick = () => document.getElementById(modalId)?.remove();
        submitBtn.onclick = async () => {
            const reason = textarea.value.trim();
            if (!reason) { showAlert('Alasan tidak hadir tidak boleh kosong.', true); return; }
            setLoading(true);
            try {
                await setDoc(doc(db, `artifacts/${appId}/users/${currentUser.email}/absent_reasons`, dateKey), {
                    date: dateKey,
                    reason,
                    user_email: currentUser.email,
                    updated_at: Timestamp.fromDate(new Date())
                }, { merge: true });
                document.getElementById(modalId)?.remove();
                await loadPresenceHistory(currentActivityFilter);
                showAlert('Alasan tidak hadir berhasil disimpan.');
            } catch (error) {
                console.error('Gagal menyimpan alasan tidak hadir:', error);
                showAlert('Gagal menyimpan alasan tidak hadir.', true);
            } finally {
                setLoading(false);
            }
        };
        footer.append(cancelBtn, submitBtn);
        body.append(helper, textarea, footer);
        showCustomModal('Alasan Tidak Hadir', body, modalId, 'sm');
        textarea.focus();
    };
    
    const fetchAndDisplayUserHistory = async (userEmail, modal) => {
        const detailsContainer = modal.querySelector('#viewer-attendance-details');
        detailsContainer.innerHTML = '<div class="spinner-container" style="display:flex; justify-content:center; padding: 2rem;"><div class="spinner"></div></div>';

        try {
            let startDate, endDate;
            const activeFilter = modal.querySelector('#viewer-filter-tabs button.active').dataset.filter;
            
            switch(activeFilter) {
                case 'harian':
                    const date = modal.querySelector('#viewer-harian-date').value;
                    if (!date) { detailsContainer.innerHTML = '<p class="empty-list-msg" style="text-align:center; padding: 2rem;">Pilih tanggal terlebih dahulu.</p>'; return; }
                    startDate = new Date(date); endDate = new Date(date); break;
                case 'bulanan':
                    const month = modal.querySelector('#viewer-bulanan-month').value; const yearB = modal.querySelector('#viewer-bulanan-year').value;
                    startDate = new Date(yearB, month, 1); endDate = new Date(yearB, parseInt(month) + 1, 0); break;
                case 'tahunan':
                    const yearT = modal.querySelector('#viewer-tahunan-year').value;
                    startDate = new Date(yearT, 0, 1); endDate = new Date(yearT, 11, 31); break;
                case 'kustom':
                    const start = modal.querySelector('#viewer-kustom-start').value; const end = modal.querySelector('#viewer-kustom-end').value;
                    if (!start || !end) { detailsContainer.innerHTML = '<p class="empty-list-msg" style="text-align:center; padding: 2rem;">Pilih tanggal mulai dan selesai.</p>'; return; }
                    startDate = new Date(start); endDate = new Date(end); break;
                case 'all': default: break;
            }

            if (startDate && endDate) {
                startDate.setHours(0, 0, 0, 0);
                endDate.setHours(23, 59, 59, 999);
            }

            let presensiQuery;
            const collectionRef = collection(db, `artifacts/${appId}/users/${userEmail}/presensi`);

            if (startDate && endDate) {
                presensiQuery = query(collectionRef, where('timestamp', '>=', Timestamp.fromDate(startDate)), where('timestamp', '<=', Timestamp.fromDate(endDate)), orderBy("timestamp", "desc"));
            } else {
                presensiQuery = query(collectionRef, orderBy("timestamp", "desc"));
            }

            const querySnapshot = await getDocs(presensiQuery);
            const historyData = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

            const autoAbsentEntries = await buildAutoAbsentEntries(userEmail, historyData, startDate, endDate);
            const mergedHistory = [...historyData, ...autoAbsentEntries]
                .sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());

            if (mergedHistory.length === 0) {
                detailsContainer.innerHTML = '<div class="empty-state"><p>Tidak ada riwayat absensi untuk periode yang dipilih.</p></div>'; return;
            }

            detailsContainer.innerHTML = '<div class="attendance-history-list"></div>';
            const listContainer = detailsContainer.querySelector('.attendance-history-list');
            const isAdmin = currentUserRoles.includes('Admin');
            const trashSvg = '<svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>';
            mergedHistory.forEach(item => {
                const isIzinCuti = item.type === 'Izin' || item.type === 'Cuti';
                let dateStr = item.timestamp.toDate().toLocaleDateString('id-ID', { weekday: window.innerWidth < 380 ? 'short' : 'long', year: 'numeric', month: 'long', day: 'numeric' });
                let timeStr = item.timestamp.toDate().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                
                if (isIzinCuti && item.dates && item.dates.length > 1) {
                    const firstDate = new Date(item.dates[0]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
                    const lastDate = new Date(item.dates[item.dates.length - 1]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
                    dateStr = `${firstDate} - ${lastDate} (${item.dates.length} hr kerja)`;
                    timeStr = '-';
                }
                
                const isAbsent = item.type === 'Tidak Hadir' || item.is_auto_absent;
                const statusClass = isAbsent ? 'absent' : (isIzinCuti ? 'izincuti' : (item.is_late ? 'late' : 'ontime'));
                const statusLabel = isAbsent ? 'TIDAK HADIR' : (isIzinCuti ? item.type.toUpperCase() : (item.is_late ? 'TERLAMBAT' : 'TEPAT WAKTU'));
                const itemEl = createElement('div', { class: `attendance-item ${statusClass}` });
                itemEl.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <p style="font-weight:bold;">${dateStr}</p>
                            <p style="font-size:0.875rem;">${item.type || 'Hadir'}${isAbsent ? '' : ` - Pukul ${timeStr}`}</p>
                        </div>
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <p style="font-family:monospace; font-size:0.875rem;">${statusLabel}</p>
                            ${isAdmin && !item.is_auto_absent ? `<button class="delete-record-btn admin-delete-btn" data-doc-id="${item.id}" data-user-email="${userEmail}" title="Hapus">${trashSvg}</button>` : ''}
                        </div>
                    </div>
                    ${isIzinCuti && item.izin_cuti_reason ? `<p style="font-size:0.75rem; font-style:italic; margin-top:4px;">Alasan: ${item.izin_cuti_reason}</p>` : ''}
                    ${isAbsent && item.absent_reason ? `<p style="font-size:0.75rem; font-style:italic; margin-top:4px;">Alasan Tidak Hadir: ${item.absent_reason}</p>` : ''}
                    ${item.is_late && item.late_reason ? `<p style="font-size:0.75rem; font-style:italic; margin-top:4px;">Alasan: ${item.late_reason}</p>` : ''}
                `;
                listContainer.appendChild(itemEl);
            });

        } catch (error) {
            console.error("Gagal memuat riwayat pengguna:", error);
            detailsContainer.innerHTML = '<div class="empty-state error"><p>Gagal memuat riwayat. Coba lagi.</p></div>';
            showAlert("Gagal memuat riwayat pengguna.", true);
        }
    };

    // =================================
    // 8. LOGIKA PANEL ADMIN
    // =================================
    const showCustomModal = (title, contentElement, modalId, size = 'md') => {
        const oldModal = document.getElementById(modalId);
        if(oldModal) oldModal.remove();
        const modalWrapper = createElement('div', { id: modalId, class: 'modal-wrapper' });
        const modalContent = createElement('div', { class: `modal-content modal-${size}` });
        const modalHeader = createElement('div', { class: 'modal-header' });
        modalHeader.appendChild(createElement('h3', { textContent: title }));
        const closeBtn = createElement('button', { class: 'btn-icon close-modal-btn', innerHTML: '<svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>', 'aria-label': 'Tutup Modal' });
        closeBtn.addEventListener('click', () => modalWrapper.remove());
        modalHeader.appendChild(closeBtn);
        modalContent.appendChild(modalHeader);
        modalContent.appendChild(contentElement);
        modalWrapper.appendChild(modalContent);
        DOMElements.modalRoot.appendChild(modalWrapper);
    };

    const showLateReasonModal = (docId) => {
        const modalId = 'late-reason-modal';
        const body = createElement('div', { class: 'modal-body' });
        const textarea = createElement('textarea', { id: 'late-reason-input', class: 'form-textarea', placeholder: 'Tuliskan alasan Anda...', rows: '3' });
        const footer = createElement('div', { class: 'modal-footer' });
        const cancelBtn = createElement('button', { class: 'btn btn-secondary', textContent: 'Batal' });
        const submitBtn = createElement('button', { class: 'btn btn-primary', textContent: 'Simpan' });
        cancelBtn.onclick = () => document.getElementById(modalId)?.remove();
        submitBtn.onclick = async () => {
            const reason = textarea.value.trim();
            if (!reason) { showAlert("Alasan tidak boleh kosong.", true); return; }
            setLoading(true);
            try {
                await updateDoc(doc(db, `artifacts/${appId}/users/${currentUser.email}/presensi`, docId), { late_reason: reason });
                document.getElementById(modalId)?.remove();
                await loadPresenceHistory();
                showAlert("Alasan berhasil disimpan.");
            } catch(error) { console.error("Gagal menyimpan alasan:", error); showAlert("Gagal menyimpan alasan.", true); }
            finally { setLoading(false); }
        };
        footer.append(cancelBtn, submitBtn);
        body.append(textarea, footer);
        showCustomModal("Alasan Terlambat", body, modalId, 'sm');
        textarea.focus();
    };
    
    const fetchAllUserProfiles = async () => {
        if (!currentUserRoles.includes('Admin')) { showAlert("Fungsi ini hanya untuk Admin.", true); return false; }
        if (allUsersCache.length > 0) return true;
        setLoading(true);
        try {
            const q = query(collection(db, `artifacts/${appId}/users_profile`), orderBy("name"));
            const querySnapshot = await getDocs(q);
            allUsersCache = querySnapshot.docs.map(d => d.data());
            return true;
        } catch (error) { console.error("Gagal memuat daftar pengguna:", error); showAlert(`Gagal memuat pengguna.`, true); return false; }
        finally { setLoading(false); }
    };

    const showUserAttendanceViewer = async () => {
        const success = await fetchAllUserProfiles();
        if (!success) return;
        const body = createElement('div', { class: 'admin-view-container' });
        const sidebar = createElement('div', { class: 'admin-sidebar' });
        sidebar.innerHTML = `<h4 class="admin-sidebar-title">Pilih Pengguna</h4><input type="search" id="viewer-user-search" placeholder="Cari nama..." class="form-input w-full mb-4">`;
        const userListContainer = createElement('div', { id: 'viewer-user-list', class: 'admin-sidebar-list' });
        const trashSvg = '<svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>';
        allUsersCache.forEach(user => { 
            const item = createElement('div', { class: 'user-select-item', dataset: { email: user.email, name: user.name.toLowerCase() } });
            item.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="min-width:0; flex:1;">
                        <p class="font-semibold" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${user.name}</p>
                        <p class="text-xs text-gray-400" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${user.email}</p>
                    </div>
                    <button class="delete-record-btn admin-delete-user-btn" data-email="${user.email}" title="Hapus Pengguna" style="flex-shrink:0; margin-left:8px;">${trashSvg}</button>
                </div>`;
            userListContainer.appendChild(item);
        });
        sidebar.appendChild(userListContainer);
        
        const contentArea = createElement('div', { class: 'admin-content-area' });
        const filterContainer = createElement('div', { id: 'viewer-filter-container' });
        const detailsContainer = createElement('div', { id: 'viewer-attendance-details' });
        detailsContainer.innerHTML = `<div class="empty-state">Pilih pengguna di sebelah kiri untuk melihat riwayat.</div>`;
        contentArea.append(filterContainer, detailsContainer);

        body.append(sidebar, contentArea);
        showCustomModal("Lihat Absensi Pengguna", body, 'admin-modal', 'lg');
    };

    const showRekapManager = async () => {
        const success = await fetchAllUserProfiles();
        if (!success) return;
        const currentYear = new Date().getFullYear();
        const years = Array.from({length: 5}, (_, i) => currentYear - i);
        const months = Array.from({length: 12}, (_, i) => ({ value: i, name: new Date(0, i).toLocaleString('id-ID', { month: 'long' }) }));
        const body = createElement('div', { class: 'modal-body space-y-4' });
        body.innerHTML = `
            <div class="widget">
                <h4 class="widget-title">Pilih Rentang Waktu</h4>
                <div class="rekap-tabs" id="rekap-filter-tabs">
                    <button class="tab-btn active" data-filter="harian">Harian</button>
                    <button class="tab-btn" data-filter="bulanan">Bulanan</button>
                    <button class="tab-btn" data-filter="tahunan">Tahunan</button>
                    <button class="tab-btn" data-filter="kustom">Kustom</button>
                </div>
                <div id="rekap-filter-inputs" class="space-y-2 mt-4">
                    <div data-content="harian" class="flex gap-4 items-center flex-wrap"><label>Tanggal:</label><input type="date" id="rekap-harian-date" class="form-input"></div>
                    <div data-content="bulanan" class="hidden flex gap-4 items-center flex-wrap"><label>Bulan:</label><select id="rekap-bulanan-month" class="form-input">${months.map(m => `<option value="${m.value}">${m.name}</option>`).join('')}</select><label>Tahun:</label><select id="rekap-bulanan-year" class="form-input">${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select></div>
                    <div data-content="tahunan" class="hidden flex gap-4 items-center flex-wrap"><label>Tahun:</label><select id="rekap-tahunan-year" class="form-input">${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select></div>
                    <div data-content="kustom" class="hidden flex gap-4 items-center flex-wrap"><label>Mulai:</label><input type="date" id="rekap-kustom-start" class="form-input"><label>Sampai:</label><input type="date" id="rekap-kustom-end" class="form-input"></div>
                </div>
            </div>
            <div class="widget">
                <h4 class="widget-title">Pilih Pengguna</h4>
                <div class="rekap-controls">
                    <input type="search" id="rekap-user-search" placeholder="Cari nama..." class="form-input">
                    <label class="select-all-label">
                        <input type="checkbox" id="rekap-select-all" class="form-checkbox">
                        <span>Pilih Semua</span>
                    </label>
                </div>
                <div class="user-rekap-list">
                    ${allUsersCache.map(user => `<label class="user-entry"><input type="checkbox" class="rekap-user-checkbox form-checkbox" data-email="${user.email}"><p>${user.name}</p></label>`).join('')}
                </div>
                <label class="flex items-center gap-2 mt-3" style="font-size: 0.85rem; cursor: pointer;">
                    <input type="checkbox" id="rekap-ignore-empty" class="form-checkbox" checked>
                    Abaikan Presensi Kosong Seluruhnya dalam Sebulan
                </label>
            </div>
            <button id="generate-rekap-btn" class="btn btn-primary w-full" disabled>Unduh Laporan Excel</button>
        `;
        showCustomModal("Rekap & Ekspor", body, 'admin-modal', 'md');
        
         const modal = document.getElementById('admin-modal');
        prefillDateFilters(modal, 'rekap');
        modal.querySelectorAll('.rekap-user-checkbox, #rekap-select-all').forEach(cb => cb.checked = true);
        updateRekapButtonState(modal);
    };

    const updateRekapButtonState = (modal) => {
        const rekapBtn = modal.querySelector('#generate-rekap-btn');
        const checkedUsers = modal.querySelectorAll('.rekap-user-checkbox:checked').length;
        if (rekapBtn) {
            rekapBtn.disabled = checkedUsers === 0;
        }
    };

    const generateAndExportRekap = async () => {
        const selectedEmails = [...document.querySelectorAll('.rekap-user-checkbox:checked')].map(cb => cb.dataset.email);
        
        if (selectedEmails.length === 0) {
            showAlert("Anda harus memilih setidaknya satu pengguna.", true);
            return;
        }

        setLoading(true);
        let startDate, endDate;
        try {
            const activeFilter = document.querySelector('#rekap-filter-tabs button.active').dataset.filter;
            switch(activeFilter) {
                case 'harian': const date = document.getElementById('rekap-harian-date').value; if (!date) throw new Error("Tanggal harus dipilih."); startDate = new Date(date); endDate = new Date(date); break;
                case 'bulanan': const month = document.getElementById('rekap-bulanan-month').value; const yearB = document.getElementById('rekap-bulanan-year').value; startDate = new Date(yearB, month, 1); endDate = new Date(yearB, parseInt(month) + 1, 0); break;
                case 'tahunan': const yearT = document.getElementById('rekap-tahunan-year').value; startDate = new Date(yearT, 0, 1); endDate = new Date(yearT, 11, 31); break;
                case 'kustom': const start = document.getElementById('rekap-kustom-start').value; const end = document.getElementById('rekap-kustom-end').value; if (!start || !end) throw new Error("Tanggal mulai dan selesai harus dipilih."); startDate = new Date(start); endDate = new Date(end); break;
            }
            startDate.setHours(0,0,0,0); endDate.setHours(23,59,59,999);

            // Build set of scheduled day-of-week numbers from jadwal umum + all jadwal khusus
            const scheduledDays = new Set();
            (presenceSchedule.slots || []).forEach(slot => scheduledDays.add(slot.day));
            Object.values(rolesConfig).forEach(config => {
                (config.schedule?.slots || []).forEach(slot => scheduledDays.add(slot.day));
            });
            
            const presensiQuery = query(collectionGroup(db, 'presensi'), where('timestamp', '>=', Timestamp.fromDate(startDate)), where('timestamp', '<=', Timestamp.fromDate(endDate)));
            const querySnapshot = await getDocs(presensiQuery);
            let allPresenceData = querySnapshot.docs.map(d => d.data()).filter(p => selectedEmails.includes(p.user_email));
            
            const wb = XLSX.utils.book_new();
            
            let currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
            const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
            const indonesianMonths = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
            const DAYS_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
            
            // Build presence map: { email: { "YYYY-MM-DD": { present: true, is_late: bool } } }
            const presences = {};
            allPresenceData.forEach(p => {
                if (!presences[p.user_email]) presences[p.user_email] = {};
                const isIzin = p.type === 'Izin';
                const isCuti = p.type === 'Cuti';
                
                let coveredDates = [];
                if ((isCuti || isIzin) && Array.isArray(p.dates) && p.dates.length > 0) {
                    coveredDates = p.dates;
                } else {
                    const dateObj = p.timestamp.toDate();
                    const yyyy = dateObj.getFullYear();
                    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                    const dd = String(dateObj.getDate()).padStart(2, '0');
                    coveredDates.push(`${yyyy}-${mm}-${dd}`);
                }

                coveredDates.forEach(dateString => {
                    if (!presences[p.user_email][dateString]) {
                        presences[p.user_email][dateString] = { present: true, is_late: !!p.is_late, is_izin: isIzin, is_cuti: isCuti };
                    } else {
                        if (isIzin) presences[p.user_email][dateString].is_izin = true;
                        if (isCuti) presences[p.user_email][dateString].is_cuti = true;
                        if (!p.is_late && !isIzin && !isCuti) presences[p.user_email][dateString].is_late = false;
                    }
                });
            });

            // --- Helper: apply thin border to a cell ---
            const thinBorder = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
            const applyBordersAndStyles = (ws, range) => {
                for (let R = range.s.r; R <= range.e.r; R++) {
                    for (let C = range.s.c; C <= range.e.c; C++) {
                        const addr = XLSX.utils.encode_cell({ r: R, c: C });
                        if (!ws[addr]) ws[addr] = { v: "", t: "s" };
                        if (!ws[addr].s) ws[addr].s = {};
                        ws[addr].s.border = thinBorder;
                    }
                }
            };
            
            const ignoreEmpty = document.getElementById('rekap-ignore-empty')?.checked;
            const now = new Date();
            const serverMaxMonth = new Date(now.getFullYear(), now.getMonth(), 1);

            let hasSheets = false;
            while (currentMonth <= endMonth) {
                if (currentMonth > serverMaxMonth) {
                    break;
                }
                const y = currentMonth.getFullYear();
                const m = currentMonth.getMonth();
                const daysInMonth = new Date(y, m + 1, 0).getDate();
                
                const scheduledDates = [];
                for (let d = 1; d <= daysInMonth; d++) {
                    const dayOfWeek = new Date(y, m, d).getDay();
                    if (scheduledDays.has(dayOfWeek)) {
                        scheduledDates.push(d);
                    }
                }
                
                if (scheduledDates.length === 0) {
                    currentMonth.setMonth(currentMonth.getMonth() + 1);
                    continue;
                }

                // --- Build the sheet data as an array of arrays (aoa) ---
                const aoa = [];
                // Total columns: No + Nama + Email + scheduledDates + Total H + Total T + Total X + Total I + Total C
                const totalCols = 3 + scheduledDates.length + 5;

                // === HEADER BLOCK (rows 0-5) ===
                // Row 0: Title
                aoa.push(["REKAP ABSENSI GURU SEKOLAH MINGGU"]);
                // Row 1: Subtitle
                aoa.push([`Periode: ${indonesianMonths[m]} ${y}`]);
                // Row 2: Generated date
                const generationDate = new Date();
                const generatedStr = generationDate.toLocaleDateString('id-ID', { weekday: window.innerWidth < 380 ? 'short' : 'long', year: 'numeric', month: 'long', day: 'numeric' }) + " \u2022 " + generationDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + " WIB";
                aoa.push([`Dicetak: ${generatedStr}`]);
                // Row 3: blank spacer
                aoa.push([]);
                // Row 4: Legend
                aoa.push(["Keterangan:  H = Hadir  |  T = Terlambat  |  X = Tidak Hadir  |  I = Izin  |  C = Cuti  |  L = Libur"]);
                // Row 5: blank spacer
                aoa.push([]);

                // === COLUMN HEADER ROW (row 6): Day names ===
                const dayNameRow = ["No", "Nama", "Email"];
                scheduledDates.forEach(d => {
                    const dayOfWeek = new Date(y, m, d).getDay();
                    dayNameRow.push(DAYS_SHORT[dayOfWeek]);
                });
                dayNameRow.push("Total H", "Total T", "Total X", "Total I", "Total C");
                aoa.push(dayNameRow);

                // === DATE HEADER ROW (row 7): Date numbers ===
                const dateHeaderRow = ["", "", ""];
                scheduledDates.forEach(d => dateHeaderRow.push(d));
                dateHeaderRow.push("", "", "", "", "");
                aoa.push(dateHeaderRow);

                const DATA_START_ROW = aoa.length; // row index where user data begins

                // === DATA ROWS ===
                let grandTotalH = 0, grandTotalT = 0, grandTotalX = 0, grandTotalI = 0, grandTotalC = 0;
                let activeUserCount = 0;

                selectedEmails.forEach(email => {
                    const userProfile = allUsersCache.find(u => u.email === email) || { name: email, email: email };
                    let userH = 0, userT = 0, userX = 0, userI = 0, userC = 0;
                    
                    const userRowData = [];
                    scheduledDates.forEach(d => {
                        const dateString = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                        const record = presences[email]?.[dateString];
                        if (holidaysCache && holidaysCache[dateString]) {
                            userRowData.push("L");
                        } else if (record?.is_izin) {
                            userRowData.push("I"); userI++;
                        } else if (record?.is_cuti) {
                            userRowData.push("C"); userC++;
                        } else if (record?.present) {
                            if (record.is_late) { userRowData.push("T"); userT++; }
                            else { userRowData.push("H"); userH++; }
                        } else {
                            userRowData.push("X"); userX++;
                        }
                    });

                    if (ignoreEmpty && userH === 0 && userT === 0 && userI === 0 && userC === 0) {
                        return; // Omit empty user
                    }

                    activeUserCount++;
                    const row = [activeUserCount, userProfile.name, userProfile.email, ...userRowData, userH, userT, userX, userI, userC];
                    
                    grandTotalH += userH;
                    grandTotalT += userT;
                    grandTotalX += userX;
                    grandTotalI += userI;
                    grandTotalC += userC;
                    aoa.push(row);
                });

                const DATA_END_ROW = aoa.length - 1;

                // === SUMMARY BLOCK (below data) ===
                let totalHolidays = 0;
                const holidaysList = [];
                scheduledDates.forEach(d => {
                    const dateString = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    if (holidaysCache && holidaysCache[dateString]) {
                        totalHolidays++;
                        holidaysList.push({ date: dateString, desc: holidaysCache[dateString] });
                    }
                });

                aoa.push([]); // blank spacer
                const summaryStartRow = aoa.length;
                aoa.push(["", "RINGKASAN", "JUMLAH"]);
                
                const effectiveScheduledDays = scheduledDates.length - totalHolidays;

                aoa.push(["", "Total Pengguna Aktif", activeUserCount]);        
                aoa.push(["", "Total Hari Terjadwal (Diluar Libur)", effectiveScheduledDays]);

                aoa.push(["", "Hadir Tepat Waktu (H)", grandTotalH]);
                aoa.push(["", "Hadir Terlambat (T)", grandTotalT]);  
                
                const totalPossible = activeUserCount * effectiveScheduledDays;
                const totalKehadiran = grandTotalH + grandTotalT;
                const pctKehadiran = totalPossible > 0 ? (totalKehadiran / totalPossible) : 0;
                aoa.push(["", "Total Kehadiran (H + T)", pctKehadiran]);
                
                aoa.push(["", "Tidak Hadir (X)", grandTotalX]);
                aoa.push(["", "Izin (I)", grandTotalI]);
                aoa.push(["", "Cuti (C)", grandTotalC]);
                
                const totalAbsen = grandTotalX + grandTotalI + grandTotalC;
                const pctAbsen = totalPossible > 0 ? (totalAbsen / totalPossible) : 0;
                aoa.push(["", "Total Tidak Hadir (X + I + C)", pctAbsen]);

                // === INJECT HOLIDAY LIST TO THE RIGHT OF SUMMARY ===
                if (holidaysList.length > 0) {
                    let r = summaryStartRow;
                    const colIdx = 4; // Append at Column E
                    if (!aoa[r]) aoa[r] = [];
                    aoa[r][colIdx] = "DAFTAR HARI LIBUR"; aoa[r][colIdx + 3] = "";
                    r++;
                    if (!aoa[r]) aoa[r] = [];
                    aoa[r][colIdx] = "Tanggal"; aoa[r][colIdx + 3] = "Keterangan";
                    r++;
                    holidaysList.forEach(h => {
                        if (!aoa[r]) aoa.push([]); // Ensure row exists
                        aoa[r][colIdx] = h.date;
                        aoa[r][colIdx + 3] = h.desc;
                        r++;
                    });
                }

                // === CREATE WORKSHEET ===
                const ws = XLSX.utils.aoa_to_sheet(aoa);

                // --- Merge cells for header rows ---
                if (!ws['!merges']) ws['!merges'] = [];
                const lastCol = totalCols - 1;
                // Merge title, subtitle, generated, legend across all columns
                ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } }); // Title
                ws['!merges'].push({ s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } }); // Period
                ws['!merges'].push({ s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } }); // Generated
                ws['!merges'].push({ s: { r: 4, c: 0 }, e: { r: 4, c: lastCol } }); // Legend

                // Merge "No" header across rows 6-7
                ws['!merges'].push({ s: { r: 6, c: 0 }, e: { r: 7, c: 0 } });
                // Merge "Nama" header across rows 6-7
                ws['!merges'].push({ s: { r: 6, c: 1 }, e: { r: 7, c: 1 } });
                // Merge "Email" header across rows 6-7
                ws['!merges'].push({ s: { r: 6, c: 2 }, e: { r: 7, c: 2 } });
                // Merge summary total headers across rows 6-7
                const totalHCol = 3 + scheduledDates.length;
                ws['!merges'].push({ s: { r: 6, c: totalHCol }, e: { r: 7, c: totalHCol } });
                ws['!merges'].push({ s: { r: 6, c: totalHCol + 1 }, e: { r: 7, c: totalHCol + 1 } });
                ws['!merges'].push({ s: { r: 6, c: totalHCol + 2 }, e: { r: 7, c: totalHCol + 2 } });
                ws['!merges'].push({ s: { r: 6, c: totalHCol + 3 }, e: { r: 7, c: totalHCol + 3 } });
                ws['!merges'].push({ s: { r: 6, c: totalHCol + 4 }, e: { r: 7, c: totalHCol + 4 } });

                // --- Apply borders to the data table (header rows + data rows) ---
                const tableRange = { s: { r: 6, c: 0 }, e: { r: DATA_END_ROW, c: lastCol } };
                applyBordersAndStyles(ws, tableRange);

                // --- Apply bold/center styles to header cells ---
                const boldCenter = { font: { bold: true }, alignment: { horizontal: "center", vertical: "center" }, border: thinBorder };
                const boldLeft = { font: { bold: true }, alignment: { horizontal: "left", vertical: "center" }, border: thinBorder };

                // Style title row
                const titleCell = ws[XLSX.utils.encode_cell({ r: 0, c: 0 })];
                if (titleCell) titleCell.s = { font: { bold: true, sz: 16 }, alignment: { horizontal: "center" } };
                // Style period row
                const periodCell = ws[XLSX.utils.encode_cell({ r: 1, c: 0 })];
                if (periodCell) periodCell.s = { font: { bold: true, sz: 12 }, alignment: { horizontal: "center" } };
                // Style generated row
                const genCell = ws[XLSX.utils.encode_cell({ r: 2, c: 0 })];
                if (genCell) genCell.s = { font: { sz: 10, italic: true }, alignment: { horizontal: "center" } };
                // Style legend row
                const legendCell = ws[XLSX.utils.encode_cell({ r: 4, c: 0 })];
                if (legendCell) legendCell.s = { font: { sz: 10, italic: true }, alignment: { horizontal: "left" } };

                // Style column header rows (row 6 and 7)
                for (let C = 0; C <= lastCol; C++) {
                    const addr6 = XLSX.utils.encode_cell({ r: 6, c: C });
                    const addr7 = XLSX.utils.encode_cell({ r: 7, c: C });
                    if (ws[addr6]) ws[addr6].s = { ...boldCenter, fill: { fgColor: { rgb: "4472C4" } }, font: { bold: true, color: { rgb: "FFFFFF" } } };
                    if (ws[addr7]) ws[addr7].s = { ...boldCenter, fill: { fgColor: { rgb: "5B9BD5" } }, font: { bold: true, color: { rgb: "FFFFFF" } } };
                }

                // Style data cells: center-align status columns, left-align name/email
                for (let R = DATA_START_ROW; R <= DATA_END_ROW; R++) {
                    for (let C = 0; C <= lastCol; C++) {
                        const addr = XLSX.utils.encode_cell({ r: R, c: C });
                        if (!ws[addr]) ws[addr] = { v: "", t: "s" };
                        if (C === 0) {
                            // No column ? center
                            ws[addr].s = { alignment: { horizontal: "center", vertical: "center" }, border: thinBorder };
                        } else if (C === 1) {
                            // Nama ? left align
                            ws[addr].s = { alignment: { horizontal: "left", vertical: "center" }, border: thinBorder };
                        } else if (C === 2) {
                            // Email ? left align
                            ws[addr].s = { alignment: { horizontal: "left", vertical: "center" }, border: thinBorder, font: { sz: 10 } };
                        } else {
                            // Status & totals ? center
                            ws[addr].s = { alignment: { horizontal: "center", vertical: "center" }, border: thinBorder };
                            // Color-code status cells
                            const val = ws[addr].v;
                            if (val === "H") ws[addr].s.font = { color: { rgb: "008000" }, bold: true };
                            else if (val === "T") ws[addr].s.font = { color: { rgb: "FF8C00" }, bold: true };
                            else if (val === "X") ws[addr].s.font = { color: { rgb: "CC0000" }, bold: true };
                            else if (val === "I") ws[addr].s.font = { color: { rgb: "0066CC" }, bold: true };
                            else if (val === "C") ws[addr].s.font = { color: { rgb: "9333EA" }, bold: true };
                            else if (val === "L") ws[addr].s.font = { color: { rgb: "777777" }, bold: true, italic: true };
                        }
                    }
                    // Alternate row shading
                    if ((R - DATA_START_ROW) % 2 === 1) {
                        for (let C = 0; C <= lastCol; C++) {
                            const addr = XLSX.utils.encode_cell({ r: R, c: C });
                            if (ws[addr] && ws[addr].s) {
                                ws[addr].s.fill = { fgColor: { rgb: "F2F7FB" } };
                            }
                        }
                    }
                }

                // Style summary block (using columns B and C now)
                const summaryTitleAddr = XLSX.utils.encode_cell({ r: summaryStartRow, c: 1 });
                const summaryValueTitleAddr = XLSX.utils.encode_cell({ r: summaryStartRow, c: 2 });
                if (ws[summaryTitleAddr]) ws[summaryTitleAddr].s = { font: { bold: true, sz: 13 } };
                if (ws[summaryValueTitleAddr]) ws[summaryValueTitleAddr].s = { font: { bold: true, sz: 13 } };
                
                for (let R = summaryStartRow + 1; R < aoa.length; R++) {
                    const labelAddr = XLSX.utils.encode_cell({ r: R, c: 1 });
                    const valueAddr = XLSX.utils.encode_cell({ r: R, c: 2 });
                    if (ws[labelAddr]) ws[labelAddr].s = { font: { bold: true }, border: thinBorder, alignment: { horizontal: "left" } };
                    if (ws[valueAddr]) {
                        ws[valueAddr].s = { border: thinBorder, alignment: { horizontal: "center" }, font: { bold: true } };
                        // Find percentage rows by label index logic or specific strings. Let's just explicitly set `z` for the last array elements.
                        // Row indices:
                        // summaryStartRow: "RINGKASAN"
                        // +1: Total Pengguna
                        // +2: Total Hari
                        // +3: Hadir Tepat Waktu (H)
                        // +4: Hadir Terlambat (T)
                        // +5: Total Kehadiran (H + T) -> percentage format
                        // +6: Tidak Hadir (X)
                        // +7: Izin (I)
                        // +8: Cuti (C)
                        // +9: Total Tidak Hadir (X + I + C) -> percentage format
                        if (R === summaryStartRow + 5 || R === summaryStartRow + 9) {
                            ws[valueAddr].z = '0.0%';
                        }
                    }
                }

                // --- Style and Merge Holiday List ---
                if (holidaysList.length > 0) {
                    const colStart = 4; // E
                    const dateEnd = colStart + 2;
                    const ketEnd = dateEnd + 6;
                    if (!ws['!merges']) ws['!merges'] = [];
                    // Merge title
                    ws['!merges'].push({ s: { r: summaryStartRow, c: colStart }, e: { r: summaryStartRow, c: ketEnd } });
                    const titleCell = ws[XLSX.utils.encode_cell({ r: summaryStartRow, c: colStart })];
                    if (titleCell) titleCell.s = { font: { bold: true, sz: 13 }, alignment: { horizontal: "left" } };
                    
                    for (let r = summaryStartRow + 1; r < summaryStartRow + 2 + holidaysList.length; r++) {
                        ws['!merges'].push({ s: { r: r, c: colStart }, e: { r: r, c: dateEnd } });
                        ws['!merges'].push({ s: { r: r, c: dateEnd + 1 }, e: { r: r, c: ketEnd } });
                        // Borders for merged cells bounds
                        applyBordersAndStyles(ws, { s: { r: r, c: colStart }, e: { r: r, c: dateEnd } });
                        applyBordersAndStyles(ws, { s: { r: r, c: dateEnd + 1 }, e: { r: r, c: ketEnd } });
                        
                        const dateCell = ws[XLSX.utils.encode_cell({ r: r, c: colStart })];
                        const ketCell = ws[XLSX.utils.encode_cell({ r: r, c: dateEnd + 1 })];
                        if (dateCell) dateCell.s.alignment = { horizontal: "center" };
                        if (ketCell) ketCell.s.alignment = { horizontal: "left" };
                        if (r === summaryStartRow + 1) {
                            if (dateCell) dateCell.s.font = { bold: true };
                            if (ketCell) ketCell.s.font = { bold: true };
                        }
                    }
                }

                // --- Column widths ---
                const colWidths = [{ wch: 4 }]; // No
                colWidths.push({ wch: 28 }); // Nama
                colWidths.push({ wch: 30 }); // Email
                scheduledDates.forEach(() => colWidths.push({ wch: 5 })); // Date columns
                colWidths.push({ wch: 9 }); // Total H
                colWidths.push({ wch: 9 }); // Total T
                colWidths.push({ wch: 9 }); // Total X
                colWidths.push({ wch: 9 }); // Total I
                colWidths.push({ wch: 9 }); // Total C
                ws['!cols'] = colWidths;

                // --- Row heights ---
                const rowHeights = [];
                rowHeights[0] = { hpt: 28 }; // Title
                rowHeights[1] = { hpt: 22 }; // Period
                rowHeights[6] = { hpt: 22 }; // Day header
                rowHeights[7] = { hpt: 20 }; // Date header
                ws['!rows'] = rowHeights;

                const sheetName = `${indonesianMonths[m]} ${y}`;
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
                hasSheets = true;
                
                currentMonth.setMonth(currentMonth.getMonth() + 1);
            }
            
            if (!hasSheets) {
                showAlert("Tidak ada jadwal yang cocok dengan rentang waktu yang dipilih.", true);
                setLoading(false);
                return;
            }

            // Build descriptive filename
            const fileStartStr = startDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
            const fileEndStr = endDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
            const fileName = `Rekap_Absensi_${fileStartStr}_sd_${fileEndStr}.xlsx`;
            
            XLSX.writeFile(wb, fileName);
            showAlert("Laporan berhasil diunduh!");
        } catch (error) { console.error("Gagal membuat rekap:", error); showAlert(error.message || "Terjadi kesalahan saat membuat laporan.", true); } 
        finally { setLoading(false); }
    };

    const showScheduleManager = async () => {
        await initializeUserSession();
        const body = createElement('div', { class: 'modal-body space-y-6' });
        body.innerHTML = `<div class="widget"><h4 class="widget-title">Pengaturan Umum</h4><div class="grid-2-col gap-4"><label>Latitude: <input type="number" step="any" id="target-latitude" value="${globalSettings.target_latitude}" class="form-input"></label><label>Longitude: <input type="number" step="any" id="target-longitude" value="${globalSettings.target_longitude}" class="form-input"></label></div><label class="block my-2">Toleransi Jarak (meter): <input type="number" id="allowed-radius" value="${globalSettings.allowed_radius_meters}" class="form-input w-24"></label></div><div class="widget"><h4 class="widget-title">Jadwal Umum</h4><div id="general-schedule-list" class="space-y-2"></div><div class="schedule-widget-footer"><button id="add-general-slot" class="btn btn-secondary btn-sm mt-2">+ Tambah Sesi</button></div></div><div class="widget"><h4 class="widget-title">Konfigurasi Peran Khusus</h4><div id="custom-roles-config-list" class="space-y-4"></div><div class="schedule-widget-footer"><button id="add-new-role" class="btn btn-secondary btn-sm mt-3">+ Buat Peran Baru</button></div></div><div class="modal-footer-centered"><button id="save-all-schedule-settings" class="btn btn-primary btn-lg">Simpan Semua Perubahan</button></div>`;
        showCustomModal("Jadwal & Peran", body, 'admin-modal', 'lg');
        renderScheduleEditor();
    };

    const createSlotHtml = (day = 1, startTime = '06:30', endTime = '09:30', lateTime = '08:16', late_feature_enabled = true) => `
    <div class="schedule-slot-row">
        <div class="schedule-slot-header">
            <select class="day-select form-input">${DAYS_OF_WEEK.map((d, i) => `<option value="${i}" ${i == day ? 'selected' : ''}>${d}</option>`).join('')}</select>
            <div class="time-inputs"><input type="time" class="start-time-input form-input" value="${startTime}"><span>-</span><input type="time" class="end-time-input form-input" value="${endTime}"></div>
            <button class="remove-slot-btn btn-icon btn-icon-danger" title="Hapus Sesi"><svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
        </div>
        <div class="late-feature-row">
            <label class="flex items-center gap-2 text-sm font-medium"><input type="checkbox" class="late-feature-toggle form-checkbox" ${late_feature_enabled ? 'checked' : ''}>Aktifkan Telat</label>
            <input type="time" class="late-time-input form-input" value="${lateTime}" ${!late_feature_enabled ? 'disabled' : ''} style="width: 120px;">
        </div>
    </div>`;
    
    const renderScheduleEditor = () => {
        document.getElementById('general-schedule-list').innerHTML = (presenceSchedule.slots || []).map(s => createSlotHtml(s.day, s.startTime, s.endTime, s.lateTime, s.late_feature_enabled)).join('') || '<p class="empty-list-msg">Belum ada jadwal umum.</p>';
        document.getElementById('custom-roles-config-list').innerHTML = Object.entries(rolesConfig).map(([role, config]) => `
            <div class="custom-role-config-row" data-role-name="${role}">
                <div class="custom-role-header">
                    <h5>${role}</h5>
                    <button class="remove-role-btn btn-icon btn-icon-danger">
                        <svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                </div>
                <label class="block my-2">Label Toggle: <input type="text" class="role-toggle-label form-input w-full" value="${config.toggle_label}"></label>
                <h6 class="text-sm font-semibold mt-2">Jadwal Khusus</h6>
                <div class="role-schedule-list space-y-2 mt-1">${(config.schedule?.slots || []).map(s => createSlotHtml(s.day, s.startTime, s.endTime, s.lateTime, s.late_feature_enabled)).join('') || '<p class="empty-list-msg">Belum ada jadwal khusus.</p>'}</div>
                <button class="add-role-slot-btn btn btn-secondary btn-sm mt-2">+ Tambah Sesi Khusus</button>
            </div>`).join('') || '<p class="empty-list-msg">Belum ada peran khusus.</p>';
    };

    const saveAllScheduleSettings = async () => {
        setLoading(true);
        try {
            const batch = writeBatch(db);
            batch.set(doc(db, "app_config", "settings"), { ...globalSettings, target_latitude: parseFloat(document.getElementById('target-latitude').value), target_longitude: parseFloat(document.getElementById('target-longitude').value), allowed_radius_meters: parseInt(document.getElementById('allowed-radius').value) || 50 });
            const generalSlots = [...document.querySelectorAll('#general-schedule-list .schedule-slot-row')].map(row => ({day: parseInt(row.querySelector('.day-select').value), startTime: row.querySelector('.start-time-input').value, endTime: row.querySelector('.end-time-input').value, lateTime: row.querySelector('.late-time-input').value, late_feature_enabled: row.querySelector('.late-feature-toggle').checked }));
            batch.set(doc(db, "app_config", "schedule"), { slots: generalSlots });
            const newRolesConfig = {};
            document.querySelectorAll('.custom-role-config-row').forEach(row => {
                const roleName = row.dataset.roleName;
                newRolesConfig[roleName] = { toggle_label: row.querySelector('.role-toggle-label').value, schedule: { slots: [...row.querySelectorAll('.schedule-slot-row')].map(slotRow => ({day: parseInt(slotRow.querySelector('.day-select').value), startTime: slotRow.querySelector('.start-time-input').value, endTime: slotRow.querySelector('.end-time-input').value, lateTime: slotRow.querySelector('.late-time-input').value, late_feature_enabled: slotRow.querySelector('.late-feature-toggle').checked }))}};
            });
            batch.set(doc(db, "app_config", "roles_config"), newRolesConfig);
            await batch.commit();
            showAlert("Semua pengaturan berhasil disimpan!");
            document.getElementById('admin-modal')?.remove();
        } catch (error) { console.error("Gagal menyimpan pengaturan:", error); showAlert("Gagal menyimpan pengaturan. Pastikan Anda memiliki hak Admin.", true); } 
        finally { setLoading(false); }
    };

    const showRoleAssignmentManager = async () => {
        const success = await fetchAllUserProfiles();
        if (!success) return;
        const customRoles = Object.keys(rolesConfig);
        const rolesPromises = allUsersCache.map(user => getDoc(doc(db, "user_roles", user.email)));
        const usersWithRoles = (await Promise.all(rolesPromises)).map((snap, i) => ({...allUsersCache[i], roles: snap.exists() ? snap.data().roles : []}));
        const body = createElement('div', { class: 'modal-body' });
        body.innerHTML = `<input type="text" id="role-user-search" placeholder="Cari nama atau email..." class="form-input w-full mb-4 sticky top-0">`;
        const userList = createElement('div', { class: 'user-role-list' });
        userList.innerHTML = usersWithRoles.map(user => `<div class="user-entry" data-name="${user.name.toLowerCase()}" data-email="${user.email.toLowerCase()}"><div class="user-info"><p class="font-bold">${user.name}</p><p class="text-sm text-gray-400">${user.email}</p></div><div class="role-checkbox-group">${customRoles.map(role => `<label><input type="checkbox" data-email="${user.email}" data-role="${role}" class="role-checkbox form-checkbox" ${user.roles.includes(role) ? 'checked' : ''}><span class="ml-2">${role}</span></label>`).join('')}</div></div>`).join('');
        body.appendChild(userList);
        showCustomModal("Tugaskan Peran", body, 'admin-modal', 'md');
    };
    
    // --- FITUR BARU: MANAJEMEN KELAS ---
    const showClassManager = async () => {
        setLoading(true);
        const [classDefsSnap, classAssignsSnap, usersResult] = await Promise.all([
            getDoc(doc(db, "app_config", "class_definitions")),
            getDocs(collection(db, "user_classes")),
            fetchAllUserProfiles()
        ]);
    
        if (!usersResult) { setLoading(false); return; }
    
        let classDefs = classDefsSnap.exists() ? classDefsSnap.data() : { categories: ['Guru'], class_names: [] };
        if (!Array.isArray(classDefs.categories)) classDefs.categories = [];
        if (!Array.isArray(classDefs.class_names)) classDefs.class_names = [];
    
        const assignments = classAssignsSnap.docs.reduce((acc, doc) => {
            acc[doc.id] = doc.data();
            return acc;
        }, {});
    
        setLoading(false);
    
        const body = createElement('div', { class: 'modal-body', style: 'display: flex; flex-direction: column; gap: 1rem; padding-bottom: 0;' });
        body.innerHTML = `
            <div class="rekap-tabs" id="class-manager-tabs" style="flex-shrink: 0; margin-bottom: 0;">
                <button class="tab-btn active" data-tab="assignments">Tugaskan Kelas</button>
                <button class="tab-btn" data-tab="editor">Edit Opsi Kelas</button>
            </div>
            <div id="class-manager-content" style="flex-grow: 1; overflow-y: auto;">
                <div data-content="assignments"></div>
                <div data-content="editor" class="hidden"></div>
            </div>
            <div id="class-manager-footer" class="modal-footer" style="flex-shrink: 0; display: none;"></div>`;
        
        showCustomModal("Manajemen Kelas", body, 'class-manager-modal', 'lg');
        
        const modal = document.getElementById('class-manager-modal');
        const assignmentContainer = body.querySelector('[data-content="assignments"]');
        const editorContainer = body.querySelector('[data-content="editor"]');
        const footerContainer = body.querySelector('#class-manager-footer');
        
        const renderEditor = () => renderClassEditorView(editorContainer, classDefs);
        const renderAssignments = () => renderClassAssignmentView(assignmentContainer, allUsersCache, classDefs, assignments);

        renderAssignments();
        renderEditor();

        modal.addEventListener('click', async (e) => {
            const tabBtn = e.target.closest('#class-manager-tabs .tab-btn');
            if (tabBtn) {
                const tabId = tabBtn.dataset.tab;
                modal.querySelectorAll('#class-manager-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
                tabBtn.classList.add('active');
                modal.querySelectorAll('#class-manager-content > div').forEach(content => {
                    content.classList.toggle('hidden', content.dataset.content !== tabId);
                });
                footerContainer.style.display = tabId === 'editor' ? 'flex' : 'none';
            }

            const addItem = (type) => {
                const defsArray = type === 'categories' ? 'categories' : 'class_names';
                const input = modal.querySelector(`#new-${type === 'categories' ? 'category' : 'classname'}-input`);
                const value = input.value.trim();
                if (value && !classDefs[defsArray].includes(value)) {
                    classDefs[defsArray].push(value);
                    renderEditor();
                }
                input.value = '';
            };

            if (e.target.id === 'add-category-btn') addItem('categories');
            if (e.target.id === 'add-classname-btn') addItem('class_names');

            const removeItem = e.target.closest('.remove-class-def-item');
            if (removeItem) {
                const { type, item } = removeItem.dataset;
                classDefs[type] = classDefs[type].filter(i => i !== item);
                renderEditor();
            }

            if (e.target.id === 'save-class-defs-btn') {
                setLoading(true);
                try {
                    await setDoc(doc(db, "app_config", "class_definitions"), classDefs);
                    showAlert("Opsi kelas berhasil disimpan.");
                    renderAssignments(); 
                } catch (err) {
                    showAlert("Gagal menyimpan opsi kelas.", true);
                    console.error(err);
                } finally {
                    setLoading(false);
                }
            }
        });

        footerContainer.innerHTML = `<button id="save-class-defs-btn" class="btn btn-primary">Simpan Perubahan Opsi</button>`;
        footerContainer.style.display = 'none';
    };
    
    const renderClassEditorView = (container, classDefs) => {
        container.innerHTML = `
            <div class="widget" style="padding: 1.5rem;">
                <h4 class="widget-title" style="margin-bottom: 1rem;">Edit Opsi Kategori</h4>
                <div id="class-editor-categories" class="mb-4"></div>
                <div class="class-editor-add-row">
                    <input type="text" id="new-category-input" class="form-input" placeholder="Kategori baru...">
                    <button id="add-category-btn" class="btn btn-secondary">Tambah</button>
                </div>
            </div>
            <div class="widget" style="padding: 1.5rem;">
                <h4 class="widget-title" style="margin-bottom: 1rem;">Edit Opsi Nama Kelas</h4>
                <div id="class-editor-names" class="mb-4"></div>
                <div class="class-editor-add-row">
                    <input type="text" id="new-classname-input" class="form-input" placeholder="Nama kelas baru...">
                    <button id="add-classname-btn" class="btn btn-secondary">Tambah</button>
                </div>
            </div>`;
    
        const renderList = (type, listContainerId) => {
            const listContainer = container.querySelector(listContainerId);
            const trashIcon = `<svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>`;
            listContainer.innerHTML = (classDefs[type] || []).map(item => `
                <div class="user-entry">
                    <p class="flex-grow">${item}</p>
                    <button class="btn-icon btn-icon-danger remove-class-def-item" data-type="${type}" data-item="${item}">
                         ${trashIcon}
                    </button>
                </div>`).join('');
        };
    
        renderList('categories', '#class-editor-categories');
        renderList('class_names', '#class-editor-names');
    };
    
    const renderClassAssignmentView = (container, users, classDefs, assignments) => {
        const categoryOptions = `<option value="">-- Tidak ada --</option>${classDefs.categories.map(c => `<option value="${c}">${c}</option>`).join('')}`;
        const classNameOptions = `<option value="">-- Tidak ada --</option>${classDefs.class_names.map(c => `<option value="${c}">${c}</option>`).join('')}`;
    
        container.innerHTML = `<input type="search" id="class-user-search" placeholder="Cari nama pengguna..." class="form-input w-full mb-4">
            <div id="class-assignment-list">
            ${users.map(user => {
                const userAssignment = assignments[user.email] || { category: '', class_name: '' };
                return `
                <div class="user-entry" data-name="${user.name.toLowerCase()}">
                    <div class="user-info"><p class="font-bold">${user.name}</p><p class="text-sm text-gray-400">${user.email}</p></div>
                    <div class="flex gap-2 flex-wrap">
                        <select class="form-select user-class-assign-select" data-type="category" data-email="${user.email}">
                            ${categoryOptions.replace(`value="${userAssignment.category}"`, `value="${userAssignment.category}" selected`)}
                        </select>
                        <select class="form-select user-class-assign-select" data-type="class_name" data-email="${user.email}">
                             ${classNameOptions.replace(`value="${userAssignment.class_name}"`, `value="${userAssignment.class_name}" selected`)}
                        </select>
                    </div>
                </div>`;
            }).join('')}
            </div>`;
    };
    
    const runAdminDiagnostics = async () => {
        if (!currentUser) return;
        let diagnosticsLog = "--- MENJALANKAN DIAGNOSTIK ADMIN ---\n";
        diagnosticsLog += `Mengecek untuk email: ${currentUser.email}\n`;
        try {
            const docRef = doc(db, "app_config", "roles");
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                diagnosticsLog += "[OK] Dokumen /app_config/roles DITEMUKAN.\n";
                const data = docSnap.data();
                if ('admin_emails' in data && Array.isArray(data.admin_emails)) {
                    diagnosticsLog += `Isi 'admin_emails': [${data.admin_emails.join(', ')}]\n`;
                    if (data.admin_emails.includes(currentUser.email)) {
                        diagnosticsLog += "[OK] BERHASIL: Email Anda ditemukan di daftar admin.";
                        showAlert("Diagnostik Admin Berhasil.");
                    } else {
                        diagnosticsLog += "[X] GAGAL: Email Anda TIDAK ditemukan di daftar admin.";
                        showAlert("Diagnostik Gagal: Email tidak terdaftar sebagai admin.", true);
                    }
                } else { diagnosticsLog += "[X] GAGAL: Field 'admin_emails' tidak ada atau bukan Array."; }
            } else { diagnosticsLog += "[X] GAGAL: Dokumen /app_config/roles TIDAK DITEMUKAN."; }
        } catch (error) { diagnosticsLog += `Error: ${error.message}`; }
        console.log(diagnosticsLog);
    };

    const handleAdminAction = (action) => {
        DOMElements.adminDropdown.classList.add('hidden');
        const adminFunctions = { 
            'view-attendance': showUserAttendanceViewer, 
            'rekap-attendance': showRekapManager, 
            'schedule-settings': showScheduleManager, 
            'role-manager': showRoleAssignmentManager,
            'class-settings': showClassManager
        };
        const func = adminFunctions[action];
        if (func) func(); else console.warn("Aksi admin tidak dikenal:", action);
    };
    
    const handleAdminSettingToggle = async (e, fieldName) => {
        if (!currentUserRoles.includes('Admin')) return;
        const isChecked = e.target.checked;
        if (fieldName === 'diagnostics_enabled' && isChecked) { runAdminDiagnostics(); }
        setLoading(true);
        try {
            await updateDoc(doc(db, "app_config", "settings"), { [fieldName]: isChecked });
            globalSettings[fieldName] = isChecked;
            showAlert("Pengaturan berhasil disimpan.");
        } catch (error) { console.error(error); showAlert("Gagal menyimpan. Pastikan Anda Admin.", true); e.target.checked = !isChecked; }
        finally { setLoading(false); }
    };

    // =================================
    // 9. EVENT LISTENERS (DELEGATION)
    // =================================
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            await setDoc(doc(db, `artifacts/${appId}/users_profile`, user.email), { name: user.displayName, email: user.email, photoURL: user.photoURL }, { merge: true });
            DOMElements.mainView.classList.remove('hidden');
            DOMElements.loginView.classList.add('hidden');
            await initializeUserSession();
        } else { resetUI(); }
    });

    DOMElements.loginBtn.addEventListener('click', () => { signInWithPopup(auth, new GoogleAuthProvider()).catch(err => { console.error("Login Gagal:", err); showAlert("Gagal masuk dengan Google. Silakan coba lagi.", true); }); });
    DOMElements.logoutBtn.addEventListener('click', () => signOut(auth));
    DOMElements.presensiBtn.addEventListener('click', handlePresence);
    DOMElements.submitIzinCutiBtn.addEventListener('click', handleIzinCuti);
    DOMElements.adminMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); DOMElements.adminDropdown.classList.toggle('hidden'); });
    initBoxResizeAnimations();

    // Set izin-cuti date to today by default
    DOMElements.izinCutiDate.value = new Date().toLocaleDateString('en-CA');
    if (DOMElements.izinCutiEndDate) {
        DOMElements.izinCutiEndDate.value = new Date().toLocaleDateString('en-CA');
        
        document.querySelectorAll('input[name="izin-cuti-type"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const isCuti = e.target.value === 'Cuti';
                const toggleVisibility = (el, show) => {
                    if (el) {
                        el.style.display = show ? 'block' : 'none';
                        if (el._flatpickr && el._flatpickr.altInput) {
                            el._flatpickr.altInput.style.display = show ? 'block' : 'none';
                        }
                    }
                };
                toggleVisibility(DOMElements.izinCutiEndDate, isCuti);
                DOMElements.izinCutiToText.style.display = isCuti ? 'inline' : 'none';
                DOMElements.izinCutiDateLabel.textContent = isCuti ? 'Dari Tanggal:' : 'Tanggal (1 Hari):';
            });
        });
    }
    autoResizeTextarea(DOMElements.izinCutiReason);
    DOMElements.izinCutiReason.addEventListener('input', () => autoResizeTextarea(DOMElements.izinCutiReason));

    // Activity tabs handler
    DOMElements.activityTabsContainer.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.activity-tab-btn');
        if (!tabBtn) return;
        DOMElements.activityTabsContainer.querySelectorAll('.activity-tab-btn').forEach(btn => btn.classList.remove('active'));
        tabBtn.classList.add('active');
        const filter = tabBtn.dataset.filter;
        if (filter === 'custom') {
            const now = new Date();
            const firstDayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-01`;
            const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            DOMElements.activityFilterInputs.style.display = 'block';
            DOMElements.activityFilterInputs.innerHTML = `
                <div class="filter-row">
                    <label>Periode:</label>
                    <input type="date" id="activity-custom-start" class="form-input" value="${firstDayStr}">
                    <span class="activity-range-sep">s/d</span>
                    <input type="date" id="activity-custom-end" class="form-input" value="${todayStr}">
                    <button id="activity-custom-apply" class="btn btn-primary btn-sm">Terapkan</button>
                </div>`;
            
            // Auto-load with prefilled dates
            window.initFlatpickrFor('#activity-custom-start'); window.initFlatpickrFor('#activity-custom-end'); loadPresenceHistory('custom', { start: firstDayStr, end: todayStr });
            
            document.getElementById('activity-custom-apply').addEventListener('click', () => {
                const start = document.getElementById('activity-custom-start').value;
                const end = document.getElementById('activity-custom-end').value;
                if (start && end) loadPresenceHistory('custom', { start, end });
                else showAlert('Pilih tanggal mulai dan akhir.', true);
            });
        } else {
            DOMElements.activityFilterInputs.style.display = 'none';
            loadPresenceHistory(filter);
        }
    });

    DOMElements.holidayTabsContainer.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.activity-tab-btn');
        if (!tabBtn) return;
        DOMElements.holidayTabsContainer.querySelectorAll('.activity-tab-btn').forEach(btn => btn.classList.remove('active'));
        tabBtn.classList.add('active');
        const filter = tabBtn.dataset.filter;
        currentHolidayFilter = filter;
        if (filter === 'custom') {
            const now = new Date();
            const firstDayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-01`;
            const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            DOMElements.holidayFilterInputs.style.display = 'block';
            DOMElements.holidayFilterInputs.innerHTML = `
                <div class="filter-row">
                    <label>Periode:</label>
                    <input type="date" id="holiday-kustom-start" class="form-input" value="${firstDayStr}">
                    <span class="activity-range-sep">s/d</span>
                    <input type="date" id="holiday-kustom-end" class="form-input" value="${todayStr}">
                    <button id="holiday-custom-apply" class="btn btn-primary btn-sm">Terapkan</button>
                </div>`;
            
            // Auto-load with prefilled dates
            window.initFlatpickrFor('#holiday-kustom-start'); window.initFlatpickrFor('#holiday-kustom-end');
            renderHolidayList();
            
            document.getElementById('holiday-custom-apply').addEventListener('click', () => {
                renderHolidayList();
            });
        } else {
            DOMElements.holidayFilterInputs.style.display = 'none';
            renderHolidayList();
        }
    });

    document.body.addEventListener('click', async (e) => {
        if (!DOMElements.adminMenuContainer.contains(e.target)) { DOMElements.adminDropdown.classList.add('hidden'); }
        const dropdownItem = e.target.closest('.dropdown-item');
        if (dropdownItem) { e.preventDefault(); handleAdminAction(dropdownItem.dataset.action); }
        if (e.target.id === 'add-holiday-btn') { showAddHolidayModal(); return; }
        const deleteHolidayBtn = e.target.closest('.delete-holiday-btn');
        if (deleteHolidayBtn) { handleDeleteHoliday(deleteHolidayBtn.dataset.docId); return; }
        if (e.target.classList.contains('add-late-reason-btn')) { showLateReasonModal(e.target.dataset.docId); }
        if (e.target.classList.contains('add-absent-reason-btn')) { showAbsentReasonModal(e.target.dataset.dateKey); }
        // Handle user deleting their own Izin/Cuti
        const ownDeleteBtn = e.target.closest('.delete-record-btn[data-delete-type="own"]');
        if (ownDeleteBtn) { handleDeleteOwnRecord(ownDeleteBtn.dataset.docId); return; }
        // Handle admin deleting from attendance viewer
        const adminDeleteBtn = e.target.closest('.admin-delete-btn[data-doc-id]');
        if (adminDeleteBtn) {
            const docId = adminDeleteBtn.dataset.docId;
            const userEmail = adminDeleteBtn.dataset.userEmail;
            if (!confirm('Yakin ingin menghapus data presensi ini?')) return;
            setLoading(true);
            try {
                await deleteDoc(doc(db, `artifacts/${appId}/users/${userEmail}/presensi`, docId));
                showAlert('Data berhasil dihapus.');
                const modal = adminDeleteBtn.closest('.modal-wrapper');
                const activeUser = modal?.querySelector('.user-select-item.active');
                if (activeUser && modal) fetchAndDisplayUserHistory(activeUser.dataset.email, modal);
            } catch (error) { console.error('Gagal menghapus:', error); showAlert('Gagal menghapus data.', true); }
            finally { setLoading(false); }
            return;
        }

        const adminDeleteUserBtn = e.target.closest('.admin-delete-user-btn[data-email]');
        if (adminDeleteUserBtn) {
            e.stopPropagation();
            const email = adminDeleteUserBtn.dataset.email;
            if (!confirm(`PERINGATAN: Anda yakin ingin menghapus profil '${email}' beserta SELURUH data absensinya secara permanen? Tindakan ini tidak dapat dibatalkan.`)) return;
            setLoading(true);
            try {
                const presensiCol = collection(db, `artifacts/${appId}/users/${email}/presensi`);
                const presensiSnap = await getDocs(presensiCol);
                const batch = writeBatch(db);
                presensiSnap.forEach(docSnap => batch.delete(docSnap.ref));
                batch.delete(doc(db, "user_roles", email));
                batch.delete(doc(db, "user_classes", email));
                batch.delete(doc(db, `artifacts/${appId}/users_profile`, email));
                await batch.commit();

                allUsersCache = allUsersCache.filter(u => u.email !== email);
                adminDeleteUserBtn.closest('.user-select-item').remove();
                showAlert(`Pengguna ${email} dan seluruh datanya telah dihapus.`);
                
                const modal = e.target.closest('.modal-wrapper');
                const detailsContainer = modal?.querySelector('#viewer-attendance-details');
                const activeItem = modal?.querySelector('.user-select-item.active');
                if (detailsContainer && (!activeItem || activeItem.dataset.email === email)) {
                    detailsContainer.innerHTML = `<div class="empty-state">Pilih pengguna di sebelah kiri untuk melihat riwayat.</div>`;
                }
            } catch (error) {
                console.error("Gagal menghapus pengguna:", error);
                showAlert("Terjadi kesalahan saat menghapus pengguna.", true);
            } finally {
                setLoading(false);
            }
            return;
        }
        
        const modal = e.target.closest('.modal-wrapper');
        if (!modal) return;
    
        if (e.target.id === 'generate-rekap-btn') { generateAndExportRekap(); }
        if (e.target.id === 'save-all-schedule-settings') { saveAllScheduleSettings(); }
        if (e.target.closest('.user-select-item')) {
            const userItem = e.target.closest('.user-select-item');
            const userEmail = userItem.dataset.email;
            modal.querySelectorAll('.user-select-item.active').forEach(item => item.classList.remove('active'));
            userItem.classList.add('active');
            
            const filterContainer = modal.querySelector('#viewer-filter-container');
            if (filterContainer) {
                const currentYear = new Date().getFullYear();
                const years = Array.from({length: 5}, (_, i) => currentYear - i);
                const months = Array.from({length: 12}, (_, i) => ({ value: i, name: new Date(0, i).toLocaleString('id-ID', { month: 'long' }) }));
                
                filterContainer.innerHTML = `<div class="rekap-tabs viewer-tabs" id="viewer-filter-tabs">
                    <button class="tab-btn active" data-filter="all">Semua</button>
                    <button class="tab-btn" data-filter="harian">Harian</button>
                    <button class="tab-btn" data-filter="bulanan">Bulanan</button>
                    <button class="tab-btn" data-filter="tahunan">Tahunan</button>
                    <button class="tab-btn" data-filter="kustom">Kustom</button>
                </div>
                <div id="viewer-filter-inputs">
                     <div data-content="harian" class="hidden flex gap-4 items-center flex-wrap"><label>Tanggal:</label><input type="date" id="viewer-harian-date" class="form-input"></div>
                     <div data-content="bulanan" class="hidden flex gap-4 items-center flex-wrap"><label>Bulan:</label><select id="viewer-bulanan-month" class="form-input">${months.map(m => `<option value="${m.value}">${m.name}</option>`).join('')}</select><label>Tahun:</label><select id="viewer-bulanan-year" class="form-input">${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select></div>
                     <div data-content="tahunan" class="hidden flex gap-4 items-center flex-wrap"><label>Tahun:</label><select id="viewer-tahunan-year" class="form-input">${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select></div>
                     <div data-content="kustom" class="hidden flex gap-4 items-center flex-wrap"><label>Mulai:</label><input type="date" id="viewer-kustom-start" class="form-input"><label>Sampai:</label><input type="date" id="viewer-kustom-end" class="form-input"></div>
                </div>`;
                prefillDateFilters(modal, 'viewer');
                fetchAndDisplayUserHistory(userEmail, modal);
            }
        }
        const tabBtn = e.target.closest('.viewer-tabs .tab-btn, .rekap-tabs .tab-btn');
        if (tabBtn && !tabBtn.closest('#class-manager-tabs')) {
            const tabsContainer = tabBtn.parentElement;
            const filterInputsContainer = modal.querySelector(`#${tabsContainer.id.replace('tabs', 'inputs')}`);

            tabsContainer.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            tabBtn.classList.add('active');
            
            if (filterInputsContainer) {
                filterInputsContainer.querySelectorAll(':scope > div').forEach(div => div.classList.add('hidden'));
                const content = filterInputsContainer.querySelector(`div[data-content="${tabBtn.dataset.filter}"]`);
                if (content) content.classList.remove('hidden');
            }

            if (tabsContainer.classList.contains('viewer-tabs')) {
                const activeUser = modal.querySelector('.user-select-item.active');
                if(activeUser) fetchAndDisplayUserHistory(activeUser.dataset.email, modal);
            }
        }
        if(e.target.id === 'add-general-slot') { const list = modal.querySelector('#general-schedule-list'); list.querySelector('.empty-list-msg')?.remove(); list.insertAdjacentHTML('beforeend', createSlotHtml()); }
        if(e.target.classList.contains('add-role-slot-btn')) { const list = e.target.closest('.custom-role-config-row').querySelector('.role-schedule-list'); list.querySelector('.empty-list-msg')?.remove(); list.insertAdjacentHTML('beforeend', createSlotHtml()); }
        const removeSlotBtn = e.target.closest('.remove-slot-btn');
        if(removeSlotBtn) { removeSlotBtn.closest('.schedule-slot-row').remove(); }
        const removeRoleBtn = e.target.closest('.remove-role-btn');
        if (removeRoleBtn) {
            const roleRow = removeRoleBtn.closest('.custom-role-config-row');
            const roleName = roleRow?.dataset.roleName;
            if (roleName && confirm(`Anda yakin ingin menghapus peran "${roleName}"?`)) {
                delete rolesConfig[roleName];
                renderScheduleEditor();
                showAlert(`Peran "${roleName}" telah dihapus. Klik 'Simpan Semua Perubahan' untuk finalisasi.`);
            }
        }
        if(e.target.id === 'add-new-role') {
            const newRoleName = prompt("Masukkan nama peran baru (contoh: Piket):")?.trim();
            if (newRoleName && !document.querySelector(`[data-role-name="${newRoleName}"]`)) { rolesConfig[newRoleName] = { toggle_label: newRoleName, schedule: { slots: [] } }; renderScheduleEditor(); }
            else if (newRoleName) { showAlert("Peran dengan nama tersebut sudah ada.", true); }
        }
        if (e.target.closest('.color-swatch')) {
            const swatch = e.target.closest('.color-swatch');
            themeManager.applyAccent(swatch.dataset.accent);
            modal.querySelector('.color-swatch.active')?.classList.remove('active');
            modal.querySelector('#custom-color-swatch.active')?.classList.remove('active');
            swatch.classList.add('active');
        }
    });
    
    document.body.addEventListener('change', async (e) => {
        const modal = e.target.closest('.modal-wrapper');
        
        if (e.target.classList.contains('user-class-assign-select')) {
            const email = e.target.dataset.email;
            const categorySelect = modal.querySelector(`.user-class-assign-select[data-email="${email}"][data-type="category"]`);
            const classNameSelect = modal.querySelector(`.user-class-assign-select[data-email="${email}"][data-type="class_name"]`);
            
            const assignment = {
                category: categorySelect.value,
                class_name: classNameSelect.value
            };

            setLoading(true);
            try {
                await setDoc(doc(db, "user_classes", email), assignment);
                showAlert(`Kelas untuk ${email} berhasil diperbarui.`);
                if (currentUser.email === email) {
                    currentUserClass = assignment;
                    renderUserProfile();
                }
            } catch (err) {
                console.error("Gagal menyimpan penugasan kelas:", err);
                showAlert("Gagal menyimpan penugasan kelas.", true);
            } finally {
                setLoading(false);
            }
        }

        if (e.target.id === 'single-presence-toggle') { handleAdminSettingToggle(e, 'single_presence_per_day'); }
        if (e.target.id === 'diagnostics-toggle') { handleAdminSettingToggle(e, 'diagnostics_enabled'); }
        if (e.target.classList.contains('role-checkbox')) {
            setLoading(true);
            const email = e.target.dataset.email, role = e.target.dataset.role, isChecked = e.target.checked;
            const userRolesDocRef = doc(db, "user_roles", email);
            try {
                const userRolesSnap = await getDoc(userRolesDocRef);
                let currentRoles = userRolesSnap.exists() ? userRolesSnap.data().roles.filter(r => rolesConfig[r]) : [];
                if (isChecked) { currentRoles.push(role); } else { currentRoles = currentRoles.filter(r => r !== role); }
                await setDoc(userRolesDocRef, { roles: [...new Set(currentRoles)] });
                showAlert("Peran berhasil diperbarui.");
            } catch (error) { console.error("Gagal memperbarui peran:", error); showAlert("Gagal memperbarui peran. Pastikan Anda Admin.", true); e.target.checked = !isChecked; } 
            finally { setLoading(false); }
        }
        if (e.target.classList.contains('late-feature-toggle')) { e.target.closest('.schedule-slot-row').querySelector('.late-time-input').disabled = !e.target.checked; }
        
        if (e.target.id === 'rekap-select-all') {
            const isChecked = e.target.checked;
            modal.querySelectorAll('.rekap-user-checkbox').forEach(cb => cb.checked = isChecked);
            updateRekapButtonState(modal);
        }
        if (e.target.classList.contains('rekap-user-checkbox')) {
            const allCheckboxes = modal.querySelectorAll('.rekap-user-checkbox');
            const checkedCount = modal.querySelectorAll('.rekap-user-checkbox:checked').length;
            modal.querySelector('#rekap-select-all').checked = checkedCount === allCheckboxes.length;
            updateRekapButtonState(modal);
        }

        if (e.target.id === 'theme-select') { themeManager.applyTheme(e.target.value); }
        if (e.target.classList.contains('custom-role-toggle')) {
            const roleName = e.target.dataset.roleName;
            document.querySelectorAll('.custom-role-toggle').forEach(t => { if (t !== e.target) t.checked = false; });
            activeCustomRole = e.target.checked ? roleName : null;
            updatePresenceState();
        }
        if (e.target.closest('#viewer-filter-inputs')) {
            const activeUser = modal.querySelector('.user-select-item.active');
            if(activeUser) {
                fetchAndDisplayUserHistory(activeUser.dataset.email, modal);
            }
        }
    });

    document.body.addEventListener('input', e => {
        const modal = e.target.closest('.modal-wrapper');
        if (!modal) return;
        const searchTerm = e.target.value.toLowerCase();
        
        if (e.target.id === 'viewer-user-search') {
            modal.querySelectorAll('#viewer-user-list .user-select-item').forEach(entry => { entry.style.display = entry.dataset.name.includes(searchTerm) ? 'flex' : 'none'; });
        }
        if (e.target.id === 'rekap-user-search') {
            modal.querySelectorAll('.user-rekap-list .user-entry').forEach(entry => {
                entry.style.display = entry.textContent.toLowerCase().includes(searchTerm) ? 'flex' : 'none';
            });
        }
        if (e.target.id === 'role-user-search') {
            modal.querySelectorAll('.user-role-list .user-entry').forEach(entry => {
                entry.style.display = entry.dataset.name.includes(searchTerm) || entry.dataset.email.includes(searchTerm) ? 'flex' : 'none';
            });
        }
        if (e.target.id === 'class-user-search') {
             modal.querySelectorAll('#class-assignment-list .user-entry').forEach(entry => {
                entry.style.display = entry.dataset.name.includes(searchTerm) ? 'flex' : 'none';
            });
        }
    });
}


window.initFlatpickrFor = function(selector) {
    // If passed an element directly, check if already initialized
    if (typeof selector !== 'string' && selector._flatpickr) return selector._flatpickr;
    
    if (typeof flatpickr !== 'undefined') {
        return flatpickr(selector, {
            altInput: true,
            altFormat: "d F Y",
            dateFormat: "Y-m-d",
            locale: "id",
            disableMobile: true
        });
    }
    return null;
};

window.addEventListener('DOMContentLoaded', () => {

    if (window.initFlatpickrFor) {
        window.initFlatpickrFor('.form-input[type="date"]');
        
        // Hide Cuti endDate immediately if initial mode is Izin (default)
        const initEndDateEl = document.getElementById('izin-cuti-end-date');
        if (initEndDateEl && initEndDateEl._flatpickr && initEndDateEl._flatpickr.altInput) {
            initEndDateEl._flatpickr.altInput.style.display = 'none';
        }
    }

    main();
});
