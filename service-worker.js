// CBE Exam Register — service worker
// Caches the static app shell (HTML/CSS/JS/icons/fonts) so the app installs,
// loads instantly, and opens offline. All Supabase/API calls always go to
// the network — this app's data is never cached, only the code that renders it.

const CACHE_VERSION = 'v3';
const CACHE_NAME = `cbe-shell-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './css/style.css',
  './js/supabaseClient.js',
  './js/data.js',
  './js/grading.js',
  './js/ui.js',
  './js/auth.js',
  './js/import.js',
  './js/views.js',
  './js/classes.js',
  './js/auth-views.js',
  './js/broadsheet.js',
  './js/analysis.js',
  './js/notify.js',
  './js/teacher.js',
  './js/attendance.js',
  './js/app.js',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Requests that must never be served from cache — live data and third-party
// services that manage their own freshness/auth.
function isNetworkOnly(url) {
  return (
    url.hostname.endsWith('supabase.co') ||
    url.hostname.includes('supabase.in') ||
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept writes

  const url = new URL(request.url);

  if (isNetworkOnly(url)) {
    return; // let the browser handle it normally, no caching
  }

  // Navigations: try network first (fresh app shell when online), fall back
  // to cache, then to the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('./offline.html'))
        )
    );
    return;
  }

  // Same-origin static assets: cache-first, refresh in the background.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
