// Letterman service worker. Runs only over https (or localhost); a double-clicked file:// page skips it.
// The content is NETWORK FIRST: online, a student always gets the newest copy; offline, the last copy they saw.
importScripts('version.js', 'sw-precache.js');
const CACHE = 'letterman-' + ((self.LETTERMAN_VERSION || {}).version || 'v1');   // a new version drops the old copy
// Published modules (published.js) are kept in a cache of their own that a new version of the app does not drop: a
// student who updates the app offline still has the modules they last saw.
const PUBLISHED = 'letterman-published-v1';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(self.PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== PUBLISHED).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// network first; a good answer is kept, and kept answers stand in when the network does not answer
const networkFirst = (req, name) => caches.open(name).then(c => fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => c.match(req).then(r => r || Promise.reject(new TypeError('offline')))));
// A published file's path holds its revision and fingerprint and never changes, so a kept copy is given first and the
// network is asked only for a file not kept yet: a slow connection never holds back a module the page has already seen.
const cacheFirst = (req, name) => caches.open(name).then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Letterman's service is never cached: its answers belong to one account, and an old one must not stand in for the
  // service. Every request to it carries the apikey or authorization header; the paths are Supabase's own. The one
  // exception is a public storage file asked for with neither header (published.js asks for nothing else): a file
  // anyone may read, the same for everyone. A request that asks past every cache (the catalog) is never kept.
  const signed = e.request.headers.has('apikey') || e.request.headers.has('authorization');
  if (!signed && /^\/storage\/v1\/object\/public\/[^/]+\/./.test(url.pathname)) {
    if (e.request.cache === 'no-store') return;
    e.respondWith(cacheFirst(e.request, PUBLISHED));
    return;
  }
  if (signed || /^\/(auth|rest|realtime|storage|functions)\/v1\//.test(url.pathname)) return;
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
