// Phase 2 cloud sync (§7): local-first with background sync to Supabase.
// IndexedDB stays the source of truth; this module pushes local changes up and
// merges remote changes down with last-write-wins on updated_at.
//
// Talks to Supabase's REST APIs (GoTrue auth + PostgREST) with plain fetch —
// no vendored client library — so the only network destination is your own
// project domain. Sign-in is a one-time email code (OTP): request a code,
// type it in, done — no OAuth redirect, works fine in a standalone PWA.
import { dbPromise, now } from './db.js';

const CONFIG_KEY = 'cb-sync-config';
const SESSION_KEY = 'cb-sync-session';

// Tables synced 1:1 with the local stores. Order matters: tags before entries
// before links on push; deletes are pushed as tombstone upserts so order-safe.
const TABLES = ['tags', 'entries', 'entry_tags'];
const FIELDS = {
  tags: ['id', 'name', 'kind', 'author', 'created_at', 'updated_at'],
  entries: ['id', 'quote', 'reflection', 'page', 'starred', 'created_at', 'updated_at'],
  entry_tags: ['id', 'entry_id', 'tag_id', 'created_at', 'updated_at'],
};

/* ---------------- config + session ---------------- */

export function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || null;
  } catch {
    return null;
  }
}

export function setConfig(url, anonKey) {
  const clean = url.trim().replace(/\/+$/, '');
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: clean, anonKey: anonKey.trim() }));
}

export function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

export function signOut() {
  saveSession(null);
}

export const isConfigured = () => !!getConfig();
export const isSignedIn = () => !!getSession();

/* ---------------- email-code sign-in (OTP) ---------------- */

// Emails a one-time code to the address (creates the account on first use).
// Note: the Supabase "Magic Link" email template must include {{ .Token }}
// so the email carries the 6-digit code — see README.
export async function requestCode(email) {
  const config = getConfig();
  const res = await fetch(`${config.url}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), create_user: true }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Could not send the code (${res.status}): ${detail.slice(0, 200)}`);
  }
}

export async function verifyCode(email, code) {
  const config = getConfig();
  const res = await fetch(`${config.url}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'email', email: email.trim(), token: code.trim() }),
  });
  if (!res.ok) throw new Error('Wrong or expired code — request a new one and try again.');
  const data = await res.json();
  saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    email: data.user?.email || email.trim(),
  });
}

async function ensureFreshSession() {
  const config = getConfig();
  const session = getSession();
  if (!config || !session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session;

  const res = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) saveSession(null); // refresh token revoked
    throw new Error('Session expired — please sign in again.');
  }
  const data = await res.json();
  const fresh = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    email: session.email || data.user?.email || null,
  };
  saveSession(fresh);
  return fresh;
}

/* ---------------- REST helper ---------------- */

async function rest(session, method, pathAndQuery, body) {
  const config = getConfig();
  const res = await fetch(`${config.url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'count=none',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Sync request failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return method === 'GET' ? res.json() : null;
}

/* ---------------- sync engine ---------------- */

// Postgres returns "+00:00" offsets; we store "Z". Normalize so string
// comparison (LWW) is reliable.
const iso = (t) => (t ? new Date(t).toISOString() : t);

const pick = (record, fields) => Object.fromEntries(fields.map((f) => [f, record[f] ?? null]));

async function getMeta(key) {
  return (await (await dbPromise).get('meta', key))?.value ?? null;
}

async function setMeta(key, value) {
  await (await dbPromise).put('meta', { key, value });
}

export async function getLastSync() {
  return getMeta('last_sync_at');
}

let inflight = null;

// Pull remote changes (LWW merge, apply tombstones), then push local changes
// and queued deletions. Returns { pulled, pushed } counts.
export function syncNow() {
  if (!inflight) {
    inflight = doSync().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function doSync() {
  if (!isConfigured() || !isSignedIn()) return { skipped: true };
  const session = await ensureFreshSession();
  if (!session) return { skipped: true };

  const db = await dbPromise;
  const watermark = (await getMeta('last_sync_watermark')) || '';
  let newWatermark = watermark;
  const bump = (t) => {
    if (t && t > newWatermark) newWatermark = t;
  };
  let pulled = 0;
  let pushed = 0;

  /* ---- pull ---- */
  for (const table of TABLES) {
    const filter = watermark ? `&updated_at=gt.${encodeURIComponent(watermark)}` : '';
    const rows = await rest(session, 'GET', `${table}?select=*${filter}&order=updated_at.asc`);
    for (const row of rows) {
      const updatedAt = iso(row.updated_at);
      bump(updatedAt);
      const local = await db.get(table, row.id);
      if (row.deleted) {
        // Apply the tombstone unless the local copy is newer (it will re-push).
        if (local && (local.updated_at || '') <= updatedAt) {
          await db.delete(table, row.id);
          pulled++;
        }
        continue;
      }
      if (!local || (local.updated_at || '') < updatedAt) {
        const record = pick(row, FIELDS[table]);
        record.created_at = iso(record.created_at);
        record.updated_at = updatedAt;
        if (table === 'entries') record.starred = !!record.starred;
        await db.put(table, record);
        pulled++;
      }
    }
  }

  /* ---- push upserts ---- */
  for (const table of TABLES) {
    const all = await db.getAll(table);
    const changed = all
      .filter((r) => (r.updated_at || '') > watermark)
      .map((r) => pick(r, FIELDS[table]));
    for (let i = 0; i < changed.length; i += 100) {
      await rest(session, 'POST', `${table}?on_conflict=id`, changed.slice(i, i + 100));
    }
    for (const r of changed) bump(r.updated_at);
    pushed += changed.length;
  }

  /* ---- push deletions as tombstones ---- */
  const deletions = await db.getAll('sync_deletes');
  const byTable = new Map();
  for (const d of deletions) {
    if (!byTable.has(d.store)) byTable.set(d.store, []);
    byTable.get(d.store).push({ id: d.record_id, deleted: true, updated_at: d.deleted_at });
  }
  for (const [table, rows] of byTable) {
    if (!TABLES.includes(table)) continue;
    for (let i = 0; i < rows.length; i += 100) {
      await rest(session, 'POST', `${table}?on_conflict=id`, rows.slice(i, i + 100));
    }
    for (const r of rows) bump(r.updated_at);
    pushed += rows.length;
  }
  if (deletions.length) {
    const tx = db.transaction('sync_deletes', 'readwrite');
    for (const d of deletions) tx.store.delete(d.id);
    await tx.done;
  }

  await setMeta('last_sync_watermark', newWatermark);
  await setMeta('last_sync_at', now());

  if (pulled) window.dispatchEvent(new CustomEvent('cb-sync', { detail: { pulled, pushed } }));
  return { pulled, pushed };
}

/* ---------------- triggers ---------------- */

let syncTimer = null;

// Debounced background sync after local mutations. Quietly no-ops when sync
// isn't set up, so Phase 1 (local-only) behavior is unchanged.
export function scheduleSync() {
  if (!isConfigured() || !isSignedIn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    if (navigator.onLine !== false) syncNow().catch((err) => console.warn('Sync failed:', err));
  }, 2500);
}

export function initAutoSync() {
  window.addEventListener('online', () => scheduleSync());
  if (isConfigured() && isSignedIn() && navigator.onLine !== false) {
    syncNow().catch((err) => console.warn('Sync failed:', err));
  }
}
