// Letterman's account: sign-in, the first-time yes, the display name, carrying work between devices, the export
// and erase of what the service keeps, and whether the account is a teacher.
// Rulings: M2-20 ("Optional for students, required for me"; "A student can always open the week as a guest";
// "Kept from today: nothing is stored before the student says yes, and they can export or erase it all"),
// M2-28 ("A NAME AND A LOGIN ARE TWO DIFFERENT THINGS"), M2-19 ("sign-up says students must be 13 or older"),
// M2-18 (the service and its access rules), Charter law 8, and the Director's rulings of 2026-10-08.
//
// Law 8, in this file:
//   - With no service configured, nothing here runs, and the page is the guest app.
//   - A guest who never signs in sends nothing of theirs to the service: the service's library
//     (vendor/supabase.js) is fetched only when someone signs in, or already holds a sign-in here. The one thing a
//     guest's page asks the service is the two public listings the Director opened to anyone on 2026-10-08 (the
//     open classes, and their announcements), as a plain read with the page's public key (M2-24, A.listings), and,
//     the same way, which class is live (M2-22: "every student's own page shows a Live button ... guests included").
//   - Until the account has said its two yeses, the sign-in is held only for this tab (sessionStorage), never in
//     the browser's lasting storage, and "Not now" erases the sign-in from the service at once.
//   - The account id is used to ask the service for the account's own rows and is never put on the page.
//   - Whether someone is a teacher is read from the service's teachers table (which no one can write to
//     through the service), never from anything the user can write.
(function () {
  'use strict';
  const SELF = document.currentScript && document.currentScript.src;
  const LIB = SELF ? new URL('vendor/supabase.js', SELF).href : 'vendor/supabase.js';
  const PRIVACY = SELF ? new URL('privacy.html', SELF).href : 'privacy.html';
  const AUTH_KEY = 'letterman:auth';
  const SEEN = 'letterman:seen';   // the progress row that keeps which announcements the account has put away
  const NAME_MAX = 40;
  const WORDS = {
    failed: 'That did not go through. Nothing changed. Try again.',
    mismatch: 'That code did not match. Check the newest email, or send a new code.',
    expired: 'That code has expired. Send a new one.',
    name: 'Choose a name the class will see.',
    age: 'Letterman accounts are for people 13 or older.',
    keep: 'Nothing is kept until you say yes.',
    unreachable: 'The class service is not answering right now. The week still works. Joining, hand-ins and announcements wait until it is back.',
    offline: 'You are offline. This is the week as you last saw it. Your answers save on this device.'
  };

  // The display name: 1 to 40 characters, no line breaks or other control characters (the service's
  // display_name_shape check says the same).
  function checkName(raw) {
    const n = String(raw == null ? '' : raw).trim();
    if (!n || n.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(n)) return { ok: false, message: WORDS.name };
    return { ok: true, name: n };
  }

  // Where the sign-in is held. Before the two yeses: this tab only. After: the browser's storage, so the student
  // stays signed in. Removing it removes it from both.
  function makeAuthStore() {
    const box = {};
    const ls = () => { try { return window.localStorage; } catch (e) { return null; } };
    const ss = () => { try { return window.sessionStorage; } catch (e) { return null; } };
    const store = {
      keep: false,
      getItem(k) { const l = ls(), s = ss(); const v = (l && l.getItem(k)) || (s && s.getItem(k)); return v != null ? v : (k in box ? box[k] : null); },
      setItem(k, v) {
        const l = ls(), s = ss();
        try { if (store.keep && l) { l.setItem(k, v); if (s) s.removeItem(k); } else if (s) s.setItem(k, v); else box[k] = v; } catch (e) { box[k] = v; }
      },
      removeItem(k) { const l = ls(), s = ss(); try { if (l) l.removeItem(k); } catch (e) { } try { if (s) s.removeItem(k); } catch (e) { } delete box[k]; },
      // the account said yes: the sign-in moves to lasting storage
      promote() {
        store.keep = true;
        const l = ls(), s = ss(); if (!l || !s) return;
        for (let i = s.length - 1; i >= 0; i--) { const k = s.key(i); if (k && k.startsWith(AUTH_KEY)) { try { l.setItem(k, s.getItem(k)); s.removeItem(k); } catch (e) { } } }
      },
      held() { const l = ls(), s = ss(); const has = st => { if (!st) return false; for (let i = 0; i < st.length; i++) if ((st.key(i) || '').startsWith(AUTH_KEY)) return true; return false; }; return { lasting: has(l), tab: has(s) }; }
    };
    return store;
  }

  let libP = null;
  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    if (libP) return libP;
    libP = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = LIB; s.async = true;
      s.onload = () => window.supabase && window.supabase.createClient ? ok(window.supabase) : no(new Error('library'));
      s.onerror = () => { libP = null; no(new Error('library')); };
      document.head.appendChild(s);
    });
    return libP;
  }
  const isNetwork = e => !!e && (e.name === 'AuthRetryableFetchError' || e.status === 0 || /fetch|network|load failed/i.test(String(e.message || e)));

  // ---------------------------------------------------------------------------------------------------------
  // Carrying work between devices: the device's record of each module and the account's copy are merged answer
  // by answer, the later committed answer winning, earlier tries kept from both, nothing lost.
  function mergeModule(a, b) {
    if (!a) return b; if (!b) return a;
    const out = Object.assign({}, a);
    const at = x => (x && x.at) || '';
    out.answers = Object.assign({}, a.answers || {});
    for (const [pid, rb] of Object.entries(b.answers || {})) {
      const ra = out.answers[pid];
      if (!ra) { out.answers[pid] = rb; continue; }
      let pick = ra;
      if (rb.committed && !ra.committed) pick = rb;
      else if (rb.committed && ra.committed && at(rb) > at(ra)) pick = rb;
      const seen = new Set(); const hist = [];
      for (const h of [...(ra.history || []), ...(rb.history || [])]) { const k = (h.at || '') + JSON.stringify(h.value); if (!seen.has(k)) { seen.add(k); hist.push(h); } }
      // the answer that lost, if it was committed, is kept as an earlier try
      const other = pick === ra ? rb : ra;
      if (other.committed && JSON.stringify(other.value) !== JSON.stringify(pick.value)) { const k = (other.at || '') + JSON.stringify(other.value); if (!seen.has(k)) hist.push({ value: other.value, at: other.at, judged: other.judged }); }
      hist.sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')));
      out.answers[pid] = Object.assign({}, pick, { history: hist });
    }
    out.visited = Object.assign({}, b.visited || {}, a.visited || {});
    out.readInline = Object.assign({}, b.readInline || {}, a.readInline || {});
    out.readFirst = !!(a.readFirst || b.readFirst);
    out.last = Object.keys(a.visited || {}).length ? a.last : b.last;
    const fb = new Map(); for (const f of [...(b.feedback || []), ...(a.feedback || [])]) if (f && f.id != null) fb.set(f.id, f);
    out.feedback = [...fb.values()].sort((x, y) => String(y.received || '').localeCompare(String(x.received || '')));
    if (a.handin || b.handin) out.handin = at(b.handin) > at(a.handin) ? b.handin : (a.handin || b.handin);
    return out;
  }
  const countAnswers = mods => Object.values(mods || {}).reduce((k, m) => k + Object.values((m && m.answers) || {}).filter(x => x && x.committed).length, 0);

  // ---------------------------------------------------------------------------------------------------------
  function create(o) {
    const svc = (o.config && o.config.service) || null;
    const configured = !!(svc && svc.url && svc.key);
    const esc = o.esc;
    const A = {
      configured, words: WORDS, checkName, mergeModule, privacy: PRIVACY,
      state: 'guest',          // guest | starting | needs-yes | member
      name: '', provider: '', teacher: false, problem: null, syncing: false,
      busy: false,             // a sign-in is under way (its sheets, the yes, bringing work in): the page asks nothing else
      get sync() { const d = o.device.get(); return d.sync !== false; }
    };
    if (!configured || o.stage) { A.start = async () => A; A.changed = () => { }; A.ask = async () => ({ error: { code: 'none' } }); A.act = A.ask; A.client = () => Promise.resolve(null); A.myClasses = async () => []; A.myHandIns = async () => []; return A; }

    const store = makeAuthStore();
    let client = null, user = null, lastPushed = {}, pushT = null, sentAt = 0, sentTo = '';
    const codeMs = (+(svc.codeMinutes) || 60) * 60000;
    const tell = () => { try { o.onChange && o.onChange(A); } catch (e) { } };
    function trouble(e) { if (isNetwork(e)) { if (A.problem !== 'unreachable') { A.problem = 'unreachable'; tell(); } return true; } return false; }
    function fine() { if (A.problem === 'unreachable') { A.problem = null; tell(); } }

    async function getClient() {
      if (client) return client;
      const lib = await loadLib();
      client = lib.createClient(svc.url, svc.key, {
        auth: { storage: store, storageKey: AUTH_KEY, flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
      });
      return client;
    }
    // The live room (live.js, M2-22) uses this same client, never a second one: two would contend for the sign-in
    // kept under one storage key. For a guest, asking for it loads the library; live.js asks only when they press Live.
    A.client = getClient;

    // What the account is: a profile (it said yes) or not yet; a teacher or not, as the service's own tables say.
    async function loadAccount() {
      const c = await getClient();
      const { data: s, error: se } = await c.auth.getSession();
      if (se) { trouble(se); }
      user = s && s.session ? s.session.user : null;
      if (!user) { A.state = 'guest'; A.name = ''; A.teacher = false; tell(); return A; }
      // the account as the service has it now, not as it was stored at sign-in; a sign-in the service no longer
      // knows (the account was deleted on another device) leaves this one a guest
      const { data: fresh, error: fe } = await c.auth.getUser();
      if (fe && !isNetwork(fe) && (fe.status === 401 || fe.status === 403 || fe.status === 404)) {
        try { await c.auth.signOut({ scope: 'local' }); } catch (e) { }
        store.removeItem(AUTH_KEY); user = null; A.state = 'guest'; A.name = ''; A.teacher = false; tell(); return A;
      }
      if (fe) trouble(fe); else if (fresh && fresh.user) user = fresh.user;
      const ids = (user.identities || []).map(i => i.provider);
      A.provider = ids.includes('discord') || (user.app_metadata || {}).provider === 'discord' ? 'discord' : 'email';
      const { data: prof, error: pe } = await c.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
      if (pe) { trouble(pe); A.state = store.keep ? 'member' : 'starting'; tell(); return A; }
      fine();
      if (!prof) { A.state = 'needs-yes'; A.name = ''; A.teacher = false; tell(); return A; }
      store.promote();
      A.state = 'member'; A.name = prof.display_name;
      const { data: t, error: te } = await c.from('teachers').select('granted_at').maybeSingle();
      A.teacher = !te && !!t;
      tell();
      return A;
    }

    // Start: only if a sign-in is held here, or the page is coming back from Discord. Otherwise nothing at all.
    A.start = async function () {
      const held = store.held();
      const q = new URLSearchParams(location.search);
      const back = q.has('code') || (q.get('signin') === 'discord' && (q.has('error') || q.has('error_description')));
      if (held.lasting) store.keep = true;
      if (!held.lasting && !held.tab && !back) return A;
      A.state = 'starting'; A.busy = true; tell();
      try {
        if (back && q.has('error')) { await getClient(); cleanUrl(); A.state = 'guest'; tell(); o.say && o.say(WORDS.failed); return A; }
        await getClient();
        if (back) cleanUrl();   // the library has already traded the code for the sign-in (detectSessionInUrl)
        await loadAccount();
        if (A.state === 'needs-yes') firstTime(back ? discordName() : '');
        else if (A.state === 'member') { await pull(); if (back) await offerBringIn(); }
      } catch (e) { trouble(e); if (A.state === 'starting') A.state = store.keep ? 'member' : 'guest'; tell(); }
      finally { A.busy = false; tell(); }
      return A;
    };
    function cleanUrl() {
      const q = new URLSearchParams(location.search);
      ['code', 'signin', 'error', 'error_code', 'error_description', 'state'].forEach(k => q.delete(k));
      const s = q.toString();
      history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash);
    }
    function discordName() {
      const m = (user && user.user_metadata) || {};
      const n = (m.custom_claims && m.custom_claims.global_name) || m.full_name || m.name || m.user_name || '';
      return String(n).replace(/#\d{1,4}$/, '').trim().slice(0, NAME_MAX);
    }

    // ------------------------------------------------------------------------------- the sign-in sheet
    A.signIn = function (reason) {
      // Discord: in a browser the page goes there and back itself; inside the desktop app (letterman://), which cannot
      // take the way back, the app does the round trip in the system browser (desktop/src/main.cjs, RFC 8252).
      const desk = window.LettermanDesktop && typeof window.LettermanDesktop.signInWithDiscord === 'function' ? window.LettermanDesktop : null;
      const web = /^https?:$/.test(location.protocol) || !!desk;
      const head = reason === 'join' ? 'Sign in to join' : 'Sign in';
      o.sheet(`<h2>${head}</h2>
        <p>Signing in lets you hand in, keep your work on any device and appear to your teacher.</p>
        ${web ? `<button class="btn block" type="button" id="si-discord">Sign in with Discord</button><p class="or">or, with a code sent by email</p>` : ''}
        <form id="si-form" novalidate><div class="field"><label for="si-email">Your email address</label>
          <input type="email" id="si-email" autocomplete="email" inputmode="email" required></div>
          <button class="btn primary block" type="submit">Send me a code</button></form>
        <p class="small muted">Accounts are for people 13 or older. <a href="${esc(PRIVACY)}" target="_blank" rel="noopener">Your privacy<span class="sr-only"> (opens a new tab)</span></a></p>
        <p class="msg" role="alert" id="si-msg"></p>
        <button class="btn quiet block" type="button" id="si-not">Not now</button>`, { focus: '#si-email' });
      const msg = t => { const m = document.getElementById('si-msg'); if (m) m.textContent = t; };
      document.getElementById('si-not').onclick = () => o.closeSheet();
      const d = document.getElementById('si-discord');
      if (d) d.onclick = async () => {
        msg('');
        if (desk) {
          msg('Finish signing in with Discord in your browser, then come back to Letterman.');
          try {
            const r = await desk.signInWithDiscord();
            if (!r || !r.access_token || !r.refresh_token) { msg(WORDS.failed); return; }
            const c = await getClient();
            const { error } = await c.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
            if (error) { trouble(error); msg(WORDS.failed); return; }
            fine(); o.closeSheet(true);
            await afterSignIn(() => discordName());
          } catch (e) { trouble(e); msg(WORDS.failed); }
          return;
        }
        try {
          const c = await getClient();
          const redirectTo = location.origin + location.pathname + '?signin=discord';
          const { error } = await c.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo } });
          if (error) { trouble(error); msg(WORDS.failed); }
        } catch (e) { trouble(e); msg(WORDS.failed); }
      };
      document.getElementById('si-form').onsubmit = async e => {
        e.preventDefault();
        const email = document.getElementById('si-email').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg('Type the email address the code should go to.'); return; }
        await sendCode(email, msg);
      };
    };
    async function sendCode(email, msg) {
      msg('');
      try {
        const c = await getClient();
        const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        if (error) { trouble(error); msg(WORDS.failed); return false; }
        fine(); sentAt = Date.now(); sentTo = email;
        codeSheet(email);
        return true;
      } catch (e) { trouble(e); msg(WORDS.failed); return false; }
    }
    function codeSheet(email) {
      o.sheet(`<h2>Enter your code</h2>
        <p>Letterman sent a code to <b>${esc(email)}</b>. It works once, for ${Math.round(codeMs / 60000)} minutes.</p>
        <form id="co-form" novalidate><div class="field"><label for="co-code">The code from the email</label>
          <input type="text" id="co-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required></div>
          <button class="btn primary block" type="submit">Sign in</button></form>
        <p class="msg" role="alert" id="co-msg"></p>
        <div class="row2btn"><button class="btn quiet" type="button" id="co-again">Send a new code</button><button class="btn quiet" type="button" id="co-not">Not now</button></div>`, { focus: '#co-code' });
      const msg = t => { const m = document.getElementById('co-msg'); if (m) m.textContent = t; };
      document.getElementById('co-not').onclick = () => o.closeSheet();
      document.getElementById('co-again').onclick = () => sendCode(email, msg);
      document.getElementById('co-form').onsubmit = async e => {
        e.preventDefault();
        const token = document.getElementById('co-code').value.replace(/\s+/g, '');
        if (!token) { msg(WORDS.mismatch); return; }
        // The service answers a wrong code and an old one the same way; the page knows when it sent the code.
        const old = Date.now() - sentAt > codeMs;
        try {
          const c = await getClient();
          const { data, error } = await c.auth.verifyOtp({ email, token, type: 'email' });
          if (error || !data || !data.session) {
            if (error && trouble(error)) { msg(WORDS.failed); return; }
            msg(old ? WORDS.expired : WORDS.mismatch); return;
          }
          fine();
          o.closeSheet();
          A.busy = true;
          try { await afterSignIn(''); } finally { A.busy = false; tell(); }
        } catch (x) { trouble(x); msg(WORDS.failed); }
      };
    }
    async function afterSignIn(suggested) {
      await loadAccount();
      if (A.state === 'needs-yes') firstTime(typeof suggested === 'function' ? suggested() : suggested);
      else if (A.state === 'member') { await pull(); await offerBringIn(); }
    }

    // ------------------------------------------------------------------------------- the first-time yes
    function firstTime(suggested) {
      const pre = (suggested || o.device.get().name || '').trim().slice(0, NAME_MAX);
      o.sheet(`<h2>Before Letterman keeps anything</h2>
        <form id="ft-form" novalidate>
        <div class="field"><label for="ft-name">Your display name</label>
          <input type="text" id="ft-name" maxlength="${NAME_MAX}" autocomplete="nickname" value="${esc(pre)}">
          <p class="help" id="ft-name-help">The name your teacher and class see. You can change it any time.</p></div>
        <label class="check"><input type="checkbox" id="ft-13"> <span>I am 13 or older</span></label>
        <label class="check"><input type="checkbox" id="ft-keep"> <span><b>Keep my work in my account.</b> Your answers and hand-ins are kept in your account so they follow you. You can export or erase them any time.</span></label>
        <p class="small"><a href="${esc(PRIVACY)}" target="_blank" rel="noopener">Your privacy<span class="sr-only"> (opens a new tab)</span></a>: what is kept, who sees it, and how to erase it.</p>
        <p class="msg" role="alert" id="ft-msg"></p>
        <button class="btn primary block" type="submit" id="ft-go">Join Letterman</button></form>
        <button class="btn quiet block" type="button" id="ft-not">Not now: keep nothing</button>`, { focus: '#ft-name', onDismiss: notNow });
      const msg = t => { const m = document.getElementById('ft-msg'); if (m) m.textContent = t; };
      document.getElementById('ft-not').onclick = notNow;
      document.getElementById('ft-form').onsubmit = async e => {
        e.preventDefault();
        const nm = checkName(document.getElementById('ft-name').value);
        const is13 = document.getElementById('ft-13').checked, keep = document.getElementById('ft-keep').checked;
        const why = [];
        if (!nm.ok) why.push(WORDS.name);
        if (!is13) why.push(WORDS.age);
        if (!keep) why.push(WORDS.keep);
        if (why.length) { msg(why.join(' ')); return; }
        try {
          const c = await getClient();
          // the two answers go as given: the service refuses a no as well (join_letterman), not only this page
          const { error } = await c.rpc('join_letterman', { chosen_name: nm.name, is_13_or_older: is13, keep_my_work: keep });
          if (error) { trouble(error); msg(WORDS.failed); return; }
          fine();
          o.closeSheet(true);
          A.busy = true;
          try { await loadAccount(); await pull(); await offerBringIn(); } finally { A.busy = false; tell(); }
        } catch (x) { trouble(x); msg(WORDS.failed); }
      };
    }
    // "Not now" before the yes: the sign-in is erased from the service at once, and nothing is left here.
    async function notNow() {
      o.closeSheet(true);
      try {
        const c = await getClient();
        if (A.state === 'needs-yes') { const { error } = await c.rpc('delete_my_account'); if (error) trouble(error); }
        await c.auth.signOut({ scope: 'local' });
      } catch (e) { trouble(e); }
      store.removeItem(AUTH_KEY); store.removeItem(AUTH_KEY + '-code-verifier'); store.removeItem(AUTH_KEY + '-user');
      user = null; A.state = 'guest'; A.name = ''; A.teacher = false; tell();
    }
    A.finishJoining = () => { if (A.state === 'needs-yes') firstTime(''); };

    // ------------------------------------------------------------------------------- bringing device work in
    async function offerBringIn() {
      const d = o.device.get();
      const n = countAnswers(d.modules);
      if (!n || d.sync === false || d.carriedFor === 'account') { await push(true); return; }
      o.sheet(`<h2>Bring your answers?</h2>
        <p>Bring the ${n} answer${n === 1 ? '' : 's'} on this device into your account?</p>
        <p class="small muted">Then they follow you to any device you sign in on.</p>
        <div style="display:grid;gap:.5rem"><button class="btn primary" type="button" id="bi-yes">Yes, bring them in</button>
        <button class="btn quiet" type="button" id="bi-no">No, keep them on this device only</button></div>`, { focus: '#bi-yes', onDismiss: () => no() });
      // Closing the sheet without an answer is a no: nothing moves into the account without a yes.
      let done; const asked = new Promise(r => { done = r; });
      const no = () => { o.closeSheet(true); d.sync = false; o.device.save(); tell(); done(); };
      document.getElementById('bi-yes').onclick = async () => { o.closeSheet(true); d.sync = true; d.carriedFor = 'account'; o.device.save(); await push(true); tell(); done(); };
      document.getElementById('bi-no').onclick = no;
      await asked;
    }

    // ------------------------------------------------------------------------------- pull and push
    async function pull() {
      if (A.state !== 'member' || !A.sync) return;
      try {
        const c = await getClient();
        const { data, error } = await c.from('progress').select('module,state');
        if (error) { trouble(error); return; }
        fine();
        const d = o.device.get();
        for (const row of data || []) {
          lastPushed[row.module] = JSON.stringify(row.state);
          // the announcements this account has put away (M2-24): kept with the account, joined with this device's
          if (row.module === SEEN) { d.seen = Object.assign({}, (row.state || {}).seen, d.seen); continue; }
          d.modules[row.module] = mergeModule(d.modules[row.module], row.state);
        }
        o.device.save(); tell();
      } catch (e) { trouble(e); }
    }
    async function push(now) {
      if (A.state !== 'member' || !A.sync) return;
      clearTimeout(pushT);
      if (!now) { pushT = setTimeout(() => push(true), 1200); return; }
      try {
        const c = await getClient();
        const d = o.device.get();
        const rows = Object.entries(d.modules || {});
        if (d.seen && Object.keys(d.seen).length) rows.push([SEEN, { seen: d.seen }]);
        for (const [mod, st] of rows) {
          const j = JSON.stringify(st);
          if (lastPushed[mod] === j) continue;
          const { data, error } = await c.from('progress').update({ state: st }).eq('module', mod).select('module');
          if (error) { trouble(error); return; }
          if (!data || !data.length) { const r = await c.from('progress').insert({ module: mod, state: st }); if (r.error) { trouble(r.error); return; } }
          lastPushed[mod] = j;
        }
        fine();
      } catch (e) { trouble(e); }
    }
    A.changed = () => { if (A.state === 'member' && A.sync) push(false); };
    A.setSync = async on => {
      const d = o.device.get(); d.sync = !!on; if (on) d.carriedFor = 'account'; o.device.save();
      if (on) { await pull(); await push(true); }
      tell();
    };

    // ------------------------------------------------------------------------------- name, sign out, export, erase
    A.rename = async raw => {
      const nm = checkName(raw);
      if (!nm.ok) return nm;
      try {
        const c = await getClient();
        const { data, error } = await c.from('profiles').update({ display_name: nm.name }).eq('id', user.id).select('display_name');
        if (error || !data || !data.length) { if (error) trouble(error); return { ok: false, message: WORDS.failed }; }
        fine(); A.name = data[0].display_name; tell();
        return { ok: true, name: A.name };
      } catch (e) { trouble(e); return { ok: false, message: WORDS.failed }; }
    };
    A.signOut = async () => {
      await push(true);
      try { const c = await getClient(); await c.auth.signOut({ scope: 'local' }); } catch (e) { }
      store.removeItem(AUTH_KEY); store.removeItem(AUTH_KEY + '-code-verifier'); store.removeItem(AUTH_KEY + '-user'); store.keep = false;
      user = null; lastPushed = {}; A.state = 'guest'; A.name = ''; A.teacher = false; A.provider = '';
      // the next person to sign in on this device is asked again before this device's work goes anywhere
      const d = o.device.get(); delete d.carriedFor; delete d.sync; o.device.save(); tell();
    };
    A.exportService = async () => {
      try {
        const c = await getClient();
        const { data, error } = await c.rpc('export_my_data');
        if (error) { trouble(error); return null; }
        fine(); return data;
      } catch (e) { trouble(e); return null; }
    };
    A.deleteAccount = async () => {
      try {
        const c = await getClient();
        const { error } = await c.rpc('delete_my_account');
        if (error) { trouble(error); return false; }
        fine();
        try { await c.auth.signOut({ scope: 'local' }); } catch (e) { }
      } catch (e) { trouble(e); return false; }
      store.removeItem(AUTH_KEY); store.removeItem(AUTH_KEY + '-code-verifier'); store.removeItem(AUTH_KEY + '-user'); store.keep = false;
      user = null; lastPushed = {}; A.state = 'guest'; A.name = ''; A.teacher = false; A.provider = '';
      const d = o.device.get(); delete d.carriedFor; delete d.sync; o.device.save(); tell();
      return true;
    };
    // ------------------------------------------------------------------------------- hand-ins and classes (M2-23)
    // The hand-in, the conversation and the console's hand-ins use the one client above (A.client), and ask for it only
    // for a signed-in account, so a guest's page never loads the library for them (law 8).
    // The classes this account joined as a student, for one course, newest first. Asked by the account id here, so
    // the id never leaves this file; a teacher's own classes are not in it.
    A.myClasses = async course => {
      if (A.state !== 'member' || !user) return [];
      try {
        const c = await getClient();
        const { data, error } = await c.from('enrolments').select('joined_at, classes(id, title, course, time_zone)').eq('student_id', user.id).order('joined_at', { ascending: false });
        if (error) { trouble(error); return null; }
        fine();
        return (data || []).map(r => r.classes).filter(k => k && (!course || k.course === course));
      } catch (e) { trouble(e); return null; }
    };
    // This account's own hand-ins, with the replies on them and each reply's author by display name (a deleted
    // teacher's reply has none: "your teacher").
    A.myHandIns = async () => {
      if (A.state !== 'member' || !user) return [];
      try {
        const c = await getClient();
        const { data, error } = await c.from('hand_ins').select('id, module, body, link, created_at, classes(title, time_zone), replies(id, body, carry_forward, created_at, updated_at, profiles(display_name))').eq('student_id', user.id).order('created_at', { ascending: false });
        if (error) { trouble(error); return null; }
        fine();
        return data || [];
      } catch (e) { trouble(e); return null; }
    };
    // Is the service answering at all? Used by the console only (never by the student page, so a guest still sends
    // nothing): with no sign-in to ask about, the console still needs to know whether the service could have said no.
    A.probe = async () => {
      try {
        const r = await fetch(svc.url + '/auth/v1/health', { headers: { apikey: svc.key }, signal: AbortSignal.timeout(6000) });
        if (r.status >= 500) throw new Error('status ' + r.status);
        fine(); return true;
      } catch (e) { if (A.problem !== 'unreachable') { A.problem = 'unreachable'; tell(); } return false; }
    };
    // The teaching half asks the service each time it opens, never a flag kept here. When the answer is no, A.problem
    // says whether the service said it ('unreachable' means it could not be asked).
    A.verifyTeacher = async () => {
      if (A.state === 'guest' && !store.held().lasting && !store.held().tab) { await A.probe(); return false; }
      try { await loadAccount(); } catch (e) { trouble(e); return false; }
      return A.state === 'member' && A.teacher;
    };
    // ------------------------------------------------------------------------------- the home page's classes (M2-24)
    // "Your classes" (a signed-in student's enrolments), "Open to join" (open_classes()), and each class's
    // announcements. A guest reads only the two public listings the Director's rulings of 2026-10-08 opened to
    // anyone ("listed for anyone, guests included"; "guests see them"): a plain GET with the page's public key,
    // carrying no account, no name and no answer, and the service's library is not fetched for it.
    const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/.test(svc.key);
    async function publicRead(fn, params) {
      const q = new URLSearchParams(params || {}).toString();
      const r = await fetch(`${svc.url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}${q ? '?' + q : ''}`,
        { headers: Object.assign({ apikey: svc.key, accept: 'application/json' }, JWT ? { authorization: 'Bearer ' + svc.key } : {}), cache: 'no-store', credentials: 'omit' });
      if (!r.ok) throw Object.assign(new Error('the service answered ' + r.status), { status: r.status });
      return r.json();
    }
    // the live room (live.js, M2-22) asks which class is live the same way, and only that
    A.publicRead = fn => fn === 'live_now' ? publicRead(fn) : Promise.reject(new Error('not a public read'));
    // A class as the pages show it: never an account id (the service's functions return none).
    const classOf = x => ({ class_id: x.class_id, title: x.title, course: x.course, starts_on: x.starts_on, meets_at: x.meets_at || null,
      time_zone: x.time_zone, weeks: x.weeks || null, teacher: x.teacher || '', joined_at: x.joined_at || null,
      open_for_enrolment: x.open_for_enrolment !== false });
    A.listings = async course => {
      try {
        const member = A.state === 'member' && !!user;
        let open = [], mine = [];
        const notes = {};
        if (member) {
          const c = await getClient();
          const o = await c.rpc('open_classes'); if (o.error) throw o.error; open = o.data || [];
          // the student's own classes with their teachers' display names (M2-21's my_classes(): no account id at all)
          const e = await c.rpc('my_classes'); if (e.error) throw e.error;
          mine = (e.data || []).map(classOf);
        } else open = await publicRead('open_classes');
        open = (open || []).map(classOf);
        // whose announcements show: the student's own classes; with none, the listed classes of this course. Everyone
        // reads them the one way, through class_announcements(), which hides one that has ended and sends no account id
        // (M2-24: the service decides who may read; the page only asks).
        const forNotes = mine.length ? mine : open.filter(x => x.course === course);
        for (const k of forNotes) {
          const rows = member ? await (async () => { const r = await (await getClient()).rpc('class_announcements', { p_class: k.class_id }); if (r.error) throw r.error; return r.data || []; })()
            : await publicRead('class_announcements', { p_class: k.class_id });
          notes[k.class_id] = (rows || []).map(n => ({ class_id: k.class_id, body: n.body, written_at: n.written_at, changed_at: n.changed_at || null, link: n.link || null }));
        }
        fine();
        return { mine, open, notices: forNotes.map(k => ({ class_id: k.class_id, title: k.title, teacher: k.teacher, time_zone: k.time_zone, notes: notes[k.class_id] || [] })) };
      } catch (e) { if (!trouble(e) && e && e.status >= 500) trouble({ status: 0 }); return null; }
    };
    // ------------------------------------------------------------------------------- for the page's other parts
    // enrol.js (classes and joining, M2-21) reaches the service only through these two, and both answer
    // { data, error }. Network trouble, or a service that answers with a server error (a paused project), shows once
    // under the running head, as for every other call here, and comes back as error.code 'unreachable'.
    //   ask: one of the two public listings (open_classes; class_announcements). A guest's read is publicRead above:
    //        a plain GET with the public key, no body, nothing of theirs, and the service's library is not fetched.
    //   act: what a signed-in account does, through the one client. A caller who has not said yes gets 'signin'.
    const down = e => ({ data: null, error: { code: 'unreachable', message: String((e && e.message) || e) } });
    const sick = r => !!r && (r.status >= 500 || (r.error && isNetwork(r.error)));
    A.ask = async (fn, args) => {
      try {
        if (!client && !store.held().lasting && !store.held().tab) {
          try { const data = await publicRead(fn, args); fine(); return { data, error: null }; }
          catch (e) { if (trouble(e) || e.status >= 500) { trouble({ status: 0 }); return down(e); } return { data: null, error: { code: String(e.status || 'failed'), message: e.message } }; }
        }
        const c = await getClient();
        const r = await c.rpc(fn, args || {});
        if (sick(r)) { trouble({ status: 0 }); return down(r.error && r.error.message); }
        if (!r.error) fine();
        return r;
      } catch (e) { trouble(e); return down(e); }
    };
    A.act = async work => {
      if (A.state !== 'member') return { data: null, error: { code: 'signin', message: '' } };
      try {
        const c = await getClient();
        const r = (await work(c)) || { data: null, error: null };
        if (sick(r)) { trouble({ status: 0 }); return down(r.error && r.error.message); }
        if (!r.error) fine();
        return r;
      } catch (e) { trouble(e); return down(e); }
    };
    // ------------------------------------------------------------------------------- how learning is measured (M2-31)
    // The values kept for a measure the course names (supabase/migrations/20261009000100_measures.sql). The service's
    // rules decide who reaches what; these only ask. No account id is returned to the page: a student's own values come
    // back without who recorded them, and a teacher's roster is held here, the page knowing each student by a number.
    A.myMeasures = async () => {
      if (A.state !== 'member' || !user) return null;
      try {
        const c = await getClient();
        const { data, error } = await c.from('measure_values').select('module, measure, value, recorder, teacher_sees, recorded_at').eq('student_id', user.id).order('recorded_at');
        if (error) { trouble(error); return null; }
        fine(); return data || [];
      } catch (e) { trouble(e); return null; }
    };
    // A self-check, recorded by the student as themselves. Sent to the teacher of each class of this course the student
    // joined only when the course says the teacher sees it; otherwise it is kept for the student alone (no class).
    A.recordSelfCheck = async ({ course, module, measure, value, teacherSees }) => {
      if (A.state !== 'member' || !user) return false;
      try {
        const c = await getClient();
        let classes = [];
        if (teacherSees) {
          const e = await c.from('enrolments').select('class_id, classes(course)').eq('student_id', user.id);
          if (e.error) { trouble(e.error); return false; }
          classes = (e.data || []).filter(r => r.classes && r.classes.course === course).map(r => r.class_id);
        }
        const rows = (classes.length ? classes : [null]).map(k => ({ class_id: k, module, measure, value, recorder: 'student', recorded_by: user.id, teacher_sees: !!k }));
        const { error } = await c.from('measure_values').insert(rows);
        if (error) { trouble(error); return false; }
        fine(); return true;
      } catch (e) { trouble(e); return false; }
    };
    // The teaching console: this teacher's classes of the course, each one's students by display name, the values in it,
    // and recording one. The roster's account ids stay in this closure.
    let roster = [];
    A.teaching = {
      async classes(course) {
        if (A.state !== 'member' || !user || !A.teacher) return null;
        try {
          const c = await getClient();
          const { data, error } = await c.from('classes').select('id, title, course').eq('teacher_id', user.id).eq('course', course).order('created_at');
          if (error) { trouble(error); return null; }
          fine(); return (data || []).map((k, i) => ({ n: i, title: k.title, _id: k.id }));
        } catch (e) { trouble(e); return null; }
      },
      async students(cls) {
        try {
          const c = await getClient();
          const e = await c.from('enrolments').select('student_id').eq('class_id', cls._id);
          if (e.error) { trouble(e.error); return null; }
          const ids = (e.data || []).map(r => r.student_id);
          const names = {};
          if (ids.length) { const p = await c.from('profiles').select('id, display_name').in('id', ids); if (p.error) { trouble(p.error); return null; } (p.data || []).forEach(x => { names[x.id] = x.display_name; }); }
          const vals = await c.from('measure_values').select('student_id, module, measure, value, recorder, recorded_at').eq('class_id', cls._id).order('recorded_at');
          if (vals.error) { trouble(vals.error); return null; }
          fine();
          roster = ids.map(id => ({ id, name: names[id] || '' })).sort((a, b) => a.name.localeCompare(b.name));
          return roster.map((s, n) => ({ n, name: s.name, values: (vals.data || []).filter(v => v.student_id === s.id).map(v => ({ module: v.module, measure: v.measure, value: v.value, recorder: v.recorder, recorded_at: v.recorded_at })) }));
        } catch (e) { trouble(e); return null; }
      },
      async record(cls, n, { module, measure, value }) {
        const s = roster[n]; if (!s) return false;
        try {
          const c = await getClient();
          const { error } = await c.from('measure_values').insert({ student_id: s.id, class_id: cls._id, module, measure, value, recorder: 'teacher', recorded_by: user.id });
          if (error) { trouble(error); return false; }
          fine(); return true;
        } catch (e) { trouble(e); return false; }
      }
    };
    window.addEventListener('online', () => { if (A.problem) { A.problem = null; tell(); } A.changed(); });
    return A;
  }

  window.LMAccount = { create, checkName, mergeModule, WORDS };
})();
