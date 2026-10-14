// Published modules, read from the service's public storage.
//
// The page may be built with a course (data/course.js): that is the seed. A released app carries none: the school's
// courses are the service's, and each arrives with a published module, whose package carries its course's public part
// (package.course). A course the page does not hold is made from it; a course this file made goes when the catalog lists
// none of its modules. When the
// deployment names a published bucket (LETTERMAN_CONFIG.published) and a service, this file starts from what the page
// last put in, quietly asks the bucket's catalog which module revisions are published, and puts each one that is not
// already in the seed into the course before app.js draws anything. The catalog is the one word on what a student sees:
// a module it no longer lists is taken off the page (a module the seed holds only where the build says its seed is the
// published list, LETTERMAN_CONFIG.published.authoritative), and put back if it is listed again. A student's answers and
// place are kept by app.js, whatever is on the page. New content and removals never arrive in the middle of a step:
// what the catalog says after the page has started (a catalog or a package that answers after the time budget, or a
// change made while the page is open) waits, and app.js takes it on the home screen or at the next start. A page that
// cannot read the catalog keeps what it has. The catalog also gives each module's live dates (opens_on, due_on), which an
// admin may have changed since the build; they are put onto the course's module entries the same way, and kept with the
// list. Offline, the page starts from the revisions, removals and dates it last had: the service worker (sw.js) keeps a
// copy of each public file it fetched, and inside the desktop app the main process keeps one (letterman://app/published/).
//
// The bucket: catalog.json at its root, the one file that changes, read past every cache; and for each module revision
// the folder the catalog names, <course>/<module>/<revision>/<fingerprint>/ (three levels also read), with package.json
// and the module's own files beside it, at paths that never change. The catalog's own path is what is read, never
// one built here. No request here carries a key or a sign-in, so nothing personal is ever cached with these files.
//
// There is no second way to learn what is published: a missing or unreadable catalog.json means the page keeps what it
// has. (The service can also answer the same list live, but only to a request that carries the public key, which would
// work in a browser and not for the desktop app's copy, and would hide a publish whose catalog was never written.)
//
// app.js starts when window.LETTERMAN_READY settles; with no published bucket configured it is settled at once, so app.js
// starts as soon as its own script has run (one microtask later, before the document finishes loading).
(function () {
  'use strict';
  const CFG = window.LETTERMAN_CONFIG || {};
  const P = CFG.published, S = CFG.service;
  const STAGE = /[?&]stage\b/.test(location.search);
  // The stage (the class's view of what the teacher shows) asks the service nothing; it shows the course the teaching console built.
  if (STAGE || !P || !P.bucket || !S || !S.url || !window.LETTERMAN_CONTENT) { window.LETTERMAN_READY = Promise.resolve(); return; }
  const CONTENT = window.LETTERMAN_CONTENT;
  const DESK = location.protocol === 'letterman:';
  const base = DESK ? location.origin + '/published/' : S.url.replace(/\/+$/, '') + '/storage/v1/object/public/' + encodeURIComponent(P.bucket) + '/';
  const num = (v, d) => Number.isFinite(v) && v > 0 ? v : d;
  const budget = num(P.budgetMs, 1500);      // how long the first start waits for the catalog and its packages
  const askMs = num(P.askMs, 5000);          // how long a later ask waits
  const recheckMs = Number.isFinite(P.recheckMs) && P.recheckMs >= 0 ? P.recheckMs : 60000;   // least time between two later asks
  const AUTHORITATIVE = P.authoritative === true;   // the seed holds only modules that were published: the catalog may take any of them off
  const KEY = 'letterman:published:v1';
  // <course>/<module>/<revision>/ or <course>/<module>/<revision>/<fingerprint>/; no level may start with a dot, so no path climbs out
  const SAFE = /^\w[\w.-]*(\/\w[\w.-]*){2,3}\/$/;
  const NAME = /^\w[\w.-]*$/;
  const LATE = {};
  const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(LATE), ms))]);
  const getJSON = (url, opts) => fetch(url, Object.assign({ credentials: 'omit', mode: DESK ? 'same-origin' : 'cors' }, opts)).then(r => r.ok ? r.json() : null).catch(() => null);
  const getCatalog = () => getJSON(base + 'catalog.json', { cache: 'no-store' }).then(j => j && j.v === 1 && j.courses && typeof j.courses === 'object' ? j : null);
  const entryOf = v => typeof v === 'string' ? { path: v, revision: null, fingerprint: null } : v && typeof v.path === 'string' && SAFE.test(v.path) ? { path: v.path, revision: v.revision, fingerprint: v.fingerprint || null } : null;
  // What this page last had: applied { "<course>/<module>": { path, revision, fingerprint } }, the live dates, and the
  // modules of the seed it took off.
  const read = () => {
    const out = { applied: {}, dates: {}, removed: {} };
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
      for (const [k, e] of Object.entries(v.applied && typeof v.applied === 'object' ? v.applied : {})) if (entryOf(e)) out.applied[k] = entryOf(e);
      if (v.dates && typeof v.dates === 'object') out.dates = v.dates;
      if (v.removed && typeof v.removed === 'object') out.removed = v.removed;
    } catch (e) { /* nothing kept */ }
    return out;
  };
  const write = rec => { if (STAGE) return; try { localStorage.setItem(KEY, JSON.stringify(Object.assign({ at: Date.now() }, rec))); } catch (e) { } };

  // What the page was built with, taken before anything is put in: each module's revision (and its fingerprint, where the
  // build recorded one) in the course's own packages, and the package itself, to put back. A published revision the seed
  // already has is never fetched.
  const SEED = {}, SEEDPKG = {};
  for (const [c, course] of Object.entries(CONTENT.courses || {})) for (const [f, p] of Object.entries(course.packages || {})) {
    const rec = (P.seed || {})[c + '/' + f] || {};
    SEED[c + '/' + f] = { revision: rec.revision != null ? rec.revision : p.module && p.module.meta && p.module.meta.revision, fingerprint: rec.fingerprint || null };
    SEEDPKG[c + '/' + f] = p;
  }
  // The seed carries the short form of a fingerprint (the build keeps long hex runs out of the public page); the catalog's
  // is the full one, so they match when the catalog's begins with the seed's.
  const seedHas = (key, e) => { const s = SEED[key]; return !!s && s.revision === e.revision && (!s.fingerprint || !e.fingerprint || e.fingerprint.indexOf(s.fingerprint) === 0); };

  // what a catalog lists: { "<course>/<module>": { path, revision, fingerprint } }, only well-formed entries
  function listed(cat) {
    const out = {};
    for (const [c, v] of Object.entries((cat && cat.courses) || {})) {
      if (!NAME.test(c)) continue;
      for (const [f, m] of Object.entries((v && v.modules) || {})) {
        if (!NAME.test(f) || !m || typeof m.path !== 'string' || !SAFE.test(m.path) || !m.path.startsWith(c + '/' + f + '/')) continue;
        out[c + '/' + f] = { path: m.path, revision: m.revision, fingerprint: typeof m.fingerprint === 'string' ? m.fingerprint : null };
      }
    }
    return out;
  }
  // The live dates a catalog gives each module it lists: { "<course>/<module>": { opens, due } }, each a calendar date or
  // null (no date). A module whose entry names no date field says nothing about dates, so the seed's stay.
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const day = v => typeof v === 'string' && DAY.test(v) ? v : null;
  function datesOf(cat) {
    const out = {};
    for (const [c, v] of Object.entries((cat && cat.courses) || {})) for (const [f, m] of Object.entries((v && v.modules) || {})) {
      if (m && typeof m === 'object' && ('opens_on' in m || 'due_on' in m)) out[c + '/' + f] = { opens: day(m.opens_on), due: day(m.due_on) };
    }
    return out;
  }
  // the live dates go onto the seed's module entries, so every screen (the locks, the term, Coming up) reads one place.
  // The dates the page was built with (the Academy's) are kept beside them once, as entry.was, so the term can say that a
  // date moved and from when.
  function applyDates(dates) {
    for (const [key, d] of Object.entries(dates || {})) {
      const [c, f] = key.split('/');
      const course = (CONTENT.courses || {})[c];
      const entry = course && (course.modules || []).find(m => m.folder === f || m.lockedFolder === f || m.id === c + '/' + f);
      if (!entry || !d || typeof d !== 'object') continue;
      if (!entry.was) entry.was = { opens: day(entry.opens), due: day(entry.due) };
      entry.opens = day(d.opens); entry.due = day(d.due);
    }
  }
  const made = new Set();   // module entries this file made (the course's list had no line for them)
  const madeCourses = {};   // <course> -> the module number whose package the course was made from
  // A course the page does not hold, made from a package's course part: its words, its list of modules (none open), its
  // links, works and glossary, and where its own files are (beside that package, under course/). A package of a higher
  // module number gives the course again, so the course is the one its latest module was brought in with.
  const courseOk = d => !!d && typeof d === 'object' && !!d.meta && typeof d.meta.title === 'string' && Array.isArray(d.modules);
  function makeCourse(c, e, pkg) {
    const d = pkg.course, n = pkg.module.meta.module;
    const had = (CONTENT.courses || {})[c];
    if (had && !(c in madeCourses)) return had;
    if (had && !(Number.isFinite(n) && n > madeCourses[c])) return had;
    if (!courseOk(d)) return had || null;
    // the same object stays the course (app.js holds it), its parts given again
    const course = Object.assign(had || { packages: {} }, { meta: d.meta, modules: d.modules.map(m => Object.assign({}, m, { folder: undefined })),
      assets: Array.isArray(d.assets) ? d.assets : [], glossary: Array.isArray(d.glossary) ? d.glossary : [], assetBase: base + e.path + 'course/' });
    for (const [f, p] of Object.entries(course.packages)) { const m = course.modules.find(x => x.id === p.module.meta.id); if (m) { m.folder = f; m.status = 'released'; } }
    CONTENT.courses = CONTENT.courses || {};
    CONTENT.courses[c] = course; madeCourses[c] = Number.isFinite(n) ? n : 0;
    if (had) applyDates(datesNow);   // the live dates go back onto the list given again
    return course;
  }
  // A package goes into the seed's course, and its module's entry in the course's list opens at that folder (an entry is
  // made, in the order of the module numbers, for a module the course had no line for).
  function apply(key, e, pkg) {
    const [c, f] = key.split('/');
    if (!pkg || !pkg.module || !pkg.module.meta || !pkg.files || typeof pkg.files !== 'object') return false;
    const course = makeCourse(c, e, pkg);
    if (!course) return false;
    course.packages[f] = { module: pkg.module, files: pkg.files, assetBase: base + e.path };
    const meta = pkg.module.meta, list = course.modules = course.modules || [];
    let entry = list.find(m => m.folder === f || m.lockedFolder === f || m.id === meta.id);
    if (!entry) {
      entry = { id: meta.id, module: meta.module, title: meta.title, opens: null };
      const at = list.findIndex(m => m.module > meta.module);
      if (at < 0) list.push(entry); else list.splice(at, 0, entry);
      made.add(key);
    }
    entry.folder = f; entry.status = 'released';
    return true;
  }
  // A module taken off the page: its package, and its line in the course's list opens nowhere (a line this file made goes).
  // What the student answered is in app.js's store and is not touched here.
  function unapply(key) {
    const [c, f] = key.split('/');
    const course = (CONTENT.courses || {})[c];
    if (!course || !course.packages[f]) return false;
    delete course.packages[f];
    const list = course.modules || [], i = list.findIndex(m => m.folder === f || m.lockedFolder === f);
    if (i >= 0) { if (made.has(key)) { list.splice(i, 1); made.delete(key); } else { delete list[i].folder; delete list[i].lockedFolder; } }
    if (c in madeCourses && !Object.keys(course.packages).length) { delete CONTENT.courses[c]; delete madeCourses[c]; }
    return true;
  }
  // a module of the seed put back as it was built
  function restoreSeed(key) {
    const [c, f] = key.split('/');
    const course = (CONTENT.courses || {})[c], p = SEEDPKG[key];
    if (!course || !p) return false;
    course.packages[f] = p;
    const entry = (course.modules || []).find(m => m.id === p.module.meta.id || m.module === p.module.meta.module);
    if (entry) entry.folder = f;
    return true;
  }

  const current = {};     // "<course>/<module>" -> entry: what is in the course now, from the bucket
  const waiting = {};     // "<course>/<module>" -> { e, pkg }: fetched since the page started, not yet put in
  const goneSoon = {};    // "<course>/<module>" -> true: the catalog no longer lists it; not yet taken off
  const backSoon = {};    // "<course>/<module>" -> true: a seed module taken off that the catalog lists again
  const removed = {};     // "<course>/<module>" -> true: seed modules this page has taken off
  const paths = {};       // "<course>/<module>" -> path, as window.LETTERMAN_PUBLISHED.applied says
  let datesNow = {}, lastAsk = 0, inflight = null, state = 'unreachable';
  const present = key => { const [c, f] = key.split('/'); const course = (CONTENT.courses || {})[c]; return !!(course && course.packages[f]); };
  const hold = (k, e, pkg) => { if (pkg && pkg.module && pkg.module.meta && pkg.files && !seedHas(k, e) && !(current[k] && current[k].path === e.path)) waiting[k] = { e, pkg }; };
  // What is waiting is also written down as what to start from next time, so a start that cannot reach the catalog (or
  // reaches it late) still has it, from the copy the fetch below left.
  const keepNext = () => write({ applied: Object.assign({}, current, Object.fromEntries(Object.entries(waiting).map(([k, w]) => [k, w.e]))), dates: datesNow, removed });
  // What a catalog read after the page started changes: the packages of what is listed that the page does not have, which
  // are kept for the next start or the home screen (only the packages: a module's pictures are fetched when it is put in),
  // and which modules on the page it no longer lists, or lists again.
  function learn(cat, ms) {
    const list = listed(cat);
    for (const k of [...Object.keys(current), ...(AUTHORITATIVE ? Object.keys(SEED) : [])]) { if (!list[k] && present(k)) goneSoon[k] = true; else delete goneSoon[k]; }
    for (const k of Object.keys(waiting)) if (!list[k]) delete waiting[k];
    for (const k of Object.keys(removed)) { if (list[k] && seedHas(k, list[k])) backSoon[k] = true; else delete backSoon[k]; }
    return within(Promise.all(Object.entries(list).filter(([k, e]) => !seedHas(k, e) && !(current[k] && current[k].path === e.path) && !(waiting[k] && waiting[k].e.path === e.path))
      .map(([k, e]) => getJSON(base + e.path + 'package.json').then(pkg => hold(k, e, pkg)))), ms).then(r => { keepNext(); return r; });
  }
  const anyWaiting = () => Object.keys(waiting).length + Object.keys(goneSoon).length + Object.keys(backSoon).length > 0;

  // Every file of a revision put in is fetched once more, so a copy is kept for offline: the service worker keeps only
  // what passes through it (and a first visit fetched before it was in charge), and a picture the student has not yet
  // looked at would otherwise be missing offline. The pictures are fetched here with CORS, so the copy kept is a whole
  // response, not an opaque one; an <img> asking for the same address offline is given it. Inside the desktop app the
  // main process keeps each file it is asked for.
  function keepForOffline(put) {
    const urls = [];
    for (const [k, e] of Object.entries(put)) {
      const [c, f] = k.split('/'), course = CONTENT.courses[c], pkg = course && course.packages[f];
      if (!pkg) continue;
      urls.push(base + e.path + 'package.json');
      for (const a of pkg.module.assets || []) for (const x of ['file', 'still', 'captions']) if (typeof a[x] === 'string' && /^assets\/[^/]+$/.test(a[x].replace(/\\/g, '/'))) urls.push(base + e.path + a[x].replace(/\\/g, '/'));
      // the course's own files, kept beside the package it was made from
      if (course.assetBase === base + e.path + 'course/') for (const a of course.assets || []) for (const x of ['file', 'still', 'captions']) if (typeof a[x] === 'string' && /^assets\/[^/]+$/.test(a[x].replace(/\\/g, '/'))) urls.push(course.assetBase + a[x].replace(/\\/g, '/'));
    }
    if (!urls.length) return;
    const again = () => urls.forEach(u => fetch(u, { credentials: 'omit', mode: DESK ? 'same-origin' : 'cors' }).catch(() => { }));
    if (DESK) return again();
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.ready.then(() => { if (navigator.serviceWorker.controller) again(); else navigator.serviceWorker.addEventListener('controllerchange', again, { once: true }); }).catch(() => { });
  }
  const remember = (answered, seen) => write({ applied: answered ? Object.assign({}, current) : Object.assign({}, seen.applied, current), dates: datesNow, removed });

  const t0 = Date.now();
  window.LETTERMAN_READY = (async () => {
    const seen = read();
    const catalog = getCatalog();
    const cat = await within(catalog, budget);
    const answered = !!cat && cat !== LATE;
    lastAsk = Date.now();
    // the catalog answered in time: what it lists now; otherwise what this page last put in (offline included), unless
    // the app has since been released with a newer revision of it
    const listNow = answered ? listed(cat) : null;
    const list = answered ? listNow : Object.fromEntries(Object.entries(seen.applied).filter(([k, e]) => !SEED[k] || !(e.revision <= SEED[k].revision)));
    // a catalog that was read is the word on what is on the page: a module of the seed that it no longer lists is taken
    // off (and stays off, offline too, until it is listed again); one that cannot be read leaves the page as it was
    if (AUTHORITATIVE) for (const k of Object.keys(SEED)) if (answered ? !listNow[k] : seen.removed[k]) { if (unapply(k)) removed[k] = true; }
    const want = Object.fromEntries(Object.entries(list).filter(([k, e]) => !seedHas(k, e)));
    const tries = Object.entries(want).map(([k, e]) => { const t = { k, e, done: false, pkg: null }; t.p = getJSON(base + e.path + 'package.json').then(pkg => { t.done = true; t.pkg = pkg; return pkg; }); return t; });
    await within(Promise.all(tries.map(t => t.p)), Math.max(200, budget - (Date.now() - t0)));
    for (const t of tries) {
      if (t.done && apply(t.k, t.e, t.pkg)) { current[t.k] = t.e; delete removed[t.k]; continue; }
      // a package that did not come in time is put in at the next start or on the home screen; for now the page shows the
      // revision it had put in before, which it keeps a copy of
      if (!t.done) t.p.then(pkg => { hold(t.k, t.e, pkg); keepNext(); });
      const was = seen.applied[t.k];
      if (was && was.path !== t.e.path && await within(getJSON(base + was.path + 'package.json'), 400).then(p => p !== LATE && apply(t.k, was, p))) current[t.k] = was;
    }
    // a seed module listed again is back as it was built
    if (answered) for (const k of Object.keys(removed)) if (listNow[k] && seedHas(k, listNow[k]) && restoreSeed(k)) delete removed[k];
    // the live dates, by the same rule: the catalog's when it answered, else the last it gave (offline included)
    const dates = answered ? datesOf(cat) : (seen.dates || {});
    datesNow = dates;
    applyDates(dates);
    remember(answered, seen);
    for (const [k, e] of Object.entries(current)) paths[k] = e.path;
    keepForOffline(current);
    state = cat === LATE ? 'late' : answered ? 'answered' : 'unreachable';
    // a late catalog is kept for the next start: its packages are fetched now (not their pictures), so the next start
    // finds them kept and is not held up
    if (cat === LATE) inflight = catalog.then(late => late && learn(late, askMs)).catch(() => { }).then(() => { inflight = null; });
    window.LETTERMAN_PUBLISHED = {
      base, applied: paths, dates, catalog: state,
      // Asks the catalog again, if it has not been asked lately, and learns what is new, what is gone and what is back.
      // Settles with whether anything is waiting to be put in or taken off.
      refresh() {
        if (inflight) return inflight.then(anyWaiting);
        if (Date.now() - lastAsk < recheckMs) return Promise.resolve(anyWaiting());
        lastAsk = Date.now();
        inflight = getCatalog().then(c => c ? learn(c, askMs) : null).catch(() => { }).then(() => { inflight = null; });
        return inflight.then(anyWaiting);
      },
      // Puts what is waiting into the course, takes off what the catalog no longer lists, and says which modules changed:
      // [{ key, folder }]. Called by app.js on the home screen, where no step is open.
      take() {
        const put = {}, out = [], before = Object.keys(CONTENT.courses || {}).sort().join();
        for (const k of Object.keys(goneSoon)) {
          delete goneSoon[k];
          if (!unapply(k)) continue;
          delete current[k]; delete paths[k]; delete waiting[k];
          if (SEED[k]) removed[k] = true;
          out.push({ key: k, folder: k.split('/')[1] });
        }
        for (const k of Object.keys(backSoon)) { delete backSoon[k]; if (restoreSeed(k)) { delete removed[k]; out.push({ key: k, folder: k.split('/')[1] }); } }
        for (const [k, w] of Object.entries(waiting)) {
          delete waiting[k];
          if (!apply(k, w.e, w.pkg)) continue;
          current[k] = put[k] = w.e; paths[k] = w.e.path; delete removed[k]; out.push({ key: k, folder: k.split('/')[1] });
        }
        if (out.length) { remember(true, {}); keepForOffline(put); }
        // a course came or went: app.js draws the page again from the start (it takes only on a home screen)
        out.courses = Object.keys(CONTENT.courses || {}).sort().join() !== before;
        return out;
      }
    };
  })().catch(() => { });
})();
