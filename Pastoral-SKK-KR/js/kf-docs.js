import { CONFIG } from './config.js';
import { api } from './api.js';
import { getAvailableYears, getCurrentAcademicYear } from './data-loader.js';
import { getCurrentUser } from './auth.js';

const CLASS_GROUPS = {
  'Indria': 'Indria (TK A, TK B)',
  'Pratama': 'Pratama (1-3 SD)',
  'Madya': 'Madya (4-6 SD)',
  'Tunas Muda': 'Tunas Muda (7-9 SMP)'
};

let kfDocsData = [];
let currentYearLabel = '';

export async function initKFDocs() {
  const years = await getAvailableYears();
  const currentAY = getCurrentAcademicYear(years);
  currentYearLabel = currentAY.label;

  const yearSelect = document.getElementById('kfd-year');
  yearSelect.innerHTML = '';
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y.label;
    opt.textContent = y.label;
    if (y.label === currentAY.label) opt.selected = true;
    yearSelect.appendChild(opt);
  });

  document.getElementById('kfd-load').onclick = loadKFDocs;
  document.getElementById('kfd-upload-btn').onclick = () => {
    document.getElementById('kfd-upload-form').classList.toggle('hidden');
  };
  document.getElementById('kfd-submit').onclick = handleUpload;
  document.getElementById('kfd-group-filter').onchange = renderKFGallery;

  loadKFDocs();
}

async function loadKFDocs() {
  window.showLoading();
  const yearLabel = document.getElementById('kfd-year').value;
  currentYearLabel = yearLabel;
  try {
    kfDocsData = await api.getKFDocs({ academicYear: yearLabel });
    renderKFGallery();
  } catch (e) {
    console.error('Failed to load KF docs:', e);
    kfDocsData = [];
    renderKFGallery();
  }
  window.hideLoading();
}

async function handleUpload() {
  const fileInput = document.getElementById('kfd-file');
  const eventDate = document.getElementById('kfd-event-date').value;
  const classGroup = document.getElementById('kfd-class-group').value;
  const msgEl = document.getElementById('kfd-upload-msg');
  const user = getCurrentUser();

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

  // Show progress
  document.getElementById('kfd-upload-progress').classList.remove('hidden');
  document.getElementById('kfd-progress-bar').style.width = '10%';
  document.getElementById('kfd-progress-text').textContent = 'Mengupload...';

  msgEl.textContent = 'Mempersiapkan upload ke Google Drive...';
  msgEl.classList.remove('hidden');
  msgEl.style.background = '#dbeafe'; msgEl.style.color = '#1e40af';

  try {
    // Convert to base64
    const base64 = await fileToBase64(file);
    document.getElementById('kfd-progress-bar').style.width = '30%';
    document.getElementById('kfd-progress-text').textContent = 'Upload ke server...';

    // Upload via worker (server-side Google Drive upload using service account)
    const result = await api.uploadKFDoc({
      eventDate, academicYear: currentYearLabel, classGroup,
      fileName: file.name, fileData: base64, mimeType: file.type
    });

    document.getElementById('kfd-progress-bar').style.width = '100%';
    document.getElementById('kfd-progress-text').textContent = 'Selesai!';

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
    msgEl.textContent = 'Gagal upload: ' + (e.message || 'Unknown error');
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

  // Group by event date
  const byDate = {};
  docs.forEach(d => {
    const dateKey = d.event_date?.split('T')[0] || 'unknown';
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(d);
  });

  if (docs.length === 0) {
    container.innerHTML = '<p class="muted" style="text-align:center;padding:40px">Belum ada dokumentasi untuk filter ini.</p>';
    return;
  }

  let html = '';
  Object.keys(byDate).sort().reverse().forEach(dateKey => {
    html += `<div style="grid-column:1/-1;margin-top:8px"><h3 style="font-size:14px;font-weight:600">📅 ${dateKey}</h3></div>`;
    byDate[dateKey].forEach(d => {
      const imgUrl = d.drive_file_id
        ? `https://drive.google.com/thumbnail?id=${d.drive_file_id}&sz=w400`
        : '';
      html += `<div class="kf-photo-card">
        <a href="${d.drive_url || '#'}" target="_blank">
          <img src="${imgUrl}" alt="${d.file_name}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22180%22><rect fill=%22%23e2e8f0%22 width=%22200%22 height=%22180%22/><text fill=%22%2394a3b8%22 x=%22100%22 y=%2290%22 text-anchor=%22middle%22 font-size=%2212%22>📷</text></svg>'" />
        </a>
        <div class="kf-photo-info">
          <div class="kf-photo-date">${CLASS_GROUPS[d.class_group] || d.class_group}</div>
          <div class="kf-photo-uploader">${d.file_name} · oleh ${d.uploaded_by || '—'}</div>
        </div>
      </div>`;
    });
  });

  container.innerHTML = html;
}

export { loadKFDocs };
