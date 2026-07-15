// Backup: JSON export/import (text records; photos are never stored) and
// Markdown export (portable, human-readable) — §5.12, §7.
import { dbPromise, now, cleanText } from './db.js';
import { listEntriesFull } from './store.js';
import { fmtDate } from './ui.js';

const EXPORT_VERSION = 1;

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/* ---------------- JSON ---------------- */

export async function exportJSON() {
  const db = await dbPromise;
  const [entries, tags, entryTags] = await Promise.all([
    db.getAll('entries'),
    db.getAll('tags'),
    db.getAll('entry_tags'),
  ]);
  const payload = {
    app: 'commonplace-book',
    version: EXPORT_VERSION,
    exported_at: now(),
    entries,
    tags,
    entry_tags: entryTags,
  };
  download(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `commonplace-backup-${stamp()}.json`
  );
  return { entries: entries.length };
}

// Merges by id with last-write-wins on updated_at (same rule Phase 2 sync will use).
export async function importJSON(file) {
  const payload = JSON.parse(await file.text());
  if (payload.app !== 'commonplace-book' || !Array.isArray(payload.entries)) {
    throw new Error('Not a Commonplace Book backup file.');
  }

  const db = await dbPromise;
  const result = { added: 0, updated: 0, skipped: 0 };

  const mergeStore = async (storeName, records) => {
    for (const record of records || []) {
      if (!record?.id) continue;
      const existing = await db.get(storeName, record.id);
      if (!existing) {
        await db.put(storeName, record);
        result.added++;
      } else if ((record.updated_at || '') > (existing.updated_at || '')) {
        await db.put(storeName, record);
        result.updated++;
      } else {
        result.skipped++;
      }
    }
  };

  await mergeStore('tags', payload.tags);
  // Backups from older builds may carry the string "null" for empty fields.
  await mergeStore(
    'entries',
    (payload.entries || []).map((e) => ({
      ...e,
      reflection: cleanText(e.reflection),
      page: cleanText(e.page),
    }))
  );
  await mergeStore('entry_tags', payload.entry_tags);
  // Older backups may contain an `images` array — photos are no longer stored, so it's ignored.

  return result;
}

/* ---------------- Markdown ---------------- */

export async function exportMarkdown() {
  const entries = await listEntriesFull();
  entries.sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Group by book; unattributed entries go last.
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.book ? entry.book.id : '';
    if (!groups.has(key)) groups.set(key, { book: entry.book, entries: [] });
    groups.get(key).entries.push(entry);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    if (!a.book) return 1;
    if (!b.book) return -1;
    return a.book.name.localeCompare(b.book.name, undefined, { sensitivity: 'base' });
  });

  const lines = [`# Commonplace Book`, ``, `Exported ${fmtDate(now())} · ${entries.length} entries`, ``];
  for (const group of ordered) {
    lines.push(
      group.book
        ? `## ${group.book.name}${group.book.author ? ` — ${group.book.author}` : ''}`
        : `## (No book)`,
      ``
    );
    for (const entry of group.entries) {
      for (const qline of entry.quote.split('\n')) lines.push(`> ${qline}`);
      const meta = [];
      if (entry.page) meta.push(`p. ${entry.page}`);
      if (entry.topics.length) meta.push(entry.topics.map((t) => `#${t.name.replace(/\s+/g, '-')}`).join(' '));
      meta.push(fmtDate(entry.created_at));
      if (entry.starred) meta.push('★');
      lines.push(``, meta.join(' · '));
      if (entry.reflection) lines.push(``, `*${entry.reflection}*`);
      lines.push(``, `---`, ``);
    }
  }

  download(
    new Blob([lines.join('\n')], { type: 'text/markdown' }),
    `commonplace-${stamp()}.md`
  );
  return { entries: entries.length };
}
