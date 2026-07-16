// Settings — §8.5: theme, export/import, storage persistence, cloud sync.
import { h, toast, topbar, confirmDialog, fmtDate } from '../ui.js';
import { exportJSON, exportMarkdown, importJSON } from '../export.js';
import {
  getConfig,
  setConfig,
  clearConfig,
  getSession,
  signOut,
  requestCode,
  verifyCode,
  syncNow,
  getLastSync,
} from '../sync.js';

const THEME_KEY = 'cb-theme';

/* ---------- cloud sync section (Phase 2) ---------- */

function syncSection() {
  const group = h('div', { class: 'settings-group' });
  let pendingEmail = null; // an email a code has been sent to, awaiting entry

  const render = async () => {
    const config = getConfig();
    const session = getSession();
    group.replaceChildren(h('h2', {}, 'Sync'));

    if (!config) {
      // Step 1: point the app at your Supabase project.
      const urlInput = h('input', {
        class: 'input',
        type: 'url',
        placeholder: 'https://your-project.supabase.co',
        autocomplete: 'off',
        autocapitalize: 'none',
      });
      const keyInput = h('input', {
        class: 'input',
        type: 'text',
        placeholder: 'anon public key',
        autocomplete: 'off',
        autocapitalize: 'none',
        style: 'margin-top:8px',
      });
      group.append(
        h(
          'div',
          { class: 'settings-row' },
          h(
            'span',
            { class: 'grow' },
            'Connect your Supabase project',
            h(
              'span',
              { class: 'sub' },
              'One-time setup — see README + supabase-schema.sql. Everything still works offline.'
            ),
            urlInput,
            keyInput,
            h(
              'button',
              {
                class: 'btn primary',
                style: 'margin-top:10px',
                onclick: () => {
                  if (!/^https?:\/\/.+/.test(urlInput.value.trim())) {
                    return toast('Enter the project URL (https://…).');
                  }
                  if (!keyInput.value.trim()) return toast('Paste the anon public key.');
                  setConfig(urlInput.value, keyInput.value);
                  toast('Project connected — now sign in.');
                  render();
                },
              },
              'Save'
            )
          )
        )
      );
      return;
    }

    if (!session) {
      // Step 2: sign in with a one-time email code.
      const signInRow = h('span', { class: 'grow' });
      if (!pendingEmail) {
        const emailInput = h('input', {
          class: 'input',
          type: 'email',
          placeholder: 'you@example.com',
          autocomplete: 'email',
          autocapitalize: 'none',
        });
        signInRow.append(
          'Sign in to sync',
          h('span', { class: 'sub' }, `Project: ${config.url.replace(/^https?:\/\//, '')}`),
          emailInput,
          h(
            'button',
            {
              class: 'btn primary',
              style: 'margin-top:10px',
              onclick: async (e) => {
                const email = emailInput.value.trim();
                if (!/.+@.+\..+/.test(email)) return toast('Enter your email address.');
                e.currentTarget.disabled = true;
                try {
                  await requestCode(email);
                  pendingEmail = email;
                  toast('Code sent — check your email.');
                  render();
                } catch (err) {
                  console.error(err);
                  toast(err.message || 'Could not send the code.', 3500);
                  e.currentTarget.disabled = false;
                }
              },
            },
            'Send code'
          )
        );
      } else {
        const codeInput = h('input', {
          class: 'input',
          type: 'text',
          inputmode: 'numeric',
          placeholder: '6-digit code',
          autocomplete: 'one-time-code',
        });
        signInRow.append(
          `Enter the code sent to ${pendingEmail}`,
          h('span', { class: 'sub' }, 'It may take a minute to arrive.'),
          codeInput,
          h(
            'div',
            { style: 'display:flex;gap:8px;margin-top:10px' },
            h(
              'button',
              {
                class: 'btn primary',
                onclick: async (e) => {
                  if (!codeInput.value.trim()) return toast('Enter the code from the email.');
                  e.currentTarget.disabled = true;
                  try {
                    await verifyCode(pendingEmail, codeInput.value);
                    pendingEmail = null;
                    toast('Signed in — syncing…');
                    render();
                    syncNow().catch((err) => console.warn('Sync failed:', err));
                  } catch (err) {
                    console.error(err);
                    toast(err.message || 'Could not verify the code.', 3500);
                    e.currentTarget.disabled = false;
                  }
                },
              },
              'Verify'
            ),
            h(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  pendingEmail = null;
                  render();
                },
              },
              'Change email'
            )
          )
        );
      }
      group.append(
        h('div', { class: 'settings-row' }, signInRow),
        h(
          'button',
          {
            class: 'settings-row',
            onclick: async () => {
              if (await confirmDialog('Disconnect this Supabase project?', { confirmLabel: 'Disconnect' })) {
                clearConfig();
                render();
              }
            },
          },
          h('span', { class: 'grow' }, 'Disconnect project')
        )
      );
      return;
    }

    // Step 3: signed in — status + actions.
    const statusSub = h('span', { class: 'sub' }, 'Checking…');
    getLastSync().then((t) => {
      statusSub.textContent = t
        ? `Last synced ${fmtDate(t)} ${new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : 'Not synced yet.';
    });

    group.append(
      h(
        'div',
        { class: 'settings-row' },
        h('span', { class: 'grow' }, session.email || 'Signed in', statusSub)
      ),
      h(
        'button',
        {
          class: 'settings-row',
          onclick: async (e) => {
            const row = e.currentTarget;
            row.disabled = true;
            try {
              const r = await syncNow();
              toast(r.skipped ? 'Sync is not set up.' : `Synced — ${r.pushed} pushed, ${r.pulled} pulled.`);
            } catch (err) {
              console.error(err);
              toast(err.message || 'Sync failed — try again when online.', 3500);
            } finally {
              row.disabled = false;
              render();
            }
          },
        },
        h('span', { class: 'grow' }, 'Sync now', h('span', { class: 'sub' }, 'Also runs automatically after changes.'))
      ),
      h(
        'button',
        {
          class: 'settings-row',
          onclick: () => {
            signOut();
            toast('Signed out — data stays on this device.');
            render();
          },
        },
        h('span', { class: 'grow' }, 'Sign out')
      )
    );
  };

  render();
  return group;
}

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
            toast(`Exported ${r.entries} ${r.entries === 1 ? 'entry' : 'entries'}.`);
          },
        },
        h(
          'span',
          { class: 'grow' },
          'Export JSON',
          h('span', { class: 'sub' }, 'Full backup — entries, books, and tags. Re-importable.')
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

    syncSection(),

    aboutSection()
  );
}

// Shows which build this device is actually running (the service worker's
// cache name), so a stale deploy is diagnosable at a glance.
function aboutSection() {
  const versionSub = h('span', { class: 'sub' }, 'Local-first · photos never stored.');
  if (window.caches) {
    caches
      .keys()
      .then((keys) => {
        const cache = keys.find((k) => k.startsWith('commonplace-'));
        if (cache) {
          versionSub.textContent = `Version ${cache.replace('commonplace-', '')} · local-first · photos never stored.`;
        }
      })
      .catch(() => {});
  }
  return h(
    'div',
    { class: 'settings-group' },
    h('h2', {}, 'About'),
    h(
      'div',
      { class: 'settings-row' },
      h('span', { class: 'grow' }, 'Commonplace Book', versionSub)
    )
  );
}
