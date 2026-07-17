import { CONFIG } from './config.js';
import { api } from './api.js';
import { getAvailableYears, getCurrentAcademicYear } from './data-loader.js';
import { getCurrentUser, getUserPermissions } from './auth.js';

const CLASS_GROUPS = {
  'Indria': 'Indria (TK A, TK B)',
  'Pratama': 'Pratama (1-3 SD)',
  'Madya': 'Madya (4-6 SD)',
  'Tunas Muda': 'Tunas Muda (7-9 SMP)'
};
const PER_PAGE_OPTIONS = [12, 24, 48, 96];

let kfDocsData = [];
let currentYearLabel = '';
let kfDocsPage = 1;
let kfDocsPerPage = 12;
let kfDocsInitDone = false;

export async function initKFDocs() {
  console.log('KF Docs: init called, initDone=', kfDocsInitDone);
  if (kfDocsInitDone) {
    loadKFDocs();
    return;
  }
  kfDocsInitDone = true;

  try {
    const years = await getAvailableYears();
    const currentAY = getCurrentAcademicYear(years);
    currentYearLabel = currentAY.label;
    console.log('KF Docs: years loaded, current=', currentYearLabel);

    const yearSelect = document.getElementById('kfd-year');
    if (!yearSelect) { console.error('KF Docs: kfd-year not found!'); return; }
    yearSelect.innerHTML = '';
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y.label;
      opt.textContent = y.label;
      if (y.label === currentAY.label) opt.selected = true;
      yearSelect.appendChild(opt);
    });

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
      kfDocsPerPage = parseInt(perPageSel.value, 10);
      kfDocsPage = 1;
      renderKFGallery();
    };

    updateKFDocsPermissions();
    console.log('KF Docs: calling loadKFDocs...');
    loadKFDocs();
  } catch(e) {
    console.error('KF Docs init error:', e);
  }
}

function updateKFDocsPermissions() {
  const perms = getUserPermissions();
  // Check if user has access to KF documentation
  const kfPerm = perms['kanaan_fellowship_siswa'] || perms['kanaan_fellowship_guru'];
  const level = typeof kfPerm === 'string' ? kfPerm : (kfPerm?.level || 'none');

  const uploadBtn = document.getElementById('kfd-upload-btn');
  const uploadForm = document.getElementById('kfd-upload-form');

  if (level === 'none' || level === 'view') {
    if (uploadBtn) uploadBtn.classList.add('hidden');
    if (uploadForm) uploadForm.classList.add('hidden');
  }
}

function canUploadKF() {
  const perms = getUserPermissions();
  const kfPerm = perms['kanaan_fellowship_siswa'] || perms['kanaan_fellowship_guru'];
  const level = typeof kfPerm === 'string' ? kfPerm : (kfPerm?.level || 'none');
  return level === 'write';
}

async function loadKFDocs() {
  window.showLoading();
  const yearLabel = document.getElementById('kfd-year').value;
  currentYearLabel = yearLabel;
  try {
    kfDocsData = await api.getKFDocs({ academicYear: yearLabel });
    kfDocsPage = 1;
    renderKFGallery();
  } catch (e) {
    console.error('Failed to load KF docs:', e);
    kfDocsData = [];
    renderKFGallery();
  }
  window.hideLoading();
}

async function handleUpload() {
  if (!canUploadKF()) {
    alert('Anda tidak memiliki izin untuk upload.');
    return;
  }
  const fileInput = document.getElementById('kfd-file');
  const eventDate = document.getElementById('kfd-event-date').value;
  const classGroup = document.getElementById('kfd-class-group').value;
  const msgEl = document.getElementById('kfd-upload-msg');

  if (!fileInput.files || !fileInput.files[0]) {
    msgEl.textContent = 'Pilih file foto terlebih dahulu.';
    msgEl.classList.remove('hidden');
    msgEl.style.background = '#fee2e2'; msgEl.style.color = '#991b1b';
    return;
  }
  if (!eventDate) {
    msgEl.textContent = 'Pilih tanggal acara.';
    msgEl.classList.remove('hidden');
    msgEl.style.background = '#fee2e2'; msgEl.style.color = '#991b1b';
    return;
  }
  const file = fileInput.files[0];
  if (file.size > 10 * 1024 * 1024) {
    msgEl.textContent = 'Ukuran file maksimal 10MB.';
    msgEl.classList.remove('hidden');
    msgEl.style.background = '#fee2e2'; msgEl.style.color = '#991b1b';
    return;
  }

  document.getElementById('kfd-upload-progress').classList.remove('hidden');
  document.getElementById('kfd-progress-bar').style.width = '10%';
  document.getElementById('kfd-progress-text').textContent = 'Menyiapkan...';

  msgEl.textContent = 'Upload ke Google Drive...';
  msgEl.classList.remove('hidden');
  msgEl.style.background = '#dbeafe'; msgEl.style.color = '#1e40af';

  try {
    const base64 = await fileToBase64(file);
    document.getElementById('kfd-progress-bar').style.width = '40%';
    document.getElementById('kfd-progress-text').textContent = 'Mengirim ke server...';

    await api.uploadKFDoc({
      eventDate, academicYear: currentYearLabel, classGroup,
      fileName: file.name, fileData: base64, mimeType: file.type
    });

    document.getElementById('kfd-progress-bar').style.width = '100%';
    document.getElementById('kfd-progress-text').textContent = 'Selesai!';
    msgEl.textContent = '✅ Foto berhasil diupload ke Google Drive!';
    msgEl.style.background = '#dcfce7'; msgEl.style.color = '#166534';

    fileInput.value = '';
    document.getElementById('kfd-event-date').value = '';
    document.getElementById('kfd-upload-form').classList.add('hidden');
    document.getElementById('kfd-upload-progress').classList.add('hidden');
    await loadKFDocs();
  } catch (e) {
    msgEl.textContent = 'Gagal: ' + (e.error || e.message || 'Unknown');
    msgEl.style.background = '#fee2e2'; msgEl.style.color = '#991b1b';
    document.getElementById('kfd-upload-progress').classList.add('hidden');
  }
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
    container.innerHTML = '<p class="muted" style="text-align:center;padding:40px">Belum ada dokumentasi untuk filter ini.</p>';
    return;
  }

  // Group by event date
  const byDate = {};
  pageDocs.forEach(d => {
    const dateKey = d.event_date?.split('T')[0] || 'unknown';
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(d);
  });

  let html = '<div class="kf-gallery">';
  Object.keys(byDate).sort().reverse().forEach(dateKey => {
    html += `<div style="grid-column:1/-1;margin-top:8px"><h3 style="font-size:14px;font-weight:600">📅 ${dateKey}</h3></div>`;
    byDate[dateKey].forEach(d => {
      const imgUrl = d.drive_file_id
        ? `https://drive.google.com/thumbnail?id=${d.drive_file_id}&sz=w400`
        : '';
      html += `<div class="kf-photo-card">
        <a href="${d.drive_url || '#'}" target="_blank">
          <img src="${imgUrl}" alt="${d.file_name || ''}" loading="lazy" onerror="this.style.display='none'" />
        </a>
        <div class="kf-photo-info">
          <div class="kf-photo-date">${CLASS_GROUPS[d.class_group] || d.class_group}</div>
          <div class="kf-photo-group">${d.file_name || ''}</div>
          <div class="kf-photo-uploader">oleh ${d.uploaded_by || '—'} · ${new Date(d.uploaded_at).toLocaleDateString('id')}</div>
        </div>
      </div>`;
    });
  });
  html += '</div>';

  // Pagination
  if (totalPages > 1) {
    html += `<div class="pagination-controls" style="margin-top:16px">
      <button class="btn btn-sm btn-secondary kfd-prev" ${kfDocsPage <= 1 ? 'disabled' : ''}>‹ Prev</button>`;
    const maxShow = 5;
    let sp = Math.max(1, kfDocsPage - Math.floor(maxShow / 2));
    let ep = Math.min(totalPages, sp + maxShow - 1);
    if (ep - sp + 1 < maxShow) sp = Math.max(1, ep - maxShow + 1);
    for (let p = sp; p <= ep; p++) {
      html += `<button class="btn btn-sm ${p === kfDocsPage ? 'btn-primary' : 'btn-secondary'} kfd-page-btn" data-page="${p}">${p}</button>`;
    }
    html += `<button class="btn btn-sm btn-secondary kfd-next" ${kfDocsPage >= totalPages ? 'disabled' : ''}>Next ›</button>
    </div>`;
  }

  html += `<div style="text-align:center;margin-top:8px;font-size:12px;color:var(--text-muted)">Menampilkan ${start+1}-${Math.min(start+kfDocsPerPage, totalItems)} dari ${totalItems} foto</div>`;

  container.innerHTML = html;

  // Bind pagination clicks
  container.querySelector('.kfd-prev')?.addEventListener('click', () => { kfDocsPage--; renderKFGallery(); });
  container.querySelector('.kfd-next')?.addEventListener('click', () => { kfDocsPage++; renderKFGallery(); });
  container.querySelectorAll('.kfd-page-btn').forEach(btn => {
    btn.addEventListener('click', () => { kfDocsPage = parseInt(btn.dataset.page); renderKFGallery(); });
  });
}

export { loadKFDocs };
