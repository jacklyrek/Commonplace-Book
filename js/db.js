// IndexedDB setup. IndexedDB is the source of truth (design doc §3, §4).
// Schema is sync-ready for Phase 2: every record has a stable UUID `id`
// plus `created_at` / `updated_at` ISO timestamps (last-write-wins later).
import { openDB } from '../vendor/idb/idb.js';

export const dbPromise = openDB('commonplace-book', 1, {
  upgrade(db) {
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
  },
});

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
