// Letterman service worker. Runs only over https (or localhost); a double-clicked file:// page skips it.
// The content is NETWORK FIRST: online, a student always gets the newest copy; offline, the last copy they saw.
importScripts('version.js', 'sw-precache.js');
const CACHE = 'letterman-' + ((self.LETTERMAN_VERSION || {}).version || 'v1');   // a new version drops the old copy
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(self.PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Letterman's service is never cached: its answers belong to one account, and an old one must not stand
  // in for the service. Every request to it carries the apikey header; the paths are Supabase's own.
  if (e.request.headers.has('apikey') || e.request.headers.has('authorization') || /^\/(auth|rest|realtime|storage|functions)\/v1\//.test(url.pathname)) return;
  if (url.origin !== location.origin) {
    // credited works on Wikimedia Commons: cache what was seen, so a figure still shows offline
    e.respondWith(caches.open(CACHE).then(c => fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => c.match(e.request))));
    return;
  }
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
