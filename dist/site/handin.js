// Letterman's hand-in inside the portal, its count on the progress bar, and the teacher's reply on the student's page.
// Ruling: M2-23, the Director's note of 2026-10-08 ("Both in the portal"). The row: "Hand-ins: inside the portal,
// counted on the progress bar (hand-in 1 of 8); your reply lands on the student's page instead of a link. At first a
// hand-in carries text or a link to the file, because animation files fill the free storage fast."
//
// Who hands in where:
//   - a signed-in student who joined a class for this course hands in here: text, an https link, or both, kept in the
//     service's hand_ins table, seen by them and that class's teacher only (the service's rules, supabase/migrations);
//   - everyone else (a guest, or a student in no class yet) hands in as before, by copying the message and opening the
//     class's Discord (app.js), so no account stands between a student and the week (Charter law 8).
// The count, "hand-in 1 of 8", counts the modules handed in either way, out of the course's modules that ask for one:
// a module whose package is in this build counts if it has an assignment; a module not built yet counts too, because
// its package cannot say otherwise until it exists.
// No line of this file names a course, a module or a channel.
(function () {
  'use strict';
  const LINK = /^https:\/\/[^\s]+$/;
  function create(x) {
    // x: the page's own parts (app.js): CFG, COURSE, courseKey, esc, ms, mem, persist, acc, sheet, closeSheet, route, when
    const { esc } = x;
    let classes = null;     // the classes this student joined for the course (null: not asked, or not signed in)
    let mine = null;        // this student's own hand-ins, with the replies on them, from the service
    let loading = null;
    const again = {};       // module id: the student asked to hand in a new version
    const member = () => { const a = x.acc(); return !!(a && a.configured && a.state === 'member'); };
    const klass = () => (member() && classes && classes.length) ? classes[0] : null;

    // Asked when the account changes (signed in, out, a name). Answers whether anything shown changed; asks the service
    // at most every few seconds, because the account says it changed several times while it starts.
    let askedAt = 0, seen = '';
    async function refresh(force) {
      if (!member()) { const had = classes !== null || mine !== null; classes = null; mine = null; seen = ''; return had; }
      if (loading) return loading;
      if (!force && Date.now() - askedAt < 3000) return false;
      askedAt = Date.now();
      loading = (async () => {
        const a = x.acc();
        const [k, h] = await Promise.all([a.myClasses(x.courseKey), a.myHandIns()]);
        if (k) classes = k;
        if (h) { mine = h; markHandedIn(h); }
        const now = JSON.stringify([classes, (mine || []).map(z => [z.id, (z.replies || []).map(r => [r.id, r.updated_at, r.profiles && r.profiles.display_name])])]);
        const changed = now !== seen; seen = now;
        return changed;
      })().catch(() => false).finally(() => { loading = null; });
      return loading;
    }
    // A hand-in kept by the service counts on this device too (another device, or before this device said yes).
    function markHandedIn(list) {
      let changed = false;
      for (const h of list) {
        const p = Object.values(x.COURSE.packages).find(k => k.module.meta.id === h.module);
        if (!p) continue;
        const m = x.ms(h.module);
        if (!m.handin) { m.handin = { at: h.created_at, via: 'letterman' }; changed = true; }
      }
      if (changed) x.persist();
    }

    // ------------------------------------------------------------------ the count
    function totals() {
      let of = 0, done = 0;
      for (const m of x.COURSE.modules) {
        const p = x.COURSE.packages[m.folder || m.lockedFolder];
        if (p ? !p.module.assignment : false) continue;
        of++;
        if (p && x.mem.modules[p.module.meta.id] && x.mem.modules[p.module.meta.id].handin) done++;
      }
      return { done, of };
    }
    const countLine = () => { const t = totals(); return t.of ? `hand-in ${t.done} of ${t.of}` : ''; };

    // ------------------------------------------------------------------ the sheet inside the portal
    // ready(model): this student hands in here, for this module, now
    const ready = model => !!(model.mj.assignment && klass());
    const ofModule = model => (mine || []).filter(h => h.module === model.id);
    function whenLine(iso) { const w = x.when.say(iso); return esc(w.main) + (w.local ? `. <span class="when-local">${esc(w.local)}</span>` : ''); }
    function cardHTML(model) {
      const asg = model.mj.assignment, k = klass(), a = x.acc();
      const list = ofModule(model), last = list[0];
      const self = Object.values(model.prompts).find(p => p.type === 'reflect');
      const selfAns = self && x.ms(model.id).answers[self.id];
      const form = !last || again[model.id];
      return `<section class="card handin hi-svc" aria-labelledby="hi-h">
        <p class="kicker">Hand it in</p>
        <h2 id="hi-h">${!form ? 'Handed in' : esc(asg.handin_title || 'Send your work to the teacher')}</h2>
        ${last ? `<div class="sent"><p><b>You handed this in</b> on ${whenLine(last.created_at)}</p>
          <p class="small">${last.replies && last.replies.length ? 'Your teacher replied. Read it in <a href="#/heard">Heard back</a>.' : `Your teacher's reply will show here, in Letterman, and in <a href="#/heard">Heard back</a>.`}</p></div>
          ${list.length > 1 || !form ? `<details class="hi-mine"><summary>What you handed in${list.length > 1 ? ` (${list.length} versions, all kept)` : ''}</summary><ol class="hi-list">${list.map(h => `<li>${h.body ? `<p class="hi-body">${esc(h.body)}</p>` : ''}${h.link ? `<p><a href="${esc(h.link)}" target="_blank" rel="noopener noreferrer">${esc(h.link)}<span class="sr-only"> (opens a new tab)</span></a></p>` : ''}<p class="small muted">${whenLine(h.created_at)}</p><p><button class="linkbtn" type="button" data-hi-del="${esc(h.id)}">Delete this version</button></p></li>`).join('')}</ol></details>` : ''}` : ''}
        ${!form ? `<p><button class="linkbtn" type="button" id="hi-again">Hand in a new version</button></p>` : `
        <p class="small muted">What to send: ${esc(asg.deliverable)}. Write it here, add a link to your file, or both. Your file itself never goes through Letterman: put it where you keep your work and paste its link. Only you and the teacher of ${esc(k.title)} see it.</p>
        <p class="handin-as">Handing in as <b>${esc(a.name)}</b>, your display name. <a href="#/settings">Change your name</a></p>
        <div class="field"><label for="hi-text">Your work in words, or a note for the teacher</label><textarea id="hi-text" rows="4" maxlength="19000" aria-describedby="hi-text-help"></textarea><p class="help" id="hi-text-help">What you made, what you want them to look at, anything you want to say.</p></div>
        <div class="field"><label for="hi-link">A link to your file</label><input type="url" id="hi-link" inputmode="url" autocomplete="url" maxlength="2000" placeholder="https://" aria-describedby="hi-link-help"><p class="help" id="hi-link-help">Optional. It starts with https://.</p></div>
        ${selfAns && selfAns.committed ? `<label class="check"><input type="checkbox" id="hi-self" checked> <span>Include my self-check: <b>${esc(selfAns.value.chip || '')}</b>${selfAns.value.text ? ` “${esc(selfAns.value.text)}”` : ''}</span></label>` : ''}
        <p class="msg" role="alert" id="hi-msg"></p>
        <button class="btn primary block" type="button" id="hi-send-svc">Hand it in</button>
        ${last ? `<p><button class="linkbtn" type="button" id="hi-keep">Keep the last version</button></p>` : ''}`}
        <p class="small muted">Optional, always.</p>
      </section>`;
    }
    function mount(model, redraw) {
      const $ = s => document.querySelector(s);
      const ag = $('#hi-again'); if (ag) ag.onclick = () => { again[model.id] = true; redraw(); const t = $('#hi-text'); if (t) t.focus(); };
      const kp = $('#hi-keep'); if (kp) kp.onclick = () => { delete again[model.id]; redraw(); };
      // a student deletes any version they handed in, at once (the privacy page: "A hand-in ... you delete is deleted at once")
      document.querySelectorAll('[data-hi-del]').forEach(bt => bt.onclick = () => {
        const id = bt.dataset.hiDel;
        x.sheet(`<h2>Delete this version?</h2><p>It is deleted at once from Letterman's service, with any reply on it. It cannot be undone. Your other versions stay.</p>
          <p class="msg" role="alert" id="hd-msg"></p>
          <div class="sheet-acts"><button type="button" class="btn primary" id="sh-ok">Yes, delete it</button><button type="button" class="btn quiet" id="sh-x">Keep it</button></div>`);
        $('#sh-x').onclick = () => x.closeSheet();
        $('#sh-ok').onclick = async () => {
          $('#sh-ok').disabled = true;
          try {
            const c = await x.acc().client();
            const { error } = c ? await c.from('hand_ins').delete().eq('id', id) : { error: true };
            if (error) throw error;
            mine = (mine || []).filter(h => h.id !== id);
            if (!ofModule(model).length) { delete x.ms(model.id).handin; delete again[model.id]; x.persist(); }
            x.closeSheet(true); redraw();
          } catch (e) { $('#sh-ok').disabled = false; $('#hd-msg').textContent = x.acc().words.failed; }
        };
      });
      const send = $('#hi-send-svc'); if (!send) return;
      send.onclick = async () => {
        const said = t => { $('#hi-msg').textContent = t; };
        const text = $('#hi-text').value.trim(), link = $('#hi-link').value.trim();
        if (!text && !link) return said('Write something or add a link first.');
        if (link && (!LINK.test(link) || link.length > 2000)) return said('A link starts with https:// and has no spaces.');
        const self = Object.values(model.prompts).find(p => p.type === 'reflect');
        const sa = self && x.ms(model.id).answers[self.id];
        const incSelf = $('#hi-self') && $('#hi-self').checked && sa && sa.committed;
        const body = [text, incSelf ? `Self-check: ${sa.value.chip || ''}${sa.value.text ? ' "' + sa.value.text + '"' : ''}` : ''].filter(Boolean).join('\n\n');
        send.disabled = true; said('');
        const a = x.acc();
        try {
          const c = await a.client();
          if (!c) throw new Error('signed out');
          const { data, error } = await c.from('hand_ins').insert({ class_id: klass().id, module: model.id, body: body || null, link: link || null }).select('id, module, body, link, created_at').single();
          if (error) throw error;
          (mine = mine || []).unshift(Object.assign({ classes: { title: klass().title }, replies: [] }, data));
          x.ms(model.id).handin = { at: data.created_at, via: 'letterman' };
          delete again[model.id];
          x.persist();
          redraw();
          const h = $('#hi-h'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
        } catch (e) {
          send.disabled = false;
          said(navigator.onLine === false ? 'You are offline. Your work is still here; hand it in when you are back.' : a.words.failed);
        }
      };
    }

    // ------------------------------------------------------------------ the reply, on the student's page
    // Each reply on this student's hand-ins, in the shape Heard back already shows (the same as a reply that came by a
    // link). It is read from the service each time and never copied onto the device: the reply is the teacher's.
    function feedback() {
      const out = [];
      for (const h of mine || []) {
        const p = Object.values(x.COURSE.packages).find(k => k.module.meta.id === h.module);
        for (const r of h.replies || []) {
          const w = x.when.say(r.created_at);
          out.push({ id: 'svc-' + r.id, svc: true, m: h.module, from: (r.profiles && r.profiles.display_name) || 'your teacher',
            d: w.main, dLocal: w.local, msg: r.body, forward: r.carry_forward || '', star: false,
            moduleTitle: p ? p.module.meta.title : h.module, fromModule: p ? p.module.meta.module : null,
            carriesInto: p ? p.module.meta.module + 1 : null, received: r.created_at, to: null });
        }
      }
      return out;
    }

    return { refresh, countLine, totals, ready, cardHTML, mount, feedback, get classes() { return classes; } };
  }
  window.LMHandin = { create };
})();
