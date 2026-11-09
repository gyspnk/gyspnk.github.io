/* ===== Multi-select checklist (dipakai Lihat Presensi & Export) ===== */

const JENJANG_ORDER = ['TK', 'SD', 'SMP', 'Lainnya'];

/**
 * Tentukan jenjang dari nama kelas: "TK A" → TK, "1 SD" → SD, "7 SMP" → SMP.
 */
export function jenjangOfClass(cls) {
  const s = String(cls || '').trim().toUpperCase();
  if (!s) return 'Lainnya';
  if (s.startsWith('TK')) return 'TK';
  if (/SD$/.test(s)) return 'SD';
  if (/SMP$/.test(s)) return 'SMP';
  return 'Lainnya';
}

/**
 * Kelompokkan nama kelas per jenjang (TK/SD/SMP/Lainnya).
 * Hasil: [{ label: 'SD', items: [{ value: '1 SD', label: '1 SD' }, ...] }, ...]
 */
export function buildClassGroups(classes) {
  const map = new Map();
  [...new Set(classes)].forEach(c => {
    const cls = String(c || '').trim();
    if (!cls) return;
    const key = jenjangOfClass(cls);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(cls);
  });
  return JENJANG_ORDER.filter(k => map.has(k)).map(label => ({
    label,
    items: map.get(label)
      .sort((a, b) => a.localeCompare(b, 'id', { numeric: true }))
      .map(v => ({ value: v, label: v }))
  }));
}

/**
 * Kelompokkan karyawan per divisi: [{ label: 'Primary', items: [{value: nama, label: nama}] }]
 */
export function buildEmployeeGroups(employees) {
  const map = new Map();
  (employees || []).forEach(emp => {
    const name = String(emp.name || '').trim();
    if (!name) return;
    const div = String(emp.division || '').trim() || 'Tanpa Divisi';
    if (!map.has(div)) map.set(div, []);
    map.get(div).push({ value: name, label: name });
  });
  return [...map.keys()]
    .sort((a, b) => a.localeCompare(b, 'id', { numeric: true }))
    .map(label => ({
      label,
      items: map.get(label).sort((a, b) => a.label.localeCompare(b.label, 'id'))
    }));
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

/**
 * Pasang komponen multi-select pada elemen mount.
 * API: getSelected(), setSelected(values), setGroups(groups, { allLabel }), getSummary(), close(), destroy()
 */
export function createMultiSelect(mount, opts = {}) {
  if (!mount) throw new Error('createMultiSelect: mount tidak ditemukan');
  if (mount._multiSelect) mount._multiSelect.destroy();

  const state = {
    groups: [],
    selected: new Set(),
    allLabel: opts.allLabel || 'Semua',
    onChange: typeof opts.onChange === 'function' ? opts.onChange : () => {},
  };

  mount.classList.add('multi-select');
  mount.innerHTML = `
    <button type="button" class="ms-toggle" aria-haspopup="true" aria-expanded="false">
      <span class="ms-summary"></span>
      <span class="ms-caret" aria-hidden="true">▾</span>
    </button>
    <div class="ms-panel hidden">
      <div class="ms-actions">
        <button type="button" class="ms-act" data-ms-act="all">Pilih Semua</button>
        <button type="button" class="ms-act" data-ms-act="clear">Kosongkan</button>
        <span class="ms-count"></span>
      </div>
      <div class="ms-list" role="group"></div>
    </div>`;

  const toggle = mount.querySelector('.ms-toggle');
  const panel = mount.querySelector('.ms-panel');
  const list = mount.querySelector('.ms-list');
  const summaryEl = mount.querySelector('.ms-summary');
  const countEl = mount.querySelector('.ms-count');

  if (opts.labelledBy) toggle.setAttribute('aria-labelledby', opts.labelledBy);

  const allValues = () => state.groups.flatMap(g => g.items.map(i => i.value));

  function summaryText() {
    const total = allValues().length;
    if (!state.selected.size) return state.allLabel;
    if (state.selected.size >= total) return state.allLabel;
    const parts = [];
    state.groups.forEach(g => {
      const values = g.items.map(i => i.value);
      const picked = values.filter(v => state.selected.has(v));
      if (!picked.length) return;
      if (g.label && picked.length === values.length && values.length > 1) {
        parts.push(`${g.label} (${values.length})`);
      } else {
        picked.forEach(v => {
          const item = g.items.find(i => i.value === v);
          parts.push(item ? item.label : v);
        });
      }
    });
    if (parts.length > 3) return `${state.selected.size} dipilih`;
    return parts.join(', ');
  }

  function syncGroups() {
    mount.querySelectorAll('input[data-ms-group]').forEach(cb => {
      const g = state.groups[Number(cb.dataset.msGroup)];
      if (!g) return;
      const values = g.items.map(i => i.value);
      const picked = values.filter(v => state.selected.has(v)).length;
      cb.checked = picked > 0 && picked === values.length;
      cb.indeterminate = picked > 0 && picked < values.length;
    });
    summaryEl.textContent = summaryText();
    const total = allValues().length;
    countEl.textContent = state.selected.size ? `${state.selected.size}/${total}` : '';
  }

  function renderList() {
    const prevScroll = list.scrollTop;
    if (!state.groups.length) {
      list.innerHTML = '<div class="ms-empty">Tidak ada pilihan.</div>';
      syncGroups();
      return;
    }
    list.innerHTML = state.groups.map((g, gi) => {
      const groupBox = g.label
        ? `<label class="ms-group">
             <input type="checkbox" data-ms-group="${gi}" />
             <span class="ms-group-name">${escapeHtml(g.label)}</span>
             <span class="ms-group-count">${g.items.length}</span>
           </label>`
        : '';
      const items = g.items.map(item => `
        <label class="ms-item${g.label ? ' ms-indent' : ''}">
          <input type="checkbox" data-ms-value="${escapeHtml(item.value)}" />
          <span class="ms-item-name">${escapeHtml(item.label)}</span>
        </label>`).join('');
      return groupBox + items;
    }).join('');
    list.querySelectorAll('input[data-ms-value]').forEach(cb => {
      cb.checked = state.selected.has(cb.dataset.msValue);
    });
    list.scrollTop = prevScroll;
    syncGroups();
  }

  function emit() {
    state.onChange(api.getSelected());
  }

  function open() {
    panel.classList.remove('hidden');
    toggle.setAttribute('aria-expanded', 'true');
  }

  function close() {
    panel.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.onclick = () => {
    if (panel.classList.contains('hidden')) open(); else close();
  };

  mount.addEventListener('change', e => {
    const cb = e.target;
    if (cb.matches('input[data-ms-group]')) {
      const g = state.groups[Number(cb.dataset.msGroup)];
      if (!g) return;
      g.items.forEach(i => {
        if (cb.checked) state.selected.add(i.value);
        else state.selected.delete(i.value);
      });
      renderList();
      emit();
    } else if (cb.matches('input[data-ms-value]')) {
      if (cb.checked) state.selected.add(cb.dataset.msValue);
      else state.selected.delete(cb.dataset.msValue);
      syncGroups();
      emit();
    }
  });

  mount.querySelector('.ms-actions').addEventListener('click', e => {
    const act = e.target.closest('[data-ms-act]')?.dataset.msAct;
    if (!act) return;
    if (act === 'all') allValues().forEach(v => state.selected.add(v));
    else state.selected.clear();
    renderList();
    emit();
  });

  const onDocClick = e => {
    if (!mount.contains(e.target)) close();
  };
  const onDocKey = e => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onDocKey);

  const api = {
    getSelected: () => [...state.selected],
    setSelected(values) {
      const valid = new Set(allValues());
      state.selected = new Set((values || []).filter(v => valid.has(v)));
      renderList();
    },
    setGroups(groups, options = {}) {
      state.groups = Array.isArray(groups) ? groups : [];
      if (options.allLabel) state.allLabel = options.allLabel;
      const valid = new Set(allValues());
      [...state.selected].forEach(v => { if (!valid.has(v)) state.selected.delete(v); });
      renderList();
    },
    getSummary: summaryText,
    close,
    destroy() {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onDocKey);
      mount.innerHTML = '';
      mount.classList.remove('multi-select');
      delete mount._multiSelect;
    },
  };

  mount._multiSelect = api;
  renderList();
  return api;
}
