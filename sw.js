// Service worker: lets the app open without internet (iPhone home-screen app or offline computer).
// App code: network first (updates arrive whenever online), cache as fallback.
// vendor/ (big, never changes): cache first.
// Only the app's own files are cached — never any bank data (that lives in IndexedDB).
const CACHE = 'budget-app-v2';

const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/db.js',
  'js/store.js',
  'js/format.js',
  'js/defaults.js',
  'js/categorize.js',
  'js/analytics.js',
  'js/icons.js',
  'js/lock.js',
  'js/ui.js',
  'js/views/dashboard.js',
  'js/views/txlist.js',
  'js/views/txform.js',
  'js/views/settings.js',
  'js/views/upload.js',
  'js/views/ruleoffer.js',
  'js/import/ocr.js',
  'js/import/inbox.js',
  'vendor/chart/chart.umd.min.js',
  'vendor/fonts/heebo-hebrew.woff2',
  'vendor/fonts/heebo-latin.woff2',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.includes('/vendor/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
