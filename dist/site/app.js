// Letterman student portal. The look is "Letterman Library & Press" (the Director's name for it, 2026-10-09): round 3's
// entrant B, The Press ("B is the winner and is near-perfect"), in palette P2, Library. The course as a well-made book: a running head on every screen with four levels
// (Home, Course, Module, Step), a ribbon at the student's place in every contents page, chapter openers, the guide as
// commentary in the margin. One renderer for any package-v1 module: no line of this file names a module, a prompt
// id or a block id, and no colour is written here (every colour is a token in app.css).
(function () {
  'use strict';
  const CONTENT = window.LETTERMAN_CONTENT;
  const CFG = window.LETTERMAN_CONFIG || {};
  const { esc } = window.MD;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const slash = p => String(p || '').replace(/\\/g, '/');                 // r2 quirk: backslash paths
  const STAGE = /[?&]stage\b/.test(location.search);
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DARK_MQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : { matches: false, addEventListener() { } };
  if (STAGE) document.body.classList.add('stage');

  // ------------------------------------------------------------------ store (on this device only)
  const KEY = 'letterman:v1';
  let mem = { consent: null, name: '', modules: {} };
  try { const s = !STAGE && localStorage.getItem(KEY); if (s) mem = Object.assign(mem, JSON.parse(s)); } catch (e) { /* storage blocked: memory only */ }
  let askedPersist = false;
  // The account (account.js; M2-20, M2-28, M2-19). With no service configured, or a guest who never signs in, it
  // loads nothing and sends nothing of the student's. A signed-in student's work is carried to their account even
  // when this device keeps nothing (their yes to keeping their work is the account's own).
  let ACC = null, ENROL = null;
  // The live room (live.js; M2-22): the Live button while the teacher teaches. Never on the stage.
  let LIVE = null;
  let HI = null, DS = null;   // the hand-in inside the portal, and the class's conversation (M2-23); made at the end
  function persist() {
    if (STAGE) return;
    if (ACC) ACC.changed();
    if (mem.consent !== 'yes') return;
    // ask the browser to keep this data out of best-effort eviction (MDN, Storage quotas and eviction criteria)
    if (!askedPersist && navigator.storage && navigator.storage.persist) { askedPersist = true; navigator.storage.persist().catch(() => { }); }
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* full or blocked */ }
  }
  function ms(modId) { return mem.modules[modId] || (mem.modules[modId] = { answers: {}, visited: {}, readInline: {}, readFirst: false, last: 0, feedback: [] }); }
  function ans(modId, pid) { const m = ms(modId); return m.answers[pid] || (m.answers[pid] = { history: [], judged: {} }); }
  function anyProgress() { return Object.values(mem.modules).some(m => Object.keys(m.answers).length || Object.keys(m.visited).length); }
  const committedCount = () => Object.values(mem.modules).reduce((k, m) => k + Object.values(m.answers || {}).filter(a => a.committed).length, 0);
  // Appearance (Settings only: the Director, 2026-10-09, took the theme button out of the running head): the theme
  // matches the system unless the student picks one; text can be larger. The browser's own bar takes the page's
  // background token.
  function themeColor() {
    let m = $('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
    const v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (v) m.content = v;
  }
  function applyLook() {
    const l = mem.look || {}, r = document.documentElement;
    if (l.theme === 'light' || l.theme === 'dark') r.dataset.theme = l.theme; else delete r.dataset.theme;
    if (l.text === 'large') r.dataset.text = 'large'; else delete r.dataset.text;
    themeColor();
  }
  if (!STAGE) applyLook(); else themeColor();
  DARK_MQ.addEventListener('change', themeColor);

  // One status region that outlives every redraw, outside #app (index.html): what a result says is spoken from here.
  function announce(t) { const s = $('#lm-status'); if (!s) return; s.textContent = ''; setTimeout(() => { s.textContent = t; }, 60); }

  // ------------------------------------------------------------------ content model (model.js)
  const M = window.LMModel.create(CONTENT);
  const { courseKey, COURSE, glossary, buildModel, okLang, courseLang } = M;
  // Times (M1-26, the Director, 2026-10-02: "times displayed in the professor's time zone"): every time shows in the
  // teacher's time zone, with the student's own beside it (app/when.js). The zone is the course's (course.json
  // meta.time_zone) until the student is in a class, whose own zone then wins (zoneFromClass, once the account's classes
  // are known). A course with no zone, and no class, keeps the student's own clock, as before.
  let ZONE = null, WHEN = null;
  function setZone(z) {
    const want = window.LMWhen && window.LMWhen.valid(z) ? z : null;
    if (WHEN && want === ZONE) return false;
    ZONE = want;
    WHEN = window.LMWhen ? window.LMWhen.create(ZONE)
      : { zone: null, say: iso => ({ main: new Date(iso).toLocaleString(), local: null }), opensAt: d => new Date(d + 'T00:00:00').getTime(), opens: d => ({ main: new Date(d + 'T00:00:00').toLocaleDateString(), local: null }) };
    return true;
  }
  // Language (standard section 3): the page says the module's language, else the course's, else 'en' when neither says.
  // A passage, prompt or term that names another language carries its own lang. Letterman's own words are English, so
  // when the course is in another language the app's chrome is marked English and the course's text is marked as
  // the course's, and a screen reader switches voice at the line between them.
  let pageLang = courseLang;
  const sameLang = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const uiMarked = () => !/^en(-|$)/i.test(pageLang);
  const uiLang = () => uiMarked() ? ' lang="en"' : '';                                    // for the app's own words
  const cl = code => { const c = okLang(code); return (uiMarked() || (c && !sameLang(c, pageLang))) ? ` lang="${esc(c || pageLang)}"` : ''; };   // for the course's text
  const slideLang = (model, sl) => { const t = sl.targets && sl.targets[0]; return t != null && model.steps[t] ? model.steps[t].block.language : null; };   // a slide speaks the language of the block it shadows
  function setLang() {
    const parts = decodeURIComponent(location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
    const m = parts[0] === 'm' && parts[1] && COURSE.packages[parts[1]] ? buildModel(parts[1]) : null;
    pageLang = m ? m.lang : courseLang;
    document.documentElement.lang = pageLang;
  }
  setZone(COURSE.meta.time_zone);
  // The release cadence (the Director, 2026-10-02): a released module opens on its calendar date, at the start of that
  // day in the teacher's time zone (on the student's own clock where there is none). The stage window and a preview
  // build are never locked.
  const notYet = d => !!d && Date.now() < WHEN.opensAt(d);
  const LOCKED = {};
  function applyLocks() {
    if (STAGE || CONTENT.preview) return [];
    const moved = [];
    COURSE.modules.forEach(m => {
      if (!m.opens || !(m.folder || m.lockedFolder)) return;
      const shut = notYet(m.opens);
      if (shut && m.folder) { LOCKED[m.folder] = m.opens; m.lockedUntil = m.opens; m.lockedFolder = m.folder; delete m.folder; moved.push(m.lockedFolder); }
      else if (!shut && m.lockedFolder) { m.folder = m.lockedFolder; delete LOCKED[m.folder]; delete m.lockedUntil; delete m.lockedFolder; moved.push(m.folder); }
    });
    return moved;
  }
  applyLocks();
  // A page left open past a module's opening opens it without a reload: the time is checked each minute and whenever
  // the page comes back into view (a phone's timers sleep). Only the home page, the course page and a module whose lock
  // moved are redrawn, so nothing a student is in the middle of is disturbed.
  function recheckLocks() {
    const moved = applyLocks();
    if (!moved.length) return false;
    const parts = decodeURIComponent(location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!parts.length || parts[0] === 'course' || (parts[0] === 'm' && moved.includes(parts[1]))) route();
    return true;
  }
  if (COURSE.modules.some(m => m.opens)) { setInterval(recheckLocks, 60000); document.addEventListener('visibilitychange', () => { if (!document.hidden) recheckLocks(); }); }
  const dateOf = d => new Date(d + 'T00:00:00');
  // "Monday 2 March, 00:00 Los Angeles time" (only the date, where there is no zone)
  const opensLabel = d => WHEN.opens(d).main;
  // "Opens Monday 2 March, 00:00 Los Angeles time. That is 17:00 where you are."
  const opensFull = d => { const o = WHEN.opens(d); return `Opens ${o.main}.${o.local ? ' ' + o.local : ''}`; };
  const shortDate = d => dateOf(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

  // ------------------------------------------------------------------ progress (distance, not a score)
  function stepDone(model, st) {
    const m = ms(model.id);
    if (st.pids.length) return st.pids.every(pid => (m.answers[pid] || {}).committed);
    return !!m.visited[st.idx] || !!m.readInline[st.block.id];
  }
  function blockDone(model, b) { return b.steps.every(i => stepDone(model, model.steps[i])); }
  function resumeStep(model) {
    const m = ms(model.id);
    const first = model.steps.find(st => st.block.required && !stepDone(model, st));
    if (m.last && model.steps[m.last] && !stepDone(model, model.steps[m.last])) return m.last;
    return first ? first.idx : (m.last && model.steps[m.last] ? m.last : 0);
  }
  // Where "Continue" goes: the step the student left off at, if it is still open; if they finished it, the next open
  // step after it (required first); never back to the start of the module. Not started: step 1.
  function contStep(model) {
    const m = mem.modules[model.id];
    const here = m && m.visited && Object.keys(m.visited).length && model.steps[m.last] ? m.last : null;
    if (here == null) return 0;
    if (!stepDone(model, model.steps[here])) return here;
    const after = model.steps.filter(s => s.idx >= here && !stepDone(model, s));
    const t = after.find(s => s.block.required) || after[0] || model.steps.find(s => !stepDone(model, s));
    return t ? t.idx : here;
  }
  function skippable(model, st) { const m = ms(model.id); return !st.pids.length && m.readInline[st.block.id] && model.explained.has(st.block.id); }
  function nextIdx(model, i) { let j = i + 1; while (j < model.steps.length && skippable(model, model.steps[j])) j++; return j < model.steps.length ? j : null; }
  function prevIdx(model, i) { let j = i - 1; while (j >= 0 && skippable(model, model.steps[j])) j--; return j >= 0 ? j : null; }
  const started = model => { const m = mem.modules[model.id]; return !!m && (Object.keys(m.visited || {}).length > 0 || Object.keys(m.answers || {}).length > 0); };

  // the modules as the course lists them, each with whether it is open here
  const MODS = () => COURSE.modules.map((m, i) => Object.assign({}, m, { i, open: !!(m.folder && COURSE.packages[m.folder]) }));
  function currentModule() {
    const shown = COURSE.modules.filter(m => m.folder && COURSE.packages[m.folder]);
    const released = shown.filter(m => m.status === 'released');
    const pool = released.length ? released : shown;
    return pool[pool.length - 1];
  }
  const nextPlanned = () => COURSE.modules.find(m => !(m.folder && COURSE.packages[m.folder]) && (m.lockedUntil || m.opens) && notYet(m.lockedUntil || m.opens));

  // ------------------------------------------------------------------ the course's words, and the app's plain ones
  // The course's own words. Standard §3a meta gives title, description and language; the Academy is asked for `welcome`
  // (the home line) and `unit` (what the course calls one step of its calendar). Where the course has none yet, a plain
  // neutral word stands in: the app names no course.
  const courseShort = COURSE.meta.title.split(':')[0].trim();
  const courseSub = COURSE.meta.title.split(':').slice(1).join(':').trim();
  const UNIT = (COURSE.meta.unit || 'module').toLowerCase();
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const unitName = n => `${cap(UNIT)} ${n}`;
  const UNITS = UNIT.endsWith('s') ? UNIT : UNIT + 's';   // a plain plural; the standard has no word for an irregular one
  const modName = m => unitName(m.module);
  const mins = n => (Number.isFinite(+n) && +n > 0 ? +n : null);   // a module with no meta.minutes says nothing about its length
  const modLong = m => `${modName(m)}: ${m.title}`;
  const modLabel = model => model.meta.module === 0 ? unitName(0) : `${unitName(model.meta.module)} of ${model.meta.of}`;
  const modOf = model => ({ module: model.meta.module, title: model.meta.title });
  // a step's own title: its section heading, the heading a short lead-in joined, or its block's title
  const stepTitle = st => st.h2 || st.lead || st.block.title;
  // a page title no other step of the module shares ("..., 2 of 3", and the step's number if still the same)
  function docTitle(model, st) {
    if (!model._titles) {
      const base = model.steps.map(s => stepTitle(s) + (s.subOf ? `, ${s.sub} of ${s.subOf}` : ''));
      const n = {}; base.forEach(t => n[t] = (n[t] || 0) + 1);
      model._titles = base.map((t, i) => n[t] > 1 ? `${t} (step ${i + 1})` : t);
    }
    return model._titles[st.idx];
  }
  function counts(model) {
    let done = 0, open = 0, opt = 0;
    model.steps.forEach(s => { if (stepDone(model, s)) done++; else { open++; if (!s.block.required) opt++; } });
    return { done, open, opt, total: model.steps.length };
  }
  const countText = c => `${c.done} done, ${c.open} open` + (c.opt ? ` (${c.opt} optional)` : '');
  // A sentence from the course, ended once: a full stop is added only where it has none.
  const sentence = s => { const t = String(s || '').trim(); const u = t.charAt(0).toUpperCase() + t.slice(1); return /[.!?…:]["'”’)]?$/.test(u) ? u : u + '.'; };
  // A block's part, from the Course Package Standard's block kinds. Colour only: the Academy's titles name them.
  const PHASE = { overview: 'start', world: 'start', 'first-pass': 'try', lesson: 'learn', examples: 'learn', assignment: 'make', sitting: 'make', submit: 'make', 'self-check': 'back', 'second-pass': 'back', references: 'further' };
  const phaseOf = b => b.kind === 'resources' ? (b.required ? 'learn' : 'further') : (PHASE[b.kind] || 'learn');
  // each module a volume of the series, by position only (never by a course's name); the colours are tokens
  const seriesOf = i => `--series:var(--series-${((i % 9) + 9) % 9})`;
  const seriesOfModel = model => seriesOf(Math.max(0, COURSE.modules.findIndex(m => m.id === model.meta.id || m.folder === model.folder)));

  // ------------------------------------------------------------------ icons (decorative; every control has words)
  const sv = (d, w) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"${w ? ` width="${w}" height="${w}"` : ''}>${d}</svg>`;
  const I = {
    home: sv('<path d="M3.5 11 12 4.5l8.5 6.5V20H14.5v-5.5h-5V20H3.5z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'),
    toc: sv('<path d="M5 6.5h1.5M9.5 6.5H19M5 12h1.5M9.5 12H19M5 17.5h1.5M9.5 17.5H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
    left: sv('<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>', 20),
    right: sv('<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>', 20),
    close: sv('<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
    guide: sv('<path d="M4 5.5C6.5 4 9.5 4 12 6c2.5-2 5.5-2 8-.5V19c-2.5-1.5-5.5-1.5-8 .5-2.5-2-5.5-2-8-.5zM12 6v13.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'),
    check: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 8.4 6.6 11.4 12.5 4.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  const RIBBON = '<svg class="ribbon-svg" viewBox="0 0 14 26" aria-hidden="true" focusable="false"><path d="M0 0h14v26l-7-6.5L0 26z"/></svg>';
  // The endpaper (palette P2, "Library"): a reading-room shelf of cloth spines with gilt bands, standing on an oak edge.
  // It replaces B's marbling (which B's own designer named its weakest point) on the course title page, the module
  // opener and the download page. Its colours are the tokens --e*. Decorative only.
  function shelf(seed) {
    const cloth = ['var(--e1)', 'var(--e5)', 'var(--e2)', 'var(--e1)', 'var(--e4)', 'var(--e3)', 'var(--e1)', 'var(--e6)', 'var(--e5)', 'var(--e7)', 'var(--e2)', 'var(--e3)'];
    const W = [30, 38, 26, 34, 44, 28, 32, 24, 36];
    let x = -8, k = 0, b = '';
    while (x < 1210) {
      const w = W[(k * 4 + seed) % W.length], top = 12 + ((k * 7 + seed * 3) % 5) * 7, c = cloth[(k * 5 + seed) % cloth.length], iw = w - 3;
      b += `<rect x="${x}" y="${top}" width="${iw}" height="${150 - top}" fill="${c}"/>`;
      b += `<rect x="${x}" y="${top + 9}" width="${iw}" height="2" fill="var(--e-gilt)"/><rect x="${x}" y="${top + 14}" width="${iw}" height="1" fill="var(--e-gilt)"/>`;
      if ((k + seed) % 3 === 0) b += `<rect x="${x + 5}" y="${top + 28}" width="${iw - 10}" height="24" rx="1" fill="var(--e-label)" opacity=".9"/>`;
      b += `<rect x="${x}" y="130" width="${iw}" height="1" fill="var(--e-gilt)"/><rect x="${x}" y="134" width="${iw}" height="2" fill="var(--e-gilt)"/>`;
      x += w; k++;
    }
    return `<svg class="marble shelf" viewBox="0 0 1200 160" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false"><rect width="1200" height="160" fill="var(--e0)"/>${b}<rect y="150" width="1200" height="10" fill="var(--e-shelf)"/><rect y="150" width="1200" height="1.5" fill="var(--e-gilt)" opacity=".55"/></svg>`;
  }
  // The course's own cover art on the shelf card: B's marbled volume, kept exactly as B drew it (tokens --m0 to --m6,
  // its filter #lm-marble in index.html), on B's own series colour for that volume (tokens --cover-N).
  function marble(seed) {
    const cols = ['var(--m1)', 'var(--m2)', 'var(--m3)', 'var(--m4)', 'var(--m5)', 'var(--m2)', 'var(--m6)', 'var(--m1)', 'var(--m3)'];
    let bands = '';
    for (let k = 0; k < 64; k++) bands += `<rect x="${k * 14 - 30}" y="-60" width="${[5, 9, 4, 11, 7][(k * 3 + seed) % 5]}" height="300" fill="${cols[(k * 5 + seed) % cols.length]}"/>`;
    return `<svg class="marble" viewBox="0 0 820 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><rect width="820" height="160" fill="var(--m0)"/><g filter="url(#lm-marble)" transform="rotate(${seed % 2 ? 8 : -6} 410 80)">${bands}</g></svg>`;
  }
  const coverOf = i => `--series:var(--cover-${((i % 9) + 9) % 9})`;

  // ------------------------------------------------------------------ rendering helpers
  function figureHTML(model, id, alt) {
    const a = model.assets[id];
    if (!a) return `<p class="muted">[missing visual: ${esc(id)}]</p>`;
    let src;
    if (a.file) src = assetUrl(model, a.file, a);
    else if (a.url) {
      // r2 quirk: a Wikimedia "File:" page, not the image. Special:FilePath serves the image itself.
      const m = a.url.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/);
      src = m ? `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1].replace(/^File:/, '')}?width=900` : a.url;
    }
    const kind = a.kind === 'diagram' ? 'Made for the course.' : a.kind === 'work' ? 'Real work.' : '';
    const credit = a.kind === 'work'
      ? `${esc(a.credit)} <a href="${esc(a.source_url || a.url)}" target="_blank" rel="noopener">Source<span class="sr-only"> (opens a new tab)</span></a>`
      : esc(a.credit || '');
    // The course's own description of the picture comes first (standard §4: assets[].alt wins; the text's own alt is the
    // Notepad fallback). A work that moves is shown as its still until the student plays it (WCAG 2.2.2); sound and video
    // carry the course's captions (WCAG 1.2.2). Nothing starts by itself.
    const desc = a.alt || alt || '';
    const media = mediaKind(a);
    const missing = `onerror="var d=document.createElement('span');d.className='img-missing';d.textContent=this.alt+' (the image needs a connection)';this.replaceWith(d)"`;
    let inner, extra = '';
    if (media === 'video' || media === 'audio') {
      const tag = media === 'video' ? 'video' : 'audio';
      const still = media === 'video' && a.still ? ` poster="${esc(assetUrl(model, a.still, a))}"` : '';
      const track = a.captions ? `<track kind="captions" src="${esc(assetUrl(model, a.captions, a))}" srclang="${esc(okLang(a.language) || model.lang)}" label="Captions" default>` : '';
      inner = `<${tag} controls preload="${media === 'video' && !a.still && !REDUCED ? 'metadata' : 'none'}"${media === 'video' ? ' playsinline' : ''}${still} aria-label="${esc(desc)}"${cl(a.language)}><source src="${esc(src)}"${a.media_type ? ` type="${esc(a.media_type)}"` : ''}>${track}<a href="${esc(src)}">Open the ${media} file</a></${tag}>`;
      // a browser draws captions over video; for sound the captions are read below the player
      if (media === 'audio' && a.captions) extra = `<details class="captions" data-vtt="${esc(assetUrl(model, a.captions, a))}"><summary>Captions</summary><div class="cues" aria-live="polite"></div></details>`;
    } else if (media === 'moving') {
      const still = a.still ? assetUrl(model, a.still, a) : '';
      // held until played whenever the course gives a still; with no still, held only for a reader who asked for less motion
      const held = !!still || REDUCED;
      inner = `<img class="moving"${held ? (still ? ` src="${esc(still)}"` : '') : ` src="${esc(src)}"`} data-still="${esc(still)}" data-moving="${esc(src)}" alt="${esc(desc)}" loading="lazy" ${missing}>`;
      if (held) extra = `<button type="button" class="btn small quiet play-moving" data-on=""><span>Play the moving picture</span><span class="sr-only">: ${esc(a.title || id)}</span></button>`;
    } else {
      inner = `<img src="${esc(src)}" alt="${esc(desc)}" loading="lazy" ${missing}>`;
    }
    return `<figure class="plate ${esc(a.kind || '')}"><span class="frame">${inner}</span>${extra}<figcaption><span class="kind">${kind}</span>${credit}</figcaption></figure>`;
  }
  const assetUrl = (model, rel, a) => a && a.course ? `content/${courseKey}/${slash(rel)}` : `content/${courseKey}/${model.folder}/${slash(rel)}`;   // a course-level asset's files are beside the course
  // what an asset is, by what the course says it is: video and sound by media_type, a moving picture by a gif or apng
  // media_type or by carrying a still (standard §6a: a work that moves carries one)
  function mediaKind(a) {
    const t = String(a.media_type || '').toLowerCase(), f = String(a.file || '').toLowerCase();
    if (/^video\//.test(t) || /\.(webm|mp4|ogv|mov)$/.test(f)) return 'video';
    if (/^audio\//.test(t) || /\.(mp3|ogg|oga|wav|m4a|opus)$/.test(f)) return 'audio';
    if (/^image\/(gif|apng)$/.test(t) || /\.(gif|apng)$/.test(f) || (a.still && (!t || /^image\//.test(t)))) return 'moving';
    return 'image';
  }
  // the play and stop button of a moving picture, and the captions of a sound, are opened by the student and by no one else
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button.play-moving'); if (!b) return;
    const img = b.parentElement.querySelector('img.moving'); if (!img) return;
    const on = !b.dataset.on;
    if (on) img.src = img.dataset.moving; else if (img.dataset.still) img.src = img.dataset.still; else img.removeAttribute('src');
    b.dataset.on = on ? '1' : '';
    b.firstElementChild.textContent = on ? 'Stop and show the still picture' : 'Play the moving picture';
  });
  document.addEventListener('toggle', e => {
    const d = e.target; if (!d.classList || !d.classList.contains('captions') || !d.open || d.dataset.loaded) return;
    d.dataset.loaded = '1';
    const out = d.querySelector('.cues'), x = new XMLHttpRequest();
    x.open('GET', d.dataset.vtt);
    x.onload = () => { out.innerHTML = vttHTML(x.responseText) || '<p class="muted">There are no captions to show.</p>'; };
    x.onerror = () => { d.dataset.loaded = ''; out.innerHTML = '<p class="muted">The captions need a connection.</p>'; };
    x.send();
  }, true);
  // WebVTT to plain lines: the header, notes, cue numbers, times and styling tags are left out
  function vttHTML(t) {
    return String(t).replace(/\r\n?/g, '\n').split(/\n{2,}/).map(block => {
      const ls = block.split('\n').filter(l => l.trim());
      if (!ls.length || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(ls[0])) return '';
      const at = ls.findIndex(l => /-->/.test(l));
      return at < 0 ? '' : ls.slice(at + 1).map(l => l.replace(/<[^>]*>/g, '').trim()).filter(Boolean).join(' ');
    }).filter(Boolean).map(l => `<p>${esc(l)}</p>`).join('');
  }
  function linkHTML(model, id, text) {
    const a = model.assets[id];
    if (!a) return esc(text);
    return `<a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.credit || '')}">${text}<span class="sr-only"> (opens a new tab)</span></a>`;
  }
  // opts.top: the level of the heading this text sits under (its own headings start one below and never skip one);
  // opts.dropH1: the page carries its own h1; opts.drop: headings the page already shows as its title.
  function renderMD(model, md, opts = {}) {
    const top = opts.top == null ? 1 : opts.top;
    let last = top;
    const drop = (opts.drop || []).filter(Boolean).map(s => String(s).trim());
    const ctx = {
      figure: (id, alt) => figureHTML(model, id, alt),
      link: (id, t) => linkHTML(model, id, t),
      prompt: id => opts.noPrompts ? '' : `<div class="prompt" data-prompt="${esc(id)}"></div>`,
      microscope: id => opts.inMicroscope ? '' : microscopeHTML(model, id, Math.max(top, 1) + 1),
      term: (id, t) => termHTML(id, t),
      heading: (lvl, raw, html) => {
        if (opts.dropH1 && lvl === 1) return '';
        if (drop.includes(String(raw).trim())) return '';
        const l = Math.min(6, Math.max(top + 1, Math.min(lvl + (opts.shift || 0), last + 1)));
        last = l;
        return `<h${l}${l === 2 && opts.sub ? ' class="sub-h"' : ''}>${html}</h${l}>`;
      }
    };
    return window.MD.render(md, ctx);
  }
  // "Under a microscope" (standard 1.3.0, §4c): a closed fold in the marker's place. It never opens by itself,
  // Escape or Close shuts it and returns focus to its button, and opening it is never saved or scored.
  function microscopeHTML(model, id, top) {
    const x = model.microscopes && model.microscopes[id];
    if (!x || !x.md) return '';
    const src = (x.cites || []).map(cid => {
      const a = model.assets[cid];
      if (!a) return '';
      const href = a.kind === 'work' ? (a.source_url || a.url) : a.url;
      const name = a.kind === 'work' ? esc(a.credit || a.title || cid) : esc(a.title || a.credit || cid);
      return href ? `<li><a href="${esc(href)}" target="_blank" rel="noopener">${name}<span class="sr-only"> (opens a new tab)</span></a></li>` : `<li>${name}</li>`;
    }).filter(Boolean).join('');
    return `<details class="microscope"${cl(x.language)}><summary><span class="mc-label">Under a microscope<span class="sr-only">:</span></span> <span class="mc-title">${esc(x.title)}</span></summary>` +
      `<div class="mc-body" role="region" aria-label="${esc(x.title)}">${renderMD(model, x.md, { noPrompts: true, inMicroscope: true, top: top || 2, dropH1: true })}` +
      (src ? `<p class="mc-src-h">Sources</p><ul class="mc-sources">${src}</ul>` : '') +
      `<p><button type="button" class="linkish mc-close">Close<span class="sr-only">: ${esc(x.title)}</span></button></p></div></details>`;
  }
  // A glossary term: the word is a button; tapping it shows the course's definition right after it.
  function termHTML(id, t) {
    const g = glossary[id];
    if (!g) return t;
    return `<button type="button" class="term" aria-expanded="false" data-term="${esc(id)}"${cl(g.language)}>${t}</button><span class="term-def" hidden${cl()}><strong>${esc(g.term || '')}${g.term ? ':' : ''}</strong> ${esc(g.definition)}</span>`;
  }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button.term'); if (!b) return; const d = b.nextElementSibling; const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); if (d) d.hidden = !open; });
  function closeMicroscope(d) { if (!d) return; d.open = false; const s = d.querySelector('summary'); if (s) s.focus(); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const d = document.activeElement && document.activeElement.closest && document.activeElement.closest('details.microscope[open]'); if (d) { e.preventDefault(); closeMicroscope(d); } } });
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.mc-close'); if (b) closeMicroscope(b.closest('details.microscope')); });
  function blockMD(block) { return (block.md || '').replace(/<!--[\s\S]*?-->/g, ''); }
  // the first paragraph of a block, as plain inline text (no figures, no prompts)
  function leadOf(b) {
    const lines = String(b.md || '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
    const para = []; let on = false;
    for (const l of lines) {
      if (/^#/.test(l)) { if (on) break; continue; }
      if (!l.trim()) { if (on) break; continue; }
      if (/^(\{\{|!\[|\||>|\s*[-*]\s|\s*\d+\.\s)/.test(l)) { if (on) break; continue; }
      on = true; para.push(l.trim());
    }
    return window.MD.inline(para.join(' '), { figure: () => '', link: (id, t) => t, term: (id, t) => t });
  }

  // ------------------------------------------------------------------ router
  const app = $('#app');
  function go(h) { if (location.hash === h) route(); else location.hash = h; }
  window.addEventListener('hashchange', route);
  // The skip link moves focus into the page and never routes: "#main" is not an address of the app.
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a.skip'); if (!a) return;
    e.preventDefault(); const m = $('#main'); if (m) { m.setAttribute('tabindex', '-1'); m.focus(); }
  });
  // the progress strip in the running head: a pointer can go straight to a step (the keyboard has the contents)
  document.addEventListener('click', e => { const g = e.target.closest && e.target.closest('.strip [data-go]'); if (g) go(g.dataset.go); });

  function route() { setLang(); closeAcctMenu(); routeInner(); placeNet(); askConsent(); measureBars(); if ($('[data-mplace], [data-mrow]')) loadMeasures(); }
  function routeInner() {
    stopPlayers();
    const h = decodeURIComponent(location.hash || '#/');
    if (h.startsWith('#fb=')) return importFeedback(h.slice(4));
    const parts = h.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!parts.length) return viewHome();
    if (parts[0] === 'course') return viewCourse();
    if (parts[0] === 'm' && parts[1] && LOCKED[parts[1]]) return viewHome();
    if (parts[0] === 'm' && parts[1]) {
      const model = buildModel(parts[1]);
      if (!model) return viewHome();
      if (parts[2] === 'guide') return viewGuide(model, +parts[3] || 0, parts[4]);
      if (parts[2] === 'talk' && DS) return DS.viewTalk(model);
      if (parts[2] !== undefined) return viewStep(model, Math.max(0, Math.min(model.steps.length - 1, +parts[2] || 0)));
      return viewModule(model);
    }
    if (parts[0] === 'heard') viewHeard();
    else if (parts[0] === 'settings' || parts[0] === 'data') viewSettings();   // #/data: the pane's earlier address
    else if (parts[0] === 'teach') viewTeach();
    else if ((parts[0] === 'classes' || parts[0] === 'join') && ENROL) ENROL.view(parts);   // enrol.js (M2-21)
    else viewHome();
  }
  // "Letterman 0.1.2 alpha": the number, and the stage as a word beside it (app/version.js)
  function versionLine() { const v = window.LETTERMAN_VERSION || {}; return v.version ? `Letterman ${v.version}${v.stage ? ' ' + v.stage : ''}` : 'Letterman'; }
  // the stage keeps one title, so a capture that matches the window by its title keeps finding it
  function setTitle(t) { document.title = STAGE ? 'Letterman stage' : t ? `${t} · Letterman` : 'Letterman'; }
  // After every screen change, focus is on the new screen's one h1 (or the page itself). A stage is a screen to look
  // at, never one to type into: it takes no focus, so the console keeps the keyboard and the class sees no ring.
  function focusMain() {
    const h = $('#main h1') || $('#main');
    if (h && !STAGE) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  }
  // A focused control is never hidden under the sticky running head or the page-turn bar: the browser keeps it clear
  // of both, measured each time either changes (scroll-padding in app.css reads these two).
  function measureBars() {
    const r = document.documentElement;
    const hb = $('.head'), tr = $('.travel') || $('.deck .ctrl');
    const trSticky = tr && /sticky|fixed/.test(getComputedStyle(tr).position);
    r.style.setProperty('--headH', (hb ? Math.ceil(hb.getBoundingClientRect().height) : 0) + 'px');
    r.style.setProperty('--footH', (trSticky ? Math.ceil(tr.getBoundingClientRect().height) : 0) + 'px');
  }
  window.addEventListener('resize', () => { measureBars(); maybeRelayout(); });

  // ------------------------------------------------------------------ THE RUNNING HEAD (Charter law: every student screen says where you are)
  // On every screen, at every width: four levels, each remembering where the student was below it (Home with the
  // student's name; the course; the module; the step, "n of N"), what is done and open, and the strip of every step
  // grouped by section with the ribbon at the student's place. A listener hears the step line and then the count.
  let lastHeader = null;
  function contextModel() {
    const f = mem.lastFolder && COURSE.packages[mem.lastFolder] && !LOCKED[mem.lastFolder] ? mem.lastFolder : (currentModule() || {}).folder;
    return f ? buildModel(f) : null;
  }
  function lastStep(model) { const m = model && mem.modules[model.id]; return m && m.visited && Object.keys(m.visited).length && model.steps[m.last] ? m.last : null; }
  function returnTo(model) { const l = lastStep(model); return model ? `#/m/${model.folder}${l != null ? '/' + l : ''}` : '#/'; }
  // the student's display name: the account's when signed in, else the name they gave on this device, else none
  function whoName() { return ACC && ACC.state === 'member' ? ACC.name : (mem.name || ''); }
  function stripHTML(model, here) {
    return `<div class="strip" aria-hidden="true">` + model.blocks.map(b => `<span class="sig ph-${phaseOf(b)}${b.required ? '' : ' opt'}" style="flex:${b.steps.length} 1 0">` +
      b.steps.map(i => `<i data-go="#/m/${model.folder}/${i}" title="Step ${i + 1}: ${esc(stepTitle(model.steps[i]))}" class="${stepDone(model, model.steps[i]) ? 'done' : 'open'}${i === here ? ' here' : ''}">${i === here ? RIBBON : ''}</i>`).join('') + `</span>`).join('') + `</div>`;
  }
  function refreshAnchor() {
    const hb = $('.head'); if (hb && lastHeader) { const f = document.activeElement && hb.contains(document.activeElement) ? document.activeElement.getAttribute('data-head') || document.activeElement.getAttribute('data-level') : null; hb.outerHTML = header(lastHeader); if (f) { const n = $(`.head [data-head="${f}"], .head [data-level="${f}"]`); if (n) n.focus(); } }
    const r = $('.rail .toc'); if (r && lastRail) r.outerHTML = contentsHTML(lastRail.model, 'rail', lastRail.idx, true);
    measureBars();
  }
  function header(args) {
    lastHeader = args;
    const { model, idx, level } = args;
    const lv = level || 'other';
    const who = whoName();
    if (!model) {
      return `<header class="appbar anchor head" role="banner"${uiLang()}><div class="head-row">
        <div class="brand" aria-hidden="true"><img src="icon.svg" alt="" width="38" height="38"><span><b>Letterman</b><small>Heirloom Estate Academy</small></span></div>
        <nav class="spine" aria-label="Where you are"><ol><li class="sg-home"><a class="seg${lv === 'home' ? ' on' : ''}" data-level="home" href="#/" aria-label="Home${who ? ', ' + esc(who) : ''}"${lv === 'home' ? ' aria-current="page"' : ''}><span class="ic" aria-hidden="true">${I.home}</span><span class="k" aria-hidden="true">Home</span><span class="v" aria-hidden="true">${esc(who || 'Guest')}</span></a></li></ol></nav>
        <span class="grow"></span>${LIVE ? LIVE.barHTML() : ''}${acctHTML()}</div></header>`;
    }
    const c = counts(model);
    const here = idx != null ? idx : (lastStep(model) != null ? lastStep(model) : resumeStep(model));
    const st = model.steps[here];
    const atStep = lv === 'step';
    const mo = modOf(model);
    const stepLine = atStep ? `Step ${here + 1} of ${c.total}: ${stepTitle(st)}` : started(model) ? `Continue at step ${here + 1} of ${c.total}: ${stepTitle(st)}` : `Step ${here + 1} of ${c.total}, not started: ${stepTitle(st)}`;
    // the crumbs already say course, module and "n of N": the whereabouts names only what they cannot, the title
    const w1 = lv === 'module' ? mo.title : stepTitle(st);
    const seg = (key, k, v, href, label, extra = '') => `<li class="sg-${key}"><a class="seg${lv === key ? ' on' : ''}" data-level="${key}" href="${href}" aria-label="${esc(label)}"${lv === key ? ` aria-current="${key === 'step' ? 'step' : 'page'}"` : ''}>${extra}<span class="k" aria-hidden="true">${k}</span><span class="v" aria-hidden="true">${v}</span></a></li>`;
    // the count is heard straight after the step line: one phrase, no paragraph or other node between them
    const hic = HI ? HI.countLine() : '';   // "hand-in 1 of 8" (M2-23)
    const tally = `<span class="tally anc-count"><span class="sr-only">${c.done} done, ${c.open} open${c.opt ? `, ${c.opt} of them optional` : ''}${hic ? `, ${esc(hic)}` : ''}</span><span aria-hidden="true"><b>${c.done}</b> done<span class="dot"> · </span><b>${c.open}</b> open${c.opt ? ` <span class="optn">(${c.opt} optional)</span>` : ''}${hic ? `<span class="hi-count"><span class="dot"> · </span>${esc(hic)}</span>` : ''}</span></span>`;
    return `<header class="appbar anchor head" role="banner"${uiLang()} style="${seriesOfModel(model)}">
      <div class="head-row">
        <div class="brand" aria-hidden="true"><img src="icon.svg" alt="" width="38" height="38"><span><b>Letterman</b><small>Heirloom Estate Academy</small></span></div>
        <nav class="spine" aria-label="Where you are"><ol>
          ${seg('home', 'Home', esc(who || 'Guest'), '#/', `Home, ${who || 'guest'}`, `<span class="ic" aria-hidden="true">${I.home}</span>`)}
          ${seg('course', 'Course', esc(courseShort), '#/course', `Course: ${courseShort}, ${modLong(mo)}`, `<span class="nw" aria-hidden="true"><span class="nw0">${esc(courseShort)}${mo.module === 0 ? '' : ', ' + esc(modName(mo))}</span><span class="nw1">${esc(mo.title)}</span></span>`)}
          ${seg('module', esc(cap(UNIT)), esc(modName(mo)), `#/m/${model.folder}`, `${cap(UNIT)}: ${modName(mo)}, its contents`, `<span class="ic" aria-hidden="true">${I.toc}</span>`)}
          ${seg('step', 'Step', `${here + 1} of ${c.total}`, `#/m/${model.folder}/${here}`, stepLine, `<span class="nw" aria-hidden="true">${atStep ? 'Step' : started(model) ? 'Continue at step' : 'Step'} ${here + 1} of ${c.total}</span>`)}
        </ol></nav>
        <div class="whereabouts" aria-hidden="true"><p class="w0">${esc(courseShort)}, ${esc(modLong(mo))}</p><p class="w1">${esc(w1)}</p></div>
        ${STAGE ? '' : tally}
        <span class="livechip">Live<span class="sr-only">: the teacher's shared screen</span></span>
        ${LIVE ? LIVE.barHTML() : ''}
        ${acctHTML()}
      </div>
      ${stripHTML(model, here)}
    </header>`;
  }
  // The account button (the Designer's app bar): it holds the display name, Settings and your data, and sign-in.
  // Never on the stage: the class must not see the teacher's account. The account id is never on the page.
  const PERSON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  function acctHTML() {
    if (STAGE || !ACC) return '';
    const st = ACC.state, member = st === 'member';
    const who = member ? ACC.name : (mem.name && !ACC.configured ? mem.name : 'Guest');
    const label = st === 'needs-yes' ? 'Finish joining' : st === 'starting' ? 'Signing in' : who;
    const line = member ? 'Signed in' : st === 'needs-yes' ? 'Signed in, nothing kept yet' : ACC.configured ? 'Not signed in' : 'On this device';
    // data-state: what the desktop app's menu reads (Sign in or Sign out); "off" when there is no service to sign in to
    return `<div class="acct-wrap" data-state="${ACC.configured ? st : 'off'}"><button type="button" class="iconbtn acct" aria-expanded="false" aria-controls="acct-menu" aria-label="Account: ${esc(label)}">${PERSON}<span class="acct-name">${esc(label)}</span></button>
      <div class="acct-menu" id="acct-menu" hidden>
        <p class="acct-who"><b>${esc(who)}</b><span>${esc(line)}</span></p>
        <a href="#/settings">Settings and your data</a>
        ${ACC.configured ? `<a href="#/classes">Classes</a>` : ''}
        ${member && ACC.teacher ? `<a href="#/teach">Teaching</a>` : ''}
        <a href="privacy.html">Your privacy</a>
        ${!ACC.configured ? '' : st === 'needs-yes' ? `<button type="button" data-acct="finish">Finish joining</button>` : member ? `<button type="button" data-acct="signout">Sign out</button>` : st === 'guest' ? `<button type="button" data-acct="signin">Sign in</button>` : ''}
      </div></div>`;
  }
  function closeAcctMenu(focusBtn) {
    const m = $('#acct-menu'), b = $('.acct');
    if (m && !m.hidden) { m.hidden = true; if (b) { b.setAttribute('aria-expanded', 'false'); if (focusBtn) b.focus(); } }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.acct');
    if (b) { const m = $('#acct-menu'); const open = m.hidden; m.hidden = !open; b.setAttribute('aria-expanded', String(open)); if (open) { const f = m.querySelector('a, button'); if (f) f.focus(); } return; }
    const a = e.target.closest && e.target.closest('[data-acct]');
    if (a) { closeAcctMenu(); const k = a.dataset.acct; if (k === 'signin') ACC.signIn(); if (k === 'finish') ACC.finishJoining(); if (k === 'signout') ACC.signOut().then(() => route()); return; }
    if (!(e.target.closest && e.target.closest('.acct-wrap'))) closeAcctMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#acct-menu') && !$('#acct-menu').hidden) { e.preventDefault(); closeAcctMenu(true); } });
  // Once, under the running head, never per section: offline, or the class service not answering.
  function placeNet() {
    const old = $('.netnote'); if (old) old.remove();
    if (STAGE || !ACC) return;
    const t = navigator.onLine === false ? ACC.words.offline : ACC.problem === 'unreachable' ? ACC.words.unreachable : '';
    if (!t) return;
    const p = document.createElement('p'); p.className = 'netnote'; p.setAttribute('role', 'status'); p.textContent = t;
    const hb = $('.head'); if (hb) hb.insertAdjacentElement('afterend', p); else app.prepend(p);
  }
  window.addEventListener('online', placeNet); window.addEventListener('offline', placeNet);
  // The account changed (signed in or out, a name, the service answering or not): the running head and the line under
  // it follow at once; a whole screen is redrawn only where nothing is being typed.
  function accountChanged() {
    if ($('.head') && lastHeader) refreshAnchor(); else { const w = $('.acct-wrap'); if (w) w.outerHTML = acctHTML(); }
    placeNet();
    if (LIVE) LIVE.accountChanged();
    const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    const h = decodeURIComponent(location.hash || '#/');
    if (!typing && !$('.sheet-bg') && /^#\/?(settings|data|teach|classes|join\/[\w-]+)?$/.test(h)) { routeInner(); placeNet(); measureBars(); }
    if (/^#\/?$/.test(h)) loadListings();
    // signed in or out: the values shown are this account's or none, and a self-check says where it will be kept
    if ($('[data-mplace], [data-mrow]')) loadMeasures(true).then(paintMeasures);
    if (ENROL) ENROL.accountChanged();   // enrol.js (M2-21): a join a guest started goes on after their sign-in
    if (HI) HI.refresh().then(ch => { if (zoneFromClass() || ch) redrawSoft(); });
  }
  // A student in a class sees the class's own time zone, which its teacher set; signed out, the course's again (M1-26).
  function zoneFromClass() {
    const k = HI && HI.classes && HI.classes[0];
    if (!setZone((k && k.time_zone) || COURSE.meta.time_zone)) return false;
    recheckLocks();
    return true;
  }
  // The account's hand-ins and replies arrived (M2-23): the screens that show them are drawn again, where nothing is
  // being typed and no sheet is open, at the same place on the page.
  function redrawSoft() {
    const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (typing || $('.sheet-bg') || STAGE) return;
    const h = decodeURIComponent(location.hash || '#/');
    if (/^#\/?(heard|course)?$/.test(h) || /^#\/m\/[^/]+\/?$/.test(h) || ($('.handin') && /^#\/m\/[^/]+\/\d+$/.test(h))) { const y = window.scrollY; routeInner(); placeNet(); measureBars(); window.scrollTo(0, y); }
    else refreshAnchor();
  }

  // ------------------------------------------------------------------ the contents, with leaders and folios (B's table of contents, at three sizes)
  let lastRail = null;
  function contentsHTML(model, mode, here, live) {
    const f = model.folder, onStep = mode === 'rail' && live;
    const mark = (i, opt) => i === here ? `<span class="mk here">${RIBBON}</span>` : `<span class="mk ${stepDone(model, model.steps[i]) ? 'done' : 'open'}${opt ? ' opt' : ''}">${stepDone(model, model.steps[i]) ? I.check : ''}</span>`;
    const state = i => i === here ? (onStep ? ' You are here.' : ' Your place.') : (stepDone(model, model.steps[i]) ? ' Done.' : ' Open.');
    return `<ol class="toc toc-${mode}">` + model.blocks.map((b, bi) => {
      const single = b.steps.length === 1 && stepTitle(model.steps[b.steps[0]]) === b.title;
      const ph = phaseOf(b), opt = !b.required;
      const meta = `${b.minutes ? `<span class="mins">${b.minutes} min</span>` : ''}${opt ? '<span class="optl">optional</span>' : ''}`;
      const link = (i, label, solo) => `<a class="ts${i === here ? ' here' : ''}${stepDone(model, model.steps[i]) ? ' done' : ''}${solo ? ' solo' : ''}" href="#/m/${f}/${i}"${i === here && onStep ? ' aria-current="step"' : ''}>${mark(i, opt)}<span class="tt">${label}<span class="sr-only">.${state(i)}${opt ? ' Optional.' : ''}</span></span><span class="leader" aria-hidden="true"></span><span class="folio" aria-hidden="true">${i + 1}</span></a>`;
      if (single) return `<li class="sec ph-${ph}${opt ? ' opt' : ''}"><span class="sec-n" aria-hidden="true">§${bi + 1}</span>${link(b.steps[0], esc(b.title), true)}${mode === 'full' && meta ? `<p class="sec-meta">${meta}</p>` : ''}</li>`;
      return `<li class="sec ph-${ph}${opt ? ' opt' : ''}"><span class="sec-n" aria-hidden="true">§${bi + 1}</span><p class="sec-t">${esc(b.title)}${mode === 'full' ? ` ${meta}` : ''}</p><ol>` +
        b.steps.map(i => `<li>${link(i, esc(stepTitle(model.steps[i])))}</li>`).join('') + `</ol></li>`;
    }).join('') + `</ol>`;
  }
  // the neighbouring modules, as the course lists them
  function neighbours(model) {
    const L = MODS(), i = L.findIndex(m => m.folder === model.folder || m.id === model.meta.id);
    let prev = null; for (let k = i - 1; k >= 0; k--) if (L[k].open) { prev = L[k]; break; }
    return { prev, next: i >= 0 ? L[i + 1] || null : null };
  }

  // ------------------------------------------------------------------ M2-24: the classes, the announcements, the module's own words
  // What the service gives (the enrolments and open_classes() data): each section shows only what came back, and is
  // absent, never a placeholder, when nothing did. A guest reads the public listings only; nothing of theirs is sent.
  let LISTINGS = null, listingsAsked = 0;
  function loadListings() {
    if (STAGE || !ACC || !ACC.configured || !ACC.listings) return;
    const ask = ++listingsAsked;
    ACC.listings(courseKey).then(r => { if (ask !== listingsAsked || !r) return; LISTINGS = r; if (/^#\/?$/.test(decodeURIComponent(location.hash || '#/'))) drawService(); }).catch(() => { });
  }
  // "Got it" is kept against the class and the time the words last changed (the time written when never edited), so a
  // student who put an announcement away sees the teacher's edited text once more (the Manager's decision, M2-24).
  const editedAt = n => (n.changed_at && new Date(n.changed_at) > new Date(n.written_at)) ? n.changed_at : n.written_at;
  const seenKey = n => `${n.class_id}|${editedAt(n)}`;
  function noticesFor() {
    if (!LISTINGS) return [];
    const seen = mem.seen || {};
    return (LISTINGS.notices || []).map(c => ({ cls: c, note: (c.notes || []).find(n => !seen[seenKey(n)]) })).filter(x => x.note);
  }
  // The day an announcement was written, said in the teacher's time zone (the class's), as the Designer's card does:
  // "Wednesday 14 October". A zone the browser does not know falls back to the reader's own.
  function noteDay(at, tz) {
    const f = z => new Intl.DateTimeFormat('en-GB', Object.assign({ weekday: 'long', day: 'numeric', month: 'long' }, z ? { timeZone: z } : {})).format(at);
    try { return f(tz); } catch (e) { return f(null); }
  }
  // The card, as the Designer wrote it: "From {teacher display name} · {date, teacher's time zone}", the text, an
  // optional link, and "Edited" if the teacher changed it.
  function noticeHTML(x) {
    const n = x.note, long = n.body.length > 260;
    const when = new Date(n.written_at);
    const edited = !!n.changed_at && new Date(n.changed_at) > when;
    const link = typeof n.link === 'string' && /^https:\/\/[^\s]+$/.test(n.link) ? n.link : '';
    const id = 'an-' + String(x.cls.class_id).replace(/[^\w-]/g, '').slice(0, 12) + '-' + when.getTime();
    return `<section class="card notice" aria-labelledby="${id}" data-seen="${esc(seenKey(n))}">
      <h2 class="kicker" id="${id}">From ${esc(x.cls.teacher || 'your teacher')}<span aria-hidden="true"> · </span><span class="sr-only">, </span><span class="n-day">${esc(noteDay(when, x.cls.time_zone))}</span>${edited ? `<span aria-hidden="true"> · </span><span class="sr-only">, </span><span class="n-edited">Edited</span>` : ''}</h2>
      ${long ? `<p class="n-body">${esc(n.body.slice(0, 240).replace(/\s+\S*$/, ''))}…</p><details class="n-more"><summary>Read the whole announcement</summary><p class="n-body">${esc(n.body)}</p></details>` : `<p class="n-body">${esc(n.body)}</p>`}
      ${link ? `<p class="n-link"><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link.replace(/^https:\/\//, '').replace(/\/$/, '').slice(0, 80))}<span class="sr-only"> (opens a new tab)</span></a></p>` : ''}
      <p class="n-foot"><span class="n-class">${esc(x.cls.title)}</span><button type="button" class="btn quiet small" data-got="1">Got it<span class="sr-only">: ${esc(x.cls.title)}</span></button></p>
    </section>`;
  }
  function classLine(c) {
    const when = c.starts_on ? `Starts ${shortDate(c.starts_on)}` : '';
    return `${c.teacher ? `with ${esc(c.teacher)}` : ''}${c.teacher && when ? ', ' : ''}${when ? esc(when) : ''}${c.time_zone ? ` <span class="tz">(times in ${esc(c.time_zone)})</span>` : ''}`;
  }
  function classesHTML() {
    if (!LISTINGS) return '';
    if (ENROL) return ENROL.homeHTML(LISTINGS);   // enrol.js (M2-21): the same two sections, with Join, Leave and the times
    const mine = LISTINGS.mine || [], open = (LISTINGS.open || []).filter(o => !mine.some(m => m.class_id === o.class_id));
    const li = c => `<li><b>${esc(c.title)}</b><span>${classLine(c)}</span>${c.course && c.course !== courseKey ? '' : ''}</li>`;
    let h = '';
    if (mine.length) h += `<section class="card classes mine" aria-labelledby="cl-h"><h2 id="cl-h" class="kicker">Your classes</h2><ul class="cls">${mine.map(li).join('')}</ul></section>`;
    if (open.length) h += `<section class="card classes open" aria-labelledby="op-h"><h2 id="op-h" class="kicker">Open to join</h2><ul class="cls">${open.map(li).join('')}</ul>
      ${ACC && ACC.configured && ACC.state === 'guest' ? `<p class="fine">Joining a class needs an account. <button type="button" class="linkbtn" data-acct="signin">Sign in</button></p>` : ''}</section>`;
    return h;
  }
  function drawService() {
    const notes = $('#home-notes'), cl = $('#home-classes');
    if (!notes || !cl) return;
    const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (typing) return;
    notes.innerHTML = noticesFor().map(noticeHTML).join('');
    cl.innerHTML = classesHTML();
    if (ENROL && LISTINGS) ENROL.wireHome(cl, LISTINGS);
  }
  app.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.notice [data-got]'); if (!b) return;
    const card = b.closest('.notice'); const k = card.dataset.seen;
    mem.seen = Object.assign({}, mem.seen, { [k]: new Date().toISOString().slice(0, 10) }); persist();
    const nextCard = card.nextElementSibling;
    drawService();
    const f = (nextCard && nextCard.dataset && $(`.notice[data-seen="${CSS.escape(nextCard.dataset.seen)}"] [data-got]`)) || $('#week-h') || $('#main h1');
    if (f) { if (!/^(BUTTON|A)$/.test(f.tagName)) f.setAttribute('tabindex', '-1'); f.focus(); }
    announce('Done. That announcement is put away.');
  });
  // The module's own words (module.json `message`, `quote`, `focuses`), written by the Academy: each shows only if the
  // Academy wrote it, and a quote shows only with its author and its source.
  function moduleWords(model, top) {
    const mj = model.mj || {};
    const msg = typeof mj.message === 'string' && mj.message.trim() ? mj.message.trim() : '';
    const q = mj.quote && typeof mj.quote === 'object' && String(mj.quote.text || '').trim() && String(mj.quote.author || '').trim() && String(mj.quote.source || '').trim() ? mj.quote : null;
    const foc = Array.isArray(mj.focuses) ? mj.focuses.filter(x => typeof x === 'string' && x.trim()) : [];
    const h = `h${Math.min(6, top + 1)}`;
    return {
      any: !!(msg || q || foc.length),
      msg: msg ? `<p class="mod-msg">${esc(msg)}</p>` : '',
      quote: q ? `<figure class="mod-quote"><blockquote><p>${esc(q.text)}</p></blockquote><figcaption>${esc(q.author)}${q.field ? `, ${esc(q.field)}` : ''}. <cite>${esc(q.source)}</cite>${q.year ? `, ${esc(q.year)}` : ''}.</figcaption></figure>` : '',
      focuses: foc.length ? `<div class="mod-focuses"><${h} class="kicker">In focus</${h}><ul>${foc.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''
    };
  }

  // ------------------------------------------------------------------ HOME: the reading room (M2-24, M1-24)
  // The Designer's people: a first-time guest, a returning guest, a student signed in with one class or two, and a
  // student between terms. One primary action on the screen, always the student's own next step. The week card is the
  // first thing under the greeting; a teacher's announcement for a class sits just above it, one card per class.
  function viewHome() {
    setTitle('');
    const cur = currentModule();
    const curModel = cur ? buildModel(cur.folder) : null;
    const ctx = contextModel();
    const fresh = !anyProgress();
    const name = whoName();
    const member = ACC && ACC.state === 'member';
    const greet = fresh && !member ? (name ? `Welcome, ${name}.` : 'Welcome.') : (name ? `Welcome back, ${name}.` : 'Welcome back.');
    const L = MODS();
    const nx = nextPlanned();
    const dateline = `${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}<span aria-hidden="true"> · </span><span class="sr-only">. </span>${esc(courseShort)}${cur ? `, ${esc(UNIT)} ${cur.module} of ${COURSE.meta.modules || L.length}` : ''}`;

    // the week card: where the student left off, or this unit's start, or, between terms, when the next one opens. While
    // the teacher is live, joining the class is its first choice (M2-22, live.js).
    let week;
    const live = LIVE ? LIVE.weekHTML() : '';
    const wk = ctx && cur && (ctx.folder === cur.folder || started(ctx)) ? ctx : curModel;
    if (wk) {
      // the card shows where the student left off; its one action continues from there (contStep)
      const c = counts(wk), went = started(wk), r = contStep(wk), left = r, st = wk.steps[left], mo = modOf(wk);   // one truth: the resume point (F5)
      const orient = COURSE.modules.find(m => m.module === 0 && m.folder && COURSE.packages[m.folder]);
      const upNext = wk.steps.slice(r + 1, r + 5).map(s => `<li><a href="#/m/${wk.folder}/${s.idx}"><span class="tt">${esc(stepTitle(s))}</span><span class="leader" aria-hidden="true"></span><span class="folio"><span class="sr-only">step </span>${s.idx + 1}</span></a></li>`).join('');
      const firstList = wk.steps.slice(0, 4).map(s => `<li><a href="#/m/${wk.folder}/${s.idx}"><span class="tt">${esc(stepTitle(s))}</span><span class="leader" aria-hidden="true"></span><span class="folio"><span class="sr-only">step </span>${s.idx + 1}</span></a></li>`).join('');
      week = `<section class="spread week" aria-labelledby="week-h" style="${seriesOfModel(wk)}">
        <div class="leaf lf">
          <span class="bookmark" aria-hidden="true">${RIBBON}</span>
          <h2 id="week-h" class="kicker">${went ? 'Where you left off' : `This ${esc(UNIT)}`}</h2>
          <p class="runhead">${esc(courseShort)} · ${esc(modLong(mo))}</p>
          <p class="big">${esc(went ? stepTitle(st) : mo.title)}</p>
          <p class="sub">${went ? `Step ${left + 1} of ${c.total}${st.block.title !== stepTitle(st) ? `, in “${esc(st.block.title)}”` : ''}` : `${c.total} steps${mins(wk.meta.minutes) ? `, about ${mins(wk.meta.minutes)} minutes` : ''}, at your own pace`}</p>
          ${COURSE.meta.welcome && fresh ? `<p class="welcome-line">${esc(COURSE.meta.welcome)}</p>` : ''}
          <p class="count">${went ? `${esc(countText(c))}. Your answers are just as you left them.` : 'Any answer can be redone.'}${HI && HI.countLine() ? ` <span class="hi-count">${esc(cap(HI.countLine()))}.</span>` : ''}</p>
          ${live}<div class="row"><a class="btn stack ${live ? 'quiet' : 'primary cta-main'}" href="#/m/${wk.folder}/${r}"><span>${went ? 'Continue' : 'Start'} at step ${r + 1}</span><span class="sr-only">: </span><small>${esc(stepTitle(wk.steps[r]))}</small></a><a class="btn quiet" href="#/m/${wk.folder}">${esc(modName(mo))} contents</a></div>
          ${fresh && orient && orient.folder !== wk.folder ? `<p class="fine">New to the course? <a href="#/m/${orient.folder}">Start at ${esc(unitName(0))}: ${esc(orient.title)}</a></p>` : ''}
        </div>
        <div class="leaf rt">
          <h3 class="kicker">${went ? `Next in ${esc(modName(mo))}` : `How ${esc(modName(mo))} begins`}</h3>
          ${(went ? upNext : firstList) ? `<ol class="upnext">${went ? upNext : firstList}</ol>` : `<p>This is the last step of the ${UNIT}.</p>`}
          <p class="fine">The ribbon marks your place in every contents page. It counts where you are, never how well you did.</p>
        </div>
      </section>`;
    } else {
      // between terms: nothing is open today
      week = `<section class="spread week between" aria-labelledby="week-h">
        <div class="leaf lf">
          <span class="bookmark" aria-hidden="true">${RIBBON}</span>
          <h2 id="week-h" class="kicker">Between terms</h2>
          <p class="big">${nx ? `${esc(modName(nx))} opens ${esc(opensLabel(nx.lockedUntil || nx.opens))}` : 'Nothing is open right now'}</p>
          <p class="sub">${nx ? esc(nx.title) : `The next term’s ${UNITS} open on their dates.`}</p>
          <p class="count">${anyProgress() ? 'Everything you made is kept just as you left it.' : `Every ${UNIT} opens here on its date.`}</p>
          ${live}<div class="row"><a class="btn ${live ? 'quiet' : 'primary cta-main'}" href="#/course">See the course contents</a></div>
        </div>
      </section>`;
    }

    // the cards under it: this unit's own words and dates, the course on the shelf, the term ahead, what came back
    const fbAll = allFeedback();
    let thisUnit = '';
    if (curModel) {
      const w = moduleWords(curModel, 2);
      const dates = cur.opens ? `${esc(modLong(cur))} opened ${esc(opensLabel(cur.opens))}.${nx ? ` ${esc(modName(nx))} opens ${esc(opensLabel(nx.lockedUntil || nx.opens))}.` : ''}` : (nx ? `${esc(modName(nx))} opens ${esc(opensLabel(nx.lockedUntil || nx.opens))}.` : '');
      if (w.any || dates) thisUnit = `<section class="card thisunit" aria-labelledby="tu-h"><h2 id="tu-h" class="kicker">This ${esc(UNIT)} in ${esc(courseShort)}</h2>
        ${w.msg ? `<blockquote class="pull">${w.msg}</blockquote>` : ''}${w.quote}${w.focuses}${dates ? `<p class="when">${dates}</p>` : ''}</section>`;
    }
    const openCount = L.filter(m => m.open).length;
    const shelf = `<section class="card shelf" aria-labelledby="sh-h"><h2 id="sh-h" class="kicker">${fresh ? 'The course' : 'Your course'}</h2>
      <a class="volume" href="#/course" style="${coverOf(cur ? L.findIndex(m => m.id === cur.id) : 0)}"><span class="cover" aria-hidden="true">${marble(3)}<span class="cv-mark"><img src="icon.svg" alt="" width="22" height="22"></span></span>
        <span class="vol-t"><b>${esc(courseShort)}</b>${courseSub ? `<span>${esc(courseSub)}</span>` : ''}<small>${openCount} of ${L.length} open.${ctx && !fresh ? ` You are in ${esc(modName(modOf(ctx)))}.` : ''}</small></span></a></section>`;
    const ahead = L.filter(m => !m.open && (m.lockedUntil || m.opens) && notYet(m.lockedUntil || m.opens)).slice(0, 4)
      .map(m => `<li><span class="cal-d">${esc(dateOf(m.lockedUntil || m.opens).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</span><span class="cal-t">${esc(modLong(m))}</span></li>`).join('');
    const term = ahead ? `<section class="card cal" aria-labelledby="cal-h"><h2 id="cal-h" class="kicker">The term ahead</h2><ol class="calendar">${ahead}</ol></section>` : '';
    const heard = fbAll.length ? `<section class="card feedback" aria-labelledby="h-h"><h2 id="h-h" class="kicker">Heard back</h2>
        <p class="fb-t">${esc(fbAll[0].from || 'Your teacher')} wrote back about ${esc(fbAll[0].moduleTitle)}</p>
        ${fbAll[0].star ? starHTML() : ''}
        <p>${esc((fbAll[0].forward || '').slice(0, 140))}${(fbAll[0].forward || '').length > 140 ? '…' : ''}</p>
        <a class="btn quiet small" href="#/heard">Read the feedback</a></section>` : '';
    const kept = member
      ? `Signed in as <b>${esc(ACC.name)}</b>. Your work is kept in your account${ACC.sync ? ' and follows you to your other devices' : '; carrying it between devices is off'}${mem.consent === 'yes' ? ', and on this device too' : ''}.`
      : `Your answers stay on this device${mem.consent === 'yes' ? '' : mem.consent === 'no' ? ' only until you close the page (you chose not to keep them)' : ' only for this visit, until you choose to keep them'}. Nothing is sent anywhere unless you ${ACC && ACC.configured ? 'sign in or ' : ''}hand work in.`;
    app.innerHTML = header({ model: ctx, idx: wk === ctx && ctx ? contStep(ctx) : lastStep(ctx), level: 'home' }) +
      `<main id="main" class="lv lv-home"${uiLang()}>
        <header class="masthead"><p class="dateline">${dateline}</p><h1>${esc(greet)}</h1></header>
        <div id="home-notes" class="notices"></div>
        ${week}
        <div id="home-classes" class="home-classes"></div>
        <div class="home-cols">${thisUnit}${shelf}${term}${heard}${M.courseMeasures.some(m => shows(m, 'home')) ? `<div class="m-place" data-mplace="home">${homeMeasuresHTML()}</div>` : ''}</div>
        <footer class="colophon"><span class="cmark" aria-hidden="true"><img src="icon.svg" alt="" width="30" height="30"></span>
          <p class="privacy-line">${kept} <a href="#/settings">Your data</a> · <a href="privacy.html">Your privacy</a>${CONTENT.preview ? ` · <span class="proto">preview</span> ${UNITS} not yet released are shown for review` : ''}</p>
          <p class="privacy-line">${curModel && DS && DS.postFor(curModel) ? `<a href="#/m/${curModel.folder}/talk">Talk about this ${esc(UNIT)} with the class</a>` : `<a href="#/talk" onclick="event.preventDefault();LM.discuss()">Talk about this ${esc(UNIT)} with the class</a>`} (in ${esc((CFG.discord || {}).server || 'Discord')}).</p>
          <p class="privacy-line"><b>${esc(versionLine())}</b>. Made by Heirloom Estate Academy. <a href="download.html">The download page</a></p>
        </footer>
      </main>`;
    drawService();
    loadListings();
    focusMain();
  }
  function starHTML() {
    return `<span class="star"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="var(--gold)" d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>A quiet gold star, just for you</span>`;
  }

  // ------------------------------------------------------------------ COURSE: the title page and its contents
  // MOUNT POINT for board row M2-31 (the Director's ruling of 2026-10-09): how learning is measured is the Academy's
  // (a grade, a self-check, a progress check, a rubric, a reward system), named course by course. This is B's place for
  // it, the row after "Modules" in the "This course" panel. It renders from the course's data only: the course field
  // and its renderer are M2-31's to build here. Until a course names one, the row is absent: Letterman writes no words
  // of its own about grades in this panel.
  //
  // The course names each measure (course.json meta.measures, and a module's own list in module.json meta.measures,
  // checked by tools/build.mjs): its label and description in the course's words, its scale, who records it and where it
  // shows (course, module, heard, home). Letterman shows the label and description where the course says, and a value
  // "in words" ("Rubric, Module 1: Developing") wherever one is recorded for this student. With nothing named, nothing
  // shows: no row, no card, no placeholder. Values come from three places, and only the student's own ever reach the page:
  //   - the service, for a signed-in student (the teacher's records and their own self-checks: ACC.myMeasures);
  //   - this device, for a self-check a guest records (kept, like their answers, only with their yes);
  //   - the app's own count, for what Letterman can count (steps done), worked out here and never sent.
  let MVALS = null, mAsked = 0;   // the signed-in student's values from the service; null until asked
  const MDEV = () => (mem.measures || []);
  const anyMeasure = () => M.courseMeasures.length > 0 || Object.keys(COURSE.packages).some(f => M.measuresOf(f).length);
  const keyOf = (m, model) => m.per === 'course' ? courseKey : model.id;
  function countValue(m, model) {
    const c = counts(model);
    if (m.counts === 'required-steps') { const req = model.steps.filter(s => s.block.required), d = req.filter(s => stepDone(model, s)).length; return `${d} of ${req.length} required steps done`; }
    return `${c.done} of ${c.total} steps done`;
  }
  // the newest value of a measure for a module (or for the course), from wherever this student's values are
  function valueOf(m, model) {
    if (m.recorded_by === 'letterman' && m.per === 'course') {
      // one count for the whole course: the steps done in every open module, of all their steps
      const all = openModels(); if (!all.some(started)) return null;
      return `${all.reduce((k, md) => k + counts(md).done, 0)} of ${all.reduce((k, md) => k + md.steps.length, 0)} steps done`;
    }
    if (m.recorded_by === 'letterman') return model && started(model) ? countValue(m, model) : null;
    const k = m.per === 'course' ? courseKey : model && model.id;
    if (!k) return null;
    const rows = [...(MVALS || []).map(r => ({ v: r.value, at: r.recorded_at, m: r.measure, k: r.module, by: r.recorder })),
      ...(ACC && ACC.state === 'member' ? [] : MDEV().map(r => ({ v: r.value, at: r.at, m: r.measure, k: r.module, by: 'student' })))]
      .filter(r => r.m === m.id && r.k === k && r.by === m.recorded_by).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return rows.length ? M.valueWords(m, rows[rows.length - 1].v) : null;
  }
  // "Rubric, Module 1: Developing"; for a measure the course takes once, "Reward: Bronze"
  const valueLine = (m, model, v) => m.per === 'course' || !model ? `${m.label}: ${v}` : `${m.label}, ${modName(modOf(model))}: ${v}`;
  const openModels = () => MODS().filter(x => x.open).map(x => buildModel(x.folder)).filter(Boolean);
  // every value line of one measure, module by module, for this student
  // bare: under a card that already carries the measure's label (Heard back), the line leaves the label off (P6)
  function valueLines(m, bare) {
    const line = (model, v) => bare ? (m.per === 'course' || !model ? v : `${modName(modOf(model))}: ${v}`) : valueLine(m, model, v);
    if (m.per === 'course') { const v = valueOf(m, null); return v ? [line(null, v)] : []; }
    return openModels().filter(md => M.measuresOf(md.folder).some(x => x.id === m.id)).map(md => { const v = valueOf(M.measuresOf(md.folder).find(x => x.id === m.id), md); return v ? line(md, v) : null; }).filter(Boolean);
  }
  const shows = (m, place) => (m.shows || []).includes(place);
  const linesHTML = lines => lines.length ? `<ul class="m-vals">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
  function measureRow(course) {
    void course;
    return M.courseMeasures.filter(m => shows(m, 'course')).map(m => `<div class="m-row" data-mrow="${esc(m.id)}"><dt>${esc(m.label)}</dt><dd>${m.description ? `<span class="m-desc">${esc(m.description)}</span>` : ''}${linesHTML(valueLines(m))}</dd></div>`).join('');
  }
  // the module opener: the module's own measures, each a card in the course's words, with this module's value
  function moduleMeasuresHTML(model) {
    return M.measuresOf(model.folder).filter(m => shows(m, 'module')).map(m => {
      const v = valueOf(m, model), id = `mm-${esc(m.id)}`;
      return `<section class="card measure" aria-labelledby="${id}" data-mcard="${esc(m.id)}"><h2 id="${id}" class="kicker">${esc(m.label)}</h2>
        ${m.description ? `<p class="m-desc">${esc(m.description)}</p>` : ''}${v ? `<p class="m-val">${esc(valueLine(m, model, v))}</p>` : ''}
        ${m.recorded_by === 'student' && !STAGE ? selfCheckHTML(m, model) : ''}</section>`;
    }).join('');
  }
  // A self-check: the student records it themselves, and the page says first who sees it.
  function selfCheckHTML(m, model) {
    const member = ACC && ACC.state === 'member', s = m.scale || {}, id = `sc-${esc(m.id)}`;
    const who = member ? (m.teacher_sees ? 'Kept in your account. Your teacher sees it.' : 'Kept in your account. Only you see it.')
      : (mem.consent === 'yes' ? 'Kept on this device. Only you see it.' : 'Kept for this visit. Only you see it.');
    const input = s.levels ? `<fieldset class="m-levels"><legend class="sr-only">${esc(m.label)}</legend>${s.levels.map((l, i) => `<label class="check"><input type="radio" name="${id}" value="${esc(l)}" id="${id}-${i}"> <span>${esc(l)}</span></label>`).join('')}</fieldset>`
      : s.text ? `<label class="sr-only" for="${id}-in">${esc(m.label)}</label><input type="text" id="${id}-in" maxlength="200">`
        : `<label class="sr-only" for="${id}-in">${esc(m.label)}</label><input type="number" id="${id}-in" min="${s.min}" max="${s.max}" step="${s.step || 1}" inputmode="decimal">${s.unit ? ` <span>${esc(s.unit)}</span>` : ''}`;
    return `<div class="m-record" data-mrecord="${esc(m.id)}" data-mfolder="${esc(model.folder)}">${input}
      <p class="small muted" id="${id}-who">${who}</p><button type="button" class="btn quiet small" data-mgo="1" aria-describedby="${id}-who">Record<span class="sr-only">: ${esc(m.label)}</span></button><p class="msg" role="status" id="${id}-msg"></p></div>`;
  }
  app.addEventListener('click', async e => {
    const b = e.target.closest && e.target.closest('[data-mgo]'); if (!b) return;
    const box = b.closest('[data-mrecord]'), model = buildModel(box.dataset.mfolder), m = model && M.measuresOf(model.folder).find(x => x.id === box.dataset.mrecord);
    if (!m) return;
    const said = $('.msg', box), pickd = $('input[type=radio]:checked', box), inp = $('input:not([type=radio])', box);
    const c = M.checkValue(m, pickd ? pickd.value : inp ? inp.value : '');
    if (!c.ok) { said.textContent = (m.scale || {}).levels ? 'Choose one first.' : (m.scale || {}).text ? 'Write a short line first.' : `Choose a number from ${m.scale.min} to ${m.scale.max}.`; return; }
    const k = keyOf(m, model);
    if (ACC && ACC.state === 'member') {
      b.disabled = true;
      const ok = await ACC.recordSelfCheck({ course: courseKey, module: k, measure: m.id, value: c.value, teacherSees: !!m.teacher_sees });
      b.disabled = false;
      if (!ok) { said.textContent = ACC.words.failed; return; }
      await loadMeasures(true);
    } else { mem.measures = [...MDEV(), { module: k, measure: m.id, value: c.value, at: new Date().toISOString() }]; persist(); }
    paintMeasures();
    const nb = $(`[data-mrecord="${CSS.escape(m.id)}"] [data-mgo]`); if (nb) nb.focus();
    announce(`Recorded: ${valueLine(m, model, M.valueWords(m, c.value))}.`);
  });
  // Heard back: what the course shows there (by default, what the teacher records), one card for each measure with a value
  function heardMeasuresHTML() {
    return M.courseMeasures.concat(...Object.keys(COURSE.packages).map(f => M.measuresOf(f))).filter((m, i, a) => a.findIndex(x => x.id === m.id) === i)
      .filter(m => shows(m, 'heard')).map(m => { const ls = valueLines(m, true), id = `hm-${esc(m.id)}`; return ls.length ? `<section class="card measure-heard" aria-labelledby="${id}"><h2 id="${id}">${esc(m.label)}</h2>${linesHTML(ls)}</section>` : ''; }).join('');
  }
  function homeMeasuresHTML() {
    return M.courseMeasures.filter(m => shows(m, 'home')).map(m => { const ls = valueLines(m), id = `om-${esc(m.id)}`; return ls.length ? `<section class="card measure-home" aria-labelledby="${id}"><h2 id="${id}" class="kicker">${esc(m.label)}</h2>${linesHTML(ls)}</section>` : ''; }).join('');
  }
  // the signed-in student's values, asked of the service on the screens that show measures, then painted in place
  async function loadMeasures(now) {
    if (STAGE || !anyMeasure() || !ACC || ACC.state !== 'member' || !ACC.myMeasures) { if (MVALS && !(ACC && ACC.state === 'member')) { MVALS = null; paintMeasures(); } return; }
    const ask = ++mAsked;
    const r = await ACC.myMeasures();
    if (ask !== mAsked || !r) return;
    const changed = JSON.stringify(r) !== JSON.stringify(MVALS);
    MVALS = r;
    if (changed && !now) paintMeasures();
  }
  function paintMeasures() {
    const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'radio';
    const dl = $('.facts dl');
    if (dl) { $$('[data-mrow]', dl).forEach(x => x.remove()); dl.insertAdjacentHTML('beforeend', measureRow(COURSE)); }
    const mp = $('[data-mplace="module"]');
    if (mp && !typing) { const model = buildModel(mp.dataset.mfolder); if (model) mp.innerHTML = moduleMeasuresHTML(model); }
    const hp = $('[data-mplace="heard"]');
    if (hp) { hp.innerHTML = heardMeasuresHTML(); const none = $('.heard-none'); if (none) none.hidden = !!hp.innerHTML.trim(); }
    const op = $('[data-mplace="home"]'); if (op) op.innerHTML = homeMeasuresHTML();
  }
  function viewCourse() {
    setTitle(`${courseShort}: contents`);
    const ctx = contextModel();
    const L = MODS();
    const openCount = L.filter(m => m.open).length;
    const dated = L.filter(m => m.lockedUntil || m.opens);
    let runs = '';
    if (dated.length) { const a = dateOf(dated[0].lockedUntil || dated[0].opens), b = dateOf(dated[dated.length - 1].lockedUntil || dated[dated.length - 1].opens); b.setDate(b.getDate() + 6); runs = `${a.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })} to ${b.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`; }
    const rows = L.map(m => {
      const isCur = ctx && m.folder === ctx.folder;
      const label = unitName(m.module);
      if (m.open) {
        const md = buildModel(m.folder), c = counts(md);
        const pct = Math.round(c.done / Math.max(1, c.total) * 100);
        const status = c.open === 0 ? 'All done' : `${c.done} of ${c.total} steps done`;
        return `<li class="ch open${isCur ? ' cur' : ''}" style="${seriesOf(m.i)};--pct:${pct}%"><a href="#/m/${m.folder}"${isCur ? ' aria-current="true"' : ''}>
          <span class="spinecol" aria-hidden="true"></span><span class="num" aria-hidden="true">${m.module}</span>
          <span class="tt"><span class="lab">${esc(label)}</span><b>${esc(m.title)}</b><small>${m.opens ? `Opened ${esc(opensLabel(m.opens))}. ` : ''}${mins(md.meta.minutes) ? `About ${mins(md.meta.minutes)} minutes.` : ''}${isCur && started(md) ? ` You continue at step ${contStep(md) + 1}.` : ''}${CONTENT.preview && m.status !== 'released' ? ' Preview.' : ''}</small></span>
          <span class="st"><span>${status}</span><span class="bar" aria-hidden="true"><i></i></span></span>${isCur ? `<span class="bookmark" aria-hidden="true">${RIBBON}</span>` : ''}</a></li>`;
      }
      const when = m.lockedUntil || m.opens;
      return `<li class="ch planned" style="${seriesOf(m.i)}"><div><span class="spinecol" aria-hidden="true"></span><span class="num" aria-hidden="true">${m.module}</span>
        <span class="tt"><span class="lab">${esc(label)}</span><b>${esc(m.title)}</b><small>Its pages arrive when the Academy releases it.</small></span>
        <span class="st"><span>${when ? esc(opensFull(when)) : 'Opens later'}</span></span></div></li>`;
    }).join('');
    const back = ctx ? `<a class="btn primary" href="#/m/${ctx.folder}/${contStep(ctx)}">${started(ctx) ? `Continue ${esc(modName(modOf(ctx)))} at step ${contStep(ctx) + 1}` : `Start ${esc(modName(modOf(ctx)))}`}</a>` : '';
    app.innerHTML = header({ model: ctx, idx: ctx && started(ctx) ? contStep(ctx) : lastStep(ctx), level: 'course' }) + `<main id="main" class="lv lv-course"${uiLang()}>
      <section class="titlepage" aria-labelledby="tp-h">
        <div class="endpaper" aria-hidden="true">${shelf(2)}</div>
        <div class="tp-body">
          <p class="kicker">Heirloom Estate Academy</p>
          <h1 id="tp-h">${esc(courseShort)}${courseSub ? `<span class="subtitle"><span class="sr-only">: </span>${esc(courseSub)}</span>` : ''}</h1>
          ${COURSE.meta.description ? `<p class="tp-desc">${esc(COURSE.meta.description)}</p>` : ''}
          <p class="tp-meta">${L.length} parts. ${openCount} of ${L.length} are open.</p>
          ${back}
        </div>
      </section>
      <div class="course-grid">
        <section class="contents" aria-labelledby="ct-h">
          <h2 id="ct-h" class="sect-h">Contents</h2>
          <ol class="chapters">${rows}</ol>
          <p class="fine">The rule under each ${UNIT} shows how much of it you have done. It is never a score.</p>
        </section>
        <aside class="course-side" aria-label="About this course">
          <section class="card facts" aria-labelledby="cf-h"><h2 id="cf-h" class="kicker">This course</h2><dl>
            ${runs ? `<div><dt>Runs</dt><dd>${esc(runs)}</dd></div>` : ''}<div><dt>${cap(UNITS)}</dt><dd>${L.length}, each opening on its own date</dd></div>${measureRow(COURSE)}</dl></section>
        </aside>
      </div>
    </main>`;
    focusMain();
  }

  // ------------------------------------------------------------------ MODULE: the chapter opener and its contents
  function viewModule(model) {
    setTitle(model.meta.title);
    const c = counts(model), mo = modOf(model), m = ms(model.id);
    const went = started(model);
    const here = went ? contStep(model) : null;   // one truth on the opener: the head, the contents and the button (F5)
    const target = model.steps[contStep(model)];
    const fb = allFeedback().find(f => f.m === model.id);
    const w = moduleWords(model, 2);
    const openBlocks = model.blocks.filter(b => !blockDone(model, b));
    const list = openBlocks.map(b => {
      const first = b.steps.find(i => !stepDone(model, model.steps[i])), left = b.steps.filter(i => !stepDone(model, model.steps[i])).length;
      return `<li class="ph-${phaseOf(b)}"><a href="#/m/${model.folder}/${first}"><span class="dot" aria-hidden="true"></span><span>${esc(b.title)}${b.required ? '' : ' <em>optional</em>'}${b.steps.length > 1 ? ` <em>${left} of ${b.steps.length} open</em>` : ''}${b.kind === 'second-pass' ? ' <em>after you have made it</em>' : ''}</span></a></li>`;
    }).join('');
    const objs = (model.mj.objectives || []).filter(o => o && o.text).map((o, n) => `<li><span class="tick" aria-hidden="true">${n + 1}</span><span>${esc(o.text)}</span></li>`).join('');
    const { prev: pm, next: nm } = neighbours(model);
    const prevSign = pm ? `<a class="sign" href="#/m/${pm.folder}">${I.left}<span><small>Before this</small>${esc(modLong(pm))}</span></a>` : '';
    const nextSign = nm ? (nm.open ? `<a class="sign nx" href="#/m/${nm.folder}"><span><small>After this</small>${esc(modLong(nm))}</span>${I.right}</a>`
      : `<p class="sign later"><span><small>After this${nm.lockedUntil || nm.opens ? `, opens ${esc(opensLabel(nm.lockedUntil || nm.opens))}` : ''}</small>${esc(modLong(nm))}</span></p>`) : '';
    const L = MODS(), mi = L.findIndex(x => x.folder === model.folder);
    app.innerHTML = header({ model, idx: here, level: 'module' }) + `<main id="main" class="lv lv-module"${uiLang()} style="${seriesOfModel(model)}"><div class="mod-grid">
      <header class="opener">
        <div class="endpaper thin" aria-hidden="true">${shelf(mi + 4)}</div>
        <div class="op-body">
          <p class="kicker">${esc(courseShort)}${mo.module ? ` · ${UNIT} ${mo.module} of ${model.meta.of}` : ''}</p>
          <div class="op-title"><span class="numeral" aria-hidden="true">${mo.module}</span><h1><span class="sr-only">${esc(modName(mo))}: </span>${esc(mo.title)}</h1></div>
          ${w.msg}
          <p class="op-meta">${L[mi] && L[mi].opens ? `Opened ${esc(opensLabel(L[mi].opens))}. ` : ''}${mins(model.meta.minutes) ? `About ${mins(model.meta.minutes)} minutes in all. ` : ''}Do it in one sitting or ten. ${esc(countText(c))}.</p>
          <div class="row"><a class="btn primary stack" href="#/m/${model.folder}/${target.idx}"><span>${went ? 'Continue at' : 'Start at'} step ${target.idx + 1}</span><small>${esc(stepTitle(target))}</small></a>
          <a class="btn quiet" href="#/m/${model.folder}/guide/${model.slideFor[target.idx]}/${target.idx}">Open the ${UNIT} guide</a></div>
        </div>
      </header>
      <div class="mod-main">
        ${w.quote || w.focuses ? `<section class="words" aria-label="In the Academy's words">${w.quote}${w.focuses}</section>` : ''}
        ${objs ? `<section class="objectives" aria-labelledby="obj-h"><h2 id="obj-h" class="sect-h">Learning objectives</h2><p class="obj-lead">By the end of this ${UNIT} you can:</p><ol>${objs}</ol></section>` : ''}
        <section class="toc-card everystep" aria-labelledby="mc-h"><h2 id="mc-h" class="sect-h">Contents</h2>${contentsHTML(model, 'full', here)}</section>
      </div>
      <aside class="mod-side" aria-label="What is still open">
        ${fb ? `<section class="card feedback" aria-labelledby="mfb-h"><h2 id="mfb-h" class="kicker">Heard back</h2><p>${esc(fb.from || 'Your teacher')} wrote back about this ${UNIT}.</p>${fb.star ? starHTML() : ''}<p><a href="#/heard">Read it</a></p></section>` : ''}
        ${M.measuresOf(model.folder).some(x => shows(x, 'module')) ? `<div class="m-place" data-mplace="module" data-mfolder="${esc(model.folder)}">${moduleMeasuresHTML(model)}</div>` : ''}
        ${DS ? DS.cardHTML(model) : ''}
        <section class="card openlist stillopen" aria-labelledby="ol-h"><h2 id="ol-h" class="kicker">${openBlocks.length ? 'Still open' : 'Every step is done'}</h2>${list ? `<ul>${list}</ul>` : '<p>Hand in your work if you want feedback, and come back for the second pass whenever you like.</p>'}<p class="fine">Optional parts can stay open, and any piece can be redone.</p></section>
        ${prevSign || nextSign ? `<nav class="signs" aria-label="Neighbouring ${UNITS}">${prevSign}${nextSign}</nav>` : ''}
      </aside>
    </div></main>`;
    focusMain();
  }

  // ------------------------------------------------------------------ STEP: one page, its contents on the left, its guide in the margin
  // Below 761 px wide (the app's own width, so the stage's chart-beside mode counts too) the contents rail folds away
  // and the guide is the page's second pane: Lesson or Guide.
  // Up to 1100 px (a tablet, a small laptop) the guide has no margin beside the lesson: it is the page's second pane
  // there too, behind the same Lesson and Guide switch, and the contents rail stays from 761 px (app.css; the Designer's S2)
  const NARROW = 1100;
  const isNarrow = () => app.clientWidth <= NARROW;
  let pane = 'lesson', guideHidden = false, guideAt = null, narrowAt = null;
  function maybeRelayout() {
    if (narrowAt == null || isNarrow() === narrowAt) return;
    const h = decodeURIComponent(location.hash || '');
    if (/^#\/m\/[^/]+\/\d+$/.test(h)) { const y = scrollY; const a = document.activeElement; routeInner(); measureBars(); window.scrollTo(0, y); if (a && a.id && $('#' + CSS.escape(a.id))) $('#' + CSS.escape(a.id)).focus({ preventScroll: true }); }
  }
  function viewStep(model, idx) {
    const st = model.steps[idx];
    const m = ms(model.id);
    if (mem.lastFolder !== model.folder || m.last !== idx) { pane = 'lesson'; guideAt = null; }
    m.visited[idx] = true; m.last = idx; mem.lastFolder = model.folder; persist();
    setTitle(docTitle(model, st));
    narrowAt = isNarrow();
    const nar = narrowAt && !STAGE, n = model.steps.length, b = st.block, bi = model.blocks.indexOf(b), mo = modOf(model);
    const nx = nextIdx(model, idx), pv = prevIdx(model, idx);
    const { prev: pm, next: nm } = neighbours(model);
    let prev = '', next = '';
    // the words are said once, by the hidden line: on a phone the visible words fold away and only the arrow shows
    if (pv != null) prev = `<a class="turn back" href="#/m/${model.folder}/${pv}"><span class="ar">${I.left}</span><span class="sr-only">Back to step ${pv + 1}: ${esc(stepTitle(model.steps[pv]))}</span><span class="t" aria-hidden="true">Back<small>${esc(stepTitle(model.steps[pv]))}</small></span></a>`;
    else if (pm) prev = `<a class="turn back" href="#/m/${pm.folder}"><span class="ar">${I.left}</span><span class="sr-only">Back to ${esc(modLong(pm))}</span><span class="t" aria-hidden="true">Back to ${esc(modName(pm))}<small>${esc(pm.title)}</small></span></a>`;
    if (nx != null) next = `<a class="turn fwd nextbtn" href="#/m/${model.folder}/${nx}"><span class="t nl">Next: step ${nx + 1}<small>${esc(stepTitle(model.steps[nx]))}</small></span><span class="ar">${I.right}</span></a>`;
    else {
      const c = counts(model);
      const left = c.open - (stepDone(model, st) ? 0 : (st.pids.length ? 0 : 1));
      if (left > 0) next = `<a class="turn fwd nextbtn" href="#/m/${model.folder}"><span class="t nl">Finish: ${left} still open<small>See them in the contents</small></span><span class="ar">${I.toc}</span></a>`;
      else if (nm && nm.open) next = `<a class="turn fwd nextbtn" href="#/m/${nm.folder}"><span class="t nl">On to ${esc(modName(nm))}<small>${esc(nm.title)}</small></span><span class="ar">${I.right}</span></a>`;
      else next = `<a class="turn fwd nextbtn" href="#/"><span class="t nl">${cap(UNIT)} done<small>Back to the course home</small></span><span class="ar">${I.home}</span></a>`;
    }
    let body = renderMD(model, st.md, { top: 1, dropH1: true, drop: [st.h2, st.lead], sub: true });
    // the "read first instead" choice the content promises, on the first screen of a first-pass block
    const hasExplainedPrompts = st.block.steps.some(i => model.steps[i].pids.some(pid => model.prompts[pid].explains_with && !model.prompts[pid].repeat_of));
    if (st.si === 0 && hasExplainedPrompts) {
      body += `<div class="readfirst">${m.readFirst
        ? `Every explanation is open. You can still answer each prompt first. <button type="button" class="linkbtn" id="rf">Close them again</button>`
        : `Guessing first is the method, but it is your call. <button type="button" class="linkbtn" id="rf">I would rather read first: open every explanation</button>`}</div>`;
    }
    const inPortal = HI && HI.ready(model);   // a student in a class hands in here (M2-23); everyone else, on Discord
    if (handinHere(model, st)) body += inPortal ? HI.cardHTML(model) : handinHTML(model);
    const opener = st.si === 0 && !st.pids.length && b.steps[0] === idx;
    const rail = `<nav class="rail" aria-label="Contents of ${esc(modLong(mo))}"${uiLang()}>
        <a class="rail-h" href="#/m/${model.folder}"><span class="k">Contents</span><span class="v">${esc(modLong(mo))}</span></a>
        <div class="rail-scroll">${contentsHTML(model, 'rail', idx, true)}</div>
        <div class="rail-foot">
          ${pm ? `<a class="neighbor" href="#/m/${pm.folder}">${I.left}<span>${esc(modName(pm))}</span></a>` : ''}
          ${nm ? (nm.open ? `<a class="neighbor nx" href="#/m/${nm.folder}"><span>${esc(modName(nm))}</span>${I.right}</a>` : `<p class="neighbor later">${esc(modName(nm))} ${nm.lockedUntil || nm.opens ? `opens ${esc(shortDate(nm.lockedUntil || nm.opens))}` : 'opens later'}</p>`) : ''}
        </div>
      </nav>`;
    lastRail = { model, idx };
    const page = `<main id="main" class="page ph-${phaseOf(b)}"${uiLang()}>
        ${nar ? `<div class="panes" role="group" aria-label="Show on this page"><button type="button" data-pane="lesson" aria-pressed="${pane === 'lesson'}">Lesson</button><button type="button" data-pane="guide" aria-pressed="${pane === 'guide'}">Guide</button></div>` : ''}
        ${LIVE ? LIVE.stepHTML(model, idx) : ''}<article class="leafpage step"${cl(b.language)}>
          <div class="runhead"><span class="rh-sec"><span aria-hidden="true">§${bi + 1}</span><span class="sr-only">Section ${bi + 1}:</span> ${esc(b.title)}${b.required ? '' : ' <span class="badge">Optional</span>'}${st.subOf ? ` <span class="rh-sub">${st.sub} of ${st.subOf}</span>` : ''}</span><span class="rh-folio" aria-hidden="true">${idx + 1}<span class="of">/${n}</span></span></div>
          <h1>${esc(stepTitle(st))}</h1>
          <div class="prose${opener ? ' first' : ''}">${body}</div>
        </article>
        ${nar ? guideHTML(model, idx, true) : ''}
        <nav class="travel nextbar" aria-label="Turn the page">${prev || '<span></span>'}${next}</nav>
      </main>`;
    const guide = nar ? '' : (guideHidden && !STAGE) ? `<div class="margin-off"><button class="guide-tab" type="button" data-gp-show="1">${I.guide}<span>Show the ${UNIT} guide</span></button></div>` : guideHTML(model, idx, false);
    app.innerHTML = header({ model, idx, level: 'step' }) +
      `<div class="lv lv-step${guideHidden && !nar && !STAGE ? ' no-guide' : ''}${nar && pane === 'guide' ? ' pane-guide' : ''}" style="${seriesOfModel(model)}">${rail}${page}${guide}</div>`;
    $$('.prompt[data-prompt]', app).forEach(el => mountPrompt(el, model, el.dataset.prompt));
    const rf = $('#rf'); if (rf) rf.onclick = () => { m.readFirst = !m.readFirst; persist(); viewStep(model, idx); measureBars(); const r2 = $('#rf'); if (r2) r2.focus(); };
    if (handinHere(model, st)) { if (inPortal) HI.mount(model, () => { viewStep(model, idx); measureBars(); }); else mountHandin(model); }
    wireGuide(model, idx);
    // the contents rail keeps the student's place in view
    const rs = $('.rail-scroll'), hereA = rs && rs.querySelector('.ts.here');
    if (rs && hereA && rs.offsetParent) { const rr = rs.getBoundingClientRect(), pr = hereA.getBoundingClientRect(); rs.scrollTop = Math.max(0, rs.scrollTop + pr.top - rr.top - rs.clientHeight / 2); }
    focusMain();
  }
  function guideHTML(model, idx, inPage) {
    const base = model.slideFor[idx] || 0;
    const k = guideAt != null ? guideAt : base;
    const sl = model.guide[k];
    if (!sl) return '';
    const tag = inPage ? 'section' : 'aside';
    const atEnd = k === model.guide.length - 1, atStart = k === 0;
    return `<${tag} class="guide guidepane" aria-labelledby="guide-h"${uiLang()}>
      <div class="guide-head"><h2 id="guide-h"><span class="k">${cap(UNIT)} guide</span><small class="eyebrow">Slide ${k + 1} of ${model.guide.length}${k === base ? ', beside this step' : ''}</small></h2>
        <span class="guide-tools"><button class="iconbtn" type="button" data-gp="-1" aria-label="Previous slide"${atStart ? ' aria-disabled="true"' : ''}>${I.left}</button><button class="iconbtn" type="button" data-gp="1" aria-label="Next slide"${atEnd ? ' aria-disabled="true"' : ''}>${I.right}</button>${inPage || STAGE ? '' : `<button class="iconbtn hide-guide" type="button" data-gp-hide="1" aria-label="Hide the guide">${I.close}</button>`}</span></div>
      <div class="guide-body slide" tabindex="0" role="region" aria-label="Slide ${k + 1}"${cl(slideLang(model, sl))}>${renderMD(model, sl.md, { noPrompts: true, top: 2 })}</div>
      ${k !== base ? `<p class="guide-off">You are reading ahead in the guide. <button class="linkbtn" type="button" data-gp-home="1">Back to this step's slide</button></p>` : ''}
      <p class="guide-full"><a href="#/m/${model.folder}/guide/${k}/${idx}">Open the guide full screen</a></p>
      ${inPage ? `<button class="btn quiet back-to-lesson" type="button" data-pane="lesson">Back to the lesson</button>` : ''}
    </${tag}>`;
  }
  // Using the guide beside the lesson never drops focus: the control used keeps it.
  function wireGuide(model, idx) {
    const root = $('.lv-step'); if (!root) return;
    root.addEventListener('click', e => {
      const p = e.target.closest('[data-pane]');
      if (p) { pane = p.dataset.pane; viewStep(model, idx); measureBars(); const f = pane === 'guide' ? $('.guide [data-gp="1"]') : $(`.panes [data-pane="lesson"]`); if (f) f.focus(); window.scrollTo(0, 0); return; }
      const g = e.target.closest('[data-gp]');
      if (g) {
        if (g.getAttribute('aria-disabled') === 'true') return;
        const base = guideAt != null ? guideAt : (model.slideFor[idx] || 0);
        guideAt = Math.max(0, Math.min(model.guide.length - 1, base + +g.dataset.gp));
        redrawGuide(model, idx, `[data-gp="${g.dataset.gp}"]`);
        announce(`Slide ${guideAt + 1} of ${model.guide.length}`);
        return;
      }
      if (e.target.closest('[data-gp-home]')) { guideAt = null; redrawGuide(model, idx, '[data-gp="1"]'); return; }
      if (e.target.closest('[data-gp-hide]')) { guideHidden = true; viewStep(model, idx); measureBars(); const t = $('.guide-tab'); if (t) t.focus(); return; }
      if (e.target.closest('[data-gp-show]')) { guideHidden = false; viewStep(model, idx); measureBars(); const t = $('.guide [data-gp="1"]'); if (t) t.focus(); return; }
    });
  }
  function redrawGuide(model, idx, focusSel) {
    const old = $('.guide'); if (!old) return;
    const inPage = old.tagName === 'SECTION';
    old.outerHTML = guideHTML(model, idx, inPage);
    const f = focusSel && $(`.guide ${focusSel}`); if (f) f.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ the guide, full screen (the running head stays; back returns to the step)
  function viewGuide(model, k, fromStep) {
    k = Math.max(0, Math.min(model.guide.length - 1, k));
    const sl = model.guide[k];
    const from = fromStep != null && fromStep !== '' ? +fromStep : lastStep(model);
    setTitle(`Guide, slide ${k + 1}: ${sl.title || model.meta.title}`);
    const back = from != null ? `#/m/${model.folder}/${from}` : `#/m/${model.folder}`;
    const target = sl.targets[0];
    const tgtLabel = target != null ? stepTitle(model.steps[target]) : null;
    const suffix = from != null ? '/' + from : '';
    const ownH1 = /^#\s/m.test(sl.md);
    const et = ownH1 ? 'p' : 'h1';
    const main = `<main id="main" class="lv lv-guide"${uiLang()} style="${seriesOfModel(model)}"><div class="deck ${sl.isTitle ? 'title-slide' : ''}"><div class="stage">
        <${et} class="eyebrow kicker">${cap(UNIT)} guide · slide ${k + 1} of ${model.guide.length}</${et}>
        <div class="slide"${cl(slideLang(model, sl))} role="group" aria-roledescription="slide" aria-label="Slide ${k + 1} of ${model.guide.length}">${renderMD(model, sl.md, { noPrompts: true, top: ownH1 ? 0 : 1 })}
        ${tgtLabel ? `<p class="shadows"><a class="btn small quiet" href="#/m/${model.folder}/${target}">This slide is step ${target + 1}: ${esc(tgtLabel)} <span aria-hidden="true">&#8594;</span></a></p>` : ''}</div>
        ${from != null ? `<p class="deck-back"><a class="btn quiet" href="${back}"><span aria-hidden="true">&#8592;</span> Back to step ${from + 1}, where you were</a></p>` : ''}
      </div>
      <div class="ctrl"><a class="btn quiet" href="#/m/${model.folder}/guide/${Math.max(0, k - 1)}${suffix}" ${k === 0 ? 'aria-disabled="true" tabindex="-1"' : ''} aria-label="Previous slide"><span aria-hidden="true">&#8592;</span> Slide</a>
        <span class="count" aria-live="polite">${k + 1} / ${model.guide.length}</span>
        <a class="btn primary" href="#/m/${model.folder}/guide/${Math.min(model.guide.length - 1, k + 1)}${suffix}" ${k === model.guide.length - 1 ? 'aria-disabled="true" tabindex="-1"' : ''} aria-label="Next slide">Slide <span aria-hidden="true">&#8594;</span></a></div>
      </div></main>`;
    app.innerHTML = header({ model, idx: from, level: 'guide' }) + main;
    const deck = $('.deck');
    let sx = null;
    deck.addEventListener('pointerdown', e => { sx = e.clientX; });
    deck.addEventListener('pointerup', e => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 60) go(`#/m/${model.folder}/guide/${Math.max(0, Math.min(model.guide.length - 1, k + (dx < 0 ? 1 : -1)))}${suffix}`); });
    document.onkeydown = e => {
      if (!location.hash.includes('/guide/')) { document.onkeydown = null; return; }
      if (e.key === 'ArrowRight') go(`#/m/${model.folder}/guide/${Math.min(model.guide.length - 1, k + 1)}${suffix}`);
      if (e.key === 'ArrowLeft') go(`#/m/${model.folder}/guide/${Math.max(0, k - 1)}${suffix}`);
    };
    focusMain();
  }

  // ------------------------------------------------------------------ prompts: produce, then read
  function mountPrompt(el, model, pid) {
    const p = model.prompts[pid];
    if (!p) { el.innerHTML = `<p class="muted">[prompt ${esc(pid)} is not described in module.json]</p>`; return; }
    el.style.cssText = `--ph:var(--ph-${phaseOf(model.steps.find(s => s.pids.includes(pid))?.block || {})})`;
    // a type this renderer does not know shows its ask with a text answer (standard §4a, §11 rule 3); the by-hand types are named
    const kind = { chart: mountChart, choice: mountChoice, 'short-answer': mountText, 'long-answer': mountText, reflect: mountReflect, sketch: mountOffPage, animate: mountOffPage, record: mountOffPage }[p.type] || mountText;
    kind(el, model, p);
    // r2 quirk: the question is often written twice, once in the block's prose and once as the prompt's ask.
    // When the paragraph just above says the same thing, the widget's copy stays for screen readers only.
    const prev = el.previousElementSibling;
    const words = t => new Set(String(t).toLowerCase().match(/[a-z0-9]+/g) || []);
    if (prev && prev.tagName === 'P') {
      const a = words(p.ask), b = words(prev.textContent);
      const inter = [...a].filter(x => b.has(x)).length;
      if (a.size && inter / a.size >= 0.6) el.classList.add('ask-above');
    }
  }
  const TYPE_LABEL = { chart: 'Place the dots', choice: 'Pick one', 'short-answer': 'In your own words', 'long-answer': 'In any form you like', reflect: 'In your own words', sketch: 'Sketch it', animate: 'Animate it', record: 'Record it' };
  function ptag(p) {
    return `<div class="prompt-top ptag"><span class="pk">${p.repeat_of ? 'Again, from memory' : 'Your turn'}</span><span class="pn">${esc(TYPE_LABEL[p.type] || TYPE_LABEL['short-answer'])}. Nothing here is scored${p.resettable === false ? '' : ', and you can redo it'}.</span></div>`;
  }
  function firstPassOf(model, p) {
    if (!p.shows_first_pass || !p.repeat_of) return null;
    const a = ms(model.id).answers[p.repeat_of];
    return a && a.committed && a.value != null ? a : null;   // a chart answered in words has no dots to compare
  }
  // the lesson the prompt points at, inside the commentary
  function explainHTML(model, p, collapsed) {
    const b = p.explains_with && model.blocks.find(x => x.id === p.explains_with);
    if (!b) return '';
    const inner = `<div class="explain"${cl(b.language)}><p class="ex-why">Why · ${esc(b.title)}</p>${renderMD(model, blockMD(b).replace(/^#\s+.*$/m, ''), { noPrompts: true, top: 2 })}</div>`;
    return collapsed ? `<details class="explain-wrap"><summary class="linkish">Read the explanation again: ${esc(b.title)}</summary>${inner}</details>` : inner;
  }
  // The commentary: what opens after a commit (or before, for a student who reads first). A named region, so a
  // listener hears what opened when focus lands on it.
  let rvN = 0;
  function commentary(inner, committed) {
    const n = ++rvN;
    return `<div class="reveal commentary" role="region" aria-labelledby="rv-k${n} rv-h${n}"><p class="ex-k" id="rv-k${n}">${committed ? 'Commentary' : 'Commentary, read first'}</p><h2 class="ex-h" id="rv-h${n}">${committed ? 'Now read it against what you made' : 'The explanation, before you try'}</h2>${inner}</div>`;
  }
  function markExplained(model, p) {
    if (p.explains_with && !p.repeat_of) { ms(model.id).readInline[p.explains_with] = true; persist(); }
  }
  const HUMAN = { accept: 'The answer', first: 'What comes first', why: 'Why', note: 'Note', also_taught: 'Also in the lesson' };
  function answerHTML(p, skip = []) {
    const a = p.answer;
    if (a == null) return p.answer_note ? `<div class="answer"><p class="h4">About this one</p><p>${esc(p.answer_note)}</p></div>` : '';
    const show = v => Array.isArray(v) ? (v.length > 1 ? `<ul>${v.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : esc(v[0])) : esc(v);
    if (typeof a === 'string') return `<div class="answer"><p class="h4">What the course says</p><p class="model">${esc(a)}</p></div>`;
    if (Array.isArray(a)) return `<div class="answer"><p class="h4">What the course says</p>${show(a)}</div>`;
    const rows = Object.keys(a).filter(k => !skip.includes(k) && k !== 'reference' && k !== 'accept_if').map(k => {
      const label = k === 'accept' && Array.isArray(a[k]) && a[k].length > 1 ? 'Any of these is the idea' : HUMAN[k] || k.replace(/_/g, ' ');
      return `<dt>${esc(label[0].toUpperCase() + label.slice(1))}</dt><dd>${show(a[k])}</dd>`;
    }).join('');
    return rows ? `<div class="answer"><p class="h4">What the course says</p><dl>${rows}</dl></div>` : '';
  }
  function redoBtn(p) { return p.resettable === false ? '' : `<button type="button" class="btn small quiet" data-act="redo">Redo this one</button>`; }
  function historyLine(st) { return st.history && st.history.length ? `<p class="history">Earlier tries kept on this device: ${st.history.length}. Redoing never touches your other answers.</p>` : ''; }
  function commit(model, p, value) {
    const st = ans(model.id, p.id);
    st.value = value; st.committed = true; st.at = new Date().toISOString(); delete st.draft;
    markExplained(model, p);
    persist(); askConsent(); refreshAnchor();
    if (LIVE) LIVE.committed(model, p, value);
  }
  function redo(model, p) {
    const st = ans(model.id, p.id);
    if (st.committed) st.history.push({ value: st.value, written: st.written, at: st.at, judged: st.judged });
    st.committed = false; st.value = undefined; st.written = undefined; st.judged = {};
    persist(); refreshAnchor();
  }

  // --- text answers (short-answer, long-answer) -----------------------------------------------
  function mountText(el, model, p) {
    const st = ans(model.id, p.id);
    const fp = firstPassOf(model, p);
    const long = p.type === 'long-answer';
    const readFirst = ms(model.id).readFirst;
    el.classList.toggle('committed', !!st.committed);
    el.innerHTML = ptag(p) + `<p class="ask" id="ask-${p.id}"${cl(p.language)}>${esc(p.ask)}</p>` +
      (fp ? `<div class="firstpass"><b>Your first pass</b>${esc(fp.value)}</div>` : '') +
      (st.committed
        ? `<div class="locked" role="group" aria-label="Your answer">${esc(st.value)}</div>
           <div class="row commit-row"><span class="status">${p.answer == null ? 'Kept on this device.' : 'Committed. Earlier tries are always kept.'}</span>${redoBtn(p)}</div>
           ${commentary(answerHTML(p) + explainHTML(model, p, !!p.repeat_of) + historyLine(st), true)}`
        : `<textarea id="ta-${p.id}" aria-labelledby="ask-${p.id}" placeholder="${long ? 'A word, a sentence, or “I don’t know yet”' : 'A guess is fine. Write it in your own words.'}">${esc(st.draft || '')}</textarea>
           ${long ? `<div class="chips"><button type="button" class="chip" data-act="idk">I don't know yet</button></div>` : ''}
           <div class="row commit-row"><button type="button" class="btn primary" data-act="commit" ${st.draft ? '' : 'disabled'}>${p.answer == null ? 'Keep this answer' : 'Commit my answer'}</button>
           <span class="status hint">${p.answer == null ? '' : 'The explanation opens when you commit.'}</span></div>
           ${readFirst ? commentary(answerHTML(p) + explainHTML(model, p, false), false) : ''}`);
    const ta = $('textarea', el), cb = $('[data-act=commit]', el);
    if (ta) ta.addEventListener('input', () => { st.draft = ta.value; cb.disabled = !ta.value.trim(); persistSoon(); });
    el.onclick = e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'idk') { ta.value = "I don't know yet"; st.draft = ta.value; cb.disabled = false; }
      if (a.dataset.act === 'commit' && ta.value.trim()) { commit(model, p, ta.value.trim()); mountText(el, model, p); focusReveal(el); }
      if (a.dataset.act === 'redo') { redo(model, p); mountText(el, model, p); $('textarea', el).focus(); }
    };
  }
  let psT; function persistSoon() { clearTimeout(psT); psT = setTimeout(persist, 400); }
  function focusReveal(el) {
    const r = $('.reveal', el) || el;
    r.setAttribute('tabindex', '-1'); r.focus({ preventScroll: true });
    const y = el.getBoundingClientRect().top + window.scrollY - (($('.head') || {}).offsetHeight || 70) - 8;
    window.scrollTo({ top: y, behavior: REDUCED ? 'auto' : 'smooth' });
  }

  // --- choice ----------------------------------------------------------------------------------
  function mountChoice(el, model, p) {
    const st = ans(model.id, p.id);
    const fp = firstPassOf(model, p);
    const readFirst = ms(model.id).readFirst;
    const accepts = p.answer && (Array.isArray(p.answer.accept) ? p.answer.accept : p.answer.accept ? [p.answer.accept] : []);
    el.classList.toggle('committed', !!st.committed);
    const sel = st.committed ? st.value : st.draft;
    el.innerHTML = ptag(p) + `<p class="ask" id="ask-${p.id}"${cl(p.language)}>${esc(p.ask)}</p>` +
      (fp ? `<div class="firstpass"><b>Your first pass</b>You chose ${esc(fp.value)}</div>` : '') +
      `<div class="options" role="radiogroup" aria-labelledby="ask-${p.id}"${cl(p.language)}>` + (p.options || []).map((o, i) => {
        const on = sel === o;
        return `<button type="button" class="chip opt${st.committed && accepts && accepts.includes(o) ? ' ok' : ''}" role="radio" aria-checked="${on}" tabindex="${on || (!sel && i === 0) ? 0 : -1}" data-opt="${esc(o)}" ${st.committed ? 'aria-disabled="true"' : ''}>${esc(o)}</button>`;
      }).join('') + `</div>` +
      (st.committed
        ? `<div class="row commit-row"><span class="status">You committed <b>${esc(st.value)}</b>.</span>${redoBtn(p)}</div>
           ${commentary(`${accepts && accepts.length ? `<div class="answer"><p class="h4">What the course says</p><p class="model">${accepts.length > 1 ? 'Working answers: ' : ''}<b>${accepts.map(esc).join(' or ')}</b>. ${accepts.includes(st.value) ? 'Yours is one of them.' : 'Yours was ' + esc(st.value) + '; read why below.'}</p>${p.answer.note ? `<p>${esc(p.answer.note)}</p>` : ''}</div>` : answerHTML(p)}
           ${explainHTML(model, p, !!p.repeat_of)}${historyLine(st)}`, true)}`
        : `<div class="row commit-row"><button type="button" class="btn primary" data-act="commit" ${sel ? '' : 'disabled'}>Commit my answer</button><span class="status hint">The explanation opens when you commit.</span></div>
           ${readFirst ? commentary(answerHTML(p) + explainHTML(model, p, false), false) : ''}`);
    const radios = $$('[role=radio]', el);
    el.onclick = e => {
      const o = e.target.closest('[data-opt]');
      if (o && !st.committed) { st.draft = o.dataset.opt; persistSoon(); radios.forEach(r => { r.setAttribute('aria-checked', r === o); r.tabIndex = r === o ? 0 : -1; }); $('[data-act=commit]', el).disabled = false; return; }
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'commit' && st.draft) { commit(model, p, st.draft); mountChoice(el, model, p); focusReveal(el); }
      if (a.dataset.act === 'redo') { redo(model, p); mountChoice(el, model, p); const f = $('[role=radio]', el); if (f) f.focus(); }
    };
    el.onkeydown = e => {
      const i = radios.indexOf(document.activeElement); if (i < 0 || st.committed) return;
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
      e.preventDefault(); const n = radios[(i + d + radios.length) % radios.length]; n.focus(); n.click();
    };
  }

  // --- reflect (self-check: free text plus chips; never summed) --------------------------------
  function mountReflect(el, model, p) {
    const st = ans(model.id, p.id);
    const v = st.committed ? st.value : st.draft || {};
    el.innerHTML = ptag(p) + `<p class="ask" id="ask-${p.id}"${cl(p.language)}>${esc(p.ask)}</p>
      <textarea id="ta-${p.id}" aria-labelledby="ask-${p.id}" placeholder="A few words of your own">${esc(v.text || '')}</textarea>
      ${p.options ? `<p class="small muted" id="chips-${p.id}">And if you like, the word that fits:</p><div class="chips" role="group" aria-labelledby="chips-${p.id}">${p.options.map(o => `<button type="button" class="chip" aria-pressed="${v.chip === o}" data-chip="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}
      <div class="row commit-row"><button type="button" class="btn primary" data-act="save">${st.committed ? 'Saved' : 'Save'}</button><span class="status">${st.committed ? 'Kept on this device.' : ''}</span>${st.committed ? redoBtn(p) : ''}</div>
      ${p.answer_note ? `<p class="history">${esc(p.answer_note)}</p>` : ''}`;
    const ta = $('textarea', el);
    const cur = () => ({ text: ta.value.trim(), chip: ($('[aria-pressed=true]', el) || {}).dataset ? $('[aria-pressed=true]', el).dataset.chip : null });
    ta.addEventListener('input', () => { st.draft = cur(); if (st.committed) { st.committed = false; $('[data-act=save]', el).textContent = 'Save'; } persistSoon(); });
    el.onclick = e => {
      const c = e.target.closest('[data-chip]');
      if (c) { const on = c.getAttribute('aria-pressed') === 'true'; $$('[data-chip]', el).forEach(x => x.setAttribute('aria-pressed', 'false')); c.setAttribute('aria-pressed', String(!on)); st.draft = cur(); st.committed = false; $('[data-act=save]', el).textContent = 'Save'; return; }
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'save') { const val = cur(); if (!val.text && !val.chip) return; commit(model, p, val); mountReflect(el, model, p); const sv = $('[data-act=save]', el); if (sv) sv.focus({ preventScroll: true }); announce(mem.consent === 'yes' || (ACC && ACC.state === 'member') ? 'Saved. Kept on this device.' : 'Saved for this visit.'); }
      if (a.dataset.act === 'redo') { redo(model, p); mountReflect(el, model, p); const t2 = $('textarea', el); if (t2) t2.focus({ preventScroll: true }); }
    };
  }

  // --- a prompt type done off the page (sketch, animate, record) --------------------------------
  // "Answer another way" is offered where the course gives another way (standard §4a: fallback, how to answer on paper or in
  // a plain text box, required for sketch, animate, record). The course's words are shown with a text box; the answer is kept
  // like any written one. Where the course gives none, there is no button.
  const otherWay = new Set();                               // prompts where the student has opened it (not saved)
  function mountOffPage(el, model, p) {
    const st = ans(model.id, p.id);
    const key = model.id + '#' + p.id;
    const way = typeof p.fallback === 'string' ? p.fallback.trim() : '';
    const wrote = st.committed && typeof st.value === 'string' && st.value !== 'done';
    const open = !!way && !st.committed && otherWay.has(key);
    el.innerHTML = ptag(p) + `<p class="ask" id="ask-${p.id}"${cl(p.language)}>${esc(p.ask)}</p>` +
      (open
        ? `<div class="otherway"><p class="small muted">Another way to answer this one:</p><p class="way"${cl(p.language)}>${esc(way)}</p>
           <textarea id="ta-${p.id}" aria-labelledby="ask-${p.id}" placeholder="Write it here, in your own words">${esc(st.draft || '')}</textarea>
           <div class="row commit-row"><button type="button" class="btn primary" data-act="keep" ${st.draft ? '' : 'disabled'}>Keep this answer</button><button type="button" class="btn quiet" data-act="back">Back to doing it by hand</button></div></div>`
        : st.committed && wrote
          ? `<div class="locked" role="group" aria-label="Your answer">${esc(st.value)}</div><div class="row commit-row"><span class="status">Kept on this device.</span>${redoBtn(p)}</div>`
          : `<p class="small muted">You do this one in your own tool, by hand. The page only keeps a note that you did it.</p>
             <div class="row commit-row"><button type="button" class="btn ${st.committed ? 'quiet' : 'primary'}" data-act="done">${st.committed ? 'Done ✓' : 'I have done it'}</button>${!st.committed && way ? `<button type="button" class="btn quiet" data-act="other">Answer another way</button>` : ''}${st.committed ? redoBtn(p) : ''}</div>`) +
      (st.committed ? commentary(answerHTML(p) + explainHTML(model, p, false), true) : '');
    const ta = $('textarea', el), kb = $('[data-act=keep]', el);
    if (ta) ta.addEventListener('input', () => { st.draft = ta.value; kb.disabled = !ta.value.trim(); persistSoon(); });
    el.onclick = e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act;
      if (act === 'done' && !st.committed) { commit(model, p, 'done'); mountOffPage(el, model, p); }
      if (act === 'other') { otherWay.add(key); mountOffPage(el, model, p); const t = $('textarea', el); if (t) t.focus(); }
      if (act === 'back') { otherWay.delete(key); mountOffPage(el, model, p); const b = $('[data-act=other]', el); if (b) b.focus(); }
      if (act === 'keep' && ta && ta.value.trim()) { commit(model, p, ta.value.trim()); otherWay.delete(key); mountOffPage(el, model, p); focusReveal(el); }
      if (act === 'redo') { redo(model, p); otherWay.delete(key); mountOffPage(el, model, p); }
    };
  }

  // ------------------------------------------------------------------ THE CHART INSTRUMENT
  function parseAxis(u, fallback) {
    if (u && typeof u === 'object') return Object.assign({ step: 1 }, fallback, u);           // r3: {min,max,step,snap}
    const s = String(u || '');
    const m = s.match(/(-?\d+(?:\.\d+)?)\s*(?:\(([^)]*)\))?\s*to\s*(-?\d+(?:\.\d+)?)\s*(?:\(([^)]*)\))?/);
    const name = s.split(',')[0].trim();
    if (!m) return Object.assign({ name }, fallback);
    return Object.assign({}, fallback, { name, min: +m[1], max: +m[3], minLabel: m[2] || '', maxLabel: m[4] || '' });
  }
  const players = new Set();
  function stopPlayers() { players.forEach(f => f()); players.clear(); }

  // A chart answered in words (standard §4a: a chart carries a fallback, how to answer on paper or in a plain text box). The words
  // are kept in the answer's own fields, written and writtenDraft, and the chart's value and draft are never touched, so the compare
  // and reference views, which read those as lists of numbers, never meet a text.
  function mountWritten(el, model, p, way) {
    const st = ans(model.id, p.id), key = model.id + '#' + p.id;
    const done = st.committed && st.written != null;
    const judge = p.answer && Array.isArray(p.answer.accept_if) ? p.answer.accept_if : [];
    el.classList.toggle('committed', !!done);
    el.innerHTML = ptag(p) + `<p class="ask" id="ask-${p.id}"${cl(p.language)}>${esc(p.ask)}</p>` +
      (done
        ? `<div class="locked" role="group" aria-label="Your answer">${esc(st.written)}</div><div class="row commit-row"><span class="status">Kept on this device, in words. Earlier tries are always kept.</span>${redoBtn(p)}</div>` +
          commentary((judge.length ? `<div class="answer"><p class="h4">Your answer is right if these are true</p><p class="small">Judge for yourself. Nothing is scored.</p><ol class="judge">${judge.map(x => `<li>${esc(sentence(x))}</li>`).join('')}</ol></div>` : '') + answerHTML(p) + explainHTML(model, p, !!p.repeat_of) + historyLine(st), true)
        : `<div class="otherway"><p class="small muted">Another way to answer this one:</p><p class="way"${cl(p.language)}>${esc(way)}</p>
           <textarea id="ta-${p.id}" aria-labelledby="ask-${p.id}" placeholder="Write it here, in your own words">${esc(st.writtenDraft || '')}</textarea>
           <div class="row commit-row"><button type="button" class="btn primary" data-act="keep" ${st.writtenDraft ? '' : 'disabled'}>Keep this answer</button><button type="button" class="btn quiet" data-act="back">Back to the chart</button></div></div>`);
    const ta = $('textarea', el), kb = $('[data-act=keep]', el);
    if (ta) ta.addEventListener('input', () => { st.writtenDraft = ta.value; kb.disabled = !ta.value.trim(); persistSoon(); });
    el.onclick = e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act;
      if (act === 'back') { otherWay.delete(key); mountChart(el, model, p); const b = $('[data-act=other]', el); if (b) b.focus(); }
      if (act === 'keep' && ta && ta.value.trim()) {
        st.written = ta.value.trim(); st.value = null; st.committed = true; st.at = new Date().toISOString(); delete st.writtenDraft; otherWay.delete(key);
        markExplained(model, p); persist(); askConsent(); refreshAnchor(); mountChart(el, model, p); focusReveal(el);
      }
      if (act === 'redo') { redo(model, p); otherWay.delete(key); mountChart(el, model, p); const c = $('.col', el); if (c) c.focus({ preventScroll: true }); }
    };
  }
  function mountChart(el, model, p) {
    const st = ans(model.id, p.id);
    const way = typeof p.fallback === 'string' ? p.fallback.trim() : '', wayKey = model.id + '#' + p.id;
    if (way && ((st.committed && st.written != null) || (!st.committed && otherWay.has(wayKey)))) return mountWritten(el, model, p, way);
    const ref = p.answer && Array.isArray(p.answer.reference) ? p.answer.reference : null;
    const ax = parseAxis(p.units && p.units.x, { min: 1, max: ref ? ref.length : 12 });
    const ay = parseAxis(p.units && p.units.y, { min: 0, max: 10 });
    const fpsM = String((p.units && p.units.x) || '').match(/(\d+)\s*frames per second/);
    const fps = fpsM ? +fpsM[1] : 24;
    const N = Math.round(ax.max - ax.min + 1);
    const SNAP = ay.snap || 0.25, KSTEP = 0.5, PSTEP = 2;
    // The words for the two axes are the prompt's own (standard §4a units.x.label, units.y.label): a column's name is its
    // label's first words (up to a comma or a bracket), the value's name likewise, and the value's unit follows ", in ".
    // With no label: "column" and "value".
    const labelHead = a => String(a.label || a.name || '').split(/[,(]/)[0].trim().toLowerCase();
    const colWord = labelHead(ax) || 'column', valWord = labelHead(ay) || 'value';
    const valUnit = ((String(ay.label || '').match(/,\s*in\s+([^()]+?)\s*(?:\(|$)/i) || [])[1] || '').trim();
    const fmt = v => (Math.round(v * 100) / 100).toString();
    const withUnit = v => fmt(v) + (valUnit ? ' ' + valUnit : '');
    const colName = i => `${cap(colWord)} ${ax.min + i}`;
    const fp = firstPassOf(model, p);
    const lastTry = () => { const h = (st.history || []).slice().reverse().find(x => Array.isArray(x.value)); return h ? h.value : null; };   // an earlier try in words has no dots
    let vals = st.committed ? st.value.slice() : (st.draft ? st.draft.slice() : new Array(N).fill(null));
    let showRef = true, showCompare = !!fp, compareSrc = fp ? 'first' : null;
    const readFirst = ms(model.id).readFirst && !p.repeat_of;
    const worked = p.worked_example && model.assets[p.worked_example];

    el.classList.toggle('committed', !!st.committed);
    el.innerHTML = ptag(p) + `<p class="ask" id="ask-${p.id}"${cl(p.language)}>${esc(p.ask)}</p>
      <p class="hint-line">Each column is one ${esc(colWord)}, ${ax.min} to ${ax.max}. ${esc(cap(valWord))} runs from <b>${ay.min}</b>${ay.minLabel ? ` (${esc(ay.minLabel)})` : ''} to <b>${ay.max}</b>${ay.maxLabel ? ` (${esc(ay.maxLabel)})` : ''}. ${st.committed ? '' : 'Tap a column to put its dot there, or drag your thumb across to draw them all.'}</p>
      <div class="chart-wrap"><svg class="chart plot" role="group" aria-labelledby="ask-${p.id}" aria-describedby="kb-${p.id}"></svg><svg class="chart gaps" aria-hidden="true"></svg></div>
      <p class="sr-only" id="kb-${p.id}">Keyboard: Tab to a ${esc(colWord)}, then Up and Down arrows move its dot by ${KSTEP}${valUnit ? ' ' + esc(valUnit) : ''}, Page Up and Page Down by ${PSTEP}, Home to the lowest value (${ay.min}), End to the highest (${ay.max}).</p>
      <div class="legend" aria-hidden="true"></div>
      <div class="chart-tools">
        <button type="button" class="btn small quiet" data-act="play"><span aria-hidden="true">&#9654;</span> Play it</button>
        <button type="button" class="btn small quiet" data-act="slow">Slow motion</button>
        ${st.committed ? '' : `<button type="button" class="linkbtn" data-act="clear">Clear the dots</button>`}
        ${st.committed && ref ? `<button type="button" class="chip" data-act="toggleRef" aria-pressed="${showRef}">Show the reference</button>` : ''}
        ${fp || lastTry() ? `<button type="button" class="chip" data-act="toggleCmp" aria-pressed="${showCompare}">${fp ? 'Show my first pass' : 'Show my last try'}</button>` : ''}
      </div>
      <div class="row commit-row">${st.committed
        ? `<span class="status">Committed. Earlier tries are always kept.</span>${redoBtn(p)}`
        : `<button type="button" class="btn primary" data-act="commit" disabled>Commit my chart</button>${way ? `<button type="button" class="btn quiet" data-act="other">Answer another way</button>` : ''}<span class="status count-line" aria-live="polite"></span>`}</div>
      <div class="after"></div>`;

    const plot = $('svg.plot', el), gaps = $('svg.gaps', el);
    let W, H, X0, X1, Y0, Y1, colW, lane;
    function layout() {
      W = Math.max(280, Math.round($('.chart-wrap', el).clientWidth || 320));
      lane = 20;                               // a play lane on each side: yours left, reference right
      X0 = lane; X1 = W - lane; colW = (X1 - X0) / N;
      Y0 = 12; Y1 = Math.round(Math.min(300, Math.max(220, W * 0.78)));
      H = Y1 + 30;
      plot.setAttribute('viewBox', `0 0 ${W} ${H}`); plot.setAttribute('width', W); plot.setAttribute('height', H);
      gaps.setAttribute('viewBox', `0 0 ${W} 74`); gaps.setAttribute('width', W); gaps.setAttribute('height', 74);
    }
    const yOf = v => Y1 - (v - ay.min) / (ay.max - ay.min) * (Y1 - Y0);
    const xOf = i => X0 + colW * (i + 0.5);
    const clampV = v => Math.max(ay.min, Math.min(ay.max, v));
    const snap = v => clampV(Math.round(v / SNAP) * SNAP);
    const compareVals = () => compareSrc === 'first' && fp ? fp.value : lastTry();

    function draw() {
      const grid = [];
      for (let v = ay.min; v <= ay.max; v++) {
        const y = yOf(v);
        grid.push(`<line x1="${X0}" x2="${X1}" y1="${y}" y2="${y}" class="${v % 2 === 0 ? 'major' : ''}"/>`);
      }
      for (let i = 0; i < N; i++) if (i % 2 === 0) grid.unshift(`<rect class="band" x="${X0 + colW * i}" y="${Y0}" width="${colW}" height="${Y1 - Y0}"/>`);
      const ylab = []; for (let v = ay.min; v <= ay.max; v += 2) ylab.push(`<text class="ax ylab" x="${X0 - 5}" y="${yOf(v) + 4}" text-anchor="end">${v}</text>`);
      const xlab = []; for (let i = 0; i < N; i++) xlab.push(`<text class="ax" x="${xOf(i)}" y="${Y1 + 23}" text-anchor="middle">${ax.min + i}</text>`);
      const cols = [];
      for (let i = 0; i < N; i++) {
        const v = vals[i];
        cols.push(`<g class="col" data-i="${i}" role="slider" tabindex="${st.committed ? -1 : 0}" aria-orientation="vertical" aria-valuemin="${ay.min}" aria-valuemax="${ay.max}" ${v != null ? `aria-valuenow="${v}"` : ''}
          aria-valuetext="${esc(v != null ? `${colName(i)}: ${withUnit(v)}` : `${colName(i)}: no dot yet`)}" aria-label="${esc(colName(i))}"${st.committed ? ' aria-readonly="true"' : ''}>
          <rect class="col-bg" x="${X0 + colW * i + 1}" y="${Y0 - 6}" width="${colW - 2}" height="${Y1 - Y0 + 12}" rx="6"/>
          <rect class="col-hit" x="${X0 + colW * i}" y="0" width="${colW}" height="${H}"/>
          ${v != null ? `<circle class="dot" cx="${xOf(i)}" cy="${yOf(v)}" r="${Math.min(9, colW * 0.36)}"/>` : ''}
        </g>`);
      }
      const placed = vals.map((v, i) => v == null ? null : `${xOf(i)},${yOf(v)}`).filter(Boolean);
      let over = placed.length > 1 ? `<polyline class="path" points="${placed.join(' ')}"/>` : '';
      const cmp = showCompare && compareVals();
      if (cmp) over += cmp.map((v, i) => v == null ? '' : `<g class="first"><line x1="${xOf(i) - 5}" y1="${yOf(v) - 5}" x2="${xOf(i) + 5}" y2="${yOf(v) + 5}"/><line x1="${xOf(i) + 5}" y1="${yOf(v) - 5}" x2="${xOf(i) - 5}" y2="${yOf(v) + 5}"/></g>`).join('');
      const revealRef = ref && showRef && (st.committed || readFirst);
      if (revealRef) {
        over += `<polyline class="refline" points="${ref.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ')}"/>`;
        over += ref.map((v, i) => { const x = xOf(i), y = yOf(v), r = 6.5; return `<path class="ref ${el._justCommitted ? 'refin' : ''}" style="transform-origin:${x}px ${y}px;animation-delay:${i * 45}ms" d="M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z"/>`; }).join('');
      }
      const lanes = `<rect class="lane" x="3" y="${Y0 - 6}" width="${lane - 7}" height="${Y1 - Y0 + 12}" rx="8" opacity="0"/>
        <circle class="pmark" cx="${lane / 2}" cy="${yOf(ay.max)}" r="7" style="display:none"/>
        <path class="pref" d="" style="display:none"/>`;
      plot.innerHTML = `<g class="grid">${grid.join('')}</g><line class="floor" x1="${X0}" x2="${X1}" y1="${yOf(ay.min)}" y2="${yOf(ay.min)}"/>
        ${ylab.join('')}${xlab.join('')}<g class="cols">${cols.join('')}</g><g class="over" pointer-events="none">${over}</g>${lanes}`;
      plot.classList.toggle('is-locked', !!st.committed);
      drawGaps(revealRef);
      drawLegend(revealRef, cmp);
      updateStatus();
      el._justCommitted = false;
    }
    function gapsOf(a) { const g = []; for (let i = 0; i < a.length - 1; i++) g.push(a[i] != null && a[i + 1] != null ? Math.abs(a[i + 1] - a[i]) : null); return g; }
    function drawGaps(revealRef) {
      const g = gapsOf(vals), gr = revealRef ? gapsOf(ref) : [];
      const max = Math.max(1, ...g.filter(x => x != null), ...gr);
      const base = 64, hmax = 40;
      let s = `<text class="gaplbl" x="${X0}" y="11">How far it moves each ${esc(colWord)}</text><line class="gapbase" x1="${X0}" x2="${X1}" y1="${base}" y2="${base}"/>`;
      for (let i = 0; i < N - 1; i++) {
        const x = X0 + colW * (i + 1);
        const bw = Math.min(10, colW * 0.36);
        if (g[i] != null) {
          const h = Math.max(1.5, g[i] / max * hmax);
          s += `<rect class="gapbar" x="${x - (revealRef ? bw + 1 : bw / 2)}" y="${base - h}" width="${bw}" height="${h}" rx="2"/>`;
          if (!revealRef) s += `<text class="gapnum" x="${x}" y="${base - h - 3}" text-anchor="middle">${fmt(g[i])}</text>`;
        }
        if (revealRef && gr[i] != null) { const h = Math.max(1.5, gr[i] / max * hmax); s += `<rect class="gapref" x="${x + 1}" y="${base - h}" width="${bw}" height="${h}" rx="2"/>`; }
      }
      gaps.innerHTML = s;
    }
    function drawLegend(revealRef, cmp) {
      const L = $('.legend', el);
      L.innerHTML = `<span><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" class="lg-dot"/></svg>Your dots</span>` +
        (revealRef ? `<span><svg viewBox="0 0 16 16"><path d="M8 1.5L14.5 8L8 14.5L1.5 8Z" class="lg-ref"/></svg>One good answer (reference)</span>` : '') +
        (cmp ? `<span><svg viewBox="0 0 16 16"><path d="M3 3L13 13M13 3L3 13" class="lg-first"/></svg>${compareSrc === 'first' ? 'Your first pass' : 'Your last try'}</span>` : '');
    }
    function updateStatus() {
      const n = vals.filter(v => v != null).length;
      const s = $('.count-line', el); if (s) s.textContent = n < N ? `${n} of ${N} ${colWord}s placed` : `All ${colWord}s placed. Play it, or commit.`;
      const c = $('[data-act=commit]', el); if (c) c.disabled = n < N;
      const pl = $('[data-act=play]', el); if (pl) pl.disabled = n < 2;
      const sl = $('[data-act=slow]', el); if (sl) sl.disabled = n < 2;
    }
    function setVal(i, v) {
      vals[i] = v;
      const g = $(`.col[data-i="${i}"]`, plot);
      if (!g) return;
      let dot = $('.dot', g);
      if (!dot) { dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('class', 'dot'); dot.setAttribute('r', Math.min(9, colW * 0.36)); dot.setAttribute('cx', xOf(i)); g.appendChild(dot); }
      dot.setAttribute('cy', yOf(v));
      g.setAttribute('aria-valuenow', v); g.setAttribute('aria-valuetext', `${colName(i)}: ${withUnit(v)}`);
      const pl = $('.over .path', plot), pts = vals.map((x, k) => x == null ? null : `${xOf(k)},${yOf(x)}`).filter(Boolean);
      if (pl) pl.setAttribute('points', pts.join(' '));
      else if (pts.length > 1) { const n = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); n.setAttribute('class', 'path'); n.setAttribute('points', pts.join(' ')); $('.over', plot).prepend(n); }
    }
    function saveDraft() { if (!st.committed) { st.draft = vals.slice(); persistSoon(); } drawGaps(false); updateStatus(); }

    // pointer: tap a column, or drag across columns to paint
    let painting = false, lastI = null, lastV = null;
    function pt(e) { const r = plot.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }; }
    function paintAt(e) {
      const { x, y } = pt(e);
      const i = Math.max(0, Math.min(N - 1, Math.floor((x - X0) / colW)));
      const v = snap(ay.min + (Y1 - y) / (Y1 - Y0) * (ay.max - ay.min));
      if (lastI != null && Math.abs(i - lastI) > 1) {
        const d = i > lastI ? 1 : -1;
        for (let k = lastI + d; k !== i; k += d) setVal(k, snap(lastV + (v - lastV) * (k - lastI) / (i - lastI)));
      }
      setVal(i, v); lastI = i; lastV = v;
      $$('.col', plot).forEach(c => c.classList.toggle('hover', +c.dataset.i === i));
    }
    plot.addEventListener('pointerdown', e => {
      if (st.committed) return;
      stopPlayers();
      painting = true; lastI = null; plot.setPointerCapture(e.pointerId); paintAt(e); e.preventDefault();
    });
    plot.addEventListener('pointermove', e => { if (painting) paintAt(e); });
    const end = () => { if (!painting) return; painting = false; lastI = null; $$('.col', plot).forEach(c => c.classList.remove('hover')); saveDraft(); };
    plot.addEventListener('pointerup', end); plot.addEventListener('pointercancel', end);
    // keyboard: each column is an APG vertical slider
    plot.addEventListener('keydown', e => {
      const g = e.target.closest('.col'); if (!g || st.committed) return;
      const i = +g.dataset.i;
      const cur = vals[i] != null ? vals[i] : (i > 0 && vals[i - 1] != null ? vals[i - 1] : ay.max);
      const d = { ArrowUp: KSTEP, ArrowRight: KSTEP, ArrowDown: -KSTEP, ArrowLeft: -KSTEP, PageUp: PSTEP, PageDown: -PSTEP }[e.key];
      let v = null;
      if (d != null) v = vals[i] == null ? cur : clampV(cur + d);
      if (e.key === 'Home') v = ay.min; if (e.key === 'End') v = ay.max;
      if (v == null) return;
      e.preventDefault(); setVal(i, v); saveDraft();
    });
    plot.addEventListener('focusin', e => { const g = e.target.closest('.col'); $$('.col', plot).forEach(c => c.classList.toggle('focus', c === g)); });
    plot.addEventListener('focusout', () => $$('.col', plot).forEach(c => c.classList.remove('focus')));

    // play: the chart becomes motion. Yours in the left lane, the reference in the right.
    function play(slow) {
      stopPlayers();
      const seq = vals.map((v, i) => v != null ? v : null);
      const showR = ref && showRef && st.committed;
      const mover = $('.pmark', plot), rb = $('.pref', plot), lanes = $$('.lane', plot);
      $$('.ylab', plot).forEach(t => t.style.opacity = 0);
      lanes.forEach(l => l.setAttribute('opacity', 1));
      mover.style.display = '';
      if (showR) rb.style.display = '';
      const frameMs = 1000 / fps * (slow ? 6 : 1);
      let f = 0, loops = 0, stopped = false, t0 = performance.now(), hold = 0;
      const tick = now => {
        if (stopped) return;
        if (now - t0 >= frameMs) {
          t0 = now;
          if (hold > 0) { hold--; } else {
            $$('.col', plot).forEach(c => c.classList.toggle('playing', +c.dataset.i === f));
            if (seq[f] != null) mover.setAttribute('cy', yOf(seq[f]));
            if (showR) { const x = W - lane / 2, y = yOf(ref[f]), r = 7; rb.setAttribute('d', `M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`); }
            f++;
            if (f >= N) { f = 0; loops++; hold = slow ? 2 : 8; if (loops >= 3) return finish(); }
          }
        }
        raf = requestAnimationFrame(tick);
      };
      let raf = requestAnimationFrame(tick);
      function finish() {
        stopped = true; cancelAnimationFrame(raf);
        mover.style.display = 'none'; rb.style.display = 'none';
        $$('.ylab', plot).forEach(t => t.style.opacity = 1); lanes.forEach(l => l.setAttribute('opacity', 0));
        $$('.col', plot).forEach(c => c.classList.remove('playing'));
        players.delete(finish);
      }
      players.add(finish);
      // put the right-hand lane in view for the reference
      const rl = lanes[0]; if (showR && rl && !$('.lane.r', plot)) { const c = rl.cloneNode(); c.setAttribute('x', W - lane + 4); c.classList.add('r'); plot.insertBefore(c, rb); c.setAttribute('opacity', 1); lanes.push(c); }
    }

    function renderAfter() {
      const after = $('.after', el);
      let h = '';
      if (worked && !st.committed && !p.repeat_of && !model.blocks.some(b => b.md.includes('asset:' + p.worked_example))) {
        h += `<details class="worked"><summary class="linkish">How to read the chart: the worked example</summary>${figureHTML(model, p.worked_example)}</details>`;
      }
      if (st.committed || readFirst) {
        const judge = p.answer && p.answer.accept_if;
        let inner = '';
        // the reference, as numbers: what the diamonds show, for a listener and for anyone who wants the values
        if (ref && st.committed) inner += `<p class="sr-only">One good answer, ${esc(colWord)} by ${esc(colWord)}: ${ref.map((v, i) => `${colName(i)} ${withUnit(v)}`).join(', ')}.</p>`;
        if (ref && st.committed) inner += `<p>The diamonds on your chart are one good answer. You decide whether yours meets each sentence.</p>`;
        if (judge && judge.length) {
          inner += `<div class="answer"><p class="h4">Your chart is right if these are true</p><p class="small">You do not need the exact numbers. Look at your dots and the bars above, and judge for yourself. Nothing is scored.</p>
            <ol class="judge checks">${judge.map((s, k) => `<li><span class="s ck-t">${esc(sentence(s))}</span>${st.committed ? `<span class="chips jg" role="group" aria-label="Does yours meet sentence ${k + 1}?"><button type="button" class="chip" data-judge="${k}" data-v="yes" aria-pressed="${st.judged[k] === 'yes'}">Mine does</button><button type="button" class="chip" data-judge="${k}" data-v="not" aria-pressed="${st.judged[k] === 'not'}">Not yet</button></span>` : ''}</li>`).join('')}</ol></div>`;
        }
        inner += explainHTML(model, p, !!p.repeat_of);
        inner += historyLine(st);
        h += commentary(inner, st.committed);
      }
      after.innerHTML = h;
    }

    el.onclick = e => {
      const a = e.target.closest('[data-act]');
      const j = e.target.closest('[data-judge]');
      if (j) { const k = +j.dataset.judge; st.judged[k] = st.judged[k] === j.dataset.v ? undefined : j.dataset.v; persist(); $$(`[data-judge="${k}"]`, el).forEach(b => b.setAttribute('aria-pressed', st.judged[k] === b.dataset.v)); return; }
      if (!a) return;
      const act = a.dataset.act;
      if (act === 'other') { stopPlayers(); otherWay.add(wayKey); mountChart(el, model, p); const t = $('textarea', el); if (t) t.focus(); return; }
      if (act === 'play') play(false);
      if (act === 'slow') play(true);
      if (act === 'clear') { stopPlayers(); vals = new Array(N).fill(null); st.draft = null; persist(); draw(); announce(`The dots are cleared. 0 of ${N} placed.`); }
      if (act === 'toggleRef') { showRef = !showRef; a.setAttribute('aria-pressed', showRef); draw(); }
      if (act === 'toggleCmp') { showCompare = !showCompare; if (!fp) compareSrc = 'last'; a.setAttribute('aria-pressed', showCompare); draw(); }
      if (act === 'commit' && vals.every(v => v != null)) {
        stopPlayers(); commit(model, p, vals.slice()); el._justCommitted = true; mountChart(el, model, p);
        focusReveal(el);
        setTimeout(() => { if (!REDUCED) play(false); }, ref ? 700 : 100);  // the moment of commit: see both play
      }
      if (act === 'redo') { stopPlayers(); redo(model, p); mountChart(el, model, p); const c = $('.col', el); if (c) c.focus({ preventScroll: true }); }
    };
    layout(); draw(); renderAfter();
    let rT; const onR = () => { clearTimeout(rT); rT = setTimeout(() => { if (!document.body.contains(el)) return window.removeEventListener('resize', onR); layout(); draw(); }, 120); };
    window.addEventListener('resize', onR);
  }

  // ------------------------------------------------------------------ hand in (Discord, M1)
  // Where the hand-in shows (standard §4): on a submit block if the path has one; if not, directly after
  // the block named by assignment.in, which is the last screen of that block.
  function handinHere(model, st) {
    if (model.blocks.some(b => b.kind === 'submit')) return st.block.kind === 'submit';
    const asg = model.mj.assignment;
    const b = asg && asg.in && model.blocks.find(x => x.id === asg.in);
    return !!b && st.idx === b.steps[b.steps.length - 1];
  }
  function handinHTML(model) {
    const asg = model.mj.assignment;
    if (!asg) return '';
    const h = ms(model.id).handin;
    const self = Object.values(model.prompts).find(p => p.type === 'reflect');
    const selfAns = self && ms(model.id).answers[self.id];
    return `<section class="card handin" aria-labelledby="hi-h">
      <p class="kicker">Hand it in</p>
      <h2 id="hi-h">${h ? 'Handed in' : esc(asg.handin_title || 'Send your work to the teacher')}</h2>
      ${h ? `<div class="sent"><p><b>You handed this in</b> on ${esc(WHEN.say(h.at).main)}${h.file ? `, with ${esc(h.file)}` : ''}.${WHEN.say(h.at).local ? ` <span class="when-local">${esc(WHEN.say(h.at).local)}</span>` : ''}</p>
        <p class="small">When the teacher replies in ${esc(CFG.discord.server)}, the reply carries a link. Open it on this device and the feedback appears here, and again where the next ${UNIT} begins.</p></div>
        <p><button type="button" class="linkbtn" id="hi-again">Hand in a new version</button></p>`
      : `<p class="small muted">What to send: ${esc(asg.deliverable)}. You post it yourself in ${esc(CFG.discord.server)}, in a private thread only you and the teacher can see. Your file never goes through Letterman.</p>
      ${ACC && ACC.state === 'member'
        ? `<p class="handin-as">Handing in as <b>${esc(ACC.name)}</b>, your display name. <a href="#/settings">Change your name</a></p>`
        : `<div class="field"><label for="hi-name">The name you want the teacher to use</label><input type="text" id="hi-name" autocomplete="nickname" maxlength="40" value="${esc(mem.name || '')}" placeholder="Any name you like"><p class="help">Your choice. It can be your Discord name, a nickname, or blank.</p></div>`}
      ${selfAns && selfAns.committed ? `<label class="check"><input type="checkbox" id="hi-self" checked> <span>Include my self-check: <b>${esc(selfAns.value.chip || '')}</b>${selfAns.value.text ? ` “${esc(selfAns.value.text)}”` : ''}</span></label>` : ''}
      <div class="field"><label for="hi-note">A line for the teacher (optional)</label><input type="text" id="hi-note" placeholder="What you want them to look at"></div>
      <button type="button" class="btn primary block" id="hi-send">Hand it in on Discord: show me how</button>
      <p class="small muted">Optional, always.</p>`}
    </section>`;
  }
  function mountHandin(model) {
    const again = $('#hi-again');
    if (again) again.onclick = () => { delete ms(model.id).handin; persist(); route(); };
    const send = $('#hi-send');
    if (!send) return;
    send.onclick = async () => {
      const member = ACC && ACC.state === 'member';
      const name = member ? ACC.name : $('#hi-name').value.trim();
      const file = null;   // the student attaches the video in Discord, not here
      const note = $('#hi-note').value.trim();
      const self = Object.values(model.prompts).find(p => p.type === 'reflect');
      const sa = self && ms(model.id).answers[self.id];
      const incSelf = $('#hi-self') && $('#hi-self').checked && sa && sa.committed;
      if (name && !member) { mem.name = name; persist(); }
      const mentions = ((CFG.discord || {}).handinMentions || []).filter(m => /^<@&?\d{5,25}>$/.test(m));
      const text = [
        mentions.length ? mentions.join(' ') : null,   // tells the teacher the thread is there, and adds them to it
        `Hand-in: ${courseShort}, ${unitName(model.meta.module)}: ${model.meta.title}`,
        `From: ${name || 'a student'}`,
        `Work: (my work is attached)`,
        incSelf ? `Self-check: ${sa.value.chip || ''}${sa.value.text ? ' "' + sa.value.text + '"' : ''}` : null,
        note ? `Note: ${note}` : null,
        `(sent from Letterman.)`
      ].filter(Boolean).join('\n');
      const done = () => { ms(model.id).handin = { at: new Date().toISOString(), file: file ? file.name : null }; persist(); closeSheet(true); route(); };
      if (CFG.prototype) {
        sheet(`<p><span class="proto">prototype</span></p><h2>(prototype) would send</h2>
          <p>On a phone, this opens the share sheet with your file and the message below. You pick <b>${esc(CFG.discord.server)}</b>, then <b>${esc(CFG.discord.handinChannel)}</b>. On a computer it copies the message and opens the channel, and you drop the file in.</p>
          <pre>${esc(text)}</pre>
          <p class="small muted">Nothing was sent. The prototype makes no network request.</p>
          <div class="sheet-acts"><button type="button" class="btn primary" id="sh-ok">I posted it: mark as handed in</button><button type="button" class="btn quiet" id="sh-x">Not yet</button></div>`);
        $('#sh-ok').onclick = done; $('#sh-x').onclick = () => closeSheet();
        return;
      }
      // Live: one hand-in channel for every class; each student starts a private thread there that only
      // they and the teacher see (the Academy's setup, 2026-10-02). The page copies; the student posts.
      const thread = `${courseShort}, ${unitName(model.meta.module)}: ${name || 'your name'}`;
      sheet(`<h2>Hand it in on Discord</h2>
        <ol class="hsteps">
          <li><p>Open <b>${esc(CFG.discord.handinChannel)}</b> in ${esc(CFG.discord.server)}.</p>
            <p><a class="btn quiet" href="${esc(CFG.discord.channelUrl)}" target="_blank" rel="noopener">Open the hand-in channel<span class="sr-only"> (opens Discord in a new tab)</span></a></p></li>
          <li><p>Start a <b>private</b> thread: tap the threads icon (or <b>+</b>), choose <b>Create Thread</b>, and set it to <b>Private</b>. Name it:</p>
            <pre id="hs-thread">${esc(thread)}</pre><p><button class="btn quiet" type="button" data-copy="hs-thread">Copy the name</button></p></li>
          <li><p>In your thread, attach your work and paste this message${mentions.length ? '. The copied message also tells the teacher your thread is there' : ''}:</p>
            <pre id="hs-msg" data-full="${esc(text)}">${esc(mentions.length ? text.split('\n').slice(1).join('\n') : text)}</pre><p><button class="btn quiet" type="button" data-copy="hs-msg">Copy the message</button></p></li>
          <li><p>Send it. Only you and the teacher can see a private thread.</p></li>
        </ol>
        <p class="small muted" aria-live="polite" id="hs-said"></p>
        <div class="sheet-acts"><button type="button" class="btn primary" id="sh-ok">I sent it: mark as handed in</button><button type="button" class="btn quiet" id="sh-x">Not yet</button></div>`);
      $$('[data-copy]').forEach(bt => bt.onclick = async () => {
        const src = $('#' + bt.dataset.copy), t = src.dataset.full || src.textContent, said = $('#hs-said');
        try { await navigator.clipboard.writeText(t); said.textContent = 'Copied.'; }
        catch (e) { const r = document.createRange(); r.selectNodeContents($('#' + bt.dataset.copy)); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); said.textContent = 'Selected: copy it with your device\'s copy command.'; }
      });
      $('#sh-ok').onclick = done; $('#sh-x').onclick = () => closeSheet();
    };
  }

  // ------------------------------------------------------------------ hearing back
  function allFeedback() {
    const out = [];
    Object.entries(mem.modules).forEach(([id, m]) => (m.feedback || []).forEach(f => out.push(f)));
    if (HI) out.push(...HI.feedback());   // replies to hand-ins made in Letterman (M2-23)
    return out.sort((a, b) => String(b.received).localeCompare(String(a.received)));
  }
  function b64dec(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  function importFeedback(payload) {
    let fb;
    try { fb = JSON.parse(b64dec(payload)); } catch (e) { fb = null; }
    history.replaceState(null, '', location.pathname + location.search + '#/heard');
    if (!fb || fb.v !== 1 || !fb.m) { viewHeard(); sheet(`<h2>That link did not open</h2><p>It may have been cut short when it was copied. Ask the teacher to send it again; the feedback is also in their Discord reply.</p><button type="button" class="btn primary" id="sh-x">OK</button>`); $('#sh-x').onclick = () => closeSheet(); return; }
    const pkg = Object.values(COURSE.packages).find(p => p.module.meta.id === fb.m);
    const mm = ms(fb.m);
    fb.moduleTitle = pkg ? pkg.module.meta.title : fb.m;
    fb.fromModule = pkg ? pkg.module.meta.module : null;
    fb.carriesInto = fb.fromModule != null ? fb.fromModule + 1 : null;
    fb.received = new Date().toISOString();
    mm.feedback = (mm.feedback || []).filter(x => x.id !== fb.id);
    mm.feedback.unshift(fb);
    persist();
    viewHeard();
  }
  function viewHeard() {
    setTitle('Heard back');
    const list = allFeedback();
    const body = list.length ? list.map(f => {
      const pkg = Object.values(COURSE.packages).find(p => p.module.meta.id === f.m);
      const crit = pkg && pkg.module.assignment ? pkg.module.assignment.criteria : [];
      const notes = (f.notes || []).filter(n => n && n.t);
      return `<article class="card feedback">
        <p class="from">From ${esc(f.from || 'your teacher')}${f.d ? ' · ' + esc(f.d) : ''}${f.dLocal ? `. <span class="when-local">${esc(f.dLocal)}</span>` : ''} · about ${esc(f.moduleTitle)}${f.to ? ' · to ' + esc(f.to) : ''}</p>
        ${f.star ? `<p>${starHTML()}</p><p class="small muted">Only you can see this. It is not a grade, and nothing counts it.</p>` : ''}
        ${f.msg ? `<p class="fb-msg">${esc(f.msg)}</p>` : ''}
        ${notes.length ? `<h2>Against the criteria</h2><ul class="crit">${notes.map(n => `<li><div class="c">${esc(crit[n.c] || 'Criterion ' + (n.c + 1))}</div>${esc(n.t)}</li>`).join('')}</ul>` : ''}
        ${f.forward ? `<h2>Carry this forward</h2><p>${esc(f.forward)}</p><p class="small muted">${f.carriesInto != null ? `This opens at the start of ${unitName(f.carriesInto)}.` : ''}</p>` : ''}
      </article>`;
    }).join('') : `<div class="card heard-none"><p>Nothing yet. When the teacher replies to work you handed in here, the reply shows on this page. A reply in ${esc(CFG.discord.server)} carries a link instead: open it on this device and the feedback lands here too.</p></div>`;
    const ctx = contextModel(), last = lastStep(ctx);
    // what the course shows on Heard back (M2-31): only where it names a measure for it
    const hm = anyMeasure() ? heardMeasuresHTML() : '';
    app.innerHTML = header({ model: ctx, idx: last, level: 'heard' }) + `<main id="main" class="lv lv-page"${uiLang()}><div class="page-col">
      <p class="kicker">Your teacher, to you</p><h1>Heard back</h1>${anyMeasure() ? `<div class="m-place" data-mplace="heard">${hm}</div>` : ''}${body}
      <p><a class="btn quiet" href="${returnTo(ctx)}"><span aria-hidden="true">&#8592;</span> ${last != null ? `Back to step ${last + 1}, where you were` : ctx ? `Back to ${esc(modName(modOf(ctx)))}` : 'Back to the course'}</a></p></div></main>`;
    const none = $('.heard-none'); if (none && hm.trim()) none.hidden = true;
    focusMain();
  }

  // ------------------------------------------------------------------ settings and your data (the Designer's one pane)
  // By category, defaults first: Account (guest by default), Appearance (match the system), Your data (this device keeps
  // nothing until yes; a signed-in student's work is carried between devices; moving and erasing it behind one closed
  // section), and Teaching only for an account the service holds as a teacher. A destructive choice is never the filled
  // button and never holds the focus when its sheet opens: the safe one does (the Designer's F6). Rulings: M2-20, M2-28, Charter law 8.
  // moveOpen: "Move or erase your work" stays as the student left it when the pane is drawn again (slot 10: the defaults
  // first, the rest behind one closed section)
  let settingsFlash = '', deskOff = null, moveOpen = false;
  // the desktop app's bridge (desktop/src/preload.cjs); absent in a browser
  const DESK = window.LettermanDesktop && window.LettermanDesktop.isDesktop ? window.LettermanDesktop : null;
  function download(name, obj) { const b = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  function viewSettings() {
    setTitle('Settings and your data');
    const n = committedCount();
    const ctx = contextModel(), last = lastStep(ctx);
    const st = ACC ? ACC.state : 'guest', member = st === 'member', on = !!(ACC && ACC.configured);
    const look = mem.look || {};
    const nameField = (label, val, help) => `<div class="field"><label for="a-name">${label}</label>
        <div class="inline-save"><input type="text" id="a-name" maxlength="40" autocomplete="nickname" value="${esc(val || '')}" aria-describedby="a-name-help a-name-msg"><button class="btn quiet" type="button" id="a-name-save">Save</button></div>
        <p class="help" id="a-name-help">${help}</p><p class="msg" id="a-name-msg" role="status"></p></div>`;
    const account = member
      ? `<p>Signed in with ${ACC.provider === 'discord' ? 'Discord' : 'a code sent by email'}.</p>
        ${nameField('Your display name', ACC.name, 'The name your teacher and class see. You can change it any time, and it changes everywhere it shows. Your account itself has an id that never shows and never changes.')}
        <button class="btn quiet" type="button" id="a-out">Sign out</button>`
      : st === 'needs-yes'
        ? `<p>You signed in, but Letterman has kept nothing yet: it needs your yes first.</p><button class="btn primary" type="button" id="a-finish">Finish joining</button>`
        : st === 'starting' ? `<p>Checking your sign-in.</p>`
          : `<p><b>Guest</b>: the default. You never need an account to learn.</p>
            ${on ? `<p>Signing in, with Discord or with a code sent by email, carries your work between devices and lets you join a class, hand in and appear to your teacher.</p><button class="btn primary" type="button" id="a-in">Sign in</button>` : ''}
            ${nameField('Your name on this device', mem.name, 'The name your teacher and class see when you hand in. You can change it any time. As a guest it stays on this device.')}`;
    const keepState = mem.consent === 'yes' ? 'yes' : mem.consent === 'no' ? 'no (your answers go when you close the page)' : 'not chosen yet (your answers go when you close the page)';
    const pick = (id, cur, opts, labelId) => `<div class="chips" role="group" aria-labelledby="${labelId}">${opts.map(([v, t]) => `<button type="button" class="chip" aria-pressed="${cur === v}" data-look-${id}="${v}">${t}</button>`).join('')}</div>`;
    const main = `<main id="main" class="lv lv-page"${uiLang()}><div class="page-col settings"><p class="kicker">Letterman</p><h1>Settings and your data</h1>
      ${settingsFlash ? `<p class="flash" role="status">${esc(settingsFlash)}</p>` : ''}
      <section class="card" aria-labelledby="s-acct"><h2 id="s-acct">Account</h2>${account}</section>
      <section class="card" aria-labelledby="s-look"><h2 id="s-look">Appearance</h2>
        <h3 id="s-theme">Theme</h3>${pick('theme', look.theme || 'system', [['system', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']], 's-theme')}
        <h3 id="s-text">Text size</h3>${pick('text', look.text || 'standard', [['standard', 'Standard'], ['large', 'Larger']], 's-text')}
        ${mem.consent === 'yes' ? '' : `<p class="small muted">Kept for this visit; this device keeps it once you say yes to keeping your progress here.</p>`}
      </section>
      <section class="card" aria-labelledby="s-data"><h2 id="s-data">Your data</h2>
        <h3 id="s-keep">Keep my progress on this device</h3>
        <p>Off until you say yes. Now: <b>${keepState}</b>. ${n} answer${n === 1 ? '' : 's'} so far.</p>
        <div class="chips" role="group" aria-labelledby="s-keep"><button type="button" class="chip" aria-pressed="${mem.consent === 'yes'}" id="c-yes">Keep it on this device</button><button type="button" class="chip" aria-pressed="${mem.consent === 'no'}" id="c-no">Don't keep anything here</button></div>
        <p class="small muted">On an iPhone, add this page to your Home Screen. Safari clears a site's data after seven days without a visit; a Home Screen app keeps its own clock.</p>
        ${member ? `<h3>Carry my work between devices</h3>
          <label class="check"><input type="checkbox" id="a-sync" ${ACC.sync ? 'checked' : ''}> <span>On: your answers are kept in your account and follow you to any device you sign in on.</span></label>` : ''}
        <p class="small gap"><a href="privacy.html">Your privacy</a>: what is kept, who sees it, how long it stays, and how to erase it.</p>
        <details class="adv move"${moveOpen ? ' open' : ''}><summary>Move or erase your work</summary><div>
        <h3>Export and import</h3>
        <p>${member ? 'Save a copy of everything: the answers on this device and everything your account keeps.' : 'Save a copy of your answers as a file, and open it on another device.'}</p>
        <div class="btnrow"><button class="btn quiet" type="button" id="d-save">Save a copy</button><label class="btn quiet" for="d-load">Load a copy</label><input type="file" id="d-load" accept="application/json" class="sr-only"></div>
        <p class="msg" id="d-msg" role="status"></p>
        <h3>Erase</h3>
        <p>Removes every answer, hand-in note and piece of feedback from this device. It cannot be undone.${member ? ' Your account is not touched.' : ''}</p>
        <button class="btn quiet danger" type="button" id="d-erase">Erase everything on this device</button>
        ${member ? `<p class="gap">Deleting your account removes everything Letterman's service keeps on it, at once.</p><button class="btn quiet danger" type="button" id="a-delete">Delete my account</button>` : ''}
        </div></details>
      </section>
      ${DESK ? `<section class="card" aria-labelledby="s-updates"><h2 id="s-updates">Updates</h2>
        <label class="check"><input type="checkbox" id="u-on"> <span>Keep Letterman up to date: it looks for a new version and installs it when you close Letterman.</span></label>
        <p class="msg" id="u-state" role="status"></p><button class="btn quiet" type="button" id="u-restart" hidden>Restart to update</button></section>` : ''}
      ${member && ACC.teacher ? `<section class="card" aria-labelledby="s-teach"><h2 id="s-teach">Teaching</h2><p>This account is a teacher.</p>
        ${DESK ? `<p>Your content folder: <b id="t-folder">not chosen yet</b></p><button class="btn quiet" type="button" id="t-choose">Choose your content folder</button>
          <p class="small muted">The teaching console and the stage open from the Teach menu.</p>` : `<a class="btn quiet" href="#/teach">Open the teaching half</a>`}</section>` : ''}
      <p class="gap"><a class="btn quiet" href="${returnTo(ctx)}"><span aria-hidden="true">&#8592;</span> ${last != null ? `Back to step ${last + 1}, where you were` : 'Back to the course'}</a></p>
      <p class="small muted">${esc(versionLine())}</p>
      </div></main>`;
    settingsFlash = '';
    app.innerHTML = header({ model: ctx, idx: last, level: 'settings' }) + main;
    const again = () => { routeInner(); placeNet(); measureBars(); };
    const mv = $('details.move', app); if (mv) mv.addEventListener('toggle', () => { moveOpen = mv.open; });
    $('#c-yes').onclick = () => { mem.consent = 'yes'; persist(); again(); $('#c-yes').focus(); announce('Keeping them: yes, on this device.'); };
    $('#c-no').onclick = () => { mem.consent = 'no'; try { localStorage.removeItem(KEY); } catch (e) { } again(); $('#c-no').focus(); announce('Keeping them: no. Your answers go when you close the page.'); };
    $$('[data-look-theme]', app).forEach(b => b.onclick = () => { const v = b.dataset.lookTheme; mem.look = Object.assign({}, mem.look, { theme: v }); applyLook(); persist(); again(); $(`[data-look-theme="${v}"]`, app).focus(); });
    $$('[data-look-text]', app).forEach(b => b.onclick = () => { const v = b.dataset.lookText; mem.look = Object.assign({}, mem.look, { text: v }); applyLook(); persist(); again(); $(`[data-look-text="${v}"]`, app).focus(); });
    const nameSave = $('#a-name-save');
    if (nameSave) nameSave.onclick = async () => {
      const said = $('#a-name-msg'), v = $('#a-name').value;
      if (member) {
        nameSave.disabled = true;
        const r = await ACC.rename(v);
        nameSave.disabled = false;
        if (!r.ok) { said.textContent = r.message; return; }
        settingsFlash = `Saved. You are ${r.name} everywhere in Letterman now.`; again(); $('#a-name').focus();
        return;
      }
      const c = ACC ? ACC.checkName(v) : { ok: !!v.trim(), name: v.trim() };
      if (!c.ok) { said.textContent = ACC ? ACC.words.name : 'Choose a name the class will see.'; return; }
      mem.name = c.name; persist(); settingsFlash = `Saved. You hand in as ${c.name}.`; again(); $('#a-name').focus();
    };
    const bi = $('#a-in'); if (bi) bi.onclick = () => ACC.signIn();
    const bf = $('#a-finish'); if (bf) bf.onclick = () => ACC.finishJoining();
    const bo = $('#a-out'); if (bo) bo.onclick = async () => { await ACC.signOut(); settingsFlash = 'Signed out. You are a guest on this device.'; again(); };
    const bs = $('#a-sync'); if (bs) bs.onchange = async () => { await ACC.setSync(bs.checked); again(); };
    $('#d-save').onclick = async () => {
      if (!member) return download('letterman-my-answers.json', mem);
      const said = $('#d-msg'); said.textContent = 'Gathering everything your account keeps.';
      const acct = await ACC.exportService();
      if (!acct) { said.textContent = ACC.words.failed; return; }
      download('letterman-my-data.json', { about: 'Everything Letterman keeps about you: what this device keeps, and everything kept on your account.', exported_at: new Date().toISOString(), device: mem, account: acct });
      said.textContent = 'Saved a copy of everything.';
    };
    $('#d-load').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { const d0 = JSON.parse(t); const d = d0 && d0.device && d0.device.modules ? d0.device : d0; if (d && d.modules) { mem = Object.assign({ consent: 'yes' }, d); applyLook(); persist(); again(); } } catch (x) { } }); };
    $('#d-erase').onclick = () => {
      sheet(`<h2>Erase everything on this device?</h2><p>Every answer, every earlier try, your hand-in notes and any feedback on this device will be deleted. ${member ? 'What your account keeps is not touched.' : 'There is no copy anywhere else unless you saved one.'}</p>
        <div class="sheet-acts"><button type="button" class="btn primary" id="sh-x">Keep everything</button><button type="button" class="btn quiet danger" id="sh-ok">Yes, erase it all</button></div>`, { focus: '#sh-x' });
      $('#sh-ok').onclick = () => { try { localStorage.removeItem(KEY); } catch (e) { } mem = { consent: mem.consent, name: '', modules: {} }; applyLook(); persist(); closeSheet(true); go('#/'); };
      $('#sh-x').onclick = () => closeSheet();
    };
    // Inside the desktop app only (its bridge, window.LettermanDesktop): Updates, and the teacher's content folder.
    if (DESK) {
      const say = s => { const e = $('#u-state'), r = $('#u-restart'); if (!e) return; const ph = (s || {}).phase;
        e.textContent = { off: 'Updates are off.', idle: 'Up to date as far as Letterman knows.', checking: 'Looking for a new version.', current: 'This is the newest version.', downloading: 'A new version is downloading.', ready: 'A new version is ready. It installs when you close Letterman.', error: 'Letterman could not check for updates. Your work is not affected.', unavailable: 'Updates are not available in this copy.' }[ph] || '';
        if (r) r.hidden = ph !== 'ready'; };
      DESK.getSettings().then(s => { const c = $('#u-on'); if (c) c.checked = !!s.updatesEnabled; const f = $('#t-folder'); if (f && s.contentFolder) f.textContent = s.contentFolder; }).catch(() => { });
      DESK.getUpdateState().then(say).catch(() => { });
      if (deskOff) deskOff(); deskOff = DESK.onUpdateState(say);
      const c = $('#u-on'); if (c) c.onchange = () => DESK.setUpdatesEnabled(c.checked).then(say).catch(() => { });
      const r = $('#u-restart'); if (r) r.onclick = () => DESK.restartToUpdate();
      const t = $('#t-choose'); if (t) t.onclick = () => DESK.chooseContentFolder().then(p => { const f = $('#t-folder'); if (f && p) f.textContent = p; }).catch(() => { });
    }
    const del = $('#a-delete');
    if (del) del.onclick = () => {
      sheet(`<h2>Delete your account?</h2>
        <p>Everything Letterman's service keeps on your account is deleted at once: your sign-in, your display name, your two yeses, your classes, your progress and your work, with the replies and stars on it. It cannot be undone.</p>
        <p>Anything you posted from Letterman in the class's conversation is deleted from Discord first.</p>
        <p>Save a copy first if you want one. What this device keeps stays until you erase it here.</p>
        <p class="msg" role="alert" id="del-msg"></p>
        <div class="sheet-acts"><button type="button" class="btn primary" id="sh-x">Keep my account</button><button type="button" class="btn quiet danger" id="sh-ok">Yes, delete my account</button></div>`, { focus: '#sh-x' });
      $('#sh-x').onclick = () => closeSheet();
      let anyway = false;   // a post Discord would not delete was named, and the student chose to go on
      $('#sh-ok').onclick = async () => {
        $('#sh-ok').disabled = true;
        // the posts first (the Director, 2026-10-09: "Yes, they can delete"); one that will not go is said plainly
        if (DS && !anyway) {
          const r = await DS.deleteMyPosts();
          if (r.failed) {
            anyway = true; $('#sh-ok').disabled = false; $('#sh-ok').textContent = 'Delete my account anyway';
            $('#del-msg').textContent = r.failed > 0
              ? `${r.failed} of your posts in the class's conversation could not be deleted from Discord just now. If you go on, ${r.failed === 1 ? 'it stays' : 'they stay'} there, and only your teacher can remove ${r.failed === 1 ? 'it' : 'them'}. Or keep your account and try again later.`
              : 'Letterman could not reach the class\'s conversation just now to delete your posts there. If you go on, anything you posted from Letterman stays on Discord, and only your teacher can remove it. Or keep your account and try again later.';
            return;
          }
        }
        const ok = await ACC.deleteAccount();
        if (!ok) { $('#sh-ok').disabled = false; $('#del-msg').textContent = ACC.words.failed; return; }
        // work this device was holding only for the account goes with it; what the student kept here stays
        if (mem.consent !== 'yes') mem.modules = {};
        closeSheet(true);
        settingsFlash = 'Your account and everything it kept are deleted. You are a guest on this device.';
        again(); focusMain();
      };
    };
    focusMain();
  }

  // ------------------------------------------------------------------ the teaching half: for a verified teacher only
  // The service decides, each time: the account must be signed in and held by the teachers table, which no one can
  // write through the service. Nothing kept on this device, and nothing in the sign-in's own claims, opens it.
  async function viewTeach() {
    setTitle('Teaching');
    const ctx = contextModel(), last = lastStep(ctx);
    const paint = inner => { app.innerHTML = header({ model: ctx, idx: last, level: 'teach' }) + `<main id="main" class="lv lv-page"${uiLang()}><div class="page-col">${inner}</div></main>`; placeNet(); measureBars(); focusMain(); };
    paint(`<h1>Teaching</h1><p>Checking with the class service.</p>`);
    const ok = ACC && ACC.configured ? await ACC.verifyTeacher() : false;
    if (decodeURIComponent(location.hash).replace(/^#\/?/, '') !== 'teach') return;
    if (!ok) {
      paint(`<h1>Teaching</h1><p class="teach-gate">The teaching half is for teachers. A teacher signs in with an account that Letterman's service holds as a teacher; nobody can make themselves one.</p>
        ${ACC && ACC.configured && ACC.state === 'guest' ? `<button class="btn primary" type="button" id="t-in">Sign in</button>` : ''}
        <p class="gap"><a class="btn quiet" href="${returnTo(ctx)}"><span aria-hidden="true">&#8592;</span> Back to the course</a></p>`);
      const b = $('#t-in'); if (b) b.onclick = () => ACC.signIn();
      return;
    }
    paint(`<h1>Teaching</h1><p class="teach-open">Signed in as <b>${esc(ACC.name)}</b>, a teacher.</p>
      <p>${DESK ? 'Open the teaching console and the stage from the Teach menu.' : 'The teaching console runs on your own computer, beside the class\'s stage: open it from the Letterman desktop app, or with the teaching server on the computer you teach from.'}</p>
      <p class="gap"><a class="btn quiet" href="${returnTo(ctx)}"><span aria-hidden="true">&#8592;</span> Back to the course</a></p>`);
  }

  // ------------------------------------------------------------------ consent, sheets, discussion
  function askConsent() {
    // a signed-in student's work is already kept in their account by their own yes; this device's copy is theirs to
    // switch on in Settings, so the question does not interrupt them here
    if (STAGE || mem.consent || $('.consent') || (ACC && ACC.state !== 'guest')) return;
    const d = document.createElement('div');
    d.className = 'consent'; d.lang = 'en'; d.setAttribute('role', 'region'); d.setAttribute('aria-label', 'Keep your answers?');
    d.innerHTML = `<p><b>Keep your answers on this device?</b> Nothing is stored until you say yes. <a href="#/settings">Export, import, erase</a></p><button type="button" class="btn primary small" id="cs-y">Keep them</button><button type="button" class="btn quiet small" id="cs-n">Not now</button>`;
    const hb = $('.head'); if (hb) hb.insertAdjacentElement('afterend', d); else document.body.prepend(d);
    // answered: the banner goes, and focus goes to the screen's heading, never to the page's body
    const after = said => { d.remove(); const h = $('#main h1') || $('#main'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } announce(said); };
    $('#cs-y').onclick = () => { mem.consent = 'yes'; persist(); after('Kept. Your answers stay on this device.'); };
    $('#cs-n').onclick = () => { mem.consent = 'no'; after('Not kept. Your answers go when you close the page.'); };
  }
  let lastFocus = null, onDismiss = null;
  // opts.focus: what takes focus first; opts.onDismiss: what Escape or a tap outside means (by default, close)
  function sheet(html, opts = {}) {
    closeSheet(true);
    lastFocus = document.activeElement;
    onDismiss = opts.onDismiss || null;
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h"${uiLang()}><button type="button" class="sheet-x" aria-label="Close"></button>${html.replace('<h2>', '<h2 id="sheet-h">')}</div>`;   // a close control at the top of every sheet (the Designer's preflight): the same as Escape
    bg.addEventListener('click', e => { if (e.target === bg || (e.target.closest && e.target.closest('.sheet-x'))) closeSheet(); });
    bg.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); }
      if (e.key === 'Tab') { const f = $$('button:not([disabled]), a, input, textarea', bg).filter(x => !x.classList.contains('sr-only')); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    });
    document.body.appendChild(bg);
    const f = (opts.focus && $(opts.focus, bg)) || $('button:not(.sheet-x)', bg) || $('button', bg); if (f) f.focus();
  }
  // closeSheet(true): closed by the page itself, after an answer. closeSheet(): dismissed by the person.
  function closeSheet(answered) {
    const s = $('.sheet-bg'); if (!s) return;
    const d = onDismiss; onDismiss = null;
    if (!answered && d) { d(); return; }
    s.remove(); if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  function say(text) { sheet(`<h2>Signing in</h2><p>${esc(text)}</p><button type="button" class="btn primary" id="sh-x">OK</button>`); $('#sh-x').onclick = () => closeSheet(); }
  window.LM = {
    steps(folder) { const m = buildModel(folder); return m.steps.map(s => `${s.idx}\t${s.block.id}\t${s.h2 || ''}\t${s.pids.join(',')}\tslide ${m.slideFor[s.idx]}`).join('\n') + '\n--guide--\n' + m.guide.map((g, k) => `${k}\t${g.title}\t${g.shadows}\t-> ${g.targets.join(',')}`).join('\n'); },
    discuss() {
      const d = (CFG.discord.discuss || {})[courseKey] || { channel: CFG.discord.discussChannel || '', url: null };
      if (CFG.prototype || !d.url) {
        sheet(`<p><span class="proto">prototype</span></p><h2>Talk with the class</h2><p>Discussion lives in ${esc(CFG.discord.server)}${d.channel ? `, in <b>${esc(d.channel)}</b>` : ''}.</p><p class="small muted">(prototype) would open ${esc(d.channel || CFG.discord.server)}. No request was made.</p><button type="button" class="btn primary" id="sh-x">OK</button>`);
        $('#sh-x').onclick = () => closeSheet();
        return;
      }
      sheet(`<h2>Talk with the class</h2><p>This class talks in <b>${esc(d.channel)}</b>, in ${esc(CFG.discord.server)}.</p>
        <div class="sheet-acts"><a class="btn primary" href="${esc(d.url)}" target="_blank" rel="noopener">Open ${esc(d.channel)}<span class="sr-only"> (opens Discord in a new tab)</span></a><button type="button" class="btn quiet" id="sh-x">Close</button></div>`);
      $('#sh-x').onclick = () => closeSheet();
    }
  };

  // ------------------------------------------------------------------ the teacher's stage (console drives this window)
  window.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type === 'letterman:goto' && STAGE) go(d.hash);
  });
  // A stage inside the console's preview that was clicked holds the keyboard. It hands the console's own keys on to the
  // console, which answers them as if they had been pressed there; no other key, and no key with Ctrl, Alt or Meta.
  if (STAGE && window.parent !== window) {
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || !/^[jkc\[\],.<>]$/i.test(e.key || '')) return;
      try { window.parent.postMessage({ type: 'letterman:key', key: e.key }, '*'); } catch (err) { }
    });
  }
  // the console also writes where the stage is into shared storage; a stage window follows it even after
  // the console is reloaded and has lost its handle on this window
  window.addEventListener('storage', e => {
    if (!STAGE || e.key !== 'letterman:stage-goto' || !e.newValue) return;
    try { const d = JSON.parse(e.newValue); if (d && d.hash) go(d.hash); } catch (err) { }
  });
  // Served by the teaching server (Teach.cmd, this computer only), the stage follows the server instead, so a stage
  // the console never opened, such as OBS's browser source, follows too. The teacher's chart comes the same way:
  // off, beside the lesson, or full stage, and a newer save of the file replaces the one showing.
  const LOCAL = /^https?:$/.test(location.protocol) && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  // The server may not answer the first time (it is still starting, or a restart is under way): the stage keeps
  // asking, a little slower each time and never slower than every 4 seconds, until it can follow. Whatever address it
  // opened on, it then goes to the console's step.
  if (STAGE && LOCAL && window.EventSource) {
    let wait = 400;
    const tryFollow = () => fetch('/api/stage', { cache: 'no-store' }).then(r => r.ok, () => false).then(ok => { if (ok) followServer(); else { setTimeout(tryFollow, wait); wait = Math.min(wait * 2, 4000); } });
    tryFollow();
  }
  function followServer() {
    let charts = [], st = { chart: { mode: 'off', pick: null } }, box = null, want = '';
    const es = new EventSource('/api/events');
    es.addEventListener('stage', e => { st = JSON.parse(e.data) || st; if (st.hash && st.hash !== location.hash) go(st.hash); showChart(); setTimeout(applyScroll, 60); });
    // The part of the step the class sees. A stage the teacher scrolls (the console's preview, or the pop-out) says
    // where it is, by the step's own content rather than in pixels: which element sits at the top, and how far into
    // it. Every other stage puts the same element at its top, so a stage of any size, OBS's included, shows the same
    // part of the step. Only a scroll the teacher made is told; a stage that was moved does not answer back.
    let userAt = 0, sendT = null;
    const SEL = '#main :is(h1,h2,h3,h4,p,li,figure,img,svg,pre,table,blockquote,details,.prompt,.handin,.cta)';
    const topLine = () => { const hb = $('.head'); return hb && /sticky|fixed/.test(getComputedStyle(hb).position) ? Math.max(0, hb.getBoundingClientRect().bottom) : 0; };
    function where() {
      if (window.scrollY < 4) return { i: -1, f: 0 };
      const list = $$(SEL), top = topLine();
      for (let i = 0; i < list.length; i++) { const r = list[i].getBoundingClientRect(); if (r.height > 0 && r.bottom > top + 1) return { i, f: Math.max(0, Math.min(1, (top - r.top) / r.height)) }; }
      return { i: -1, f: 0 };
    }
    function applyScroll() {
      const s = st.scroll;
      if (!s || s.hash !== location.hash || Date.now() - userAt < 1500) return;
      if (s.i < 0) return window.scrollTo(0, 0);
      const list = $$(SEL); let i = s.i;
      while (list[i] && !list[i].getBoundingClientRect().height) i++;   // hidden at this size: the next one
      if (!list[i]) return;
      const r = list[i].getBoundingClientRect();
      window.scrollTo(0, window.scrollY + r.top + (i === s.i ? s.f * r.height : 0) - topLine());
    }
    ['wheel', 'touchmove', 'keydown', 'pointerdown'].forEach(t => window.addEventListener(t, () => { userAt = Date.now(); }, { passive: true }));
    window.addEventListener('scroll', () => {
      if (Date.now() - userAt > 1000) return;
      clearTimeout(sendT);
      sendT = setTimeout(() => fetch('/api/stage', { method: 'POST', headers: { 'content-type': 'application/json', 'x-letterman': '1' }, body: JSON.stringify({ scroll: Object.assign({ hash: location.hash }, where()) }) }).catch(() => { }), 120);
    }, { passive: true });
    window.addEventListener('hashchange', () => setTimeout(applyScroll, 60));
    document.addEventListener('load', e => { if (e.target.tagName === 'IMG') applyScroll(); }, true);   // a picture that loads late moves what is below it
    // the console's buttons scroll its preview through here, as the teacher's own scroll
    window.LMStage = { scroll(dir) { userAt = Date.now(); window.scrollBy(0, Math.round(dir * (window.innerHeight - topLine()) * 0.75)); } };
    es.addEventListener('charts', e => { charts = JSON.parse(e.data) || []; showChart(); });
    function showChart() {
      const mode = (st.chart || {}).mode || 'off';
      const f = mode !== 'off' && (charts.find(c => c.name === st.chart.pick) || charts[0]);
      document.body.classList.toggle('chart-full', !!f && mode === 'full');
      document.body.classList.toggle('chart-beside', !!f && mode === 'beside');
      if (!f) { if (box) box.hidden = true; return; }
      if (!box) { box = document.createElement('figure'); box.className = 'stagechart'; box.innerHTML = '<img alt="">'; document.body.appendChild(box); }
      box.hidden = false;
      const img = box.querySelector('img');
      img.alt = st.label || '';
      const src = `/chart/${encodeURIComponent(f.name)}?v=${f.mtime}-${f.size}`;
      if (src === want) return;
      // the new copy is loaded before it replaces the old one, so the stage never shows a blank or half a file
      want = src;
      const next = new Image();
      next.onload = () => { if (want === src) { img.src = src; box.dataset.chart = f.name; } };
      next.src = src;
    }
  }

  // ------------------------------------------------------------------ offline (only where a service worker can run)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !STAGE) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }

  ACC = window.LMAccount ? window.LMAccount.create({ config: CFG, stage: STAGE, esc, sheet, closeSheet, say, onChange: accountChanged,
    device: { get: () => mem, save: () => persist() } }) : null;
  LIVE = window.LMLive && ACC ? window.LMLive.create({ config: CFG, stage: STAGE, account: ACC, esc, course: courseKey,
    has: f => !!COURSE.packages[f] && !LOCKED[f], go,
    // a class going live or ending: the home page redraws (its first choice changes) unless something is being typed
    onChange: () => { refreshAnchor(); const h = decodeURIComponent(location.hash || '#/'); if (/^#\/?$/.test(h) && !$('.sheet-bg') && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) { routeInner(); placeNet(); } } }) : null;
  // enrol.js (M2-21): classes open to join, joining and leaving; its screens are painted under the app bar
  ENROL = window.LMEnrol && ACC ? window.LMEnrol.create({ acc: ACC, stage: STAGE, esc, sheet, closeSheet, content: CONTENT, setTitle, go,
    refresh: () => { const f = document.activeElement; routeInner(); placeNet(); if (f && f.isConnected && f.closest('.sheet')) f.focus(); },
    paint: inner => { const ctx = contextModel(); app.innerHTML = header({ model: ctx, idx: lastStep(ctx), level: 'classes' }) + `<main id="main" class="lv lv-page"><div class="page-col enrol-page">${inner}</div></main>`; placeNet(); measureBars(); if (!$('.sheet-bg')) focusMain(); } }) : null;
  // The hand-in inside the portal and the class's conversation (M2-23): app/handin.js and app/discuss.js, drawn on this
  // file's own page: the running head, and the one-column page of Heard back and Settings.
  const parts = { CFG, COURSE, courseKey, esc, ms, get mem() { return mem; }, persist, acc: () => ACC, sheet, closeSheet, route, get when() { return WHEN; }, unit: UNIT,
    setTitle, focusMain, modLabel, lastStep, returnTo, announce,
    paint: (model, last, main) => { app.innerHTML = header({ model, idx: last, level: 'module' }) + `<main id="main" class="lv lv-page"><div class="page-col talk">${main}</div></main>`; placeNet(); measureBars(); } };
  HI = window.LMHandin ? window.LMHandin.create(parts) : null;
  DS = window.LMDiscuss ? window.LMDiscuss.create(parts) : null;
  route();
  if (ACC) ACC.start().then(() => { if (LIVE) LIVE.start(); if (HI) HI.refresh().then(ch => { if (zoneFromClass() || ch) redrawSoft(); }); });
})();
