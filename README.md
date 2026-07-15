# Commonplace Book

A personal commonplace book PWA — collect quotes and passages from physical books
via photo → on-device OCR, tag them by book and topic, and browse/search them later.
**Phase 1: fully local, fully offline.** See `commonplace-book-design-doc.md` for the spec.

## Run locally

No build step. Serve the folder over HTTP (ES modules and the service worker
don't work from `file://`):

```
python -m http.server 8123
```

Then open <http://localhost:8123>.

## Stack

- Vanilla HTML/CSS/JS, ES modules, no build step, no framework.
- **IndexedDB** (via the self-hosted `idb` helper) is the source of truth.
- **Tesseract.js 6** for on-device OCR — worker, LSTM wasm cores, and
  `eng.traineddata.gz` all self-hosted under `vendor/tesseract/`.
- **Cropper.js 1.6.2** (self-hosted) for the crop step.
- System font stack (no webfont downloads).
- Service worker precaches the app shell **and** all OCR assets, so capture
  works with no network at all. The app makes **zero** third-party requests.

## Data model (sync-ready for Phase 2)

Stores: `entries`, `tags` (kind = `book` | `topic`, author lives on book tags),
`entry_tags`, `images` (local-only photo blobs). Every record has a stable UUID
`id` plus `created_at` / `updated_at` ISO timestamps, so Phase 2 cloud sync
(last-write-wins) layers on without a schema change. JSON import already merges
by id with newest-wins.

## Deploy + install on iPhone

1. Push this folder to GitHub Pages or Netlify (it's fully static).
2. Add the app's host to Screen Time's "Allowed Websites Only" list —
   it's the only domain the app ever talks to in Phase 1.
3. Open the URL in Safari → Share → **Add to Home Screen**.
4. In Settings (inside the app), tap **Request persistent storage**, and
   export a JSON backup now and then — iOS can evict PWA storage under
   pressure or long disuse.

## Maintenance notes

- `sw.js` precaches an explicit asset list — if you add/rename a file, update
  `ASSETS` and bump `VERSION` so installed clients pick up the change.
- Icons are generated; regenerate via a System.Drawing script if you want new art.
