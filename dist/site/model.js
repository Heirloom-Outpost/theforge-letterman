// Letterman's content model: shared by the student portal and the teaching console ("one renderer, two targets").
// Reads a package-v1 module as written (r2), including its quirks. Knows no module by name.
(function () {
  'use strict';
  const slash = p => String(p || '').replace(/\\/g, '/');   // r2 quirk: backslash paths
  window.LMModel = { create(CONTENT) {
  const courseKey = Object.keys(CONTENT.courses)[0];
  const COURSE = CONTENT.courses[courseKey];
  const MODELS = {};
  // The language of the page comes from the course (standard section 3: meta.language, a BCP 47 tag); a module may say its own.
  // A value that is not a tag is ignored. 'en' is used only when the course says nothing.
  const okLang = c => (typeof c === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(c.trim())) ? c.trim() : null;
  const courseLang = okLang(COURSE.meta && COURSE.meta.language) || 'en';
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = courseLang;   // the student page and the console both load this

  function inheritPrompt(p, byId) {
    if (!p.repeat_of || !byId[p.repeat_of]) return p;
    const base = byId[p.repeat_of];
    const eff = Object.assign({}, base, p);
    // r2 quirk: "answer": "same as p1" means inherit. r3 makes inheritance the rule.
    if (typeof p.answer === 'string' && /^same as\b/i.test(p.answer)) eff.answer = base.answer;
    eff.units = Object.assign({}, base.units || {}, p.units || {});
    eff.explains_with = p.explains_with || base.explains_with;
    eff.worked_example = p.worked_example;   // the second pass is from memory
    return eff;
  }

  function splitSteps(block) {
    // One idea per screen: split a block at each "## " heading, then give each prompt its own screen.
    const md = (block.md || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n');
    const lines = md.split('\n');
    const sections = [];
    let cur = { h2: null, lines: [] };
    for (const l of lines) {
      if (/^##\s+/.test(l)) { sections.push(cur); cur = { h2: l.replace(/^##\s+/, '').trim(), lines: [l] }; }
      else cur.lines.push(l);
    }
    sections.push(cur);
    const out = [];
    for (const s of sections) {
      const text = s.lines.join('\n');
      if (!text.trim()) continue;
      const pids = [...text.matchAll(/^\{\{prompt:([\w-]+)\}\}\s*$/gm)].map(m => m[1]);
      if (pids.length <= 1) { out.push({ h2: s.h2, md: text, pids }); continue; }
      // several prompts in one section: the text before the second prompt stays with the first
      const parts = text.split(/(?=^\{\{prompt:[\w-]+\}\}\s*$)/m);
      let lead = '';
      let k = 0;
      for (const part of parts) {
        const has = /^\{\{prompt:/.test(part);
        if (!has) { lead += part; continue; }
        out.push({ h2: k === 0 ? s.h2 : s.h2, md: (k === 0 ? lead : '') + part, pids: [part.match(/^\{\{prompt:([\w-]+)\}\}/)[1]], sub: k + 1, subOf: pids.length });
        k++;
      }
    }
    // drop a section that is only a heading line (would be an empty screen)
    const kept = out.filter(s => s.md.replace(/^#.*$/gm, '').trim() || s.pids.length);
    // a short lead-in with nothing to do is not a screen of its own: it joins the next one
    if (kept.length > 1 && !kept[0].pids.length && !kept[0].h2 && kept[0].md.replace(/^#.*$/gm, '').trim().length < 400) {
      kept[1] = Object.assign({}, kept[1], { md: kept[0].md + '\n\n' + kept[1].md, h2: null, lead: kept[1].h2 });
      kept.shift();
    }
    return kept;
  }

  function norm(s) { return String(s).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim().replace(/^the /, ''); }

  function buildModel(folder) {
    if (MODELS[folder]) return MODELS[folder];
    const pkg = COURSE.packages[folder];
    if (!pkg) return null;
    const mj = pkg.module;
    const byId = {};
    (mj.prompts || []).forEach(p => { byId[p.id] = p; });
    const prompts = {};
    Object.keys(byId).forEach(id => { prompts[id] = inheritPrompt(byId[id], byId); });
    const assets = {};
    (COURSE.assets || []).forEach(a => { assets[a.id] = Object.assign({}, a, { course: true }); });   // course.course: its files sit beside the course, not in a module's folder (set here, never published)   // course-level links (standard §3a); the module's own win
    (mj.assets || []).forEach(a => { assets[a.id] = a; });
    const blocks = (mj.student || []).map(b => Object.assign({}, b, { file: slash(b.file), md: pkg.files[slash(b.file)] || '' }));
    const steps = [];
    blocks.forEach((b, bi) => {
      b.steps = [];
      splitSteps(b).forEach((s, si) => {
        const st = Object.assign(s, { block: b, bi, si, idx: steps.length });
        b.steps.push(st.idx);
        steps.push(st);
      });
      if (!b.steps.length) { const st = { h2: null, md: b.md, pids: [], block: b, bi, si: 0, idx: steps.length }; b.steps.push(st.idx); steps.push(st); }
    });
    const explained = new Set(Object.values(prompts).filter(p => !p.repeat_of && p.explains_with).map(p => p.explains_with));
    const microscopes = {};
    (mj.microscopes || []).forEach(x => { microscopes[x.id] = Object.assign({}, x, { md: pkg.files[slash(x.file || '')] || '' }); });
    const model = { folder, mj, meta: mj.meta, id: mj.meta.id, lang: okLang(mj.meta.language) || courseLang, prompts, assets, microscopes, blocks, steps, explained, guide: parseGuide(pkg.files[slash(mj.guide).replace(/^.*?(guide\/)/, '$1')] || pkg.files['guide/guide.md'] || '') };
    mapGuide(model);
    MODELS[folder] = model;
    return model;
  }

  // ------------------------------------------------------------------ the module guide (slides)
  function parseGuide(md) {
    const chunks = md.replace(/<!--[\s\S]*?-->/g, '').split(/^\s*---\s*$/m);
    return chunks.map((c, i) => {
      const sh = c.match(/^\*Shadows:\s*(.+?)\*\s*$/m);
      const body = c.replace(/^\*Shadows:.*$/m, '').trim();
      const h = body.match(/^#{1,2}\s+(.+)$/m);
      return { i, md: body, title: h ? h[1] : '', shadows: sh ? sh[1].trim() : null, targets: [], isTitle: /^#\s/m.test(body) };
    }).filter(s => s.md);
  }
  function matchBlock(model, frag) {
    const f = norm(frag);
    if (!f) return null;
    return model.blocks.find(b => norm(b.title) === f) || model.blocks.find(b => norm(b.title).startsWith(f)) ||
      model.blocks.find(b => norm(b.kind) === f || norm(b.id) === f) || model.blocks.find(b => norm(b.title).includes(f));
  }
  function mapGuide(model) {
    // r2 quirk: "Shadows:" is prose. r3 makes it machine-readable; until then, match titles.
    model.guide.forEach(sl => {
      if (!sl.shadows) return;
      // the standard's key (§5): block:<id> or prompt:<id>, exact
      const key = sl.shadows.match(/^(block|prompt):([\w-]+)$/);
      if (key) {
        const b = key[1] === 'block' && model.blocks.find(x => x.id === key[2]);
        // within a block of several screens, the screen that shows the slide's own visual
        const ids = [...sl.md.matchAll(/\]\(asset:([\w-]+)\)/g)].map(x => x[1]);
        const byAsset = b && b.steps.find(i => ids.some(id => model.steps[i].md.includes('asset:' + id)));
        const st = b ? (byAsset != null ? byAsset : b.steps[0]) : (model.steps.find(x => x.pids.includes(key[2])) || {}).idx;
        if (st != null) sl.targets = [st];
        return;
      }
      const frags = sl.shadows.split(/,\s*(?:and\s+)?/);
      let lastBlock = null;
      frags.forEach(fr => {
        const pm = fr.match(/prompt\s+(\d+)/i);
        if (pm && lastBlock) {
          const n = pm[1];
          const st = lastBlock.steps.map(i => model.steps[i]).find(s => s.h2 && new RegExp('^prompt\\s+' + n + '\\b', 'i').test(s.h2));
          if (st) { sl.targets = [st.idx]; return; }
          const pids = lastBlock.steps.map(i => model.steps[i]).filter(s => s.pids.length);
          if (pids[n - 1]) { sl.targets = [pids[n - 1].idx]; return; }
        }
        const b = matchBlock(model, fr);
        if (!b) return;
        lastBlock = b;
        // within the named block, prefer the screen that shows the same visual as the slide
        const ids = [...sl.md.matchAll(/\]\(asset:([\w-]+)\)/g)].map(x => x[1]);
        const byAsset = b.steps.find(i => ids.some(id => model.steps[i].md.includes('asset:' + id)));
        const t = byAsset != null ? byAsset : b.steps[0];
        if (!sl.targets.includes(t)) sl.targets.push(t);
      });
    });
    // step -> slide: the slide that names it, else the nearest earlier one
    model.slideFor = model.steps.map(st => {
      const exact = model.guide.findIndex(sl => sl.targets.includes(st.idx));
      if (exact >= 0) return exact;
      let best = 0;
      model.guide.forEach((sl, k) => { if (sl.targets.length && Math.min(...sl.targets) <= st.idx) best = k; });
      return best;
    });
  }


  const glossary = {};
  (COURSE.glossary || []).forEach(t => { glossary[t.id] = t; });

  // ------------------------------------------------------------------ how the course measures learning (M2-31)
  // The course names its measures (meta.measures, checked by the build); a module's own list replaces the course's for
  // that module. Nothing named, nothing here: every function below answers with nothing.
  const courseMeasures = ((COURSE.meta || {}).measures || []).slice();
  function measuresOf(folder) {
    const p = COURSE.packages[folder], own = p && p.module.meta && p.module.meta.measures;
    return Array.isArray(own) ? own : courseMeasures.filter(m => m.per !== 'course');
  }
  // A value, checked against the measure's scale before it is kept anywhere: one of its levels, a number in its range
  // on its step, or a short line of text. The service keeps the text it is given; this is where the scale is held to.
  function checkValue(m, raw) {
    const s = (m && m.scale) || {}, v = String(raw == null ? '' : raw).trim();
    if (!v || v.length > 200 || /[\u0000-\u001f\u007f]/.test(v)) return { ok: false };
    if (s.levels) return s.levels.includes(v) ? { ok: true, value: v } : { ok: false };
    if (s.text) return { ok: true, value: v };
    if (Number.isFinite(s.min) && Number.isFinite(s.max)) {
      const n = Number(v), k = (n - s.min) / (s.step || 1);
      return Number.isFinite(n) && n >= s.min && n <= s.max && Math.abs(k - Math.round(k)) < 1e-9 ? { ok: true, value: String(n) } : { ok: false };
    }
    return { ok: false };
  }
  // the value in words: a level or a line as it is; a number out of its range ("7 of 10 points")
  function valueWords(m, v) {
    const s = (m && m.scale) || {};
    return Number.isFinite(s.max) && !s.levels ? `${v} of ${s.max}${s.unit ? ' ' + s.unit : ''}` : String(v);
  }

  return { courseKey, COURSE, glossary, buildModel, slash, courseMeasures, measuresOf, checkValue, valueWords, okLang, courseLang };
  } };
})();
