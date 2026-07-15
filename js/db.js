// IndexedDB setup. IndexedDB is the source of truth (design doc §3, §4).
// Schema is sync-ready for Phase 2: every record has a stable UUID `id`
// plus `created_at` / `updated_at` ISO timestamps (last-write-wins later).
import { openDB } from '../vendor/idb/idb.js';

// Optional text fields must be real null when absent — older builds could store
// the string "null", which then rendered literally. Used on save, import, and
// in the v2 migration below.
export function cleanText(value) {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  return !trimmed || trimmed === 'null' || trimmed === 'undefined' ? null : value;
}

export const dbPromise = openDB('commonplace-book', 2, {
  async upgrade(db, oldVersion, newVersion, tx) {
    if (oldVersion < 1) {
      const entries = db.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('created_at', 'created_at');
      entries.createIndex('updated_at', 'updated_at');

      const tags = db.createObjectStore('tags', { keyPath: 'id' });
      tags.createIndex('kind', 'kind');
      tags.createIndex('name', 'name');

      const entryTags = db.createObjectStore('entry_tags', { keyPath: 'id' });
      entryTags.createIndex('entry_id', 'entry_id');
      entryTags.createIndex('tag_id', 'tag_id');

      // Photos stay local-only in Phase 1; referenced from entries.image_ref.
      db.createObjectStore('images', { keyPath: 'id' });
    }

    if (oldVersion === 1) {
      // v2: normalize "null"/blank reflection and page strings left by old builds.
      let cursor = await tx.objectStore('entries').openCursor();
      while (cursor) {
        const entry = cursor.value;
        const reflection = cleanText(entry.reflection);
        const page = cleanText(entry.page);
        if (reflection !== entry.reflection || page !== entry.page) {
          await cursor.update({ ...entry, reflection, page });
        }
        cursor = await cursor.continue();
      }
    }
  },
});

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
