// Letterman's live room, on the student's own page: the Live button for everyone; the roster and the star when
// signed in. Ruling: M2-22, the Director's mark of 2026-10-08 ("Live button for all, roster and star when signed in;
// takes in M1-25"): "While you teach, every student's own page shows a Live button that takes them to the step you're
// on, guests included. For signed-in students, a roster in your console lights up who is here, their committed answers
// reach you as they commit, and you give a gold star live, seen only by that student. The stage and its OBS view stay
// as they are." Limit: "the free plan holds 200 live connections at once."
//
// What this page does, and what it never does:
//   - With no service configured, and on the stage (?stage), nothing here runs.
//   - While the page is open and in view it asks the service, every 15 seconds, which classes of this course are live
//     (public.live_now). A guest asks with the public key alone and sends nothing of theirs; the library is not loaded.
//   - Only when the student presses Live does the page open a connection (Supabase Realtime): one, for this page, which
//     follows the class's step. It closes when they leave the live class, when the class ends, or when the page closes.
//   - A guest is never on the roster; nothing about a guest is kept. A signed-in student in the class is on the roster
//     (by a live key the service made, never the account id) for as long as the page follows the class, and their
//     committed answers in the class's module go to the teacher as they commit. Their gold star comes on a channel
//     only they can open.
//   - Whether a student is in the class is the service's answer (their own enrolment), never anything the page keeps.
(function () {
  'use strict';
  const POLL = 15000;            // while the page is in view and not following a class
  const POLL_FOLLOWING = 60000;  // while following: the connection carries the steps; this only notices a quiet console
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>';

  function create(o) {
    const svc = (o.config && o.config.service) || null;
    if (!svc || !svc.url || !svc.key || o.stage || !o.account || !o.account.client || !o.account.publicRead) return null;
    const esc = o.esc;
    const L = { live: null, joined: false, following: false, key: null, stars: [], moved: false, problem: '' };
    let client = null, pollT = null, expect = null, connecting = false, started = false, leaving = Promise.resolve();

    const hashOf = () => L.live ? `#/m/${L.live.module}/${L.live.step}` : '';
    const atClass = () => !!L.live && decodeURIComponent(location.hash || '') === hashOf();
    const member = () => o.account.state === 'member';
    const typing = () => { const a = document.activeElement; return !!document.querySelector('.sheet-bg') || !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('#main')); };

    // ---------------------------------------------------------------- which class is live
    async function poll() {
      clearTimeout(pollT); pollT = null;
      if (document.hidden) return;   // asked again when the page comes back into view
      let rows = null;
      try {
        if (member()) {
          const c = await o.account.client();
          const { data, error } = await c.rpc('live_now');
          if (!error) rows = data;
        } else rows = await o.account.publicRead('live_now');   // a plain GET with the public key: nothing of the guest's
      } catch (e) { rows = null; }
      if (rows) setLive((rows || []).filter(r => r && r.course === o.course && o.has(r.module)).sort((a, b) => (b.yours ? 1 : 0) - (a.yours ? 1 : 0))[0] || null);
      schedule();
    }
    function schedule() { clearTimeout(pollT); if (!document.hidden) pollT = setTimeout(poll, L.joined ? POLL_FOLLOWING : POLL); }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && started) poll(); else { clearTimeout(pollT); pollT = null; } });

    function setLive(row) {
      const was = L.live;
      if (!row) { if (was) ended(); return; }
      if (was && was.class_id !== row.class_id) leave();
      const moved = !was || was.module !== row.module || was.step !== row.step;
      L.live = { class_id: row.class_id, title: row.title, teacher: row.teacher, module: row.module, step: row.step, yours: !!row.yours };
      if (!was || was.class_id !== row.class_id) { o.onChange(); render(); return; }
      if (moved && L.following) toClass(); else render();
    }

    // ---------------------------------------------------------------- joining, following, leaving
    async function join() {
      if (!L.live) return;
      L.joined = true; L.following = true; L.moved = false; L.problem = '';
      toClass(true);
      await connect();
      schedule();
    }
    function toClass(force) {
      const h = hashOf(); if (!h) return;
      if (!force && typing()) { L.following = false; L.moved = true; render(); return; }   // never pulled away mid-answer
      L.moved = false;
      if (decodeURIComponent(location.hash || '') === h) { L.following = true; render(); return; }
      expect = h; o.go(h);
    }
    async function connect() {
      if (client || connecting || !L.live) return;
      connecting = true;
      const cls = L.live.class_id;
      try {
        await leaving;   // a connection still closing from leaving before is closed first, so this one starts clean
        const c = await o.account.client();   // the page's one client (account.js); for a guest, signed out
        if (member()) {
          await c.realtime.setAuth();
          // the student's own enrolment in this class, as the service has it: its live key, or none
          const { data: s } = await c.auth.getSession();
          const me = s && s.session && s.session.user;
          if (me && L.live && L.live.yours) {
            const { data } = await c.from('enrolments').select('live_key').eq('class_id', cls).eq('student_id', me.id).maybeSingle();
            L.key = data && data.live_key ? data.live_key : null;
          }
        }
        if (!L.joined || !L.live || L.live.class_id !== cls) return;
        client = c;
        render();   // what the step says depends on whether the service holds this student in the class
        const opts = { config: { private: true } };
        if (L.key) opts.config.presence = { key: L.key };
        const ch = c.channel('live:' + cls, opts);
        ch.on('broadcast', { event: 'step' }, m => onStep(m.payload || {}));
        ch.on('broadcast', { event: 'end' }, () => ended());
        ch.subscribe(st => {
          if (st === 'SUBSCRIBED' && L.key) ch.track({}).catch(() => { });
          if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { L.problem = 'unreachable'; render(); }
          if (st === 'SUBSCRIBED' && L.problem) { L.problem = ''; render(); }
        });
        if (L.key) {
          const sc = c.channel('star:' + L.key, { config: { private: true } });
          sc.on('broadcast', { event: 'star' }, m => onStar(m.payload || {}));
          sc.subscribe();
        }
      } catch (e) { L.problem = 'unreachable'; render(); }
      finally { connecting = false; }
    }
    function leave() {
      const c = client;
      client = null;
      // the live room is the only thing on this page that uses Realtime: leaving it closes the page's connection at once
      // (removing one channel alone waits about fifty seconds before the library closes an empty connection)
      const gone = leaving = c ? c.removeAllChannels().catch(() => { }) : leaving;
      L.joined = false; L.following = false; L.key = null; L.moved = false; L.problem = '';
      schedule();
      return gone;   // settled once the connection is closed: a page joining again waits for it
    }
    function ended() {
      leave();
      L.live = null; L.stars = [];
      o.onChange();
      render();
    }
    function onStep(p) {
      if (!L.live || typeof p.module !== 'string' || !Number.isInteger(p.step)) return;
      L.live.module = p.module; L.live.step = p.step;
      if (L.following) toClass(); else render();
    }
    function onStar(p) {
      L.stars.push({ module: p.module || '', step: p.step || '' });
      render();
    }
    // the student moves on their own: they are off with the class again only when they come back to its step
    window.addEventListener('hashchange', () => {
      const h = decodeURIComponent(location.hash || '');
      if (expect && h === expect) { expect = null; L.following = true; }
      else if (L.joined) L.following = atClass();
      render();
    });
    // leaving the page: the connection is closed there and then, not left for the browser to notice
    window.addEventListener('pagehide', () => { if (client) { try { client.realtime.disconnect(); } catch (e) { } } });
    document.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('[data-live]');
      if (!a) return;
      e.preventDefault();
      if (a.dataset.live === 'join') join();
      if (a.dataset.live === 'leave') { leave(); render(); const b = document.querySelector('[data-live-mount="bar"] a'); if (b) b.focus(); }
    });

    // ---------------------------------------------------------------- a committed answer, in the class's module
    L.committed = async (model, p, value) => {
      if (!L.joined || !L.key || !L.live || !member() || !model || model.folder !== L.live.module || value == null) return;
      try {
        const c = await o.account.client();
        await c.from('live_answers').insert({ class_id: L.live.class_id, module: model.id, prompt_id: p.id, answer: value });
      } catch (e) { }
    };

    // ---------------------------------------------------------------- what the page shows
    function barInner() {
      if (!L.live) return '';
      const n = L.live.step + 1;
      // a star stays in sight in the app bar, which never scrolls away; the step's line says whose it is
      const star = L.joined && L.stars.length ? `<span class="live-gold">${STAR}<span class="sr-only">, and a gold star for you</span></span>` : '';
      if (L.joined && L.following && atClass()) return `<span class="live-on"><span class="live-dot" aria-hidden="true"></span>Live<span class="sr-only"> with the class</span>${star}</span>`;
      return `<a class="live-go" href="${esc(hashOf())}" data-live="join" aria-label="${esc(`Live now: ${L.live.title}. ${L.joined ? 'Back to' : 'Join'} the class at step ${n}${star ? ', and a gold star for you' : ''}`)}"><span class="live-dot" aria-hidden="true"></span>Live<span class="live-n"> · step ${n}</span>${star}</a>`;
    }
    function weekInner() {
      if (!L.live) return '';
      return `<a class="btn primary cta-main live-join" href="${esc(hashOf())}" data-live="join">Join the class live at step ${L.live.step + 1}</a>
        <p class="small live-who">${esc(L.live.title)}, with ${esc(L.live.teacher)}, is live now.</p>`;
    }
    function stepInner() {
      if (!L.live || !L.joined) return '';
      const n = L.live.step + 1, who = esc(L.live.teacher);
      const stars = L.stars.map(() => `<p class="live-star">${STAR}<span>A gold star from ${who}, just for you.</span></p>`).join('');
      const sends = L.key
        ? `Your committed answers in this module go to ${who} as you commit them.`
        : member() ? 'You are following the class. Your answers stay with you: only students in this class send theirs to the teacher.'
          : 'You are following as a guest. Your answers stay on this device.';
      const off = L.problem ? '<p class="small">The class service is not answering. The class goes on; the Live button follows it again when the service is back.</p>' : '';
      const where = atClass()
        ? `<p><b>You are with the class on this step.</b> ${sends}</p>`
        : `<p><b>The class is on step ${n}.</b>${L.moved ? ' It moved on while you were writing.' : ''} <a class="btn small primary" href="${esc(hashOf())}" data-live="join">Go to the class</a></p>`;
      return `${where}${stars}${off}<button type="button" class="linkish" data-live="leave">Leave the live class</button>`;
    }
    function render() {
      $$('[data-live-mount]').forEach(el => {
        const k = el.dataset.liveMount;
        const html = k === 'bar' ? barInner() : k === 'week' ? weekInner() : k === 'step' ? stepInner() : '';
        if (el.innerHTML !== html) el.innerHTML = html;
        if (k !== 'step') el.hidden = !html;   // the step's line stays in place, empty, so what it says next is announced
      });
    }
    L.barHTML = () => { const h = barInner(); return `<span class="live-bar" data-live-mount="bar"${h ? '' : ' hidden'}>${h}</span>`; };
    L.weekHTML = () => { const h = weekInner(); return h ? `<div class="live-week" data-live-mount="week">${h}</div>` : ''; };
    L.stepHTML = () => `<div class="live-step" data-live-mount="step" role="status">${stepInner()}</div>`;
    L.render = render;
    L.isLive = () => !!L.live;
    L.start = () => { started = true; lastState = o.account.state; poll(); };
    // Signed in or out: ask again as who the page is now. A page following the class follows it again as who it is
    // now: signed out, it is no longer on the roster; signed in, it is, if the service holds it in the class.
    let lastState = o.account.state;
    L.accountChanged = async () => {
      if (!started || o.account.state === lastState) return;
      lastState = o.account.state;
      const was = L.joined;
      if (was) await leave();
      await poll();
      if (was && L.live) join();
    };
    return L;
  }

  window.LMLive = { create };
})();
