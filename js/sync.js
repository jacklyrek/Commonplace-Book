// Phase 2 cloud sync (§7): local-first with background sync to Supabase.
// IndexedDB stays the source of truth; this module pushes local changes up and
// merges remote changes down with last-write-wins on updated_at.
//
// Talks to Supabase's REST APIs (GoTrue auth + PostgREST) with plain fetch —
// no vendored client library — so the only network destination is your own
// project domain. Sign-in is a one-time email code (OTP): request a code,
// type it in, done — no OAuth redirect, works fine in a standalone PWA.
import { dbPromise, now, markDirty } from './db.js';

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

// Watermarks live in the synced_at (server) clock. Renamed deliberately: any
// value left by a build that tracked updated_at here means something else, and
// reading it as server time could strand rows. An unknown key just re-pulls once.
const WATERMARK_KEY = 'sync_watermarks_synced';

// Postgres stamps synced_at a moment *before* the row commits, so a row can
// become visible with a stamp we've already read past. Rewinding the filter a
// little catches those; the LWW check makes the re-reads no-ops.
const PULL_LAG_MS = 5000;

const pullFloor = (watermark) => {
  if (!watermark) return '';
  const t = Date.parse(watermark);
  return Number.isNaN(t) ? '' : new Date(t - PULL_LAG_MS).toISOString();
};

async function getMeta(key) {
  return (await (await dbPromise).get('meta', key))?.value ?? null;
}

async function setMeta(key, value) {
  await (await dbPromise).put('meta', { key, value });
}

export async function getLastSync() {
  return getMeta('last_sync_at');
}

// Puts a record back in the push outbox. A pull that keeps the local copy over
// the remote one has to do this: push only sends what's queued, so otherwise
// nothing would ever resend the winner and the server would go on serving the
// row we just rejected. The push below runs after the pull, so it goes out in
// this same round, and once the server agrees the pull stops re-queueing it.
async function requeue(db, storeName, recordId) {
  const tx = db.transaction('sync_dirty', 'readwrite');
  markDirty(tx, storeName, recordId);
  await tx.done;
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
  // One watermark per table, tracked in synced_at — server time, stamped by
  // Postgres on arrival and never accepted from a client (see the trigger in
  // supabase-schema.sql). updated_at cannot do this job: it says when a user
  // touched a row, on whichever device touched it, so a device with a fast clock
  // drags the watermark past every slower device's timestamps and their rows stop
  // matching the filter — not late, never. The two clocks stay strictly apart:
  // synced_at decides what to pull, updated_at decides who wins a conflict.
  const watermarks = { ...((await getMeta(WATERMARK_KEY)) || {}) };
  let pulled = 0;
  let pushed = 0;

  /* ---- pull ---- */
  for (const table of TABLES) {
    const since = pullFloor(watermarks[table]);
    // gte, not gt: two rows can share a synced_at, and gt would skip the second
    // one forever. Re-reading rows is free — the LWW check below no-ops them.
    const filter = since ? `&synced_at=gte.${encodeURIComponent(since)}` : '';
    const rows = await rest(session, 'GET', `${table}?select=*${filter}&order=synced_at.asc`);
    for (const row of rows) {
      const updatedAt = iso(row.updated_at);
      const syncedAt = iso(row.synced_at);
      if (syncedAt && syncedAt > (watermarks[table] || '')) watermarks[table] = syncedAt;
      const local = await db.get(table, row.id);
      if (row.deleted) {
        if (local && (local.updated_at || '') <= updatedAt) {
          await db.delete(table, row.id);
          pulled++;
        } else if (local) {
          // Local copy wins over the tombstone, so it has to go back up or the
          // record stays deleted on the server and the two never reconcile.
          await requeue(db, table, row.id);
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
      } else if ((local.updated_at || '') > updatedAt) {
        // Same reason: we're keeping a newer local copy, so re-queue it rather
        // than let the server keep serving the stale one.
        await requeue(db, table, row.id);
      }
    }
  }

  /* ---- push upserts (whatever the outbox says changed) ---- */
  const dirty = await db.getAll('sync_dirty');
  const queuedByTable = new Map();
  for (const d of dirty) {
    if (!TABLES.includes(d.store)) continue;
    if (!queuedByTable.has(d.store)) queuedByTable.set(d.store, []);
    queuedByTable.get(d.store).push(d);
  }
  const sent = [];
  for (const table of TABLES) {
    const rows = [];
    for (const d of queuedByTable.get(table) || []) {
      const record = await db.get(table, d.record_id);
      // A missing record was deleted after it was queued; its tombstone below
      // carries the deletion, so just drop the stale queue row.
      //
      // deleted: false is explicit, not noise. A live record we push may already
      // be a tombstone on the server — that's exactly what the re-queue above
      // does when a local edit beats someone else's delete. Leaving the column
      // out of the payload leaves the tombstone standing, so the next pull
      // re-queues the same record and every sync re-pushes it, forever.
      if (record) rows.push({ ...pick(record, FIELDS[table]), deleted: false });
      sent.push(d);
    }
    for (let i = 0; i < rows.length; i += 100) {
      await rest(session, 'POST', `${table}?on_conflict=id`, rows.slice(i, i + 100));
    }
    pushed += rows.length;
  }
  if (sent.length) {
    const tx = db.transaction('sync_dirty', 'readwrite');
    for (const d of sent) {
      // Leave anything edited again mid-sync queued for the next round.
      const current = await tx.store.get(d.id);
      if (current && current.queued_at === d.queued_at) tx.store.delete(d.id);
    }
    await tx.done;
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
    pushed += rows.length;
  }
  if (deletions.length) {
    const tx = db.transaction('sync_deletes', 'readwrite');
    for (const d of deletions) tx.store.delete(d.id);
    await tx.done;
  }

  await setMeta(WATERMARK_KEY, watermarks);
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
