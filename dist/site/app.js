// Letterman student portal. The crowned design (Competitor A, "the interactive lesson", 2026-09-25).
// One renderer for any package-v1 module. No line of this file names a module, a prompt id or a block id.
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
  if (STAGE) document.body.classList.add('stage');

  // ------------------------------------------------------------------ store (on this device only)
  const KEY = 'letterman:v1';
  let mem = { consent: null, name: '', modules: {} };
  try { const s = !STAGE && localStorage.getItem(KEY); if (s) mem = Object.assign(mem, JSON.parse(s)); } catch (e) { /* storage blocked: memory only */ }
  let askedPersist = false;
  function persist() {
    if (STAGE || mem.consent !== 'yes') return;
    // ask the browser to keep this data out of best-effort eviction (MDN, Storage quotas and eviction criteria)
    if (!askedPersist && navigator.storage && navigator.storage.persist) { askedPersist = true; navigator.storage.persist().catch(() => { }); }
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* full or blocked */ }
  }
  function ms(modId) { return mem.modules[modId] || (mem.modules[modId] = { answers: {}, visited: {}, readInline: {}, readFirst: false, last: 0, feedback: [] }); }
  function ans(modId, pid) { const m = ms(modId); return m.answers[pid] || (m.answers[pid] = { history: [], judged: {} }); }
  function anyProgress() { return Object.values(mem.modules).some(m => Object.keys(m.answers).length || Object.keys(m.visited).length); }

  // ------------------------------------------------------------------ content model (model.js)
  const { courseKey, COURSE, glossary, buildModel } = window.LMModel.create(CONTENT);
  // The release cadence (the Director, 2026-10-02): a released module opens on its calendar date, at the start of
  // that day where the student is. The stage window and a preview build are never locked.
  const TODAY = (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date());
  const LOCKED = {};
  if (!STAGE && !CONTENT.preview) COURSE.modules.forEach(m => { if (m.folder && m.opens && m.opens > TODAY) { LOCKED[m.folder] = m.opens; m.lockedUntil = m.opens; delete m.folder; } });
  const opensLabel = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  // ------------------------------------------------------------------ progress (distance, not a score)
  function stepDone(model, st) {
    const m = ms(model.id);
    if (st.pids.length) return st.pids.every(pid => (m.answers[pid] || {}).committed);
    return !!m.visited[st.idx] || !!m.readInline[st.block.id];
  }
  function blockDone(model, b) { return b.steps.every(i => stepDone(model, model.steps[i])); }
  function progress(model) {
    const req = model.blocks.filter(b => b.required);
    const done = req.filter(b => blockDone(model, b)).length;
    return { done, total: req.length };
  }
  function resumeStep(model) {
    const m = ms(model.id);
    const first = model.steps.find(st => st.block.required && !stepDone(model, st) && !(model.explained.has(st.block.id) && !st.pids.length && !m.readInline[st.block.id] && false));
    if (m.last && model.steps[m.last] && !stepDone(model, model.steps[m.last])) return m.last;
    return first ? first.idx : 0;
  }
  function skippable(model, st) { const m = ms(model.id); return !st.pids.length && m.readInline[st.block.id] && model.explained.has(st.block.id); }
  function nextIdx(model, i) { let j = i + 1; while (j < model.steps.length && skippable(model, model.steps[j])) j++; return j < model.steps.length ? j : null; }
  function prevIdx(model, i) { let j = i - 1; while (j >= 0 && skippable(model, model.steps[j])) j--; return j >= 0 ? j : null; }

  function currentModule() {
    const shown = COURSE.modules.filter(m => m.folder && COURSE.packages[m.folder]);
    const released = shown.filter(m => m.status === 'released');
    const pool = released.length ? released : shown;
    return pool[pool.length - 1];
  }

  // ------------------------------------------------------------------ rendering helpers
  function figureHTML(model, id, alt) {
    const a = model.assets[id];
    if (!a) return `<p class="muted">[missing visual: ${esc(id)}]</p>`;
    let src;
    if (a.file) src = `content/${courseKey}/${model.folder}/${slash(a.file)}`;
    else if (a.url) {
      // r2 quirk: a Wikimedia "File:" page, not the image. Special:FilePath serves the image itself.
      const m = a.url.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/);
      src = m ? `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1].replace(/^File:/, '')}?width=900` : a.url;
    }
    const kind = a.kind === 'diagram' ? 'Made for the course.' : a.kind === 'work' ? 'Real work.' : '';
    const credit = a.kind === 'work'
      ? `${esc(a.credit)} <a href="${esc(a.source_url || a.url)}" target="_blank" rel="noopener">Source<span class="sr-only"> (opens a new tab)</span></a>`
      : esc(a.credit || '');
    return `<figure class="${esc(a.kind)}"><span class="frame"><img src="${esc(src)}" alt="${esc(alt || a.alt || '')}" loading="lazy" onerror="this.outerHTML='<div class=&quot;img-missing&quot;>'+this.alt+' (the image needs a connection)</div>'"></span><figcaption><span class="kind">${kind}</span>${credit}</figcaption></figure>`;
  }
  function linkHTML(model, id, text) {
    const a = model.assets[id];
    if (!a) return esc(text);
    return `<a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.credit || '')}">${text}<span class="sr-only"> (opens a new tab)</span></a>`;
  }
  function renderMD(model, md, opts = {}) {
    const ctx = {
      figure: (id, alt) => figureHTML(model, id, alt),
      link: (id, t) => linkHTML(model, id, t),
      prompt: id => opts.noPrompts ? '' : `<div class="prompt" data-prompt="${esc(id)}"></div>`,
      microscope: id => opts.inMicroscope ? '' : microscopeHTML(model, id),
      term: (id, t) => termHTML(id, t),
      heading: (lvl, raw, html) => {
        const l = Math.min(4, lvl + (opts.shift || 0));
        return `<h${l}>${html}</h${l}>`;
      }
    };
    return window.MD.render(md, ctx);
  }
  // "Under a microscope" (standard 1.3.0, §4c): a closed fold in the marker's place. It never opens by itself,
  // Escape or Close shuts it and returns focus to its button, and opening it is never saved or scored.
  function microscopeHTML(model, id) {
    const x = model.microscopes && model.microscopes[id];
    if (!x || !x.md) return '';
    const src = (x.cites || []).map(cid => {
      const a = model.assets[cid];
      if (!a) return '';
      const href = a.kind === 'work' ? (a.source_url || a.url) : a.url;
      const name = a.kind === 'work' ? esc(a.credit || a.title || cid) : esc(a.title || a.credit || cid);
      return href ? `<li><a href="${esc(href)}" target="_blank" rel="noopener">${name}<span class="sr-only"> (opens a new tab)</span></a></li>` : `<li>${name}</li>`;
    }).filter(Boolean).join('');
    return `<details class="microscope"><summary><span class="mc-label">Under a microscope<span class="sr-only">:</span></span> <span class="mc-title">${esc(x.title)}</span></summary>` +
      `<div class="mc-body" role="region" aria-label="${esc(x.title)}">${renderMD(model, x.md, { noPrompts: true, inMicroscope: true })}` +
      (src ? `<p class="mc-src-h">Sources</p><ul class="mc-sources">${src}</ul>` : '') +
      `<p><button type="button" class="linkish mc-close">Close<span class="sr-only">: ${esc(x.title)}</span></button></p></div></details>`;
  }
  // A glossary term: the word is a button; tapping it shows the course's definition right after it, in the line.
  function termHTML(id, t) {
    const g = glossary[id];
    if (!g) return t;
    return `<button type="button" class="term" aria-expanded="false" data-term="${esc(id)}">${t}</button><span class="term-def" hidden> (${esc(g.definition)})</span>`;
  }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button.term'); if (!b) return; const d = b.nextElementSibling; const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); if (d) d.hidden = !open; });
  function closeMicroscope(d) { if (!d) return; d.open = false; const s = d.querySelector('summary'); if (s) s.focus(); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const d = document.activeElement && document.activeElement.closest && document.activeElement.closest('details.microscope[open]'); if (d) { e.preventDefault(); closeMicroscope(d); } } });
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.mc-close'); if (b) closeMicroscope(b.closest('details.microscope')); });
  function blockMD(block) { return (block.md || '').replace(/<!--[\s\S]*?-->/g, ''); }

  // ------------------------------------------------------------------ router
  const app = $('#app');
  function go(h) { if (location.hash === h) route(); else location.hash = h; }
  window.addEventListener('hashchange', route);

  function route() { routeInner(); askConsent(); }
  function routeInner() {
    stopPlayers();
    const h = decodeURIComponent(location.hash || '#/');
    if (h.startsWith('#fb=')) return importFeedback(h.slice(4));
    const parts = h.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!parts.length) return viewHome();
    if (parts[0] === 'm' && parts[1] && LOCKED[parts[1]]) return viewHome();
    if (parts[0] === 'm' && parts[1]) {
      const model = buildModel(parts[1]);
      if (!model) return viewHome();
      if (parts[2] === 'guide') return viewGuide(model, +parts[3] || 0, parts[4]);
      if (parts[2] !== undefined) return viewStep(model, Math.max(0, Math.min(model.steps.length - 1, +parts[2] || 0)));
      return viewModule(model);
    }
    if (parts[0] === 'heard') viewHeard();
    else if (parts[0] === 'data') viewData();
    else viewHome();
  }
  // "Letterman 0.1.1 alpha": the number, and the stage as a word beside it (app/version.js)
  function versionLine() { const v = window.LETTERMAN_VERSION || {}; return v.version ? `Letterman ${v.version}${v.stage ? ' ' + v.stage : ''}` : 'Letterman'; }
  function setTitle(t) { document.title = t ? `${t} · Letterman` : 'Letterman · Heirloom Estate Academy'; }
  function focusMain() { const h = $('#main h1, #main h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } window.scrollTo(0, 0); }

  // ------------------------------------------------------------------ THE ANCHOR (Charter law: every student screen says where you are)
  // One persistent header on every student route, at every width. It always says three things:
  //   1. the course and module;  2. the step (the one you are on, or the one you left to come here);
  //   3. what is done and what is still open, as a segmented bar grouped by part, with the count in words.
  // Every route away from a step (guide, Heard back, Your data) returns to that step.
  const courseShort = COURSE.meta.title.split(':')[0];
  const modLabel = model => model.meta.module === 0 ? 'Week 0' : `Module ${model.meta.module} of ${model.meta.of}`;
  function stepLabel(model, st) { return st.si > 0 && st.h2 ? `${st.block.title}: ${st.h2}` : st.block.title; }
  function counts(model) {
    let done = 0, open = 0, optOpen = 0;
    model.steps.forEach(s => { if (stepDone(model, s)) done++; else { open++; if (!s.block.required) optOpen++; } });
    return { done, open, optOpen, total: model.steps.length };
  }
  function segsHTML(model, idx) {
    return model.blocks.map(b => `<span class="sg" style="--n:${b.steps.length}">` + b.steps.map(i => {
      const s = model.steps[i];
      return `<i class="${i === idx ? 'here' : stepDone(model, s) ? 'done' : ''}${s.block.required ? '' : ' opt'}"></i>`;
    }).join('') + `</span>`).join('');
  }
  function contextModel() {
    const f = mem.lastFolder && COURSE.packages[mem.lastFolder] ? mem.lastFolder : (currentModule() || {}).folder;
    return f ? buildModel(f) : null;
  }
  let lastHeader = null, lastRail = null;
  function refreshAnchor() {
    const hb = $('.appbar.anchor'); if (hb && lastHeader) { hb.outerHTML = header(lastHeader); }
    const r = $('.rail'); if (r && lastRail) r.querySelector('.path').outerHTML = pathHTML(lastRail.model, lastRail.idx);
  }
  function header(args) {
    lastHeader = args;
    const { model, idx, onStep, back, backLabel, right } = args;
    const c = model ? counts(model) : null;
    const st = model && idx != null ? model.steps[idx] : null;
    const line2 = !model ? '' : st
      ? (onStep ? `Step ${idx + 1} of ${c.total} · ${stepLabel(model, st)}` : `You were at step ${idx + 1} of ${c.total} · ${stepLabel(model, st)}`)
      : `${c.total} steps · not started`;
    const count = c ? `${c.done} done · ${c.open} open${c.optOpen ? `<span class="opt-n"> (${c.optOpen} optional)</span>` : ''}` : '';
    return `<header class="appbar anchor" role="banner">
      <div class="row1">
        ${back ? `<a class="back" href="${back}" aria-label="${esc(backLabel || 'Back')}">&#8592;</a>` : `<a class="home" href="#/" aria-label="Letterman: course home"><img src="icon.svg" alt="" width="36" height="36"></a>`}
        <div class="where">${model ? `<a class="anc-mod" href="#/m/${model.folder}">${esc(courseShort)} · ${esc(modLabel(model))}<span class="mt">: ${esc(model.meta.title)}</span></a><b class="anc-step">${esc(line2)}</b>` : `<b class="anc-step">${esc(courseShort)}</b>`}</div>
        <span class="livechip" aria-label="Live: the teacher's shared screen">&#9679; Live</span>
        ${right || ''}
      </div>
      ${model ? `<div class="row2"><div class="segs" aria-hidden="true">${segsHTML(model, onStep ? idx : null)}</div><span class="anc-count">${count}</span></div>` : ''}
    </header>`;
  }
  // desktop: the module path stays in a rail beside every module-scoped screen
  function shell(model, idx, main, aside) {
    lastRail = { model, idx };
    return `<div class="stepgrid ${aside ? '' : 'no-aside'}">
      <nav class="rail" aria-label="Module path"><p class="eyebrow">${esc(modLabel(model))}</p><p class="rail-t">${esc(model.meta.title)}</p>${pathHTML(model, idx)}</nav>
      <main id="main">${main}</main>
      ${aside ? `<aside class="guidepane" aria-label="The module guide, beside you">${aside}</aside>` : ''}
    </div>`;
  }
  function lastStep(model) { const m = model && mem.modules[model.id]; return m && m.visited && Object.keys(m.visited).length && model.steps[m.last] ? m.last : null; }
  function returnTo(model) { const l = lastStep(model); return model ? `#/m/${model.folder}${l != null ? '/' + l : ''}` : '#/'; }

  // ------------------------------------------------------------------ view: home
  function viewHome() {
    setTitle('');
    const cur = currentModule();
    const curModel = cur ? buildModel(cur.folder) : null;
    const ctx = contextModel();
    const orient = COURSE.modules.find(m => m.module === 0 && m.folder);
    const oModel = orient ? buildModel(orient.folder) : null;
    const fresh = !anyProgress();
    let visitor = '';
    if (fresh && oModel) {
      const firstPara = (oModel.blocks[0].md.replace(/<!--[\s\S]*?-->/g, '').split(/\n\s*\n/).find(p => p.trim() && !/^#/.test(p.trim())) || '').trim();
      const firstPrompt = curModel && curModel.steps.find(s => s.pids.length);
      visitor = `<section class="card visitor" aria-labelledby="v-h">
        <p class="eyebrow">New here?</p>
        <h2 id="v-h">${esc(COURSE.meta.title)}</h2>
        <p>${window.MD.inline(firstPara, { figure: () => '', link: (id, t) => t })}</p>
        <div class="week cta" style="display:grid;gap:.5rem">
          ${firstPrompt ? `<a class="btn primary" href="#/m/${curModel.folder}/${firstPrompt.idx}">Try what week ${curModel.meta.module} starts with</a>` : ''}
          <a class="btn quiet" href="#/m/${oModel.folder}">Start at Week 0: ${esc(oModel.meta.title)}</a>
        </div>
        <p class="small muted" style="margin:.8rem 0 0">No account. What you answer stays on this device, and only if you say so.</p>
      </section>`;
    }
    let week = '';
    if (curModel) {
      const c = counts(curModel);
      const r = resumeStep(curModel);
      const started = Object.keys(ms(curModel.id).answers).length || Object.keys(ms(curModel.id).visited).length;
      week = `<section class="card week" aria-labelledby="w-h">
        <p class="num">This week · ${esc(modLabel(curModel))}</p>
        <h2 id="w-h">${esc(curModel.meta.title)}</h2>
        <div class="meta"><span>About ${curModel.meta.minutes} minutes, at your own pace</span><span>${curModel.steps.length} steps</span></div>
        <div class="segs big" aria-hidden="true">${segsHTML(curModel, null)}</div>
        <p class="small muted" style="margin:.4rem 0 0">${c.done} of ${c.total} steps done · this counts where you are, never how well you did</p>
        <div class="cta">
          <a class="btn primary" href="#/m/${curModel.folder}/${r}">${started ? `Continue at step ${r + 1}: ` + esc(stepLabel(curModel, curModel.steps[r])) : 'Start with your hands'}</a>
          <a class="btn quiet" href="#/m/${curModel.folder}">See every step of the module</a>
        </div>
      </section>`;
    }
    const fbAll = allFeedback();
    const heard = fbAll.length ? `<section class="card feedback" aria-labelledby="h-h">
        <p class="eyebrow">Heard back</p>
        <h2 id="h-h" style="margin-top:.2rem">${esc(fbAll[0].from || 'Your teacher')} wrote back about ${esc(fbAll[0].moduleTitle)}</h2>
        ${fbAll[0].star ? starHTML() : ''}
        <p style="margin-top:.6rem">${esc((fbAll[0].forward || '').slice(0, 140))}${(fbAll[0].forward || '').length > 140 ? '…' : ''}</p>
        <a class="btn small" href="#/heard">Read the feedback</a>
      </section>` : '';
    const road = COURSE.modules.map(m => {
      const has = m.folder && COURSE.packages[m.folder];
      const mdl = has ? buildModel(m.folder) : null;
      const isCur = cur && m.id === cur.id;
      const c = mdl ? counts(mdl) : null;
      const done = c && c.done === c.total;
      const carry = fbAll.find(f => f.carriesInto === m.module);
      const cls = done ? 'done' : isCur ? 'current' : has ? 'open' : '';
      return `<li class="${cls}"><span class="dot" aria-hidden="true">${done ? '&#10003;' : m.module}</span><div class="t">
        ${has ? `<a href="#/m/${m.folder}">${m.module === 0 ? 'Week 0' : 'Module ' + m.module}: ${esc(m.title)}</a>` : `<b>Module ${m.module}: ${esc(m.title)}</b>`}
        <span>${done ? 'Done' : c && c.done ? `${c.done} of ${c.total} steps done${isCur ? ' · this week' : ''}` : isCur ? 'This week' : has ? (m.module === 0 ? 'Start here if you are new' : 'Open') : m.lockedUntil ? 'Opens ' + opensLabel(m.lockedUntil) : 'Opens when the class reaches it'}${has && CONTENT.preview && m.status !== 'released' ? ' · preview' : ''}</span>
        ${carry ? `<div class="carry">Feedback from Module ${carry.fromModule} carries into this one.</div>` : ''}
      </div></li>`;
    }).join('');
    app.innerHTML = header({ model: ctx, idx: lastStep(ctx), right: `<a class="iconbtn" href="#/data" aria-label="Your data on this device">Your data</a>` }) +
      `<main id="main"><div class="wrap" style="max-width:1100px">
        <div class="hero"><p class="eyebrow">${esc(courseShort)}</p><h1>${fresh ? 'Learn to make things move.' : 'Welcome back.'}</h1>
        <p class="lede">${fresh ? 'One module a week. You try first, then you read. Nothing is graded.' : 'The bar at the top shows where you are. Pick up at your step.'}</p></div>
        <div class="grid-home" id="homegrid">
          <div style="display:grid;gap:1rem;align-content:start">${visitor}${week}${heard}</div>
          <section class="card" aria-labelledby="r-h"><h2 id="r-h" style="margin-top:0">The road: eight modules to one piece</h2><ol class="road">${road}</ol></section>
        </div>
        <p class="privacy-line">Your answers stay on this device${mem.consent === 'yes' ? '' : mem.consent === 'no' ? ' only until you close the page (you chose not to keep them)' : ' only for this visit, until you choose to keep them'}. Nothing is sent anywhere unless you hand work in. <a href="#/data">Your data</a>${CONTENT.preview ? ' · <span class="proto">preview</span> modules not yet released are shown for review' : ''}</p>
        <p class="privacy-line"><a href="#/talk" onclick="event.preventDefault();LM.discuss()">Talk about this week with the class</a> (in ${esc((CFG.discord || {}).server || 'Discord')}).</p>
        <p class="privacy-line">${esc(versionLine())}</p>
      </div></main>`;
    focusMain();
  }
  function starHTML() {
    return `<span class="star"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="var(--gold)" d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>A quiet gold star, just for you</span>`;
  }

  // ------------------------------------------------------------------ view: the module map (every step, what is done, what is open)
  function pathHTML(model, hereIdx) {
    return `<ol class="path">` + model.blocks.map(b => {
      const done = blockDone(model, b);
      const here = hereIdx != null && model.steps[hereIdx].block === b;
      const nDone = b.steps.filter(i => stepDone(model, model.steps[i])).length;
      const first = b.steps[0] + 1, last = b.steps[b.steps.length - 1] + 1;
      return `<li class="${done ? 'done' : ''} ${here ? 'here' : ''}"><a href="#/m/${model.folder}/${here ? hereIdx : b.steps[0]}" ${here ? 'aria-current="step"' : ''}>
        <span class="node" aria-hidden="true">${done ? '&#10003;' : ''}</span>
        <span class="lbl"><b>${esc(b.title)}</b><span>Step${first === last ? ' ' + first : `s ${first}–${last}`} · ${done ? 'done' : nDone ? `${nDone} of ${b.steps.length} done` : 'open'}${here ? ' · you are here' : ''}</span></span>
        ${b.required ? '' : '<span class="tag">optional</span>'}</a></li>`;
    }).join('') + `</ol>`;
  }
  function openList(model) {
    return model.blocks.filter(b => !blockDone(model, b)).map(b => `<li><a href="#/m/${model.folder}/${b.steps.find(i => !stepDone(model, model.steps[i]))}">${esc(b.title)}</a>${b.required ? '' : ' <span class="tag">optional</span>'}${b.kind === 'second-pass' ? ' <span class="small muted">(after you have made the ball)</span>' : ''}</li>`).join('');
  }
  function viewModule(model) {
    setTitle(model.meta.title);
    const c = counts(model);
    const r = resumeStep(model);
    const m = ms(model.id);
    const started = Object.keys(m.visited).length;
    const fb = (m.feedback || [])[0];
    const open = openList(model);
    const main = `<div class="wrap">
        <p class="eyebrow">${esc(modLabel(model))}</p>
        <h1>${esc(model.meta.title)}</h1>
        <p class="muted">About ${model.meta.minutes} minutes. Do it in one sitting or ten. Any single piece can be redone without losing the rest.</p>
        <div style="display:grid;gap:.5rem;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
          <a class="btn primary" href="#/m/${model.folder}/${r}">${started ? `Continue at step ${r + 1}` : 'Start at step 1'}</a>
          <a class="btn quiet" href="#/m/${model.folder}/guide/${model.slideFor[r]}/${r}">Open the module guide (slides)</a>
        </div>
        ${fb ? `<div class="card feedback" style="margin-top:1rem"><p class="eyebrow">Heard back</p><p>${esc(fb.from || 'Your teacher')} wrote back about this module.</p>${fb.star ? starHTML() : ''} <p style="margin-top:.6rem"><a href="#/heard">Read it</a></p></div>` : ''}
        ${started && open ? `<div class="card stillopen" style="margin-top:1rem"><h2 style="margin-top:0">Still open</h2><ul>${open}</ul><p class="small muted" style="margin:0">Optional parts can stay open. Nothing here is a grade.</p></div>` : started && !open ? `<div class="card" style="margin-top:1rem"><h2 style="margin-top:0">Every step is done</h2><p style="margin:0">Hand in your work if you want feedback, and come back for the second pass whenever you like.</p></div>` : ''}
        <div class="everystep"><h2>Every step</h2>
        ${pathHTML(model, started ? m.last : null)}</div>
      </div>`;
    app.innerHTML = header({ model, idx: started ? m.last : null, back: '#/', backLabel: 'Back to the course' }) + `<div class="modpage">${shell(model, started ? m.last : null, main, null)}</div>`;
    focusMain();
  }

  // ------------------------------------------------------------------ view: a step (one screen)
  function viewStep(model, idx) {
    const st = model.steps[idx];
    const m = ms(model.id);
    m.visited[idx] = true; m.last = idx; mem.lastFolder = model.folder; persist();
    setTitle(st.h2 || st.block.title);
    const nx = nextIdx(model, idx), pv = prevIdx(model, idx);
    let nxLabel, nxHref;
    if (nx != null) { nxLabel = model.steps[nx].block !== st.block ? 'Next: ' + model.steps[nx].block.title : `Next: step ${nx + 1}`; nxHref = `#/m/${model.folder}/${nx}`; }
    else { const c = counts(model); nxLabel = c.open ? `What is still open (${c.open})` : 'Module done: back to the course'; nxHref = c.open ? `#/m/${model.folder}` : '#/'; }
    let body = renderMD(model, st.md);
    if (st.si > 0 && !/^#\s/m.test(st.md)) body = `<p class="eyebrow">${esc(st.block.title)}${st.subOf && st.h2 ? ` · ${esc(st.h2)}` : ''}${st.subOf ? ` · ${st.sub} of ${st.subOf}` : ''}</p>` + body;
    // the "read first instead" choice the content promises, on the first screen of a first-pass block
    const hasExplainedPrompts = st.block.steps.some(i => model.steps[i].pids.some(pid => model.prompts[pid].explains_with && !model.prompts[pid].repeat_of));
    if (st.si === 0 && hasExplainedPrompts) {
      body += `<div class="readfirst">${m.readFirst
        ? `Every explanation is open. You can still answer each prompt first. <button class="linkish" id="rf">Close them again</button>`
        : `Guessing first is the method, but it is your call. <button class="linkish" id="rf">I would rather read first: open every explanation</button>`}</div>`;
    }
    if (handinHere(model, st)) body += handinHTML(model);
    const blockGuide = model.slideFor[idx];
    const main = `<div class="wrap">
          <article class="step">${body}</article>
          <nav class="nextbar" aria-label="Move through the module">
            ${pv != null ? `<a class="btn quiet back" href="#/m/${model.folder}/${pv}" aria-label="Previous: step ${pv + 1}">&#8592;</a>` : ''}
            <a class="btn primary nextbtn" href="${nxHref}"><span class="nl">${esc(nxLabel)}</span><span aria-hidden="true">&#8594;</span></a>
          </nav>
        </div>`;
    app.innerHTML = header({ model, idx, onStep: true, back: `#/m/${model.folder}`, backLabel: 'Every step of the module',
      right: `<a class="iconbtn guide-btn" href="#/m/${model.folder}/guide/${blockGuide}/${idx}" aria-label="Open the module guide at this step">Guide</a>` }) +
      shell(model, idx, main, guidePaneHTML(model, blockGuide, idx));
    $$('.prompt[data-prompt]', app).forEach(el => mountPrompt(el, model, el.dataset.prompt));
    const rf = $('#rf'); if (rf) rf.onclick = () => { m.readFirst = !m.readFirst; persist(); viewStep(model, idx); };
    if (handinHere(model, st)) mountHandin(model);
    wireGuidePane(model, idx);
    focusMain();
  }
  function guidePaneHTML(model, k, fromStep) {
    const sl = model.guide[k];
    if (!sl) return '';
    return `<div class="pane-h"><p class="eyebrow">Module guide · slide ${k + 1} of ${model.guide.length}</p>
      <span><button class="iconbtn" data-gp="-1" aria-label="Previous slide">&#8592;</button> <button class="iconbtn" data-gp="1" aria-label="Next slide">&#8594;</button></span></div>
      <div class="slide">${renderMD(model, sl.md, { noPrompts: true })}</div>
      <p class="small" style="margin-top:.8rem"><a href="#/m/${model.folder}/guide/${k}/${fromStep}">Open the guide full screen</a></p>`;
  }
  function wireGuidePane(model, idx) {
    const pane = $('.guidepane');
    if (!pane) return;
    let k = model.slideFor[idx];
    pane.addEventListener('click', e => {
      const b = e.target.closest('[data-gp]');
      if (!b) return;
      k = Math.max(0, Math.min(model.guide.length - 1, k + +b.dataset.gp));
      pane.innerHTML = guidePaneHTML(model, k, idx);
    });
  }

  // ------------------------------------------------------------------ view: the guide, full screen (the anchor stays; back returns to the step)
  function viewGuide(model, k, fromStep) {
    k = Math.max(0, Math.min(model.guide.length - 1, k));
    const sl = model.guide[k];
    const from = fromStep != null && fromStep !== '' ? +fromStep : lastStep(model);
    setTitle('Guide: ' + (sl.title || model.meta.title));
    const back = from != null ? `#/m/${model.folder}/${from}` : `#/m/${model.folder}`;
    const target = sl.targets[0];
    const tgtLabel = target != null ? stepLabel(model, model.steps[target]) : null;
    const suffix = from != null ? '/' + from : '';
    const main = `<div class="deck ${sl.isTitle ? 'title-slide' : ''}"><div class="stage">
        <p class="eyebrow">Module guide · slide ${k + 1} of ${model.guide.length}</p>
        <div class="slide" aria-roledescription="slide" aria-label="Slide ${k + 1} of ${model.guide.length}">${renderMD(model, sl.md, { noPrompts: true })}
        ${tgtLabel ? `<p class="shadows"><a class="btn small quiet" href="#/m/${model.folder}/${target}">This slide is step ${target + 1}: ${esc(tgtLabel)} &#8594;</a></p>` : ''}</div>
        ${from != null ? `<p style="margin-top:1rem"><a class="btn quiet block" href="${back}">&#8592; Back to step ${from + 1}, where you were</a></p>` : ''}
      </div>
      <div class="ctrl"><a class="btn quiet" href="#/m/${model.folder}/guide/${Math.max(0, k - 1)}${suffix}" ${k === 0 ? 'aria-disabled="true" tabindex="-1" style="opacity:.4;pointer-events:none"' : ''} aria-label="Previous slide">&#8592; Slide</a>
        <span class="count" aria-live="polite">${k + 1} / ${model.guide.length}</span>
        <a class="btn primary" href="#/m/${model.folder}/guide/${Math.min(model.guide.length - 1, k + 1)}${suffix}" ${k === model.guide.length - 1 ? 'aria-disabled="true" tabindex="-1" style="opacity:.4;pointer-events:none"' : ''} aria-label="Next slide">Slide &#8594;</a></div>
      </div>`;
    app.innerHTML = header({ model, idx: from, back, backLabel: from != null ? `Back to step ${from + 1}` : 'Back to the module' }) + shell(model, from, main, null);
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

  // ------------------------------------------------------------------ prompts
  function mountPrompt(el, model, pid) {
    const p = model.prompts[pid];
    if (!p) { el.innerHTML = `<p class="muted">[prompt ${esc(pid)} is not described in module.json]</p>`; return; }
    const kind = { chart: mountChart, choice: mountChoice, 'short-answer': mountText, 'long-answer': mountText, reflect: mountReflect }[p.type] || mountOffPage;
    kind(el, model, p);
    // r2 quirk: the question is often written twice, once in the block's prose and once as the prompt's ask.
    // When the paragraph just above says the same thing, the widget's copy stays for screen readers only.
    // (r3 puts a prompt's text in one place.)
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
    return `<div class="ptag"><span>${p.repeat_of ? 'Again, from memory' : TYPE_LABEL[p.type] || p.type}</span><span>${p.resettable ? 'Redo any time' : ''}</span></div>`;
  }
  function firstPassOf(model, p) {
    if (!p.shows_first_pass || !p.repeat_of) return null;
    const a = ms(model.id).answers[p.repeat_of];
    return a && a.committed ? a : null;
  }
  function explainHTML(model, p, collapsed) {
    const b = p.explains_with && model.blocks.find(x => x.id === p.explains_with);
    if (!b) return '';
    const inner = `<div class="explain"><p class="eyebrow">Why · ${esc(b.title)}</p>${renderMD(model, blockMD(b).replace(/^#\s+.*$/m, ''), { noPrompts: true, shift: 1 })}</div>`;
    return collapsed ? `<details class="explain-wrap"><summary class="linkish">Read the explanation again: ${esc(b.title)}</summary>${inner}</details>` : inner;
  }
  function markExplained(model, p) {
    if (p.explains_with && !p.repeat_of) { ms(model.id).readInline[p.explains_with] = true; persist(); }
  }
  const HUMAN = { accept: 'The answer', first: 'What comes first', why: 'Why', note: 'Note', also_taught: 'Also in the lesson' };
  function answerHTML(p, skip = []) {
    const a = p.answer;
    if (a == null) return p.answer_note ? `<div class="answer"><h4>About this one</h4><p style="margin:0">${esc(p.answer_note)}</p></div>` : '';
    const show = v => Array.isArray(v) ? (v.length > 1 ? `<ul style="margin:.2rem 0 0">${v.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : esc(v[0])) : esc(v);
    if (typeof a === 'string') return `<div class="answer"><h4>What the course says</h4><p style="margin:0">${esc(a)}</p></div>`;
    if (Array.isArray(a)) return `<div class="answer"><h4>What the course says</h4>${show(a)}</div>`;
    const rows = Object.keys(a).filter(k => !skip.includes(k) && k !== 'reference' && k !== 'accept_if').map(k => {
      const label = k === 'accept' && Array.isArray(a[k]) && a[k].length > 1 ? 'Any of these is the idea' : HUMAN[k] || k.replace(/_/g, ' ');
      return `<dt>${esc(label[0].toUpperCase() + label.slice(1))}</dt><dd>${show(a[k])}</dd>`;
    }).join('');
    return rows ? `<div class="answer"><h4>What the course says</h4><dl>${rows}</dl></div>` : '';
  }
  function redoBtn(p) { return p.resettable === false ? '' : `<button class="btn small quiet" data-act="redo">Redo this one</button>`; }
  function historyLine(st) { return st.history && st.history.length ? `<p class="history">Earlier tries kept on this device: ${st.history.length}. Redoing never touches your other answers.</p>` : ''; }
  function commit(model, p, value) {
    const st = ans(model.id, p.id);
    st.value = value; st.committed = true; st.at = new Date().toISOString(); delete st.draft;
    markExplained(model, p);
    persist(); askConsent(); refreshAnchor();
  }
  function redo(model, p) {
    const st = ans(model.id, p.id);
    if (st.committed) st.history.push({ value: st.value, at: st.at, judged: st.judged });
    st.committed = false; st.value = undefined; st.judged = {};
    persist(); refreshAnchor();
  }
  function refreshSegs() { /* the segment bar updates on the next screen */ }

  // --- text answers (short-answer, long-answer) -----------------------------------------------
  function mountText(el, model, p) {
    const st = ans(model.id, p.id);
    const fp = firstPassOf(model, p);
    const long = p.type === 'long-answer';
    const readFirst = ms(model.id).readFirst;
    el.classList.toggle('committed', !!st.committed);
    el.innerHTML = ptag(p) + `<p class="ask" id="ask-${p.id}">${esc(p.ask)}</p>` +
      (fp ? `<div class="firstpass"><b>Your first pass</b>${esc(fp.value)}</div>` : '') +
      (st.committed
        ? `<div class="locked" aria-label="Your answer">${esc(st.value)}</div>
           <div class="row"><span class="status">${p.answer == null ? 'Kept on this device.' : 'Committed.'}</span>${redoBtn(p)}</div>
           <div class="reveal">${answerHTML(p)}${explainHTML(model, p, !!p.repeat_of)}${historyLine(st)}</div>`
        : `<textarea id="ta-${p.id}" aria-labelledby="ask-${p.id}" placeholder="${long ? 'A word, a sentence, or “I don’t know yet”' : 'Your best guess, in your own words'}">${esc(st.draft || '')}</textarea>
           ${long ? `<div class="chips"><button class="chip" data-act="idk">I don't know yet</button></div>` : ''}
           <div class="row"><button class="btn primary" data-act="commit" ${st.draft ? '' : 'disabled'}>${p.answer == null ? 'Keep this answer' : 'Commit my answer'}</button>
           <span class="status">${p.answer == null ? '' : 'The explanation opens when you commit.'}</span></div>
           ${readFirst ? `<div class="reveal">${answerHTML(p)}${explainHTML(model, p, false)}</div>` : ''}`);
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
    const hb = $('.appbar'); const y = el.getBoundingClientRect().top + window.scrollY - (hb ? hb.offsetHeight + 8 : 70);
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
    el.innerHTML = ptag(p) + `<p class="ask" id="ask-${p.id}">${esc(p.ask)}</p>` +
      (fp ? `<div class="firstpass"><b>Your first pass</b>You chose ${esc(fp.value)}</div>` : '') +
      `<div class="options" role="radiogroup" aria-labelledby="ask-${p.id}">` + (p.options || []).map((o, i) => {
        const on = sel === o;
        return `<button class="chip" role="radio" aria-checked="${on}" tabindex="${on || (!sel && i === 0) ? 0 : -1}" data-opt="${esc(o)}" ${st.committed ? 'aria-disabled="true"' : ''}>${esc(o)}</button>`;
      }).join('') + `</div>` +
      (st.committed
        ? `<div class="row"><span class="status">You committed <b>${esc(st.value)}</b>.</span>${redoBtn(p)}</div>
           <div class="reveal">${accepts && accepts.length ? `<div class="answer"><h4>What the course says</h4><p style="margin:0">${accepts.length > 1 ? 'Working answers: ' : ''}<b>${accepts.map(esc).join(' or ')}</b>. ${accepts.includes(st.value) ? 'Yours is one of them.' : 'Yours was ' + esc(st.value) + '; read why below.'}</p>${p.answer.note ? `<p style="margin:.5rem 0 0">${esc(p.answer.note)}</p>` : ''}</div>` : answerHTML(p)}
           ${explainHTML(model, p, !!p.repeat_of)}${historyLine(st)}</div>`
        : `<div class="row"><button class="btn primary" data-act="commit" ${sel ? '' : 'disabled'}>Commit my answer</button><span class="status">The explanation opens when you commit.</span></div>
           ${readFirst ? `<div class="reveal">${answerHTML(p)}${explainHTML(model, p, false)}</div>` : ''}`);
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
    el.innerHTML = ptag(p) + `<p class="ask" id="ask-${p.id}">${esc(p.ask)}</p>
      <textarea id="ta-${p.id}" aria-labelledby="ask-${p.id}" placeholder="A few words of your own">${esc(v.text || '')}</textarea>
      ${p.options ? `<p class="small muted" style="margin:.7rem 0 0" id="chips-${p.id}">And if you like, the word that fits:</p><div class="chips" role="group" aria-labelledby="chips-${p.id}">${p.options.map(o => `<button class="chip" aria-pressed="${v.chip === o}" data-chip="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}
      <div class="row"><button class="btn primary" data-act="save">${st.committed ? 'Saved' : 'Save'}</button><span class="status" aria-live="polite">${st.committed ? 'Kept on this device.' : ''}</span>${st.committed ? redoBtn(p) : ''}</div>
      ${p.answer_note ? `<p class="history">${esc(p.answer_note)}</p>` : ''}`;
    const ta = $('textarea', el);
    const cur = () => ({ text: ta.value.trim(), chip: ($('[aria-pressed=true]', el) || {}).dataset ? $('[aria-pressed=true]', el).dataset.chip : null });
    ta.addEventListener('input', () => { st.draft = cur(); if (st.committed) { st.committed = false; $('[data-act=save]', el).textContent = 'Save'; } persistSoon(); });
    el.onclick = e => {
      const c = e.target.closest('[data-chip]');
      if (c) { const on = c.getAttribute('aria-pressed') === 'true'; $$('[data-chip]', el).forEach(x => x.setAttribute('aria-pressed', 'false')); c.setAttribute('aria-pressed', String(!on)); st.draft = cur(); st.committed = false; $('[data-act=save]', el).textContent = 'Save'; return; }
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'save') { const val = cur(); if (!val.text && !val.chip) return; commit(model, p, val); mountReflect(el, model, p); }
      if (a.dataset.act === 'redo') { redo(model, p); mountReflect(el, model, p); }
    };
  }

  // --- a prompt type done off the page (sketch, animate, record) --------------------------------
  function mountOffPage(el, model, p) {
    const st = ans(model.id, p.id);
    el.innerHTML = ptag(p) + `<p class="ask">${esc(p.ask)}</p><p class="small muted">You do this one in your own tool, by hand. The page only keeps a note that you did it.</p>
      <div class="row"><button class="btn ${st.committed ? 'quiet' : 'primary'}" data-act="done">${st.committed ? 'Done ✓' : 'I have done it'}</button>${st.committed ? redoBtn(p) : ''}</div>
      ${st.committed ? `<div class="reveal">${answerHTML(p)}${explainHTML(model, p, false)}</div>` : ''}`;
    el.onclick = e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'done' && !st.committed) { commit(model, p, 'done'); mountOffPage(el, model, p); }
      if (a.dataset.act === 'redo') { redo(model, p); mountOffPage(el, model, p); }
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

  function mountChart(el, model, p) {
    const st = ans(model.id, p.id);
    const ref = p.answer && Array.isArray(p.answer.reference) ? p.answer.reference : null;
    const ax = parseAxis(p.units && p.units.x, { min: 1, max: ref ? ref.length : 12 });
    const ay = parseAxis(p.units && p.units.y, { min: 0, max: 10 });
    const fpsM = String((p.units && p.units.x) || '').match(/(\d+)\s*frames per second/);
    const fps = fpsM ? +fpsM[1] : 24;
    const N = Math.round(ax.max - ax.min + 1);
    const SNAP = ay.snap || 0.25, KSTEP = 0.5, PSTEP = 2;
    const fp = firstPassOf(model, p);
    let vals = st.committed ? st.value.slice() : (st.draft ? st.draft.slice() : new Array(N).fill(null));
    let showRef = true, showCompare = !!fp, compareSrc = fp ? 'first' : null;
    const readFirst = ms(model.id).readFirst && !p.repeat_of;
    const worked = p.worked_example && model.assets[p.worked_example];

    el.classList.toggle('committed', !!st.committed);
    el.innerHTML = ptag(p) + `<p class="ask" id="ask-${p.id}">${esc(p.ask)}</p>
      <p class="hint-line">Each column is one frame, ${ax.min} to ${ax.max}. Height runs from <b>${ay.min}</b>${ay.minLabel ? ` (${esc(ay.minLabel)})` : ''} to <b>${ay.max}</b>${ay.maxLabel ? ` (${esc(ay.maxLabel)})` : ''}. ${st.committed ? '' : 'Tap a column to put its dot there, or drag your thumb across to draw them all.'}</p>
      <div class="chart-wrap"><svg class="chart plot" role="group" aria-labelledby="ask-${p.id}" aria-describedby="kb-${p.id}"></svg><svg class="chart gaps" aria-hidden="true"></svg></div>
      <p class="sr-only" id="kb-${p.id}">Keyboard: Tab to a frame, then Up and Down arrows move its dot by half a square, Page Up and Page Down by two, Home to the floor, End to the top.</p>
      <div class="legend" aria-hidden="true"></div>
      <div class="chart-tools">
        <button class="btn small" data-act="play">&#9654; Play it</button>
        <button class="btn small quiet" data-act="slow">Slow motion</button>
        ${st.committed ? '' : `<button class="btn small quiet" data-act="clear">Clear</button>`}
        ${st.committed && ref ? `<button class="chip" data-act="toggleRef" aria-pressed="${showRef}">Show the reference</button>` : ''}
        ${fp || (st.history && st.history.length) ? `<button class="chip" data-act="toggleCmp" aria-pressed="${showCompare}">${fp ? 'Show my first pass' : 'Show my last try'}</button>` : ''}
      </div>
      <div class="row">${st.committed
        ? `<span class="status">Committed.</span>${redoBtn(p)}`
        : `<button class="btn primary" data-act="commit" disabled>Commit my chart</button><span class="status count-line" aria-live="polite"></span>`}</div>
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
    const fmt = v => (Math.round(v * 100) / 100).toString();
    const compareVals = () => compareSrc === 'first' && fp ? fp.value : (st.history && st.history.length ? st.history[st.history.length - 1].value : null);

    function draw() {
      const grid = [];
      for (let v = ay.min; v <= ay.max; v++) {
        const y = yOf(v);
        grid.push(`<line x1="${X0}" x2="${X1}" y1="${y}" y2="${y}" class="${v % 2 === 0 ? 'major' : ''}"/>`);
      }
      for (let i = 0; i <= N; i++) grid.push(`<line x1="${X0 + colW * i}" x2="${X0 + colW * i}" y1="${Y0}" y2="${Y1}" style="stroke-dasharray:2 4"/>`);
      const ylab = []; for (let v = ay.min; v <= ay.max; v += 2) ylab.push(`<text class="ax ylab" x="${X0 - 5}" y="${yOf(v) + 4}" text-anchor="end">${v}</text>`);
      const xlab = []; for (let i = 0; i < N; i++) xlab.push(`<text class="ax" x="${xOf(i)}" y="${Y1 + 23}" text-anchor="middle">${ax.min + i}</text>`);
      const cols = [];
      for (let i = 0; i < N; i++) {
        const v = vals[i];
        cols.push(`<g class="col" data-i="${i}" role="slider" tabindex="${st.committed ? -1 : 0}" aria-orientation="vertical" aria-valuemin="${ay.min}" aria-valuemax="${ay.max}" ${v != null ? `aria-valuenow="${v}"` : ''}
          aria-valuetext="${v != null ? `Frame ${ax.min + i}: ${fmt(v)} squares` : `Frame ${ax.min + i}: no dot yet`}" aria-label="Frame ${ax.min + i}" ${st.committed ? 'aria-readonly="true"' : ''}>
          <rect class="col-bg" x="${X0 + colW * i + 1}" y="${Y0 - 6}" width="${colW - 2}" height="${Y1 - Y0 + 12}" rx="6"/>
          <rect class="col-hit" x="${X0 + colW * i}" y="0" width="${colW}" height="${H}"/>
          ${v != null ? `<circle class="dot" cx="${xOf(i)}" cy="${yOf(v)}" r="${Math.min(9, colW * 0.36)}"/>` : ''}
        </g>`);
      }
      let over = '';
      const cmp = showCompare && compareVals();
      if (cmp) over += cmp.map((v, i) => v == null ? '' : `<g class="first"><line x1="${xOf(i) - 5}" y1="${yOf(v) - 5}" x2="${xOf(i) + 5}" y2="${yOf(v) + 5}"/><line x1="${xOf(i) + 5}" y1="${yOf(v) - 5}" x2="${xOf(i) - 5}" y2="${yOf(v) + 5}"/></g>`).join('');
      const revealRef = ref && showRef && (st.committed || readFirst);
      if (revealRef) {
        over += `<polyline class="refline" points="${ref.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ')}"/>`;
        over += ref.map((v, i) => { const x = xOf(i), y = yOf(v), r = 6.5; return `<path class="ref ${el._justCommitted ? 'refin' : ''}" style="transform-origin:${x}px ${y}px;animation-delay:${i * 45}ms" d="M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z"/>`; }).join('');
      }
      const lanes = `<rect class="lane" x="3" y="${Y0 - 6}" width="${lane - 7}" height="${Y1 - Y0 + 12}" rx="8" opacity="0"/>
        <circle class="pball" cx="${lane / 2}" cy="${yOf(ay.max)}" r="7" style="display:none"/>
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
      let s = `<text class="gaplbl" x="${X0}" y="11">How far it moves each frame</text><line x1="${X0}" x2="${X1}" y1="${base}" y2="${base}" stroke="var(--line-2)"/>`;
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
      L.innerHTML = `<span><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="var(--ball)"/></svg>Your dots</span>` +
        (revealRef ? `<span><svg viewBox="0 0 16 16"><path d="M8 1.5L14.5 8L8 14.5L1.5 8Z" fill="var(--card)" stroke="var(--ref)" stroke-width="2"/></svg>One good answer (reference)</span>` : '') +
        (cmp ? `<span><svg viewBox="0 0 16 16"><path d="M3 3L13 13M13 3L3 13" stroke="var(--first)" stroke-width="2"/></svg>${compareSrc === 'first' ? 'Your first pass' : 'Your last try'}</span>` : '');
    }
    function updateStatus() {
      const n = vals.filter(v => v != null).length;
      const s = $('.count-line', el); if (s) s.textContent = n < N ? `${n} of ${N} frames placed` : 'All frames placed. Play it, or commit.';
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
      g.setAttribute('aria-valuenow', v); g.setAttribute('aria-valuetext', `Frame ${ax.min + i}: ${fmt(v)} squares`);
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
    // keyboard: each frame is an APG vertical slider
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

    // play: the chart becomes motion. Your ball in the left lane, the reference in the right.
    function play(slow) {
      stopPlayers();
      const seq = vals.map((v, i) => v != null ? v : null);
      const showR = ref && showRef && st.committed;
      const ball = $('.pball', plot), rb = $('.pref', plot), lanes = $$('.lane', plot);
      $$('.ylab', plot).forEach(t => t.style.opacity = 0);
      lanes.forEach(l => l.setAttribute('opacity', 1));
      ball.style.display = '';
      if (showR) rb.style.display = '';
      const frameMs = 1000 / fps * (slow ? 6 : 1);
      let f = 0, loops = 0, stopped = false, t0 = performance.now(), hold = 0;
      const tick = now => {
        if (stopped) return;
        if (now - t0 >= frameMs) {
          t0 = now;
          if (hold > 0) { hold--; } else {
            $$('.col', plot).forEach(c => c.classList.toggle('playing', +c.dataset.i === f));
            if (seq[f] != null) ball.setAttribute('cy', yOf(seq[f]));
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
        ball.style.display = 'none'; rb.style.display = 'none';
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
      const revealRef = ref && (st.committed || readFirst);
      let h = '';
      if (worked && !st.committed && !p.repeat_of && !model.blocks.some(b => b.md.includes('asset:' + p.worked_example))) {
        h += `<details class="worked" style="margin-top:.8rem"><summary class="linkish">How to read the chart: the worked example</summary>${figureHTML(model, p.worked_example)}</details>`;
      }
      if (st.committed || readFirst) {
        const judge = p.answer && p.answer.accept_if;
        h += `<div class="reveal">`;
        if (judge && judge.length) {
          h += `<div class="answer"><h4>Your chart is right if these are true</h4><p style="margin:0 0 .3rem" class="small">You do not need the exact numbers. Look at your dots and the bars above, and judge for yourself. Nothing is scored.</p>
            <ol class="judge">${judge.map((s, k) => `<li><div class="s">${esc(s[0].toUpperCase() + s.slice(1))}.</div>${st.committed ? `<div class="chips" role="group" aria-label="Does yours? Sentence ${k + 1}"><button class="chip" data-judge="${k}" data-v="yes" aria-pressed="${st.judged[k] === 'yes'}">Mine does</button><button class="chip" data-judge="${k}" data-v="not" aria-pressed="${st.judged[k] === 'not'}">Not yet</button></div>` : ''}</li>`).join('')}</ol></div>`;
        }
        h += explainHTML(model, p, !!p.repeat_of);
        h += historyLine(st) + `</div>`;
      }
      after.innerHTML = h;
    }

    el.onclick = e => {
      const a = e.target.closest('[data-act]');
      const j = e.target.closest('[data-judge]');
      if (j) { const k = +j.dataset.judge; st.judged[k] = st.judged[k] === j.dataset.v ? undefined : j.dataset.v; persist(); $$(`[data-judge="${k}"]`, el).forEach(b => b.setAttribute('aria-pressed', st.judged[k] === b.dataset.v)); return; }
      if (!a) return;
      const act = a.dataset.act;
      if (act === 'play') play(false);
      if (act === 'slow') play(true);
      if (act === 'clear') { stopPlayers(); vals = new Array(N).fill(null); st.draft = null; persist(); draw(); }
      if (act === 'toggleRef') { showRef = !showRef; a.setAttribute('aria-pressed', showRef); draw(); }
      if (act === 'toggleCmp') { showCompare = !showCompare; if (!fp) compareSrc = 'last'; a.setAttribute('aria-pressed', showCompare); draw(); }
      if (act === 'commit' && vals.every(v => v != null)) {
        stopPlayers(); commit(model, p, vals.slice()); el._justCommitted = true; mountChart(el, model, p);
        focusReveal(el);
        setTimeout(() => { if (!REDUCED) play(false); }, ref ? 700 : 100);  // the moment of commit: see both balls fall
      }
      if (act === 'redo') { stopPlayers(); redo(model, p); mountChart(el, model, p); const c = $('.col', el); if (c) c.focus({ preventScroll: true }); }
    };
    layout(); draw(); renderAfter();
    const jc = el._justCommitted;
    if (jc) el._justCommitted = false;
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
    return `<section class="card handin" aria-labelledby="hi-h" style="margin-top:1.2rem">
      <p class="eyebrow">Hand it in</p>
      <h2 id="hi-h" style="margin-top:.2rem">${h ? 'Handed in' : 'Send your ball to the teacher'}</h2>
      ${h ? `<div class="sent"><p style="margin:0"><b>You handed this in</b> on ${new Date(h.at).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${h.file ? `, with ${esc(h.file)}` : ''}.</p>
        <p style="margin:.4rem 0 0" class="small">When the teacher replies in ${esc(CFG.discord.server)}, the reply carries a link. Open it on this device and the feedback appears here, and again where the next module begins.</p></div>
        <p style="margin-top:.8rem"><button class="linkish" id="hi-again">Hand in a new version</button></p>`
      : `<p class="small muted">What to send: ${esc(asg.deliverable)}. You post it yourself in ${esc(CFG.discord.server)}, in a private thread only you and the teacher can see. This page never uploads anything.</p>
      <div class="field"><label for="hi-name">The name you want the teacher to use</label><input type="text" id="hi-name" autocomplete="nickname" value="${esc(mem.name || '')}" placeholder="Any name you like"><p class="help">Your choice. It can be your Discord name, a nickname, or blank.</p></div>
      ${selfAns && selfAns.committed ? `<label class="check"><input type="checkbox" id="hi-self" checked> <span>Include my self-check: <b>${esc(selfAns.value.chip || '')}</b>${selfAns.value.text ? ` “${esc(selfAns.value.text)}”` : ''}</span></label>` : ''}
      <div class="field"><label for="hi-note">A line for the teacher (optional)</label><input type="text" id="hi-note" placeholder="What you want them to look at"></div>
      <button class="btn primary block" id="hi-send">Hand it in on Discord: show me how</button>
      <p class="small muted" style="margin:.6rem 0 0">Optional, always. There is never a grade.</p>`}
    </section>`;
  }
  function mountHandin(model) {
    const again = $('#hi-again');
    if (again) again.onclick = () => { delete ms(model.id).handin; persist(); route(); };
    const send = $('#hi-send');
    if (!send) return;
    send.onclick = async () => {
      const name = $('#hi-name').value.trim();
      const file = null;   // the student attaches the video in Discord, not here
      const note = $('#hi-note').value.trim();
      const self = Object.values(model.prompts).find(p => p.type === 'reflect');
      const sa = self && ms(model.id).answers[self.id];
      const incSelf = $('#hi-self') && $('#hi-self').checked && sa && sa.committed;
      if (name) { mem.name = name; persist(); }
      const text = [
        `Hand-in: ${COURSE.meta.title.split(':')[0]}, ${model.meta.module === 0 ? 'Week 0' : 'Module ' + model.meta.module}: ${model.meta.title}`,
        `From: ${name || 'a student'}`,
        `Work: (my video is attached)`,
        incSelf ? `Self-check: ${sa.value.chip || ''}${sa.value.text ? ' "' + sa.value.text + '"' : ''}` : null,
        note ? `Note: ${note}` : null,
        `(sent from Letterman. Nothing is graded.)`
      ].filter(Boolean).join('\n');
      const done = () => { ms(model.id).handin = { at: new Date().toISOString(), file: file ? file.name : null }; persist(); closeSheet(); route(); };
      if (CFG.prototype) {
        sheet(`<p><span class="proto">prototype</span></p><h2>(prototype) would send</h2>
          <p>On a phone, this opens the share sheet with your file and the message below. You pick <b>${esc(CFG.discord.server)}</b>, then <b>${esc(CFG.discord.handinChannel)}</b>. On a computer it copies the message and opens the channel, and you drop the file in.</p>
          <pre>${esc(text)}</pre>
          <p class="small muted">Nothing was sent. The prototype makes no network request.</p>
          <div style="display:grid;gap:.5rem"><button class="btn primary" id="sh-ok">I posted it: mark as handed in</button><button class="btn quiet" id="sh-x">Not yet</button></div>`);
        $('#sh-ok').onclick = done; $('#sh-x').onclick = closeSheet;
        return;
      }
      // Live: one hand-in channel for every class; each student starts a private thread there that only
      // they and the teacher see (the Academy's setup, 2026-10-02). The page copies; the student posts.
      const thread = `${COURSE.meta.title.split(':')[0]}, Week ${model.meta.module}: ${name || 'your name'}`;
      sheet(`<h2>Hand it in on Discord</h2>
        <ol class="hsteps">
          <li><p>Open <b>${esc(CFG.discord.handinChannel)}</b> in ${esc(CFG.discord.server)}.</p>
            <p><a class="btn quiet" href="${esc(CFG.discord.channelUrl)}" target="_blank" rel="noopener">Open the hand-in channel<span class="sr-only"> (opens Discord in a new tab)</span></a></p></li>
          <li><p>Start a <b>private</b> thread: tap the threads icon (or <b>+</b>), choose <b>Create Thread</b>, and set it to <b>Private</b>. Name it:</p>
            <pre id="hs-thread">${esc(thread)}</pre><p><button class="btn quiet" type="button" data-copy="hs-thread">Copy the name</button></p></li>
          <li><p>In your thread, attach your video and paste this message:</p>
            <pre id="hs-msg">${esc(text)}</pre><p><button class="btn quiet" type="button" data-copy="hs-msg">Copy the message</button></p></li>
          <li><p>Send it. Only you and the teacher can see a private thread.</p></li>
        </ol>
        <p class="small muted" aria-live="polite" id="hs-said"></p>
        <div style="display:grid;gap:.5rem"><button class="btn primary" id="sh-ok">I sent it: mark as handed in</button><button class="btn quiet" id="sh-x">Not yet</button></div>`);
      $$('[data-copy]').forEach(bt => bt.onclick = async () => {
        const t = $('#' + bt.dataset.copy).textContent, said = $('#hs-said');
        try { await navigator.clipboard.writeText(t); said.textContent = 'Copied.'; }
        catch (e) { const r = document.createRange(); r.selectNodeContents($('#' + bt.dataset.copy)); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); said.textContent = 'Selected: copy it with your device\'s copy command.'; }
      });
      $('#sh-ok').onclick = done; $('#sh-x').onclick = closeSheet;
    };
  }

  // ------------------------------------------------------------------ hearing back
  function allFeedback() {
    const out = [];
    Object.entries(mem.modules).forEach(([id, m]) => (m.feedback || []).forEach(f => out.push(f)));
    return out.sort((a, b) => String(b.received).localeCompare(String(a.received)));
  }
  function b64dec(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  function importFeedback(payload) {
    let fb;
    try { fb = JSON.parse(b64dec(payload)); } catch (e) { fb = null; }
    history.replaceState(null, '', location.pathname + location.search + '#/heard');
    if (!fb || fb.v !== 1 || !fb.m) { sheet(`<h2>That link did not open</h2><p>It may have been cut short when it was copied. Ask the teacher to send it again; the feedback is also in their Discord reply.</p><button class="btn primary" id="sh-x">OK</button>`); $('#sh-x').onclick = closeSheet; return viewHeard(); }
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
      return `<article class="card feedback" style="margin-bottom:1rem">
        <p class="from">From ${esc(f.from || 'your teacher')}${f.d ? ' · ' + esc(f.d) : ''} · about ${esc(f.moduleTitle)}${f.to ? ' · to ' + esc(f.to) : ''}</p>
        ${f.star ? `<p>${starHTML()}</p><p class="small muted" style="margin-top:-.4rem">Only you can see this. It is not a grade, and nothing counts it.</p>` : ''}
        ${f.msg ? `<p>${esc(f.msg)}</p>` : ''}
        ${notes.length ? `<h3>Against the four lines of what good looks like</h3><ul class="crit">${notes.map(n => `<li><div class="c">${esc(crit[n.c] || 'Criterion ' + (n.c + 1))}</div>${esc(n.t)}</li>`).join('')}</ul>` : ''}
        ${f.forward ? `<h3>Carry this forward</h3><p>${esc(f.forward)}</p><p class="small muted">${f.carriesInto != null ? `This opens at the start of Module ${f.carriesInto}, where your ball comes back.` : ''}</p>` : ''}
      </article>`;
    }).join('') : `<div class="card"><p>Nothing yet. When you hand work in, the teacher's reply in ${esc(CFG.discord.server)} carries a link. Open it on this device and the feedback lands here.</p></div>`;
    const ctx = contextModel(), last = lastStep(ctx);
    const main = `<div class="wrap"><h1>Heard back</h1>${body}<p><a class="btn quiet block" href="${returnTo(ctx)}">&#8592; ${last != null ? `Back to step ${last + 1}, where you were` : 'Back to the module'}</a></p></div>`;
    app.innerHTML = header({ model: ctx, idx: last, back: returnTo(ctx), backLabel: 'Back to where you were' }) + (ctx ? shell(ctx, last, main, null) : `<main id="main">${main}</main>`);
    focusMain();
  }

  // ------------------------------------------------------------------ your data
  function viewData() {
    setTitle('Your data');
    const n = Object.values(mem.modules).reduce((k, m) => k + Object.values(m.answers).filter(a => a.committed).length, 0);
    const ctx = contextModel(), last = lastStep(ctx);
    const dataMain = `<div class="wrap"><h1>Your data</h1>
      <div class="card"><p><b>No account, and nothing on a server.</b> Your answers live in this browser on this device. ${n} answer${n === 1 ? '' : 's'} so far.</p>
      <p>Keeping them: <b>${mem.consent === 'yes' ? 'yes, on this device' : mem.consent === 'no' ? 'no (they go when you close the page)' : 'not chosen yet (they go when you close the page)'}</b></p>
      <div class="chips"><button class="chip" aria-pressed="${mem.consent === 'yes'}" id="c-yes">Keep them on this device</button><button class="chip" aria-pressed="${mem.consent === 'no'}" id="c-no">Don't keep anything</button></div>
      <p class="small muted">On an iPhone, add this page to your Home Screen. Safari clears a site's data after seven days without a visit; a Home Screen app keeps its own clock.</p></div>
      <div class="card" style="margin-top:1rem"><h2 style="margin-top:0">Moving to another device</h2><p>Save a copy as a file and open it on the other device.</p>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn quiet" id="d-save">Save a copy</button><label class="btn quiet" for="d-load">Load a copy</label><input type="file" id="d-load" accept="application/json" class="sr-only"></div></div>
      <div class="card" style="margin-top:1rem"><h2 style="margin-top:0">Erase</h2><p>Removes every answer, hand-in note and piece of feedback from this device. It cannot be undone.</p><button class="btn quiet" id="d-erase">Erase everything on this device</button></div>
      <p style="margin-top:1rem"><a class="btn quiet block" href="${returnTo(ctx)}">&#8592; ${last != null ? `Back to step ${last + 1}, where you were` : 'Back to the course'}</a></p>
      <p class="small muted">${esc(versionLine())}</p>
      </div>`;
    app.innerHTML = header({ model: ctx, idx: last, back: returnTo(ctx), backLabel: 'Back to where you were' }) + (ctx ? shell(ctx, last, dataMain, null) : `<main id="main">${dataMain}</main>`);
    $('#c-yes').onclick = () => { mem.consent = 'yes'; persist(); viewData(); };
    $('#c-no').onclick = () => { mem.consent = 'no'; try { localStorage.removeItem(KEY); } catch (e) { } viewData(); };
    $('#d-save').onclick = () => { const b = new Blob([JSON.stringify(mem, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'letterman-my-answers.json'; a.click(); };
    $('#d-load').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { const d = JSON.parse(t); if (d && d.modules) { mem = Object.assign({ consent: 'yes' }, d); persist(); viewData(); } } catch (x) { } }); };
    $('#d-erase').onclick = () => {
      sheet(`<h2>Erase everything?</h2><p>Every answer, every earlier try, your hand-in notes and any feedback on this device will be deleted. There is no copy anywhere else unless you saved one.</p>
        <div style="display:grid;gap:.5rem"><button class="btn primary" id="sh-ok">Yes, erase it all</button><button class="btn quiet" id="sh-x">Keep everything</button></div>`);
      $('#sh-ok').onclick = () => { try { localStorage.removeItem(KEY); } catch (e) { } mem = { consent: mem.consent, name: '', modules: {} }; persist(); closeSheet(); go('#/'); };
      $('#sh-x').onclick = closeSheet;
    };
    focusMain();
  }

  // ------------------------------------------------------------------ consent, sheets, discussion
  function askConsent(force) {
    if (STAGE || mem.consent || $('.consent')) return;
    const d = document.createElement('div');
    d.className = 'consent'; d.setAttribute('role', 'region'); d.setAttribute('aria-label', 'Keep your answers?');
    d.innerHTML = `<p><b>Keep your answers on this device?</b> Nothing is stored until you say yes. <a href="#/data">Export, import, erase</a></p><button class="btn primary small" id="cs-y">Keep them</button><button class="btn small" id="cs-n">Not now</button>`;
    const hb = $('.appbar'); if (hb) hb.insertAdjacentElement('afterend', d); else document.body.prepend(d);
    $('#cs-y').onclick = () => { mem.consent = 'yes'; persist(); d.remove(); };
    $('#cs-n').onclick = () => { mem.consent = 'no'; d.remove(); };
  }
  let lastFocus = null;
  function sheet(html) {
    closeSheet();
    lastFocus = document.activeElement;
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">${html.replace('<h2>', '<h2 id="sheet-h">')}</div>`;
    bg.addEventListener('click', e => { if (e.target === bg) closeSheet(); });
    bg.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSheet();
      if (e.key === 'Tab') { const f = $$('button, a, input, textarea', bg); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    });
    document.body.appendChild(bg);
    const f = $('button', bg); if (f) f.focus();
  }
  function closeSheet() { const s = $('.sheet-bg'); if (s) { s.remove(); if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus(); } }
  window.LM = {
    steps(folder) { const m = buildModel(folder); return m.steps.map(s => `${s.idx}\t${s.block.id}\t${s.h2 || ''}\t${s.pids.join(',')}\tslide ${m.slideFor[s.idx]}`).join('\n') + '\n--guide--\n' + m.guide.map((g, k) => `${k}\t${g.title}\t${g.shadows}\t-> ${g.targets.join(',')}`).join('\n'); },
    discuss() {
      const d = (CFG.discord.discuss || {})[courseKey] || { channel: CFG.discord.discussChannel, url: null };
      if (CFG.prototype || !d.url) {
        sheet(`<p><span class="proto">prototype</span></p><h2>Talk with the class</h2><p>Discussion lives in ${esc(CFG.discord.server)}, in <b>${esc(d.channel)}</b>.</p><p class="small muted">(prototype) would open ${esc(d.channel)}. No request was made.</p><button class="btn primary" id="sh-x">OK</button>`);
        $('#sh-x').onclick = closeSheet;
        return;
      }
      sheet(`<h2>Talk with the class</h2><p>This class talks in <b>${esc(d.channel)}</b>, in ${esc(CFG.discord.server)}.</p>
        <div style="display:grid;gap:.5rem"><a class="btn primary" href="${esc(d.url)}" target="_blank" rel="noopener">Open ${esc(d.channel)}<span class="sr-only"> (opens Discord in a new tab)</span></a><button class="btn quiet" id="sh-x">Close</button></div>`);
      $('#sh-x').onclick = closeSheet;
    }
  };

  // ------------------------------------------------------------------ the teacher's stage (console drives this window)
  window.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type === 'letterman:goto' && STAGE) go(d.hash);
  });
  // the console also writes where the stage is into shared storage; a stage window follows it even after
  // the console is reloaded and has lost its handle on this window
  window.addEventListener('storage', e => {
    if (!STAGE || e.key !== 'letterman:stage-goto' || !e.newValue) return;
    try { const d = JSON.parse(e.newValue); if (d && d.hash) go(d.hash); } catch (err) { }
  });

  // ------------------------------------------------------------------ offline (only where a service worker can run)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !STAGE) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }

  route();
})();
