import { CONFIG } from './config.js';
import { api, isDemoMode } from './api.js';
import { getAvailableYears, getCurrentAcademicYear } from './data-loader.js';
import { getCurrentUser, getUserPermissions } from './auth.js';

const CLASS_GROUPS = {
  'Indria': 'Indria (TK A, TK B)',
  'Pratama': 'Pratama (1-3 SD)',
  'Madya': 'Madya (4-6 SD)',
  'Tunas Muda': 'Tunas Muda (7-9 SMP)'
};

let kfDocsData = [];
let currentYearLabel = '';
let kfDocsPage = 1;
let kfDocsPerPage = 12;
let kfInitialized = false;

export async function initKFDocs() {
  if (kfInitialized) { loadKFDocs(); return; }
  kfInitialized = true;

  // Setup handlers (with null checks)
  const loadBtn = document.getElementById('kfd-load');
  const uploadBtn = document.getElementById('kfd-upload-btn');
  const submitBtn = document.getElementById('kfd-submit');
  const groupFilter = document.getElementById('kfd-group-filter');
  const perPageSel = document.getElementById('kfd-per-page');

  if (loadBtn) loadBtn.onclick = loadKFDocs;
  if (uploadBtn) uploadBtn.onclick = () => {
    const form = document.getElementById('kfd-upload-form');
    if (form) form.classList.toggle('hidden');
  };
  if (submitBtn) submitBtn.onclick = handleUpload;
  if (groupFilter) groupFilter.onchange = () => { kfDocsPage = 1; renderKFGallery(); };
  if (perPageSel) perPageSel.onchange = () => {
    kfDocsPerPage = parseInt(perPageSel.value, 10) || 12;
    kfDocsPage = 1;
    renderKFGallery();
  };

  // Load years
  try {
    const years = await getAvailableYears();
    const currentAY = getCurrentAcademicYear(years);
    currentYearLabel = currentAY.label;
    const yearSelect = document.getElementById('kfd-year');
    if (yearSelect) {
      yearSelect.innerHTML = '';
      years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = y.label;
        opt.textContent = y.label;
        if (y.label === currentAY.label) opt.selected = true;
        yearSelect.appendChild(opt);
      });
    }
  } catch(e) { console.warn('KF Docs: failed to load years', e); }

  updateUploadVisibility();
  loadKFDocs();
}

function updateUploadVisibility() {
  // Upload temporarily disabled — requires Google Workspace domain-wide delegation
  const uploadBtn = document.getElementById('kfd-upload-btn');
  const uploadForm = document.getElementById('kfd-upload-form');
  if (uploadBtn) uploadBtn.style.display = 'none';
  if (uploadForm) uploadForm.classList.add('hidden');
}

async function loadKFDocs() {
  window.showLoading && window.showLoading();
  const yearSelect = document.getElementById('kfd-year');
  const yearLabel = yearSelect?.value || currentYearLabel;
  currentYearLabel = yearLabel;
  try {
    kfDocsData = await api.getKFDocs({ academicYear: yearLabel });
  } catch(e) {
    console.warn('KF Docs: load error', e);
    kfDocsData = [];
  }
  kfDocsPage = 1;
  renderKFGallery();
  window.hideLoading && window.hideLoading();
}

async function handleUpload() {
  const perms = getUserPermissions();
  const kfPerm = perms['kanaan_fellowship_guru'] || perms['kanaan_fellowship_siswa'];
  const level = typeof kfPerm === 'string' ? kfPerm : (kfPerm?.level || 'none');
  if (level !== 'write') { alert('Anda tidak memiliki izin upload.'); return; }

  const fileInput = document.getElementById('kfd-file');
  const eventDate = document.getElementById('kfd-event-date')?.value;
  const classGroup = document.getElementById('kfd-class-group')?.value;
  const msgEl = document.getElementById('kfd-upload-msg');

  if (!fileInput?.files?.[0]) { showMsg(msgEl, 'Pilih file foto.', 'error'); return; }
  if (!eventDate) { showMsg(msgEl, 'Pilih tanggal acara.', 'error'); return; }
  const file = fileInput.files[0];
  if (file.size > 10*1024*1024) { showMsg(msgEl, 'Maksimal 10MB.', 'error'); return; }

  const progressDiv = document.getElementById('kfd-upload-progress');
  const progressBar = document.getElementById('kfd-progress-bar');
  const progressText = document.getElementById('kfd-progress-text');
  if (progressDiv) progressDiv.classList.remove('hidden');
  if (progressBar) progressBar.style.width = '10%';
  if (progressText) progressText.textContent = 'Menyiapkan...';
  showMsg(msgEl, 'Upload ke Google Drive...', 'info');

  try {
    const base64 = await fileToBase64(file);
    if (progressBar) progressBar.style.width = '40%';
    if (progressText) progressText.textContent = 'Mengirim...';

    await api.uploadKFDoc({
      eventDate, academicYear: currentYearLabel, classGroup,
      fileName: file.name, fileData: base64, mimeType: file.type
    });

    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = 'Selesai!';
    showMsg(msgEl, '✅ Foto berhasil diupload!', 'success');

    if (fileInput) fileInput.value = '';
    const eventDateEl = document.getElementById('kfd-event-date');
    if (eventDateEl) eventDateEl.value = '';
    const form = document.getElementById('kfd-upload-form');
    if (form) form.classList.add('hidden');
    if (progressDiv) progressDiv.classList.add('hidden');

    await loadKFDocs();
  } catch(e) {
    showMsg(msgEl, 'Gagal: ' + (e.error || e.message || 'Unknown'), 'error');
    if (progressDiv) progressDiv.classList.add('hidden');
  }
}

function showMsg(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  el.style.background = type === 'error' ? '#fee2e2' : type === 'success' ? '#dcfce7' : '#dbeafe';
  el.style.color = type === 'error' ? '#991b1b' : type === 'success' ? '#166534' : '#1e40af';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderKFGallery() {
  const container = document.getElementById('kfd-gallery');
  if (!container) return;

  const groupFilter = document.getElementById('kfd-group-filter')?.value || 'all';
  let docs = kfDocsData;
  if (groupFilter !== 'all') docs = docs.filter(d => d.class_group === groupFilter);

  const totalItems = docs.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / kfDocsPerPage));
  if (kfDocsPage > totalPages) kfDocsPage = totalPages;
  const start = (kfDocsPage - 1) * kfDocsPerPage;
  const pageDocs = docs.slice(start, start + kfDocsPerPage);

  if (totalItems === 0) {
    container.innerHTML = '<p class="muted" style="text-align:center;padding:40px">Belum ada dokumentasi.<br><span style="font-size:12px">Upload foto sementara dinonaktifkan.</span></p>';
    return;
  }

  const byDate = {};
  pageDocs.forEach(d => {
    const dk = d.event_date?.split('T')[0] || '?';
    if (!byDate[dk]) byDate[dk] = [];
    byDate[dk].push(d);
  });

  let html = '<div class="kf-gallery">';
  Object.keys(byDate).sort().reverse().forEach(dk => {
    html += `<div style="grid-column:1/-1;margin-top:8px"><h3 style="font-size:14px;font-weight:600">📅 ${dk}</h3></div>`;
    byDate[dk].forEach(d => {
      const thumb = d.drive_file_id ? `https://drive.google.com/thumbnail?id=${d.drive_file_id}&sz=w400` : '';
      html += `<div class="kf-photo-card">
        <a href="${d.drive_url || '#'}" target="_blank"><img src="${thumb}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'" /></a>
        <div class="kf-photo-info">
          <div class="kf-photo-date">${CLASS_GROUPS[d.class_group] || d.class_group}</div>
          <div class="kf-photo-group">${d.file_name || ''}</div>
          <div class="kf-photo-uploader">oleh ${d.uploaded_by || '-'} · ${d.uploaded_at ? new Date(d.uploaded_at).toLocaleDateString('id') : ''}</div>
        </div></div>`;
    });
  });
  html += '</div>';

  if (totalPages > 1) {
    html += '<div class="pagination-controls" style="margin-top:16px">';
    html += `<button class="btn btn-sm btn-secondary" data-kfd-prev ${kfDocsPage<=1?'disabled':''}>‹ Prev</button>`;
    const ms = 5; let sp = Math.max(1, kfDocsPage-Math.floor(ms/2)), ep = Math.min(totalPages, sp+ms-1);
    if (ep-sp+1<ms) sp = Math.max(1, ep-ms+1);
    for (let p=sp; p<=ep; p++) html += `<button class="btn btn-sm ${p===kfDocsPage?'btn-primary':'btn-secondary'}" data-kfd-page="${p}">${p}</button>`;
    html += `<button class="btn btn-sm btn-secondary" data-kfd-next ${kfDocsPage>=totalPages?'disabled':''}>Next ›</button></div>`;
  }
  html += `<div style="text-align:center;margin-top:6px;font-size:11px;color:var(--text-muted)">${start+1}-${Math.min(start+kfDocsPerPage,totalItems)} / ${totalItems} foto</div>`;

  container.innerHTML = html;
  container.querySelector('[data-kfd-prev]')?.addEventListener('click', ()=>{ kfDocsPage--; renderKFGallery(); });
  container.querySelector('[data-kfd-next]')?.addEventListener('click', ()=>{ kfDocsPage++; renderKFGallery(); });
  container.querySelectorAll('[data-kfd-page]').forEach(b => b.addEventListener('click', ()=>{ kfDocsPage = parseInt(b.dataset.kfdPage); renderKFGallery(); }));
}

export { loadKFDocs };
