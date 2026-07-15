# Commonplace Book — Design Doc

## 1. Overview

A personal **commonplace book** app for iPhone: a place to collect quotes and passages (mostly from **physical books**), tag them, reflect on them, and browse or search them later.

- Installed to the home screen as a **PWA** (web app), not published to the App Store.
- Primary capture path for physical books: **take a photo → on-device OCR → select/edit the text → save as a note.**
- Runs **offline**, stores data **locally first**, and **syncs to the cloud** so nothing is lost and it's reachable across devices.

This doc is the build spec. It's written to be handed to Claude Code. It specifies *what* to build and the key technical decisions, and deliberately leaves implementation detail to the build step.

---

## 2. Goals & Non-Goals

**Goals**
- Fast capture of passages from physical books via photo + OCR.
- Flexible organization: tag each entry with a **book** and with **topic tags**; browse by either.
- Search everything (quote text, reflection, book, tags).
- Works fully offline; syncs when online.
- Feels like a native app on the home screen.
- Compatible with a locked-down iPhone (Screen Time "Allowed Websites Only" whitelist).

**Non-Goals**
- App Store distribution.
- Multiple users, sharing, or any social features.
- A backend server the user has to run/maintain (use a hosted backend-as-a-service).

---

## 3. Platform & Stack

| Layer | Choice | Notes |
|---|---|---|
| App type | PWA (installable web app) | Add to Home Screen from Safari; standalone, full-screen. |
| Frontend | Vanilla HTML/CSS/JS, **no build step**, ES modules | Simplest to deploy and to keep whitelist-clean. A light framework (e.g. Svelte) is optional if it grows. |
| Local storage | **IndexedDB** (via the `idb` helper) | Source of truth on-device; enables offline. |
| OCR | **Tesseract.js** (WASM), English lang data | Runs entirely on-device. **Self-host** the worker/wasm/lang files — do not load from a CDN. |
| Image crop | A small cropper (e.g. Cropper.js) or a hand-rolled canvas crop | Self-hosted. |
| Camera | `<input type="file" accept="image/*" capture="environment">` | Most reliable way to open the camera on iOS Safari. |
| Sync backend | **Supabase** (Postgres + Auth + Storage) recommended | See §7 for the decision and the Firebase alternative. |
| Hosting | Static host: **GitHub Pages** or **Netlify** | App is fully static; no server to run. |

**Whitelist rule of thumb:** every runtime asset (Tesseract, cropper, fonts) is served from the app's own origin. The *only* outbound network call is to the sync backend. See §9.

---

## 4. Data Model

Books are modeled as a **kind of tag**, so browsing by book and browsing by topic use the same machinery.

**`entries`**
- `id`
- `quote` (text) — the passage itself
- `reflection` (text, nullable) — your own thoughts; **blank by default**, optional
- `page` (text/int, nullable) — page number in the source book
- `image_ref` (nullable) — reference to the attached source photo
- `starred` (bool, default false)
- `created_at`, `updated_at`

**`tags`**
- `id`
- `name`
- `kind` — `"book"` or `"topic"`
- `author` (nullable) — used only when `kind = "book"`

**`entry_tags`** (many-to-many)
- `entry_id`, `tag_id`

**Rules**
- An entry can have at most one `book`-kind tag and any number of `topic`-kind tags (soft rule; enforce in UI).
- "Browse by book" = filter entries by a `book` tag. "Browse by topic" = filter by a `topic` tag. Same filter path.
- Page lives on the **entry** (per-quote); author lives on the **book tag**.

---

## 5. Core Features

1. **Add entry** — type/paste a quote, or capture via photo→OCR (§6).
2. **Tag with a book** — pick an existing book tag or create a new one (name + optional author).
3. **Topic tags** — freeform, reusable, autocomplete from existing tags.
4. **Optional reflection** — a collapsible field, empty unless you fill it.
5. **Optional page number.**
6. **Attach the source photo** to the entry; tap to view full-size later.
7. **Browse** by book or by topic tag (filter chips).
8. **Search** across quote, reflection, book name, author, and tags.
9. **Sort** by date (default), book, or author.
10. **Star / favorite** entries and filter to starred.
11. **Edit / delete** any entry.
12. **Export / import** — JSON (full backup) and Markdown (portable, human-readable).
13. **Dark mode.**
14. **Resurface** — a "show me a random old entry" action, for rediscovery.

---

## 6. Photo-to-Note (OCR) Flow

The core capture experience for physical books.

1. **Capture** — tap "From photo"; the camera opens (`capture="environment"`).
2. **Crop** *(optional)* — drag to crop down to just the passage. Cropping tighter improves OCR accuracy and speed.
3. **Recognize** — the app runs Tesseract.js **on-device** on the cropped image. Show a progress indicator (OCR takes a few seconds).
4. **Edit** — recognized text drops into an editable box. You fix any OCR slips and trim to exactly the passage you want. (Editing here *is* the "select the text" step — simplest and most forgiving.)
5. **Attach & save** — the original photo is stored with the entry so you can re-read or re-crop later. Assign book + tags + optional page/reflection, then save.

**Why on-device OCR:** free, works offline, keeps the passage private, and adds **zero** external domains to the whitelist. Clean printed book type is near the best case for accuracy.

*Enhancement (later):* draw a region directly on the photo and OCR only that region, skipping the crop-then-edit step.

---

## 7. Sync & Backup

You chose **cloud sync**. Recommended approach:

**Architecture: local-first with background sync.**
- IndexedDB is the source of truth on the device — the app is always fully usable offline.
- When online and signed in, changes sync to the backend; changes from other devices sync down.
- Last-write-wins on conflicts is acceptable for a single-user app (keep `updated_at` per record).

**Recommended backend: Supabase.**
- Relational model maps cleanly onto entries / tags / entry_tags.
- Built-in Auth — use **email magic link or Apple sign-in** (avoids a Google login).
- Supabase Storage bucket for synced photos.
- Free tier is ample for personal use.

**Alternative: Firebase Firestore** — its offline persistence + sync is more automatic (less sync code to write), at the cost of a NoSQL model and adding Google API domains to the whitelist.

**Images decision (see §12):** syncing photos is the heaviest part. Options: (a) compress/downscale on capture and sync them, or (b) keep photos **local-only** and sync just the text — lighter and simpler. Recommend starting with (b) if you want sync lean.

**Backup regardless of sync:** JSON export/import is the belt-and-suspenders backup. iOS can evict a PWA's local storage under storage pressure or long disuse, so export + sync together are what protect years of collected quotes.

---

## 8. Screens / UX

1. **Library (home)** — reverse-chronological list of entries; search bar on top; filter chips for books and topics; sort control; star filter. Floating "+" to add.
2. **Add / Edit entry** — quote field; "From photo" button (→ §6 flow); book picker (or create new + author); topic tag input with autocomplete; optional page; collapsible reflection; photo thumbnail; save.
3. **Entry detail** — full quote, reflection, book + author, topics, page, source photo (tap to enlarge); edit / delete / star.
4. **Browse** — list of book tags and topic tags; tap one to see its entries.
5. **Settings** — account / sync status and sign-in; export (JSON, Markdown); import; theme (light/dark/system).

---

## 9. Non-Functional Requirements

- **Offline-first:** every feature except sync works with no network.
- **Whitelist compatibility (important):** self-host all runtime assets so the app makes **no** third-party calls except to the sync backend. Domains to add to the Safari "Allowed Websites Only" list:
  - the app's own host (e.g. `your-name.github.io` or your Netlify subdomain)
  - the sync backend (e.g. `<project-ref>.supabase.co`)
- **Privacy:** OCR is on-device; synced data goes only to your own backend account.
- **Performance:** show progress during OCR; compress images before storing.
- **iOS PWA notes:** installs via Safari only; local storage can be evicted — sync + export mitigate this.

---

## 10. Deployment & Install

1. Push the static site to GitHub Pages or Netlify; get the URL.
2. On iPhone: enable Safari, add the app URL (and backend domain) to the Screen Time whitelist.
3. Open the URL in Safari → Share → **Add to Home Screen**.
4. Launch from the home-screen icon (standalone, full-screen).

---

## 11. Build Phases

**Phase 1 — Local app (build this first, install it, use it):**
entries with quote / optional reflection / optional page; book + topic tags; browse, search, sort, star; photo → crop → OCR → edit → save; IndexedDB; JSON + Markdown export/import; PWA install; dark mode; resurface-random.

**Phase 2 — Sync:**
add Supabase auth + sync of text records; then (optional) photo sync. Design the Phase 1 schema sync-ready (stable IDs + `updated_at`) so this layers on cleanly.

**Phase 3 — Nice-to-haves:**
region-select OCR on the image; smarter conflict handling; tag rename/merge; stats.

---

## 12. Open Decisions

- **Sync backend:** Supabase (recommended) vs Firebase Firestore.
- **Photo sync:** sync compressed images vs keep photos local-only.
- **Auth method:** email magic link vs Apple sign-in (avoid Google login).
- **Framework:** vanilla JS (recommended) vs a light framework if the app grows.
