# Commonplace Book

A personal commonplace book PWA — collect quotes and passages from physical books
via photo → on-device OCR, tag them by book and topic, and browse/search them later.
Local-first and fully offline; optional cloud sync via Supabase (Phase 2).
See `commonplace-book-design-doc.md` for the spec.

Photos are never stored: a photo is downscaled, cropped, OCR'd on-device, and
discarded — only the extracted (editable) text is kept.

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

## Data model

Stores: `entries`, `tags` (kind = `book` | `topic`, author lives on book tags),
`entry_tags`, plus sync bookkeeping (`meta`, `sync_deletes` tombstone outbox).
Every record has a stable UUID `id` plus `created_at` / `updated_at` ISO
timestamps; sync and JSON import both merge by id with last-write-wins.

## Cloud sync (Phase 2)

Local-first: IndexedDB stays the source of truth and everything works offline.
When configured and signed in, changes sync to your own Supabase project in the
background (after edits, on launch, on regaining connectivity) — pull first with
last-write-wins, then push changed records and deletion tombstones. The sync
client is hand-rolled `fetch` against Supabase's REST APIs — no client library,
so the only network destination is your own project's domain.

Sign-in is a one-time email code: enter your email, Supabase emails you a
6-digit code, you type it in. No passwords, no OAuth redirects, PWA-friendly.

One-time setup:

1. Create a free project at supabase.com. Note the **Project URL** and the
   **anon public key** (Project Settings → API).
2. Dashboard → SQL Editor → paste and run `supabase-schema.sql`.
3. Make the sign-in email carry a code: Dashboard → Authentication →
   Email Templates → **Magic Link** — make sure the body includes
   `{{ .Token }}` (e.g. `<p>Your sign-in code: {{ .Token }}</p>`).
   Without this the email only contains a link, not the code the app asks for.
4. In the app: Settings → Sync → paste Project URL + anon key → Save →
   enter your email → **Send code** → type the code → **Verify**.

## Deploy + install on iPhone

1. Push this folder to GitHub Pages or Netlify (it's fully static).
2. Add to Screen Time's "Allowed Websites Only" list:
   - the app's host (e.g. `your-name.github.io`)
   - `<project-ref>.supabase.co` (sync)
3. Open the URL in Safari → Share → **Add to Home Screen**.
4. In Settings (inside the app), tap **Request persistent storage**, and
   export a JSON backup now and then — iOS can evict PWA storage under
   pressure or long disuse (sync + export together protect your data).

## Maintenance notes

- `sw.js` precaches an explicit asset list — if you add/rename a file, update
  `ASSETS` and bump `VERSION` so installed clients pick up the change.
- Icons are generated; regenerate via a System.Drawing script if you want new art.
