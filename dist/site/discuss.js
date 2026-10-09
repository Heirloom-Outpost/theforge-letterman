// Letterman's view of the class's conversation: one post per module, on Discord, shown inside the portal (M2-23).
// The Director, 2026-10-08: "If the Discord discussion data can somehow be rendered into Letterman, if users could post
// in the Discord discussion THROUGH Letterman, that would be very ideal and convenient"; "One conversation, on
// Discord". The row: "First, each module links to its post. Then Letterman shows the post inside the portal, and a
// signed-in student posts into it from Letterman." "Reading the post needs no sign-in; posting does."
//
// Which post belongs to which module is this deployment's (letterman.deployment.json, discord.discuss.<course>.posts,
// by module number), never the app's. Reading and posting go through the service's discussion function
// (supabase/functions/discussion), which holds Letterman's Discord bot token and webhook; the page never sees either.
// A guest's page asks the function only when the guest opens the conversation, and sends nothing of theirs: no name,
// no answers (law 8). Posting needs the student's sign-in, which the function checks with the service itself.
(function () {
  'use strict';
  const POST = /^https:\/\/discord\.com\/channels\/\d{15,25}\/(\d{15,25})$/;
  const WORDS = {
    loading: 'Loading the conversation.',
    failed: 'The conversation could not be loaded right now. Open it in Discord instead.',
    empty: 'No one has written here yet.',
    posted: 'Posted.',
    tooMany: 'You have posted five times in ten minutes. Wait a few minutes, then post again.',
    tooLong: 'That is longer than Discord allows: 2000 characters at most.',
    signIn: 'Sign in again to post.',
    join: 'Finish joining Letterman to post.',
    notOurs: 'This post is not this class\'s. Open it in Discord instead.',
    notSetUp: 'Posting from Letterman is not set up yet. Post in Discord instead.',
    write: 'Write something first.',
    notYours: 'That post is not yours to delete.',
    notDeleted: 'Discord did not delete it just now. Nothing changed. Try again.'
  };
  function create(x) {
    // x: the page's own parts (app.js): CFG, courseKey, esc, acc, header, shell, setTitle, focusMain, modLabel, lastStep,
    // returnTo, when, unit
    const { esc } = x;
    const conf = () => ((x.CFG.discord || {}).discuss || {})[x.courseKey] || null;
    const server = () => (x.CFG.discord || {}).server || 'Discord';
    const svc = () => (x.CFG.service && x.CFG.service.url && x.CFG.service.key) ? x.CFG.service : null;
    // the module's post, from the deployment: its address and its id (the last number in the address)
    function postFor(model) {
      const c = conf(), u = c && c.posts && c.posts[String(model.meta.module)];
      const m = typeof u === 'string' && u.match(POST);
      return m ? { url: u, id: m[1] } : null;
    }
    const channel = () => { const c = conf() || {}; return { name: c.channel || (x.CFG.discord || {}).discussChannel || '', url: c.url || '' }; };
    const ext = (href, label, cls) => `<a class="btn ${cls || 'quiet'}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}<span class="sr-only"> (opens Discord in a new tab)</span></a>`;

    // The module page's card: read it here, or open it in Discord. With no post for the module, the class's channel.
    function cardHTML(model) {
      const p = postFor(model), ch = channel();
      if (!p && !ch.url) return '';
      return `<section class="card talkcard" aria-labelledby="tk-h"><h2 id="tk-h" class="kicker">Talk with the class</h2>
        <p>${p ? `It lives in ${esc(server())}, in one post for this ${esc(x.unit)}.${svc() ? ' Read it here; no account needed.' : ''}` : `This class talks in <b>${esc(ch.name)}</b>, in ${esc(server())}.`}</p>
        <div class="btnrow">${p && svc() ? `<a class="btn primary" href="#/m/${model.folder}/talk">Read the conversation here</a>` : ''}${p ? ext(p.url, 'Open the post in Discord') : ext(ch.url, `Open ${esc(ch.name || server())}`)}</div></section>`;
    }

    // The student's own posts from Letterman, by Discord's number for each message: the record that lets them delete it
    // (the Director, 2026-10-09: "Yes, they can delete"). Read from the service as the student; the rules show no one
    // else's, so a classmate's page offers no button on anyone else's post.
    let ownPosts = {};
    async function loadOwn(p) {
      ownPosts = {};
      const a = x.acc(); if (!a || a.state !== 'member') return;
      try {
        const c = await a.client(); if (!c) return;
        const { data } = await c.from('discussion_posts').select('id, message').eq('post', p.id).not('message', 'is', null);
        (data || []).forEach(r => { ownPosts[r.message] = r.id; });
      } catch (e) { }
    }
    function messageHTML(m) {
      const w = x.when.say(m.at);
      const mine = m.via && ownPosts[m.id];
      const files = (m.files || []).map(f => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)}<span class="sr-only"> (a file in Discord, opens a new tab)</span></a></li>`).join('');
      return `<li class="talk-msg"><p class="talk-who"><b>${esc(m.name)}</b>${m.via ? ' <span class="tag talk-via">via Letterman</span>' : ''} <span class="talk-when">${esc(w.main)}${w.local ? `. <span class="when-local">${esc(w.local)}</span>` : ''}${m.edited ? ' (edited)' : ''}</span></p>
        ${m.text ? `<p class="talk-text">${esc(m.text)}</p>` : ''}${files ? `<ul class="talk-files">${files}</ul>` : ''}
        ${mine ? `<p class="talk-del"><button class="linkbtn" type="button" data-talk-del="${esc(mine)}">Delete my post</button></p>` : ''}</li>`;
    }
    async function load(p) {
      const s = svc();
      const box = document.getElementById('talk-list'); if (!box) return;
      box.setAttribute('aria-busy', 'true');
      let r = null;
      await loadOwn(p);
      try {
        const res = await fetch(`${s.url}/functions/v1/discussion?post=${encodeURIComponent(p.id)}`, { headers: { apikey: s.key }, cache: 'no-store' });
        r = res.ok ? await res.json() : null;
      } catch (e) { r = null; }
      const now = document.getElementById('talk-list'); if (!now) return;
      now.setAttribute('aria-busy', 'false');
      if (!r || !Array.isArray(r.messages)) { now.innerHTML = `<p class="muted">${WORDS.failed}</p>`; return; }
      now.innerHTML = r.messages.length ? `<ol class="talk-list">${r.messages.map(messageHTML).join('')}</ol>` : `<p class="muted">${WORDS.empty}</p>`;
      now.querySelectorAll('[data-talk-del]').forEach(b => b.onclick = () => askDelete(p, b.dataset.talkDel));
    }
    function askDelete(p, id) {
      x.sheet(`<h2>Delete your post?</h2><p>It is deleted from the class's conversation on Discord at once, for everyone. It cannot be undone.</p>
        <p class="msg" role="alert" id="td-msg"></p>
        <div class="sheet-acts"><button type="button" class="btn primary" id="sh-ok">Yes, delete it</button><button type="button" class="btn quiet" id="sh-x">Keep it</button></div>`);
      document.getElementById('sh-x').onclick = () => x.closeSheet();
      document.getElementById('sh-ok').onclick = async () => {
        const ok = document.getElementById('sh-ok'); ok.disabled = true;
        let code = null;
        try {
          const c = await x.acc().client();
          const { error } = c ? await c.functions.invoke('discussion', { body: { action: 'delete', id } }) : { error: { context: null } };
          if (error) { try { code = ((await error.context.json()) || {}).error || 'failed'; } catch (z) { code = 'failed'; } }
        } catch (z) { code = 'failed'; }
        if (code) { ok.disabled = false; document.getElementById('td-msg').textContent = code === 'not-yours' ? WORDS.notYours : WORDS.notDeleted; return; }
        x.closeSheet(true); load(p);
      };
    }
    // Before an account is deleted: every post of the student's still on Discord is deleted there first. Answers how many
    // could not be (0 when there were none), so the erase sheet can say so plainly before anything goes.
    async function deleteMyPosts() {
      const a = x.acc(); if (!a || a.state !== 'member') return { failed: 0 };
      try {
        const c = await a.client(); if (!c) return { failed: 0 };
        const { data, error: e0 } = await c.from('discussion_posts').select('id').not('message', 'is', null);
        if (e0) return { failed: -1 };
        if (!(data || []).length) return { failed: 0 };
        const { data: d, error } = await c.functions.invoke('discussion', { body: { action: 'delete-all' } });
        if (error || !d) return { failed: data.length };
        return { failed: d.failed || 0, deleted: d.deleted || 0 };
      } catch (e) { return { failed: -1 }; }
    }

    function composerHTML(p) {
      const a = x.acc();
      if (!svc() || !a || !a.configured) return `<p class="small">To write, ${ext(p.url, 'post in Discord', 'small quiet')}</p>`;
      if (a.state === 'member') return `<form id="talk-form" class="talk-form" novalidate>
          <div class="field"><label for="talk-text">Your message</label><textarea id="talk-text" rows="3" maxlength="2000" aria-describedby="talk-help"></textarea>
          <p class="help" id="talk-help">It goes into this ${esc(x.unit)}'s post in ${esc(server())} as <b>${esc(a.name)}</b> via Letterman, and pings no one.</p></div>
          <p class="msg" role="alert" id="talk-msg"></p>
          <button class="btn primary" type="submit" id="talk-send">Post</button></form>`;
      if (a.state === 'needs-yes') return `<p>Finish joining Letterman to post here.</p><button class="btn quiet" type="button" id="talk-finish">Finish joining</button>`;
      return `<p>Reading needs no account. Posting does.</p><button class="btn quiet" type="button" id="talk-signin">Sign in to post</button>`;
    }
    function viewTalk(model) {
      const p = postFor(model);
      if (!p || !svc()) { location.replace(`#/m/${model.folder}`); return; }
      x.setTitle('Talk with the class: ' + model.meta.title);
      const last = x.lastStep(model);
      const main = `<p class="kicker">${esc(x.modLabel(model))}</p>
          <h1>Talk with the class</h1>
          <p class="muted">One conversation for this ${esc(x.unit)}, in ${esc(server())}. Letterman shows it here; a post from here goes into the same conversation.</p>
          <div class="btnrow">${ext(p.url, 'Open the post in Discord')}<button class="btn quiet" type="button" id="talk-again">Show the newest</button></div>
          <div id="talk-list" aria-live="polite" aria-busy="true"><p class="muted">${WORDS.loading}</p></div>
          <div class="talk-compose">${composerHTML(p)}</div>
          <p class="gap"><a class="btn quiet" href="${x.returnTo(model)}"><span aria-hidden="true">&#8592;</span> ${last != null ? `Back to step ${last + 1}, where you were` : 'Back to the module'}</a></p>`;
      x.paint(model, last, main);
      document.getElementById('talk-again').onclick = () => load(p);
      const si = document.getElementById('talk-signin'); if (si) si.onclick = () => x.acc().signIn();
      const fj = document.getElementById('talk-finish'); if (fj) fj.onclick = () => x.acc().finishJoining();
      const f = document.getElementById('talk-form');
      if (f) f.onsubmit = async e => {
        e.preventDefault();
        const ta = document.getElementById('talk-text'), said = t => { document.getElementById('talk-msg').textContent = t; }, btn = document.getElementById('talk-send');
        const text = ta.value.trim();
        if (!text) return said(WORDS.write);
        if (text.length > 2000) return said(WORDS.tooLong);
        btn.disabled = true; said('');
        let code = null;
        try {
          const c = await x.acc().client();
          if (!c) code = 'sign-in';
          else {
            const { error } = await c.functions.invoke('discussion', { body: { post: p.id, text } });
            if (error) { try { code = ((await error.context.json()) || {}).error || 'failed'; } catch (z) { code = 'failed'; } }
          }
        } catch (z) { code = 'failed'; }
        btn.disabled = false;
        if (code) return said({ 'too-many': WORDS.tooMany, 'too-long': WORDS.tooLong, 'sign-in': WORDS.signIn, 'join-first': WORDS.join, 'not-a-post': WORDS.notOurs, 'not-set-up': WORDS.notSetUp }[code] || x.acc().words.failed);
        ta.value = ''; said(WORDS.posted);
        load(p);
      };
      load(p);
      x.focusMain();
    }
    return { postFor, cardHTML, viewTalk, deleteMyPosts };
  }
  window.LMDiscuss = { create, WORDS };
})();
