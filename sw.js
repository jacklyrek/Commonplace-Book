// Service worker: precaches the app shell AND all OCR/crop assets so the app —
// including photo→OCR capture — works fully offline (§9). Cache-first for all
// same-origin GETs. VERSION is auto-stamped with the commit SHA at deploy time
// (see .github/workflows/deploy.yml); the value below is just a local fallback.
const VERSION = 'cb-v12';
const CACHE = `commonplace-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/store.js',
  './js/ui.js',
  './js/images.js',
  './js/ocr.js',
  './js/crop.js',
  './js/export.js',
  './js/sync.js',
  './js/views/library.js',
  './js/views/entryForm.js',
  './js/views/entryDetail.js',
  './js/views/browse.js',
  './js/views/settings.js',
  './vendor/idb/idb.js',
  './vendor/cropperjs/cropper.min.js',
  './vendor/cropperjs/cropper.min.css',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/lang/eng.traineddata.gz',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (there should be none)

  // Always read/write the current version's cache explicitly. The global,
  // unscoped caches.match() searches every cache still in storage (in
  // creation order) and can hand back a stale response from an older
  // version if one lingers, even after this version has activated.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        return shell || fetch(request);
      }
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
  );
});
