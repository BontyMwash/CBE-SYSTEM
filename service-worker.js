// B~CBE Analytics — service worker
// Copyright (c) 2026 B~CBE Analytics. All rights reserved.
// Caches the static app shell (HTML/CSS/JS/icons/fonts) so the app installs,
// loads instantly, and opens offline. All Supabase/API calls always go to
// the network — this app's data is never cached, only the code that renders it.

// Bump this on every deploy that changes any cached file. The 'activate'
// handler below deletes every cache whose name doesn't match CACHE_NAME, so
// a bump is what actually gets a code change in front of users who already
// have the app installed — without it, the cache-first fetch strategy below
// keeps serving the OLD file indefinitely (this is why a shipped fix can
// look like it "didn't take" until this number changes).
const CACHE_VERSION = 'v10';
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

// Third-party library scripts the app depends on for one-click exports.
// These are pinned to an exact version in their URL (so they never change
// under us) and are safe — and worth — caching like the rest of the shell.
// Previously these were lumped in with Supabase under "always hit the
// network", which meant "Download PDF" / "Download Excel" had a hard
// dependency on cdnjs/jsdelivr being reachable at the exact moment the
// button was clicked, with no fallback: any flaky connection, corporate/
// school network filter, or ad-/tracker-blocking extension that flags
// those CDN hosts left the button silently failing ("PDF library did not
// load"). Pre-caching them at install time, and serving them cache-first
// afterwards, makes the export buttons work offline and immune to that
// class of failure, the same way the rest of the app shell already does.
const LIBRARY_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.9.3/html2pdf.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([...APP_SHELL, ...LIBRARY_URLS]))
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

// Requests that must never be served from cache — live data and auth that
// manages its own freshness. (The export-library CDN hosts used to be
// listed here too — see LIBRARY_URLS above for why that changed.)
function isNetworkOnly(url) {
  return (
    url.hostname.endsWith('supabase.co') ||
    url.hostname.includes('supabase.in') ||
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

  // Same-origin static assets, and the pinned library CDN files above:
  // cache-first, refresh in the background.
  if (url.origin === self.location.origin || LIBRARY_URLS.includes(request.url)) {
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

