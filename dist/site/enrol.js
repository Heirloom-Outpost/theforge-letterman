// Letterman enrolment, the student's half: classes open to join, joining, a student's own classes, leaving.
// A teacher opens a class; a signed-in student presses Join, and the class appears on their home with its start date.
// Classes are listed for anyone, guests included, by the teacher's display name and never an account id. A guest is
// asked to sign in to join. A class's times are in its teacher's time zone, with the student's own beside them when
// their clock differs.
//
// The service is reached only through account.js (ACC.ask for the open list, which anyone may read; ACC.act for what
// a signed-in account does). Nothing here ever holds an account id: the service's functions return none.
//
// Privacy, in this file: a guest sends nothing about themselves. Their home reads the public list of classes open to
// join (one request with the public key: no body of theirs, no sign-in, nothing stored), and the service's library
// is never loaded for them. A join a guest starts waits, in this tab only (sessionStorage), for their sign-in and
// their yes; it holds a class id, nothing else.
(function () {
  'use strict';
  const PENDING = 'letterman:join-pending';
  const PENDING_MS = 30 * 60000;
  const WORDS = {
    offline: 'Joining needs the internet.',
    closed: 'Joining has closed for this class. Ask your teacher.',
    empty: 'No class is open to join right now. When your teacher opens one, it shows here.',
    looking: 'Looking for classes open to join.'
  };

  // ------------------------------------------------------------------------------- time, in the class's zone
  // The instant a wall-clock time in a time zone happens (two passes settle a daylight-saving change).
  function zoneOffset(t, tz) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).forEach(x => { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
  }
  function instant(date, time, tz) {
    const [y, m, d] = String(date).split('-').map(Number), [hh, mm] = String(time || '00:00').split(':').map(Number);
    const wall = Date.UTC(y, m - 1, d, hh, mm);
    let t = wall;
    for (let i = 0; i < 2; i++) t = wall - zoneOffset(t, tz);
    return new Date(t);
  }
  const addDays = (date, n) => { const [y, m, d] = String(date).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  // One date format everywhere on the student page: the device's own, as app.js writes every other
  // date ("Monday, October 19" and "6:00 PM" on an American English device; "Monday 19 October" and "18:00" on a British one)
  const dayLabel = (at, tz) => new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(at);
  const clockLabel = (at, tz) => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(at);
  const weekdayLabel = (at, tz) => new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'long' }).format(at);
  // "Pacific time": the zone's everyday name. A name the zone's own formatter does not give falls back to its place.
  function zoneName(tz, at) {
    let n = '';
    try { n = (new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(at || new Date()).find(x => x.type === 'timeZoneName') || {}).value || ''; } catch (e) { }
    if (!n || /^GMT[+-]/.test(n)) n = String(tz).split('/').pop().replace(/_/g, ' ') + ' Time';
    return / Standard Time$/.test(n) ? n : n.replace(/ Time$/, ' time');
  }
  const here = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } };
  // When a class meets, said for a student: in the class's zone, and in theirs when it differs.
  function when(c, now) {
    now = now || new Date();
    if (!c.starts_on) return { line: 'The start date is not set yet.', local: '', first: null };
    const tz = c.time_zone || 'UTC', first = instant(c.starts_on, c.meets_at, tz);
    const weeks = +c.weeks || 1, last = instant(addDays(c.starts_on, 7 * (weeks - 1)), c.meets_at, tz);
    const t = c.meets_at ? ` at ${clockLabel(first, tz)} ${zoneName(tz, first)}` : '';
    let line;
    if (first > now) line = `Starts ${dayLabel(first, tz)}${t}`;
    else if (last.getTime() + 3 * 3600000 > now.getTime()) line = `Started ${dayLabel(first, tz)}. Meets ${weekdayLabel(first, tz)}s${t}`;
    else line = `Ended ${dayLabel(last, tz)}`;
    let local = '';
    const me = here();
    if (c.meets_at && first > now) {
      const theirs = `${dayLabel(first, tz)} ${clockLabel(first, tz)}`, mine = `${dayLabel(first, me)} ${clockLabel(first, me)}`;
      if (theirs !== mine) local = dayLabel(first, tz) === dayLabel(first, me) ? `That is ${clockLabel(first, me)} where you are.` : `That is ${dayLabel(first, me)} at ${clockLabel(first, me)} where you are.`;
    }
    return { line, local, first, last, startsDay: dayLabel(first, tz) };
  }

  // ------------------------------------------------------------------------------- the calendar file, built here
  // One event per meeting, each at its own instant in UTC, so a daylight-saving change between meetings is right in
  // any calendar (RFC 5545). The service keeps no length for a meeting, so each event is the moment it starts.
  function icsText(c, courseTitle, stamp) {
    const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const utc = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const fold = line => {
      const out = []; let cur = '', bytes = 0;
      for (const ch of line) {
        const b = new TextEncoder().encode(ch).length;
        if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
        cur += ch; bytes += b;
      }
      out.push(cur);
      return out.join('\r\n ');
    };
    const weeks = Math.max(1, +c.weeks || 1), tz = c.time_zone || 'UTC';
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Heirloom Estate Academy//Letterman//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (let n = 1; n <= weeks; n++) {
      const at = instant(addDays(c.starts_on, 7 * (n - 1)), c.meets_at, tz);
      lines.push('BEGIN:VEVENT', `UID:${c.class_id}-${n}@letterman`, `DTSTAMP:${utc(stamp || new Date())}`, `DTSTART:${utc(at)}`,
        `SUMMARY:${esc(`${c.title} (meeting ${n} of ${weeks})`)}`, `DESCRIPTION:${esc(`${courseTitle}. Meets every ${weekdayLabel(at, tz)} at ${clockLabel(at, tz)} ${zoneName(tz, at)}.`)}`,
        'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  // ------------------------------------------------------------------------------- the page's part
  function create(o) {
    const ACC = o.acc, esc = o.esc, $ = s => document.querySelector(s);
    const on = !!(ACC && ACC.configured) && !o.stage;
    const E = { words: WORDS, when, ics: icsText };
    const courseTitle = c => { const k = (o.content.courses || {})[c.course]; return (k && k.meta && k.meta.title) || String(c.course || '').replace(/_/g, ' '); };
    const isId = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
    const offline = () => navigator.onLine === false;
    const member = () => ACC.state === 'member';
    const blobs = [];
    // A card's file goes when its screen is drawn again; the "You're in" sheet's stays while the sheet can be open,
    // since the screen behind it is drawn again at once.
    function calLink(c, inSheet) {
      if (!c.starts_on) return '';
      const u = URL.createObjectURL(new Blob([icsText(c, courseTitle(c))], { type: 'text/calendar' }));
      if (inSheet) setTimeout(() => URL.revokeObjectURL(u), 30 * 60000); else blobs.push(u);
      const file = String(c.title).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'class';
      return `<a class="enrol-cal" href="${u}" download="${esc(file)}.ics">Add to calendar<span class="sr-only">: ${esc(c.title)}</span></a>`;
    }
    const freeBlobs = () => { while (blobs.length) URL.revokeObjectURL(blobs.pop()); };

    // a join that waits for the sign-in and the yes, in this tab only
    const pending = () => { try { const p = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); return p && Date.now() - p.at < PENDING_MS && isId(p.id) ? p.id : null; } catch (e) { return null; } };
    const setPending = id => { try { sessionStorage.setItem(PENDING, JSON.stringify({ id, at: Date.now() })); } catch (e) { } };
    const clearPending = () => { try { sessionStorage.removeItem(PENDING); } catch (e) { } };

    async function load() {
      if (offline()) return { error: 'offline' };
      const open = await ACC.ask('open_classes');
      if (open.error) return { error: open.error.code === 'unreachable' ? 'unreachable' : 'failed' };
      let mine = [];
      if (member()) {
        const m = await ACC.act(c => c.rpc('my_classes'));
        if (m.error) return { error: m.error.code === 'unreachable' ? 'unreachable' : 'failed' };
        mine = m.data || [];
      }
      return { open: open.data || [], mine };
    }
    const problem = e => e === 'offline' ? WORDS.offline : e === 'unreachable' ? ACC.words.unreachable : ACC.words.failed;

    function card(c, kind, focusId) {
      const w = when(c);
      const id = esc(c.class_id);
      return `<article class="card enrol-card${kind === 'mine' ? ' mine' : ''}" id="class-${id}" data-class="${id}" aria-labelledby="ec-${id}"${focusId === c.class_id ? ' tabindex="-1"' : ''}>
        <p class="eyebrow">${kind === 'mine' ? 'Your class' : 'Open to join'}</p>
        <p class="enrol-course">${esc(courseTitle(c))}</p>
        ${c.teacher ? `<p class="enrol-with">with ${esc(c.teacher)}</p>` : ''}
        <h3 id="ec-${id}">${esc(c.title)}</h3>
        <p class="enrol-when">${esc(w.line)}</p>
        ${w.local ? `<p class="enrol-here small muted">${esc(w.local)}</p>` : ''}
        ${c.weeks ? `<p class="enrol-weeks small">${+c.weeks} week${+c.weeks === 1 ? '' : 's'}</p>` : ''}
        ${kind === 'mine'
          ? `<div class="btnrow">${calLink(c)}<button class="btn quiet small" type="button" data-leave="${id}">Leave<span class="sr-only"> ${esc(c.title)}</span></button></div>`
          : `<button class="btn primary" type="button" data-join="${id}">Join<span class="sr-only"> ${esc(c.title)}</span></button>`}
      </article>`;
    }
    function wire(root, data) {
      root.querySelectorAll('[data-join]').forEach(b => b.onclick = () => startJoin(b.dataset.join, data));
      root.querySelectorAll('[data-leave]').forEach(b => b.onclick = () => askLeave((data.mine || []).find(c => c.class_id === b.dataset.leave)));
    }

    // ------------------------------------------------------------------- home: "Your classes" and "Open to join"
    // The home page's two sections (app.js) are drawn here from what account.js's listings() read: the same
    // headings and list, each class with when it meets (the teacher's zone, and the student's own when it differs),
    // its weeks, and Join, or Leave and Add to calendar. Every home page shows them, a guest's included. Join is a quiet
    // button here: the home page keeps one primary action, the student's own next step.
    function itemHTML(c, kind) {
      const w = when(c), id = esc(c.class_id);
      const meta = [esc(courseTitle(c)), c.weeks ? `${+c.weeks} week${+c.weeks === 1 ? '' : 's'}` : '', c.teacher ? `with ${esc(c.teacher)}` : ''].filter(Boolean).join(' · ');
      return `<li id="class-${id}" class="enrol-item" data-class="${id}"><b>${esc(c.title)}</b>
        <span class="enrol-when">${esc(w.line)}</span>${w.local ? `<span class="enrol-here">${esc(w.local)}</span>` : ''}
        <span class="enrol-meta">${meta}</span>
        <span class="enrol-acts">${kind === 'mine'
          ? `${calLink(c)}<button class="btn quiet small" type="button" data-leave="${id}">Leave<span class="sr-only"> ${esc(c.title)}</span></button>`
          : `<button class="btn quiet small" type="button" data-join="${id}">Join<span class="sr-only"> ${esc(c.title)}</span></button>`}</span></li>`;
    }
    E.homeHTML = function (L) {
      if (!on || !L) return '';
      freeBlobs();
      const mine = L.mine || [], open = (L.open || []).filter(o => !mine.some(m => m.class_id === o.class_id));
      let h = '';
      if (mine.length) h += `<section class="card classes mine" aria-labelledby="cl-h"><h2 id="cl-h" class="kicker">Your classes</h2><ul class="cls">${mine.map(c => itemHTML(c, 'mine')).join('')}</ul></section>`;
      if (open.length) h += `<section class="card classes open" aria-labelledby="op-h"><h2 id="op-h" class="kicker">Open to join</h2><ul class="cls">${open.map(c => itemHTML(c, 'open')).join('')}</ul>
        ${ACC.state === 'guest' ? `<p class="fine">Joining a class needs an account. <button type="button" class="linkbtn" data-acct="signin">Sign in</button></p>` : ''}</section>`;
      return h;
    };
    E.wireHome = function (el, L) { if (on && el && L) wire(el, { open: L.open || [], mine: L.mine || [] }); };

    // ------------------------------------------------------------------- the list, and a join link's card
    E.view = async function (parts) {
      const focus = parts[0] === 'join' ? parts[1] : null;
      // a page of the Academy: its kicker and title, then your classes and the ones open to join
      o.setTitle(focus ? 'Join a class' : 'Classes');
      const head = `<p class="kicker">The Academy</p><h1>${focus ? 'Join a class' : 'Classes'}</h1>`;
      if (!on) { o.paint(`${head}<p>Classes need Letterman's class service, and this copy of Letterman has none.</p><p><a class="btn quiet" href="#/">Back to the course</a></p>`); return; }
      o.paint(`${head}<p class="small muted" role="status">${esc(WORDS.looking)}</p>`);
      freeBlobs();
      const data = await load();
      const now = decodeURIComponent(location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
      if (now[0] !== parts[0] || now[1] !== parts[1]) return;   // the student went elsewhere while this was asked
      const back = `<p style="margin-top:1rem"><a class="btn quiet block" href="#/">&#8592; Back to the course</a></p>`;
      if (data.error) { o.paint(`${head}<p class="enrol-msg" role="status">${esc(problem(data.error))}</p>${back}`); return; }
      const mine = focus && data.mine.find(c => c.class_id === focus);
      const target = focus && data.open.find(c => c.class_id === focus);
      let body;
      if (focus) {
        body = mine ? `<p class="flash" role="status">You are in this class.</p><div class="enrol-list">${card(mine, 'mine', focus)}</div>`
          : target ? `<div class="enrol-list">${card(target, 'open', focus)}</div>`
          : `<p class="enrol-msg" role="status">${esc(WORDS.closed)}</p>`;
        const others = data.open.filter(c => c.class_id !== focus && !data.mine.some(m => m.class_id === c.class_id));
        if (others.length) body += `<h2 class="enrol-h">Other classes open to join</h2><div class="enrol-list">${others.map(c => card(c, 'open')).join('')}</div>`;
      } else {
        const open = data.open.filter(c => !data.mine.some(m => m.class_id === c.class_id));
        body = data.mine.length ? `<h2 class="enrol-h">Your classes</h2><div class="enrol-list">${data.mine.map(c => card(c, 'mine')).join('')}</div>` : '';
        body += `<h2 class="enrol-h">Open to join</h2>` + (open.length ? `<div class="enrol-list">${open.map(c => card(c, 'open')).join('')}</div>` : `<p class="enrol-msg" role="status">${esc(WORDS.empty)}</p>`);
      }
      o.paint(`${head}${body}${back}`);
      wire(document.getElementById('main') || document.body, data);
      if (focus) { const c = document.getElementById('class-' + focus); if (c) { c.scrollIntoView({ block: 'start' }); } }
    };

    // ------------------------------------------------------------------- joining
    function startJoin(id, data) {
      if (offline()) { o.sheet(`<h2>Joining needs the internet</h2><p>${esc(WORDS.offline)}</p><button class="btn primary" type="button" id="sh-x">OK</button>`); $('#sh-x').onclick = () => o.closeSheet(); return; }
      if (ACC.state === 'guest') { setPending(id); ACC.signIn('join'); return; }
      if (ACC.state === 'needs-yes') { setPending(id); ACC.finishJoining(); return; }
      if (!member()) return;
      const c = ((data && data.open) || []).find(x => x.class_id === id);
      if (c) askJoin(c); else continueJoin(id);
    }
    // after the sign-in and the yes: the class is asked for again, as it may have closed meanwhile
    async function continueJoin(id) {
      const data = await load();
      if (data.error) { o.sheet(`<h2>Joining</h2><p class="enrol-msg">${esc(problem(data.error))}</p><button class="btn primary" type="button" id="sh-x">OK</button>`); $('#sh-x').onclick = () => o.closeSheet(); return; }
      if (data.mine.some(c => c.class_id === id)) { o.go('#/join/' + id); return; }
      const c = data.open.find(x => x.class_id === id);
      if (!c) { o.sheet(`<h2>This class is not open</h2><p class="enrol-msg">${esc(WORDS.closed)}</p><button class="btn primary" type="button" id="sh-x">OK</button>`); $('#sh-x').onclick = () => o.closeSheet(); return; }
      askJoin(c);
    }
    function askJoin(c) {
      o.sheet(`<h2>Join ${esc(c.title)}?</h2>
        <p>Your teacher sees your display name on the class list.</p>
        <p>Your answers and hand-ins are kept in your account so they follow you. You can export or erase them any time.</p>
        <p class="msg" role="alert" id="jn-msg"></p>
        <div style="display:grid;gap:.5rem"><button class="btn primary" type="button" id="jn-yes">Join and keep my work</button><button class="btn quiet" type="button" id="jn-no">Not now</button></div>`, { focus: '#jn-yes' });
      $('#jn-no').onclick = () => { clearPending(); o.closeSheet(); };
      $('#jn-yes').onclick = async () => {
        const msg = $('#jn-msg'), btn = $('#jn-yes');
        if (offline()) { msg.textContent = WORDS.offline; return; }
        btn.disabled = true; msg.textContent = '';
        const r = await ACC.act(cl => cl.from('enrolments').insert({ class_id: c.class_id }));
        btn.disabled = false;
        // 23505: already in the class (another tab, another device): that is a yes too
        if (r.error && r.error.code !== '23505') {
          msg.textContent = r.error.code === '42501' ? WORDS.closed : r.error.code === 'unreachable' ? ACC.words.unreachable : ACC.words.failed;
          return;
        }
        clearPending();
        const w = when(c);
        o.sheet(`<h2>You're in.</h2>${w.first ? `<p>It ${w.first > new Date() ? 'starts' : 'started'} ${esc(w.startsDay)}.</p>` : ''}
          <div style="display:grid;gap:.5rem">${calLink(c, true).replace('class="enrol-cal"', 'class="btn quiet enrol-cal"')}<button class="btn primary" type="button" id="sh-x">Done</button></div>`, { focus: '#sh-x' });
        $('#sh-x').onclick = () => o.closeSheet();
        o.refresh();
      };
    }

    // ------------------------------------------------------------------- leaving
    function askLeave(c) {
      if (!c) return;
      o.sheet(`<h2>Leave ${esc(c.title)}?</h2>
        <p>You come off the class list. Your work stays in your account. You can join again while joining is open.</p>
        <p class="msg" role="alert" id="lv-msg"></p>
        <div style="display:grid;gap:.5rem"><button class="btn primary" type="button" id="lv-no">Stay</button><button class="btn quiet danger" type="button" id="lv-yes">Leave the class</button></div>`, { focus: '#lv-no' });
      $('#lv-no').onclick = () => o.closeSheet();
      $('#lv-yes').onclick = async () => {
        const msg = $('#lv-msg');
        if (offline()) { msg.textContent = 'Leaving needs the internet.'; return; }
        const r = await ACC.act(cl => cl.rpc('leave_class', { p_class: c.class_id }));
        if (r.error) { msg.textContent = r.error.code === 'unreachable' ? ACC.words.unreachable : ACC.words.failed; return; }
        o.closeSheet(true);
        o.refresh();
      };
    }

    // ------------------------------------------------------------------- the account changed
    // A join a guest started goes on once they are signed in, have said yes, and nothing else is being asked.
    E.accountChanged = function () {
      if (!on) return;
      const id = pending();
      if (id && member() && !ACC.busy && !document.querySelector('.sheet-bg')) { clearPending(); continueJoin(id); }
    };
    return E;
  }

  window.LMEnrol = { create, when, ics: icsText, instant, zoneName, WORDS };
})();
