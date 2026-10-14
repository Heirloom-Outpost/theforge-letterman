// Letterman's calendar: one list of dated events, drawn three ways.
//
// Every date the school keeps (when a module opens and when its work is due, when a class meets, when a module was
// released or published, when its discussion post goes out, when a key runs out) becomes one event of one kind. The
// sources only turn their own rows into events (courseEvents, curriculumEvents, teacherEvents, classEvents, keyEvents,
// postEvents); nothing in a view knows where an event came from. Which kinds a person sees is CONFIG.roles, the one
// place that says so, and a view is given only what visible() leaves.
//
// The three views, all lists of weeks and never a grid:
//   termHTML     the student's "The term": each module's week, when it opens and when its work is due. Nothing to add or
//                change. A date moved since the Academy gave it says so ("Moved from Monday 5 October."), while it is
//                still ahead, and never says who moved it.
//   comingUpHTML the next few dates, as rows (the school home's "Coming up"), a moved date saying so the same way.
//   mountStaff   the teachers' and admins' "Calendar": the same weeks with more on them, filters, and for an admin the
//                changed dates (who, when, what it was) and "Change date".
//
// Every date and time is said by app/when.js, in the course's or the class's time zone. Times are never computed here
// from a locale. No line names a course, a school or a person: the zone, the words and the people come from the data.
(function () {
  'use strict';

  const CONFIG = {
    // which kinds of event each role sees
    roles: {
      student: ['opens', 'due'],
      teacher: ['opens', 'due', 'class', 'release'],
      admin: ['opens', 'due', 'class', 'release', 'publish', 'post', 'key']
    },
    // who sees the history of a changed date (who changed it, when, what it was)
    history: ['admin'],
    // each kind: the small word on a row, the filter it belongs to, and its place within a day
    kinds: {
      class: { word: 'Class', group: 'classes', order: 0 },
      opens: { word: 'Opens', group: 'curriculum', order: 1 },
      release: { word: 'Release', group: 'curriculum', order: 2 },
      publish: { word: 'Publish', group: 'curriculum', order: 3 },
      post: { word: 'Post', group: 'discussion', order: 4 },
      due: { word: 'Due', group: 'curriculum', order: 5 },
      key: { word: 'Key', group: 'keys', order: 6 }
    },
    groups: [['classes', 'Classes'], ['curriculum', 'Curriculum'], ['discussion', 'Discussion posts'], ['keys', 'Keys']],
    // the seven days that hold today, wherever a screen marks them (the term, the staff's calendar, the course home's dateline)
    thisWeek: 'This week',
    empty: 'No dates yet. They appear when the school sets them.'
  };

  const DAY = /^\d{4}-\d{2}-\d{2}$/;   // a calendar date, YYYY-MM-DD
  const KEEP = 'letterman:calendar:v1';
  // What the last answers were, kept on this device so a view can be drawn before the service answers and offline.
  function remember(name, value) { try { const v = JSON.parse(localStorage.getItem(KEEP) || 'null') || {}; v[name] = { value, at: Date.now() }; localStorage.setItem(KEEP, JSON.stringify(v)); } catch (e) { } }
  function recall(name) { try { const v = (JSON.parse(localStorage.getItem(KEEP) || 'null') || {})[name]; return v ? v : null; } catch (e) { return null; } }

  const X_MARK = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // o: { when: an LMWhen instance (the course's or the class's zone), esc, unit: the course's word for a module, capitalised,
  //      now: a function giving the time, or a number (so a check can set it), LMWhen }
  function create(o) {
    const W = o.when, esc = o.esc, UNIT = o.unit || 'Module';
    const LW = o.LMWhen || window.LMWhen;
    const nowMs = () => typeof o.now === 'function' ? o.now() : (o.now == null ? Date.now() : o.now);
    const modName = n => `${UNIT} ${n}`;
    const modLong = m => m.number != null && m.number !== '' ? `${modName(m.number)}: ${m.title}` : (m.title || '');
    const dayOfDate = date => W.day(W.wall(date, '12:00'));          // "Monday 5 October", from a calendar date
    const mk = (kind, at, w, rest) => Object.assign({ kind, at, w, day: w.civil(at) }, rest);

    // ------------------------------------------------------------------------- the sources, as events
    // The course the page holds: its modules with their dates. publishedOnly (optional) leaves out a module the page holds no pages for;
    // a module's `folder` is set only while its pages are open to the reader, and only then does a view link to it.
    // A module's entry may carry `was`, the dates the page was built with before the school moved them (app/published.js);
    // a date that differs from it carries `movedFrom`, the day it was. That is a date and nothing more: no one's name.
    // c: { key, name, modules: [{ id, module, title, folder, lockedFolder, opens, due, was: { opens, due } }], packages }
    function courseEvents(c, opts) {
      const out = [];
      const from = (m, field) => { const w = m.was && m.was[field]; return typeof w === 'string' && DAY.test(w) && w !== m[field] ? w : null; };
      for (const m of c.modules || []) {
        const folder = m.folder || m.lockedFolder;
        if (opts && opts.publishedOnly && !(folder && c.packages && c.packages[folder])) continue;
        const mod = { id: m.id, number: m.module, title: m.title, folder: m.folder || '', course: c.key, courseName: c.name || '' };
        if (m.opens) out.push(mk('opens', W.opensAt(m.opens), W, { module: mod, day: m.opens, movedFrom: from(m, 'opens') }));
        if (m.due) out.push(mk('due', W.dueAt(m.due), W, { module: mod, day: m.due, movedFrom: from(m, 'due') }));
      }
      return out;
    }
    // Every change of one date field in a module's history (admin_curriculum), oldest first: what it was, what it became.
    const changes = (history, field) => (history || []).filter(h => h[field + '_before'] !== h[field + '_after'])
      .map(h => ({ from: h[field + '_before'] || null, to: h[field + '_after'] || null, by: h.by || '', at: h.at, source: h.source, reason: h.reason || '' }));
    // admin_curriculum() rows. names(row) gives { number, title }; without it the last import's title stands.
    function curriculumEvents(rows, opts) {
      const out = [];
      for (const r of rows || []) {
        const info = (opts && opts.names && opts.names(r)) || {};
        const last = (r.imports || [])[(r.imports || []).length - 1] || {};
        const mod = { id: r.module, number: info.number != null ? info.number : null, title: info.title || last.title || String(r.module).split('/').pop(), course: r.course, courseName: info.courseName || '' };
        const state = { released: !!r.released, published: !!r.published };
        const field = (kind, date, name) => {
          if (!date) return;
          const hist = changes(r.history, name), moves = hist.filter(h => h.from);
          // academyDay: the date the newest revision brought from the Academy, for the Change date sheet's help
          out.push(mk(kind, kind === 'opens' ? W.opensAt(date) : W.dueAt(date), W, { module: mod, day: date, state, history: hist, moved: moves.length ? moves[moves.length - 1] : null, academyDay: last[name + '_on'] || null }));
        };
        field('opens', r.opens_on, 'opens'); field('due', r.due_on, 'due');
        if (r.released && r.released.at) out.push(mk('release', Date.parse(r.released.at), W, { module: mod, by: r.released.by || '', revision: r.released.revision }));
        if (r.published && r.published.at) out.push(mk('publish', Date.parse(r.published.at), W, { module: mod, by: r.published.by || '', revision: r.published.revision }));
        if (r.post && r.post.at) out.push(mk('post', Date.parse(r.post.at), W, { module: mod, by: r.post.by || '', made: true }));
      }
      return out;
    }
    // teacher_material() rows: a released module has dates, and says whether students have it yet. A teacher sees a release
    // row only for a release an admin has planned ahead, and Letterman keeps no planned release time, so there is none to place.
    function teacherEvents(rows, opts) {
      const by = new Map();
      for (const r of rows || []) {
        const m = by.get(r.module) || { row: r, released: false, published: false };
        m.released = m.released || !!r.released; m.published = m.published || !!r.published;
        by.set(r.module, m);
      }
      const out = [];
      for (const [id, m] of by) {
        const r = m.row, info = (opts && opts.names && opts.names(r)) || {};
        const mod = { id, number: info.number != null ? info.number : null, title: info.title || r.title || String(id).split('/').pop(), course: r.course, courseName: info.courseName || '' };
        const state = { released: m.released, published: m.published };
        if (r.opens_on) out.push(mk('opens', W.opensAt(r.opens_on), W, { module: mod, day: r.opens_on, state }));
        if (r.due_on) out.push(mk('due', W.dueAt(r.due_on), W, { module: mod, day: r.due_on, state }));
      }
      return out;
    }
    // teaching_classes() rows (or any class with starts_on, meets_at, time_zone, weeks): one session a week, each at its own
    // instant in the class's zone, said in that zone
    function classEvents(classes) {
      const out = [];
      for (const c of classes || []) {
        if (!c.starts_on || !c.meets_at) continue;
        const cw = LW.create(c.time_zone || null), weeks = Math.max(1, +c.weeks || 1);
        for (let n = 0; n < weeks; n++) out.push(mk('class', cw.wall(LW.addDays(c.starts_on, 7 * n), String(c.meets_at).slice(0, 5)), cw, { cls: { id: c.class_id || c.id, title: c.title, course: c.course }, session: n + 1, of: weeks }));
      }
      return out;
    }
    // keys: [{ label, expires_on: 'YYYY-MM-DD' | expires_at: ISO }]; a later lane supplies them, and none is fine
    function keyEvents(keys) {
      return (keys || []).filter(k => k && (k.expires_on || k.expires_at)).map(k => {
        const at = k.expires_at ? Date.parse(k.expires_at) : W.dueAt(k.expires_on);
        return mk('key', at, W, { label: k.label || 'A key' });
      });
    }
    // scheduled discussion posts: [{ module: { id, number, title }, at: ISO | ms }]; none is fine
    function postEvents(posts) {
      return (posts || []).filter(p => p && p.at != null).map(p => mk('post', typeof p.at === 'number' ? p.at : Date.parse(p.at), W, { module: p.module || {}, scheduled: true }));
    }

    // ------------------------------------------------------------------------- one list
    const order = e => (CONFIG.kinds[e.kind] || {}).order || 0;
    const sameness = e => [e.kind, (e.module || {}).id || '', e.day, (e.cls || {}).id || '', e.session || '', e.label || '', e.scheduled ? 's' : ''].join('|');
    function merge(...lists) {
      const seen = new Set(), out = [];
      for (const e of [].concat(...lists)) { const k = sameness(e); if (!seen.has(k)) { seen.add(k); out.push(e); } }
      return out.sort((a, b) => a.at - b.at || order(a) - order(b));
    }
    // The events a role sees: its kinds only, and the history of a changed date only for those who may read it.
    function visible(events, role) {
      const kinds = CONFIG.roles[role];
      if (!kinds) return [];
      const hist = CONFIG.history.includes(role);
      return events.filter(e => kinds.includes(e.kind)).map(e => hist || (!e.moved && !e.history) ? e : Object.assign({}, e, { moved: null, history: null }));
    }
    const today = () => W.civil(nowMs());
    const monday = day => LW.addDays(day, -((LW.weekday(day) + 6) % 7));

    // Calendar weeks, Monday to Sunday: for the staff's view
    function weeksOf(events) {
      const by = new Map(), t = today();
      for (const e of events) { const m = monday(e.day); if (!by.has(m)) by.set(m, { first: m, last: LW.addDays(m, 6), events: [] }); by.get(m).events.push(e); }
      return [...by.values()].sort((a, b) => a.first < b.first ? -1 : 1).map(w => Object.assign(w, { now: w.first <= t && t <= w.last, past: w.last < t }));
    }
    // One week for each module, from the day it opens to the day its work is due: for the student's view
    function moduleWeeks(events) {
      const by = new Map(), t = today();
      for (const e of events) {
        if (e.kind !== 'opens' && e.kind !== 'due') continue;
        const k = e.module.id || e.module.title;
        if (!by.has(k)) by.set(k, { module: e.module, events: [] });
        by.get(k).events.push(e);
      }
      return [...by.values()].map(w => {
        const days = w.events.map(e => e.day).sort();
        return Object.assign(w, { first: days[0], last: days[days.length - 1], opens: w.events.find(e => e.kind === 'opens'), due: w.events.find(e => e.kind === 'due') });
      }).sort((a, b) => a.first < b.first ? -1 : a.first > b.first ? 1 : 0).map(w => Object.assign(w, { now: w.first <= t && t <= w.last, past: w.last < t }));
    }

    // ------------------------------------------------------------------------- words for a moment
    const atText = e => `${e.w.day(e.at)}, ${e.w.clock(e.at)}`;
    const localLine = e => { const b = e.w.beside(e.at); return b ? `<span class="cal-local">${esc(b)}</span>` : ''; };
    const zoneLine = (owner) => W.zone ? `Times are ${esc(LW.label(W.zone))}, ${esc(owner || "the course's")} own.` : 'Times are on your own clock.';

    // ------------------------------------------------------------------------- the student's view: "The term"
    // A date moved since the Academy gave it, said quietly under it while it is still ahead: "Moved from Monday 5 October."
    const wasText = e => e && e.movedFrom && e.at >= nowMs() ? `Moved from ${dayOfDate(e.movedFrom)}.` : '';
    const wasLine = e => { const t = wasText(e); return t ? `<p class="cal-was">${esc(t)}</p>` : ''; };
    function weekHTML(w, opts) {
      const link = opts && opts.link ? opts.link(w.module) : '';
      const name = esc(modLong(w.module));
      const here = CONFIG.thisWeek;   // the same words in the student's term and in the staff's calendar
      return `<li class="cal-week${w.now ? ' now' : ''}"${w.now ? ' aria-current="date"' : ''}>
        <div class="cal-when">${w.now ? `<span class="cal-this" aria-hidden="true">${esc(here)}</span>` : ''}<h3 class="cal-d">${esc(LW.range(w.first, w.last))}${w.now ? `<span class="sr-only">. ${esc(here)}.</span>` : ''}</h3></div>
        <div class="cal-what"><p class="cal-mod">${link ? `<a href="${esc(link)}">${name}</a>` : name}</p>
          ${w.opens ? `<p class="cal-line">Opens ${esc(atText(w.opens))}${localLine(w.opens)}</p>${wasLine(w.opens)}` : ''}
          ${w.due ? `<p class="cal-line">Work due ${esc(atText(w.due))}${localLine(w.due)}</p>${wasLine(w.due)}` : ''}</div></li>`;
    }
    // opts: { courseName, link(module) -> address | '', zoneOwner, ics: true to offer the calendar file }
    function termHTML(events, opts) {
      opts = opts || {};
      const weeks = moduleWeeks(events), past = weeks.filter(w => w.past), rest = weeks.filter(w => !w.past);
      const earlier = past.length ? `<details class="adv cal-earlier"${rest.length ? '' : ' open'}><summary>Earlier weeks (${past.length})</summary><div><ol class="cal-weeks past">${past.map(w => weekHTML(w, opts)).join('')}</ol></div></details>` : '';
      return `${opts.courseName ? `<p class="kicker">${esc(opts.courseName)}</p>` : ''}<h1>The term</h1>
        <p class="tp-meta">When each ${esc(UNIT.toLowerCase())} opens and when its work is due. ${zoneLine(opts.zoneOwner)}</p>
        ${weeks.length && opts.ics ? `<p><button type="button" class="linkbtn" data-cal-ics>Add these dates to your own calendar</button></p>` : ''}
        ${weeks.length ? `${earlier}${rest.length ? `<section class="card cal-card" aria-label="The term, week by week"><ol class="cal-weeks">${rest.map(w => weekHTML(w, opts)).join('')}</ol></section>` : ''}` : `<p class="nothing">${esc(CONFIG.empty)}</p>`}`;
    }
    // The calendar file for a student: each date a whole day, so no zone can move it.
    function icsOf(events, opts) {
      const E = window.LMEnrol;
      if (!E || !E.icsFile) return null;
      const items = [];
      for (const w of moduleWeeks(events)) {
        if (w.opens) items.push({ uid: `${w.module.id}-opens@letterman`, date: w.opens.day, summary: `${modLong(w.module)}: opens`, description: `${opts.courseName || ''}${opts.courseName ? '. ' : ''}${modName(w.module.number)} opens on this date.` });
        if (w.due) items.push({ uid: `${w.module.id}-due@letterman`, date: w.due.day, summary: `${modLong(w.module)}: work due`, description: `${opts.courseName || ''}${opts.courseName ? '. ' : ''}Work for ${modName(w.module.number)} is due by the end of this day.` });
      }
      return items.length ? E.icsFile(items, undefined, opts.school) : null;
    }
    // The term page's one control: the calendar file link (a download made in the page, kept nowhere)
    function wireTerm(root, events, opts) {
      const b = root.querySelector('[data-cal-ics]'); if (!b) return;
      b.onclick = () => {
        const text = icsOf(events, opts || {}); if (!text) return;
        const u = URL.createObjectURL(new Blob([text], { type: 'text/calendar' })), a = document.createElement('a');
        a.href = u; a.download = `${String((opts && opts.courseName) || 'term').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'term'}_dates.ics`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000);
      };
    }

    // ------------------------------------------------------------------------- the school home's "Coming up"
    // The next dates from now on, as the home's calendar rows. The course's name leads a row only where there is more than one.
    // opts.opensOnly: openings alone (while nothing is open, no work can be due, so only what opens is listed).
    function comingUp(events, limit, opts) {
      const t = nowMs(), kinds = opts && opts.opensOnly ? ['opens'] : ['opens', 'due'];
      return events.filter(e => kinds.includes(e.kind) && e.at >= t).slice(0, limit);
    }
    function comingUpHTML(events, limit, withCourse, opts) {
      return comingUp(events, limit, opts).map(e => `<li><span class="cal-d">${esc(LW.shortDay(e.day))}</span><span class="cal-t">${withCourse && e.module.courseName ? esc(e.module.courseName) + ': ' : ''}${esc(modName(e.module.number))} ${e.kind === 'opens' ? 'opens' : 'work due'}${wasText(e) ? ` <small class="cal-was">${esc(wasText(e))}</small>` : ''}</span></li>`).join('');
    }

    // ------------------------------------------------------------------------- the staff's view: "Calendar"
    const sentence = e => {
      const m = e.module || {};
      switch (e.kind) {
        case 'class': return `${e.cls.title}`;
        case 'opens': return `${modLong(m)} opens`;
        case 'due': return `${modLong(m)}: work due`;
        case 'release': return `${modLong(m)} released to teachers${e.revision ? ` (revision ${e.revision})` : ''}`;
        case 'publish': return `${modLong(m)} published to students${e.revision ? ` (revision ${e.revision})` : ''}`;
        case 'post': return e.scheduled ? `${modLong(m)}: its discussion post goes out` : `${modLong(m)}: its discussion post was made`;
        case 'key': return `${e.label} expires`;
        default: return '';
      }
    };
    const stateTags = e => !e.state ? '' : [e.state.released ? 'Released to teachers' : '', e.state.published ? 'Published to students' : (e.state.released ? 'Not with students yet' : '')].filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join(' ');
    const movedLine = m => `Moved from ${esc(dayOfDate(m.from))}${m.by ? ` by ${esc(m.by)}` : ''} on ${esc(W.day(Date.parse(m.at)))}.${m.reason ? ` <span class="cal-reason">“${esc(m.reason)}”</span>` : ''}`;
    const historyLine = h => h.from ? `Moved from ${esc(dayOfDate(h.from))} to ${h.to ? esc(dayOfDate(h.to)) : 'no date'}${h.by ? ` by ${esc(h.by)}` : ''} on ${esc(W.day(Date.parse(h.at)))}${h.source === 'import' ? ', from a new revision' : ''}.${h.reason ? ` “${esc(h.reason)}”` : ''}`
      : `Set to ${esc(dayOfDate(h.to))}${h.source === 'import' ? ', from the Academy’s calendar' : ''}${h.by ? `, by ${esc(h.by)}` : ''}, on ${esc(W.day(Date.parse(h.at)))}.`;
    function rowHTML(e, ctl) {
      const kind = CONFIG.kinds[e.kind] || { word: e.kind };
      const zoneNote = e.w.zone && e.w.zone !== W.zone ? ` ${esc(LW.label(e.w.zone))}` : '';
      const extra = e.kind === 'class' ? ` · Session ${e.session} of ${e.of}` : e.kind === 'release' || e.kind === 'publish' || e.kind === 'post' ? (e.by ? ` · by ${esc(e.by)}` : '') : '';
      const change = ctl && ctl.canChange && e.kind === 'opens' && e.module.id ? `<button type="button" class="btn quiet small" data-cal-change="${esc(e.module.id)}">Change date<span class="sr-only">: when ${esc(modName(e.module.number != null ? e.module.number : e.module.title))} opens</span></button>` : '';
      const hist = e.history && e.history.length ? `<details class="cal-hist"><summary>Changes to this date (${e.history.length})</summary><ul>${e.history.slice().reverse().map(h => `<li>${historyLine(h)}</li>`).join('')}</ul></details>` : '';
      return `<li class="cal-row" data-kind="${esc(e.kind)}"><p class="kicker">${esc(kind.word)}</p>
        <div class="cal-body"><p class="cal-sent">${esc(sentence(e))} ${stateTags(e)}</p>
          <p class="cal-time">${esc(atText(e))}${zoneNote}${extra}${localLine(e)}</p>
          ${e.moved ? `<p class="cal-moved">${movedLine(e.moved)}</p>` : ''}${hist}${change}</div></li>`;
    }
    function staffWeekHTML(w, ctl) {
      return `<li class="cal-week${w.now ? ' now' : ''}${w.past ? ' past' : ''}"${w.now ? ' aria-current="date"' : ''}>
        <div class="cal-when">${w.now ? `<span class="cal-this" aria-hidden="true">${esc(CONFIG.thisWeek)}</span>` : ''}<h3 class="cal-d">${esc(LW.range(w.first, w.last))}${w.now ? `<span class="sr-only">. ${esc(CONFIG.thisWeek)}.</span>` : ''}</h3></div>
        <ul class="cal-rows">${w.events.map(e => rowHTML(e, ctl)).join('')}</ul></li>`;
    }
    const groupsFor = role => CONFIG.groups.filter(([g]) => (CONFIG.roles[role] || []).some(k => (CONFIG.kinds[k] || {}).group === g));

    // el: where the calendar goes. opts: { role, events: list | function, zoneOwner, changeDate(change) -> Promise<{ error? }> }
    function mountStaff(el, opts) {
      const role = opts.role, hidden = new Set();
      let all = [], flash = '';
      const list = () => visible(typeof opts.events === 'function' ? opts.events() : (opts.events || []), role);
      function draw(focusSel) {
        const groups = groupsFor(role), ev = list().filter(e => !hidden.has((CONFIG.kinds[e.kind] || {}).group));
        all = ev;
        const weeks = weeksOf(ev);
        const ctl = { canChange: role === 'admin' && typeof opts.changeDate === 'function' };
        el.innerHTML = `<div class="cal-staff">
          <p class="tp-meta">${zoneLine(opts.zoneOwner)}</p>
          <div class="cal-flash" role="status">${flash ? `<p class="flash">${esc(flash)}</p>` : ''}</div>
          <div class="chips cal-filter" role="group" aria-label="Show"><span class="cal-show" aria-hidden="true">Show</span>${groups.map(([g, label]) => `<button type="button" class="chip" aria-pressed="${hidden.has(g) ? 'false' : 'true'}" data-cal-filter="${g}">${esc(label)}</button>`).join('')}</div>
          ${weeks.length ? `<section class="card cal-card" aria-label="Calendar, week by week"><ol class="cal-weeks">${weeks.map(w => staffWeekHTML(w, ctl)).join('')}</ol></section>` : `<p class="nothing">${esc(CONFIG.empty)}</p>`}</div>`;
        el.querySelectorAll('[data-cal-filter]').forEach(b => b.onclick = () => { const g = b.dataset.calFilter; if (hidden.has(g)) hidden.delete(g); else hidden.add(g); draw(`[data-cal-filter="${g}"]`); });
        el.querySelectorAll('[data-cal-change]').forEach(b => b.onclick = () => changeSheet(b.dataset.calChange, b));
        if (focusSel) { const f = el.querySelector(focusSel); if (f) f.focus(); }
      }
      // "Change date" on an admin's opens row: the one Change date sheet (changeDateSheet, below)
      function changeSheet(moduleId, opener) {
        const open = all.find(e => e.kind === 'opens' && e.module.id === moduleId), due = all.find(e => e.kind === 'due' && e.module.id === moduleId);
        if (!open) return;
        const academy = open.academyDay && DAY.test(open.academyDay) ? `${dayOfDate(open.academyDay)} ${open.academyDay.slice(0, 4)}` : null;
        changeDateSheet({
          module: modName(open.module.number != null ? open.module.number : open.module.title), opens: open.day, due: due ? due.day : '', opener,
          zoneLabel: W.zone ? `${LW.label(W.zone)}, the course’s own.` : 'On each student’s own clock: the course names no time zone.', academyDate: academy,
          onSave: c => opts.changeDate({ module: moduleId, opens_on: c.opens_on, due_on: c.due_on, reason: c.reason }),
          onDone: c => {
            flash = `${modLong(open.module)} now opens ${dayOfDate(c.opens_on)}.`;
            if (opts.changed) opts.changed(); else draw();
            const f = el.querySelector(`[data-cal-change="${CSS.escape(moduleId)}"]`); if (f) f.focus();
          }
        });
      }
      draw();
      return { draw, set(events) { opts.events = events; draw(); }, say(text) { flash = text || ''; draw(); }, hidden };
    }

    return { courseEvents, curriculumEvents, teacherEvents, classEvents, keyEvents, postEvents, merge, visible, weeksOf, moduleWeeks,
      termHTML, wireTerm, icsOf, comingUp, comingUpHTML, mountStaff, modName, modLong };
  }

  // ------------------------------------------------------------------------- one sheet, and the one Change date sheet
  const escText = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // A sheet as the app's: it closes only from its own buttons, the X or Escape (a press outside does nothing), keeps the
  // focus inside, and gives the focus back to what opened it. labelledBy: the id of its heading.
  function sheet(html, opts) {
    opts = opts || {};
    const last = opts.opener || document.activeElement, bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${escText(opts.labelledBy || '')}"><button type="button" class="sheet-x" aria-label="Close">${X_MARK}</button>${html}</div>`;
    const close = quiet => { bg.remove(); if (!quiet && last && document.body.contains(last)) last.focus(); };
    bg.addEventListener('click', e => { if (e.target.closest && e.target.closest('.sheet-x')) close(); });
    bg.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const f = [...bg.querySelectorAll('button:not([disabled]), a, input, textarea')]; if (!f.length) return;
        const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    });
    document.body.appendChild(bg);
    const f = (opts.focus && bg.querySelector(opts.focus)) || bg.querySelector('button'); if (f) f.focus();
    return { el: bg, close };
  }
  // "Change date": the one sheet for changing when a module opens and when its work is due, wherever the date is seen (the
  // calendar's opens row, a module's page in Admin). The Academy's files are never changed; the date is Letterman's own.
  // o: { module: the words for the module ("Module 2"), opens, due: its dates now (YYYY-MM-DD, or ''),
  //      zoneLabel: the zone the date is in, said under "Opens on"; academyDate: the Academy's own date in words, or null;
  //      onSave({ opens_on, due_on, reason }) -> Promise<{ error? }>; onDone(change) once it is saved and the sheet is closed;
  //      opener: what gets the focus back when it closes without a save }
  function changeDateSheet(o) {
    const s = sheet(`<h2 id="cd-sheet-h" tabindex="-1">Change when ${escText(o.module)} opens</h2>
      <form id="cd-form" novalidate>
        <div class="field"><label for="cd-opens">Opens on</label><input type="date" id="cd-opens" value="${escText(o.opens || '')}" aria-describedby="cd-opens-help"><p class="help" id="cd-opens-help">${escText(o.zoneLabel || '')}${o.academyDate ? ` The Academy’s date: ${escText(o.academyDate)}.` : ''}</p></div>
        <div class="field"><label for="cd-due">Work due</label><input type="date" id="cd-due" value="${escText(o.due || '')}"></div>
        <div class="field"><label for="cd-why">Why (optional)</label><input type="text" id="cd-why" maxlength="500" autocomplete="off" aria-describedby="cd-why-help"><p class="help" id="cd-why-help">Kept with the change, for the other admins.</p></div>
        <p>Students see the new date the next time Letterman starts or goes Home. The Academy’s files are not changed.</p>
        <p class="msg" id="cd-msg" role="alert"></p>
        <div class="sheet-acts"><button type="submit" class="btn primary" id="cd-go">Change the date</button><button type="button" class="btn quiet" id="cd-no">Cancel</button></div>
      </form>`, { labelledBy: 'cd-sheet-h', focus: '#cd-opens', opener: o.opener });
    const q = id => s.el.querySelector(id);
    q('#cd-no').onclick = () => s.close();
    q('#cd-form').onsubmit = async ev => {
      ev.preventDefault();
      const a = q('#cd-opens').value, b = q('#cd-due').value, msg = q('#cd-msg');
      if (!a) { msg.textContent = 'Choose the day it opens.'; return q('#cd-opens').focus(); }
      if (b && b < a) { msg.textContent = 'The work cannot be due before it opens. Choose a later due date.'; return q('#cd-due').focus(); }
      if (a === (o.opens || '') && b === (o.due || '')) { msg.textContent = 'Those are the dates it already has.'; return; }
      q('#cd-go').disabled = true; msg.textContent = '';
      const change = { opens_on: a, due_on: b || null, reason: q('#cd-why').value.trim() || null };
      let r; try { r = await o.onSave(change); } catch (e) { r = { error: 'It did not go through. Try again in a moment.' }; }
      q('#cd-go').disabled = false;
      if (r && r.error) { msg.textContent = typeof r.error === 'string' ? r.error : 'It did not go through. Try again in a moment.'; return; }
      s.close(true);
      if (o.onDone) o.onDone(change);
    };
    return s;
  }

  window.LMCalendar = { CONFIG, create, remember, recall, changeDateSheet };
})();
