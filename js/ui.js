// Small DOM + UI helpers shared by all views.

// Hyperscript-style element builder. Children may be nodes, strings, arrays, or null.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(child));
  }
  return el;
}

/* ---------------- icons (inline SVG, feather-style) ---------------- */

const ICON_PATHS = {
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>',
  shuffle:
    '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
  back: '<polyline points="15 18 9 12 15 6"/>',
  camera:
    '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  sliders:
    '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICON_PATHS[name] || '';
  return svg;
}

/* ---------------- misc ---------------- */

export function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function debounce(fn, ms = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

let scriptCache = new Map();
export function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.append(s);
      })
    );
  }
  return scriptCache.get(src);
}

/* ---------------- toast ---------------- */

let toastTimer;
export function toast(message, ms = 2200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------------- confirm dialog ---------------- */

export function confirmDialog(message, { confirmLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    const overlay = h(
      'div',
      { class: 'overlay', onclick: (e) => e.target === overlay && close(false) },
      h(
        'div',
        { class: 'dialog', role: 'alertdialog' },
        h('p', {}, message),
        h(
          'div',
          { class: 'dialog-actions' },
          h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
          h(
            'button',
            { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) },
            confirmLabel
          )
        )
      )
    );
    document.getElementById('overlays').append(overlay);
  });
}

/* ---------------- progress overlay ---------------- */

export function showProgress(label, { onCancel } = {}) {
  const fill = h('div', { class: 'progressfill' });
  const labelEl = h('div', { class: 'plabel' }, label);
  const overlay = h(
    'div',
    { class: 'overlay' },
    h(
      'div',
      { class: 'dialog progressbox' },
      labelEl,
      h('div', { class: 'progresstrack' }, fill),
      onCancel
        ? h(
            'button',
            {
              class: 'btn',
              onclick: () => {
                overlay.remove();
                onCancel();
              },
            },
            'Cancel'
          )
        : null
    )
  );
  document.getElementById('overlays').append(overlay);
  return {
    update(pct, text) {
      fill.style.width = `${Math.round(Math.max(0, Math.min(100, pct)))}%`;
      if (text) labelEl.textContent = text;
    },
    close() {
      overlay.remove();
    },
  };
}

/* ---------------- fullscreen image viewer ---------------- */

export function openImageViewer(blob) {
  const url = URL.createObjectURL(blob);
  const close = () => {
    URL.revokeObjectURL(url);
    viewer.remove();
  };
  const viewer = h(
    'div',
    { class: 'imageviewer', onclick: close },
    h('img', { src: url, alt: 'Source photo' }),
    h('button', { class: 'closeviewer', 'aria-label': 'Close' }, icon('x'))
  );
  document.getElementById('overlays').append(viewer);
}

/* ---------------- shared topbar ---------------- */

export function topbar({ title, back = false, actions = [] }) {
  return h(
    'header',
    { class: 'topbar' },
    back
      ? h(
          'button',
          { class: 'iconbtn', 'aria-label': 'Back', onclick: () => history.back() },
          icon('back')
        )
      : null,
    h('h1', {}, title),
    ...actions
  );
}
