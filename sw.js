/* Procurement Progress Report — service worker
   Added 2026-10-29 (Hani) for offline/installable use in the field.

   Scope is deliberately narrow: this only caches the app's own static
   page itself (which also contains the icons and the install manifest)
   and the three libraries in lib/, so the app can still OPEN with no signal — in a
   warehouse basement, a site with no coverage, etc.

   It never caches or intercepts anything to do with your data:
   sheets.googleapis.com, www.googleapis.com (Drive/userinfo/Gmail), and
   accounts.google.com (sign-in) all pass straight through to the
   network, untouched, every time. Caching those would risk silently
   showing stale procurement data as if it were current, which is far
   worse than the page just failing to load — so this worker never
   does that. Writes made while offline are queued by the app itself
   (see OFFLINE_QUEUE_KEY in the page) and sent once the network is
   back, not handled here.

   v2 (Phase 1, 2026-10-29):
   - No longer hard-codes the page's file name, so it works whether the
     page is published as index.html or under any other name.
   - The page itself is now network-first: when you're online you always
     get the latest published version straight away (v1 showed the
     previously cached copy once after every update); the cached copy is
     only used when the network is unreachable.
   - Each file is cached on its own during install, so one missing or
     renamed file can no longer stop the whole worker from installing. */

const SHELL_CACHE = 'ppr-shell-v4';
// v4 (2026-10-30): the libraries live in lib/ again (to keep the page
// small), so they are pre-cached here for offline use alongside the page.
const SHELL_FILES = [
  './',
  './lib/chart.umd.min.js',
  './lib/xlsx.full.min.js',
  './lib/html2pdf.bundle.min.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return Promise.all(SHELL_FILES.map(function (f) {
        return cache.add(f).catch(function (e) { console.warn('SW: could not pre-cache ' + f, e); });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== SHELL_CACHE; })
             .map(function (n) { return caches.delete(n); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

function putInCache(request, resp) {
  if (resp && resp.ok) {
    var copy = resp.clone();
    caches.open(SHELL_CACHE).then(function (cache) { cache.put(request, copy); });
  }
  return resp;
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = req.url;

  // Never touch Google's own endpoints (data + auth) — always network,
  // always live, exactly as if this worker didn't exist.
  if (url.indexOf('googleapis.com') !== -1 || url.indexOf('accounts.google.com') !== -1 ||
      url.indexOf('gstatic.com') !== -1) {
    return;
  }

  // Only handle our own same-origin files; anything else passes through.
  if (req.method !== 'GET' || new URL(url).origin !== self.location.origin) {
    return;
  }

  // The page itself: network-first, cached copy only as an offline fallback.
  // ignoreSearch so a link like ?sheet=<id> still finds the cached page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (resp) { return putInCache(req, resp); })
        .catch(function () {
          return caches.match(req, { ignoreSearch: true }).then(function (cached) {
            return cached || caches.match('./', { ignoreSearch: true });
          });
        })
    );
    return;
  }

  // Anything else same-origin: cache-first for instant offline use,
  // refreshed in the background for next time.
  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (resp) { return putInCache(req, resp); })
        .catch(function () { return cached; });
      return cached || network;
    })
  );
});
