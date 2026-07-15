// CRUD operations over the IndexedDB stores (§4 data model).
import { dbPromise, uid, now, cleanText } from './db.js';

/* ---------------- entries ---------------- */

// Creates or updates. Fills in id/created_at for new records, always bumps updated_at.
export async function saveEntry(entry) {
  const db = await dbPromise;
  const record = {
    id: entry.id || uid(),
    quote: entry.quote,
    reflection: cleanText(entry.reflection),
    page: cleanText(entry.page),
    image_ref: entry.image_ref ?? null,
    starred: !!entry.starred,
    created_at: entry.created_at || now(),
    updated_at: now(),
  };
  await db.put('entries', record);
  return record;
}

export async function getEntry(id) {
  return (await dbPromise).get('entries', id);
}

export async function listEntries() {
  return (await dbPromise).getAll('entries');
}

export async function toggleStar(id) {
  const db = await dbPromise;
  const entry = await db.get('entries', id);
  if (!entry) return null;
  entry.starred = !entry.starred;
  entry.updated_at = now();
  await db.put('entries', entry);
  return entry;
}

// Deletes the entry plus its entry_tags rows and attached image.
export async function deleteEntry(id) {
  const db = await dbPromise;
  const entry = await db.get('entries', id);
  const tx = db.transaction(['entries', 'entry_tags', 'images'], 'readwrite');
  const links = await tx.objectStore('entry_tags').index('entry_id').getAllKeys(id);
  for (const key of links) tx.objectStore('entry_tags').delete(key);
  if (entry?.image_ref) tx.objectStore('images').delete(entry.image_ref);
  tx.objectStore('entries').delete(id);
  await tx.done;
}

export async function randomEntry() {
  const db = await dbPromise;
  const ids = await db.getAllKeys('entries');
  if (!ids.length) return null;
  return db.get('entries', ids[Math.floor(Math.random() * ids.length)]);
}

/* ---------------- tags ---------------- */

export async function listTags(kind) {
  const db = await dbPromise;
  const all = kind ? await db.getAllFromIndex('tags', 'kind', kind) : await db.getAll('tags');
  return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function getTag(id) {
  return (await dbPromise).get('tags', id);
}

// Finds a tag by (kind, name) case-insensitively, or creates it.
// For book tags, fills in the author if it was missing.
export async function ensureTag(name, kind, author = null) {
  const db = await dbPromise;
  const clean = name.trim();
  const existing = (await db.getAllFromIndex('tags', 'kind', kind)).find(
    (t) => t.name.toLowerCase() === clean.toLowerCase()
  );
  if (existing) {
    if (kind === 'book' && author && author.trim() && !existing.author) {
      existing.author = author.trim();
      existing.updated_at = now();
      await db.put('tags', existing);
    }
    return existing;
  }
  const tag = {
    id: uid(),
    name: clean,
    kind,
    author: kind === 'book' && author && author.trim() ? author.trim() : null,
    created_at: now(),
    updated_at: now(),
  };
  await db.put('tags', tag);
  return tag;
}

// Map of tag_id -> number of entries using it.
export async function tagUsageCounts() {
  const db = await dbPromise;
  const links = await db.getAll('entry_tags');
  const counts = new Map();
  for (const link of links) counts.set(link.tag_id, (counts.get(link.tag_id) || 0) + 1);
  return counts;
}

/* ---------------- entry_tags ---------------- */

// Replaces the entry's tag set with exactly tagIds (diff-based, preserves timestamps).
export async function setEntryTags(entryId, tagIds) {
  const db = await dbPromise;
  const tx = db.transaction('entry_tags', 'readwrite');
  const current = await tx.store.index('entry_id').getAll(entryId);
  const wanted = new Set(tagIds);
  for (const link of current) {
    if (!wanted.has(link.tag_id)) tx.store.delete(link.id);
    else wanted.delete(link.tag_id);
  }
  for (const tagId of wanted) {
    tx.store.put({
      id: `${entryId}::${tagId}`,
      entry_id: entryId,
      tag_id: tagId,
      created_at: now(),
      updated_at: now(),
    });
  }
  await tx.done;
}

export async function tagsForEntry(entryId) {
  const db = await dbPromise;
  const links = await db.getAllFromIndex('entry_tags', 'entry_id', entryId);
  const tags = await Promise.all(links.map((l) => db.get('tags', l.tag_id)));
  return tags.filter(Boolean);
}

/* ---------------- joined reads ---------------- */

function attachTags(entry, tagsById, linksByEntry) {
  const tags = (linksByEntry.get(entry.id) || [])
    .map((l) => tagsById.get(l.tag_id))
    .filter(Boolean);
  return {
    ...entry,
    tags,
    book: tags.find((t) => t.kind === 'book') || null,
    topics: tags
      .filter((t) => t.kind === 'topic')
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
  };
}

// All entries with .tags / .book / .topics attached (personal scale: in-memory join is fine).
export async function listEntriesFull() {
  const db = await dbPromise;
  const [entries, tags, links] = await Promise.all([
    db.getAll('entries'),
    db.getAll('tags'),
    db.getAll('entry_tags'),
  ]);
  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const linksByEntry = new Map();
  for (const link of links) {
    if (!linksByEntry.has(link.entry_id)) linksByEntry.set(link.entry_id, []);
    linksByEntry.get(link.entry_id).push(link);
  }
  return entries.map((e) => attachTags(e, tagsById, linksByEntry));
}

export async function getEntryFull(id) {
  const entry = await getEntry(id);
  if (!entry) return null;
  const tags = await tagsForEntry(id);
  return {
    ...entry,
    tags,
    book: tags.find((t) => t.kind === 'book') || null,
    topics: tags
      .filter((t) => t.kind === 'topic')
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
  };
}

/* ---------------- images ---------------- */

export async function putImage(blob) {
  const db = await dbPromise;
  const record = { id: uid(), blob, type: blob.type, created_at: now(), updated_at: now() };
  await db.put('images', record);
  return record.id;
}

export async function getImage(id) {
  if (!id) return null;
  return (await dbPromise).get('images', id);
}

export async function deleteImage(id) {
  if (!id) return;
  return (await dbPromise).delete('images', id);
}
