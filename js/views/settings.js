// Settings — §8.5: theme, export/import, storage persistence, sync placeholder.
import { h, toast, topbar, confirmDialog } from '../ui.js';
import { exportJSON, exportMarkdown, importJSON } from '../export.js';

const THEME_KEY = 'cb-theme';

function applyTheme(value) {
  if (value === 'light' || value === 'dark') {
    document.documentElement.dataset.theme = value;
    localStorage.setItem(THEME_KEY, value);
  } else {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem(THEME_KEY);
  }
}

export async function renderSettings(container) {
  /* ---------- theme ---------- */

  const currentTheme = localStorage.getItem(THEME_KEY) || 'system';
  const seg = h('div', { class: 'seg' });
  for (const value of ['system', 'light', 'dark']) {
    seg.append(
      h(
        'button',
        {
          class: currentTheme === value ? 'active' : '',
          onclick: (e) => {
            applyTheme(value);
            [...seg.children].forEach((b) => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
          },
        },
        value[0].toUpperCase() + value.slice(1)
      )
    );
  }

  /* ---------- backup ---------- */

  const importInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const ok = await confirmDialog(
        'Import this backup? Existing entries are kept; records are merged by id (newest wins).',
        { confirmLabel: 'Import' }
      );
      if (!ok) return;
      try {
        const result = await importJSON(file);
        toast(`Imported: ${result.added} added, ${result.updated} updated, ${result.skipped} unchanged.`, 3500);
      } catch (err) {
        console.error(err);
        toast(err.message || 'Import failed — is this a Commonplace backup?');
      }
    },
  });

  /* ---------- storage ---------- */

  const storageInfo = h('span', { class: 'sub' }, 'Checking…');
  (async () => {
    const bits = [];
    if (navigator.storage?.estimate) {
      const { usage } = await navigator.storage.estimate();
      if (usage != null) bits.push(`Using ${(usage / (1024 * 1024)).toFixed(1)} MB`);
    }
    if (navigator.storage?.persisted) {
      bits.push((await navigator.storage.persisted()) ? 'persistent storage granted' : 'not yet persistent');
    }
    storageInfo.textContent = bits.join(' · ') || 'Storage details unavailable';
  })();

  const requestPersist = async () => {
    if (!navigator.storage?.persist) return toast('Not supported in this browser.');
    const granted = await navigator.storage.persist();
    toast(granted ? 'Persistent storage granted.' : 'Persistence not granted (yet).');
    storageInfo.textContent = granted ? 'persistent storage granted' : 'not yet persistent';
  };

  /* ---------- layout ---------- */

  container.append(
    topbar({ title: 'Settings' }),

    h(
      'div',
      { class: 'settings-group' },
      h('h2', {}, 'Appearance'),
      h('div', { class: 'settings-row' }, h('span', { class: 'grow' }, 'Theme'), seg)
    ),

    h(
      'div',
      { class: 'settings-group' },
      h('h2', {}, 'Backup'),
      h(
        'button',
        {
          class: 'settings-row',
          onclick: async () => {
            const r = await exportJSON();
            toast(`Exported ${r.entries} entries (${r.images} photos).`);
          },
        },
        h(
          'span',
          { class: 'grow' },
          'Export JSON',
          h('span', { class: 'sub' }, 'Full backup — entries, tags, and photos. Re-importable.')
        )
      ),
      h(
        'button',
        {
          class: 'settings-row',
          onclick: async () => {
            const r = await exportMarkdown();
            toast(`Exported ${r.entries} entries as Markdown.`);
          },
        },
        h(
          'span',
          { class: 'grow' },
          'Export Markdown',
          h('span', { class: 'sub' }, 'Human-readable, grouped by book.')
        )
      ),
      h(
        'button',
        { class: 'settings-row', onclick: () => importInput.click() },
        h(
          'span',
          { class: 'grow' },
          'Import JSON backup',
          h('span', { class: 'sub' }, 'Merges with what’s already here — never deletes.')
        ),
        importInput
      )
    ),

    h(
      'div',
      { class: 'settings-group' },
      h('h2', {}, 'Storage'),
      h(
        'button',
        { class: 'settings-row', onclick: requestPersist },
        h(
          'span',
          { class: 'grow' },
          'Request persistent storage',
          storageInfo
        )
      ),
      h(
        'div',
        { class: 'settings-row' },
        h(
          'span',
          { class: 'grow sub' },
          'iOS can evict web-app data under storage pressure or long disuse — export a JSON backup now and then.'
        )
      )
    ),

    h(
      'div',
      { class: 'settings-group' },
      h('h2', {}, 'Sync'),
      h(
        'div',
        { class: 'settings-row' },
        h(
          'span',
          { class: 'grow' },
          'Cloud sync',
          h('span', { class: 'sub' }, 'Coming in Phase 2 — data is already sync-ready (stable ids + timestamps).')
        )
      )
    ),

    h(
      'div',
      { class: 'settings-group' },
      h('h2', {}, 'About'),
      h(
        'div',
        { class: 'settings-row' },
        h(
          'span',
          { class: 'grow' },
          'Commonplace Book',
          h('span', { class: 'sub' }, 'Phase 1 · local-only · everything stays on this device.')
        )
      )
    )
  );
}
