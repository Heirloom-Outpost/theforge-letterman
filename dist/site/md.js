// Letterman's Markdown reader.
//
// The format is the Course Package Standard's (section 4): CommonMark 0.31.2 plus the GFM table extension, and nothing
// else from GFM. Two things are done on purpose that CommonMark leaves to the reader:
//   - Raw HTML is never passed through. A tag in the text is shown as text. (The Academy's build already refuses HTML
//     markup in student files; this is the reader's own guard.) A link or picture address is kept only when it is
//     http, https or mailto, or has no scheme; javascript:, data: and the like are left as plain words.
//   - Named character references ("&copy;") use the browser's own table when there is a page, and a short built-in table
//     otherwise; a number reference ("&#169;") always works.
// Also read, because real content uses them though the standard does not name them: a bare http(s)
// address in the text becomes a link, and "- [ ]" / "- [x]" list items show a box.
//
// The Academy's conventions, as literal text, never a template language (standard section 4):
//   ![alt](asset:id)   a visual, drawn from module.json assets[] with its credit
//   [text](asset:id)   an outbound link, drawn from assets[] (opens in a new tab)
//   [text](term:id)    a word linked to the course glossary
//   {{prompt:id}}      a prompt, on a line of its own
//   {{microscope:id}}  an "Under a microscope" fold, on a line of its own (standard 1.3.0, section 4c)
//   {{deeper}}         opens the fold that runs to the end of the block (at the top level only)
// Nothing here knows about any one module.
(function () {
  'use strict';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ------------------------------------------------------------------ characters and references
  const ASCII_PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
  const isPunctAscii = c => c !== '' && ASCII_PUNCT.indexOf(c) >= 0;
  const reWs = /[\s\u{a0}]/u;
  const reUniPunct = /[\p{P}\p{S}]/u;
  const NAMED = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u{a0}', copy: '\u{a9}', reg: '\u{ae}', trade: '\u{2122}', hellip: '\u{2026}',
    mdash: '\u{2014}', ndash: '\u{2013}', lsquo: '\u{2018}', rsquo: '\u{2019}', ldquo: '\u{201c}', rdquo: '\u{201d}', laquo: '\u{ab}', raquo: '\u{bb}',
    times: '\u{d7}', divide: '\u{f7}', deg: '\u{b0}', plusmn: '\u{b1}', micro: '\u{b5}', para: '\u{b6}', sect: '\u{a7}', middot: '\u{b7}',
    bull: '\u{2022}', larr: '\u{2190}', rarr: '\u{2192}', uarr: '\u{2191}', darr: '\u{2193}', harr: '\u{2194}', hearts: '\u{2665}', euro: '\u{20ac}',
    pound: '\u{a3}', yen: '\u{a5}', cent: '\u{a2}', frac12: '\u{bd}', frac14: '\u{bc}', frac34: '\u{be}', ne: '\u{2260}', le: '\u{2264}',
    ge: '\u{2265}', Auml: '\u{c4}', auml: '\u{e4}', Ouml: '\u{d6}', ouml: '\u{f6}', Uuml: '\u{dc}', uuml: '\u{fc}', szlig: '\u{df}',
    eacute: '\u{e9}', egrave: '\u{e8}', aacute: '\u{e1}', agrave: '\u{e0}', ntilde: '\u{f1}', ccedil: '\u{e7}'
  };
  function namedRef(name) {
    if (Object.prototype.hasOwnProperty.call(NAMED, name)) return NAMED[name];
    if (typeof document !== 'undefined') {            // the browser knows the full table (an inert textarea decodes it)
      const t = document.createElement('textarea'); t.innerHTML = '&' + name + ';';
      return t.value !== '&' + name + ';' ? t.value : null;
    }
    return null;
  }
  function decodeRef(e) {
    if (e[0] === '#') {
      const n = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) ? '\u{fffd}' : String.fromCodePoint(n);
    }
    return namedRef(e);
  }
  const RE_ESC_OR_REF = /\\([!-\/:-@\[-`{-~])|&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g;
  const unescapeStr = s => s.replace(RE_ESC_OR_REF, (m, ch, ref) => ch ? ch : (decodeRef(ref) ?? m));
  const normLabel = s => s.trim().replace(/[ \t\r\n]+/g, ' ').toLowerCase().toUpperCase();
  const lastChar = (s, pos) => { if (pos <= 0) return ''; const c = s.charCodeAt(pos - 1); return (c >= 0xdc00 && c <= 0xdfff && pos >= 2) ? s.slice(pos - 2, pos) : s[pos - 1]; };
  const firstChar = (s, pos) => pos >= s.length ? '' : String.fromCodePoint(s.codePointAt(pos));

  // an address a page may follow: http, https, mailto, or no scheme at all
  function safeUrl(dest) {
    const t = dest.replace(/[\0-\x20\x7f-\x9f\u{200b}-\u{200d}\u{2028}\u{2029}\u{feff}]/gu, '');
    const m = /^([A-Za-z][A-Za-z0-9+.\-]*):/.exec(t);
    if (m && !/^(https?|mailto)$/i.test(m[1])) return null;
    return dest.replace(/ /g, '%20');
  }
  const isExternal = u => /^https?:/i.test(u);

  // ------------------------------------------------------------------ links: labels, destinations, titles
  const RE_LABEL = /^\[(?:[^\\\[\]]|\\.){0,1000}\]/s;
  function labelAt(s, pos) { const m = RE_LABEL.exec(s.slice(pos, pos + 1010)); return m ? m[0] : null; }
  function skipSpnl(s, p) {                       // spaces and tabs, at most one line end, spaces and tabs
    while (s[p] === ' ' || s[p] === '\t') p++;
    if (s[p] === '\n') { p++; while (s[p] === ' ' || s[p] === '\t') p++; }
    return p;
  }
  // returns { value, end } or null; an empty address is allowed only when `allowEmpty`
  function destAt(s, p, allowEmpty) {
    if (s[p] === '<') {
      let q = p + 1;
      while (q < s.length) {
        const c = s[q];
        if (c === '\\' && q + 1 < s.length && isPunctAscii(s[q + 1])) { q += 2; continue; }
        if (c === '\n' || c === '<') return null;
        if (c === '>') return { value: unescapeStr(s.slice(p + 1, q)), end: q + 1 };
        q++;
      }
      return null;
    }
    let q = p, depth = 0;
    while (q < s.length) {
      const c = s[q];
      if (c === '\\' && q + 1 < s.length && isPunctAscii(s[q + 1])) { q += 2; continue; }
      if (c === '(') { depth++; q++; continue; }
      if (c === ')') { if (depth === 0) break; depth--; q++; continue; }
      if (c === ' ' || c === '\t' || c === '\n' || /[\u0000-\u001f\u007f]/.test(c)) break;
      q++;
    }
    if (depth !== 0) return null;
    if (q === p && !allowEmpty) return null;
    return { value: unescapeStr(s.slice(p, q)), end: q };
  }
  function titleAt(s, p) {
    const open = s[p];
    const close = open === '(' ? ')' : open;
    if (open !== '"' && open !== "'" && open !== '(') return null;
    let q = p + 1;
    while (q < s.length) {
      const c = s[q];
      if (c === '\\' && q + 1 < s.length && isPunctAscii(s[q + 1])) { q += 2; continue; }
      if (c === close) return { value: unescapeStr(s.slice(p + 1, q)), end: q + 1 };
      if (open === '(' && c === '(') return null;
      q++;
    }
    return null;
  }
  // after "[text](": the address, an optional title, and ")"
  function inlineTailAt(s, p) {
    p = skipSpnl(s, p);
    const d = destAt(s, p, true); if (!d) return null;
    let q = d.end, title = null;
    const afterDest = q;
    q = skipSpnl(s, q);
    if (q > afterDest) { const t = titleAt(s, q); if (t) { title = t.value; q = skipSpnl(s, t.end); } }
    if (s[q] !== ')') return null;
    return { dest: d.value, title, end: q + 1 };
  }
  // a link reference definition at the start of a paragraph; returns the number of characters it uses, or 0
  function refDefAt(text, refs) {
    const lab = labelAt(text, 0); if (!lab) return 0;
    let p = lab.length;
    if (text[p] !== ':') return 0;
    p = skipSpnl(text, p + 1);
    const d = destAt(text, p, false); if (!d) return 0;
    p = d.end;
    const beforeTitle = p;
    p = skipSpnl(text, p);
    let title = null;
    if (p > beforeTitle) { const t = titleAt(text, p); if (t) { title = t.value; p = t.end; } else p = beforeTitle; }
    const eol = q => { while (text[q] === ' ' || text[q] === '\t') q++; return (q >= text.length || text[q] === '\n') ? q : -1; };
    let end = eol(p);
    if (end < 0) {
      if (title === null) return 0;
      title = null; end = eol(beforeTitle);          // the title was not alone on its line: keep the address, drop the title
      if (end < 0) return 0;
    }
    const key = normLabel(lab.slice(1, -1));
    if (!key) return 0;
    if (!refs[key]) refs[key] = { dest: d.value, title };
    return end < text.length ? end + 1 : end;
  }

  // ------------------------------------------------------------------ inline
  // text -> nodes -> HTML. Nodes: {t:'text',s} {t:'code',s} {t:'br'} {t:'soft'} {t:'emph'|'strong',kids} {t:'link'|'image',dest,title,kids}
  const RE_REF = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/y;
  const RE_AUTO = /<([A-Za-z][A-Za-z0-9+.\-]{1,31}:[^\s<>]*)>/y;
  const RE_MAIL = /<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)*)>/y;
  const RE_BARE = /https?:\/\/[^\s<>)]+/y;

  function processEmphasis(list, delims) {
    const bottoms = {};
    let ci = 0;
    while (ci < delims.length) {
      const c = delims[ci];
      if (!c.close || c.cnt === 0) { ci++; continue; }
      const key = c.ch + (c.open ? 1 : 0) + (c.orig % 3);
      const lo = bottoms[key] ? delims.indexOf(bottoms[key]) : -1;
      let found = -1;
      for (let oi = ci - 1; oi > lo; oi--) {
        const o = delims[oi];
        if (o.ch !== c.ch || !o.open || o.cnt === 0) continue;
        if ((o.close || c.open) && (o.orig + c.orig) % 3 === 0 && !(o.orig % 3 === 0 && c.orig % 3 === 0)) continue;   // the rule of three
        found = oi; break;
      }
      if (found < 0) {
        bottoms[key] = delims[ci - 1] || null;
        if (!c.open) delims.splice(ci, 1); else ci++;
        continue;
      }
      const o = delims[found];
      const use = c.cnt >= 2 && o.cnt >= 2 ? 2 : 1;
      const io = list.indexOf(o.node), ic = list.indexOf(c.node);
      const kids = list.splice(io + 1, ic - io - 1);
      list.splice(io + 1, 0, { t: use === 2 ? 'strong' : 'emph', kids });
      o.cnt -= use; c.cnt -= use;
      o.node.s = o.node.s.slice(0, o.node.s.length - use);
      c.node.s = c.node.s.slice(use);
      delims.splice(found + 1, ci - found - 1);       // whatever lay between can no longer match
      ci = found + 1;
      if (o.cnt === 0) { list.splice(list.indexOf(o.node), 1); delims.splice(found, 1); ci--; }
      if (c.cnt === 0) { list.splice(list.indexOf(c.node), 1); delims.splice(ci, 1); }
    }
  }

  function parseInline(s, refs) {
    const nodes = [], delims = [], brackets = [];
    let pos = 0;
    const pushText = str => { const l = nodes[nodes.length - 1]; if (l && l.t === 'text' && !l.fixed) l.s += str; else nodes.push({ t: 'text', s: str }); };
    const skipLead = () => { while (s[pos] === ' ' || s[pos] === '\t') pos++; };
    const PLAIN = /[^\n`\\&*_\[\]!<h]+/y;
    while (pos < s.length) {
      const c = s[pos];
      if (c === '\n') {
        const l = nodes[nodes.length - 1];
        let hard = false;
        if (l && l.t === 'text' && !l.fixed) { hard = / {2,}$/.test(l.s); l.s = l.s.replace(/ +$/, ''); }
        nodes.push({ t: hard ? 'br' : 'soft' }); pos++; skipLead();
      } else if (c === '`') {
        let n = 1; while (s[pos + n] === '`') n++;
        let q = pos + n, found = -1;
        while (q < s.length) {
          const k = s.indexOf('`', q); if (k < 0) break;
          let m = 1; while (s[k + m] === '`') m++;
          if (m === n) { found = k; break; }
          q = k + m;
        }
        if (found < 0) { pushText('`'.repeat(n)); pos += n; }
        else {
          let code = s.slice(pos + n, found).replace(/\n/g, ' ');
          if (code.length > 2 && code[0] === ' ' && code[code.length - 1] === ' ' && /[^ ]/.test(code)) code = code.slice(1, -1);
          nodes.push({ t: 'code', s: code }); pos = found + n;
        }
      } else if (c === '\\') {
        const nx = s[pos + 1];
        if (nx === '\n') { nodes.push({ t: 'br' }); pos += 2; skipLead(); }
        else if (nx !== undefined && isPunctAscii(nx)) { pushText(nx); pos += 2; }
        else { pushText('\\'); pos++; }
      } else if (c === '&') {
        RE_REF.lastIndex = pos;
        const m = RE_REF.exec(s);
        const r = m && decodeRef(m[1]);
        if (m && r != null) { pushText(r); pos += m[0].length; } else { pushText('&'); pos++; }
      } else if (c === '*' || c === '_') {
        let n = 1; while (s[pos + n] === c) n++;
        const before = lastChar(s, pos) || '\n', after = firstChar(s, pos + n) || '\n';
        const wsB = reWs.test(before), wsA = reWs.test(after), puB = reUniPunct.test(before), puA = reUniPunct.test(after);
        const left = !wsA && (!puA || wsB || puB), right = !wsB && (!puB || wsA || puA);
        const open = c === '*' ? left : left && (!right || puB), close = c === '*' ? right : right && (!left || puA);
        const node = { t: 'text', s: c.repeat(n), fixed: true };
        nodes.push(node); delims.push({ node, ch: c, cnt: n, orig: n, open, close });
        pos += n;
      } else if (c === '[' || (c === '!' && s[pos + 1] === '[')) {
        const image = c === '!';
        const node = { t: 'text', s: image ? '![' : '[', fixed: true };
        nodes.push(node);
        if (brackets.length) brackets[brackets.length - 1].bracketAfter = true;
        pos += image ? 2 : 1;
        brackets.push({ node, image, active: true, delimLen: delims.length, pos, bracketAfter: false });
      } else if (c === ']') {
        const op = brackets[brackets.length - 1];
        if (!op) { pushText(']'); pos++; continue; }
        if (!op.active) { brackets.pop(); pushText(']'); pos++; continue; }
        let dest = null, title = null, end = -1;
        if (s[pos + 1] === '(') { const r = inlineTailAt(s, pos + 2); if (r) { dest = r.dest; title = r.title; end = r.end; } }
        if (end < 0) {
          const lab = labelAt(s, pos + 1);
          let key = null;
          if (lab && lab.length > 2) { key = lab.slice(1, -1); end = pos + 1 + lab.length; }
          else if (!op.bracketAfter) { key = s.slice(op.pos, pos); end = pos + 1 + (lab ? lab.length : 0); }
          const ref = key != null ? refs[normLabel(key)] : null;
          if (ref) { dest = ref.dest; title = ref.title; } else end = -1;
        }
        if (end < 0) { brackets.pop(); pushText(']'); pos++; continue; }
        const at = nodes.indexOf(op.node);
        const kids = nodes.splice(at + 1);
        nodes.pop();                                    // the opening bracket itself
        processEmphasis(kids, delims.splice(op.delimLen));
        nodes.push({ t: op.image ? 'image' : 'link', dest, title, kids });
        brackets.pop();
        if (!op.image) brackets.forEach(b => { if (!b.image) b.active = false; });   // a link holds no link
        pos = end;
      } else if (c === '<') {
        RE_AUTO.lastIndex = pos; RE_MAIL.lastIndex = pos;
        let m = RE_AUTO.exec(s);
        if (m) { nodes.push({ t: 'link', dest: m[1], title: null, kids: [{ t: 'text', s: m[1] }] }); pos += m[0].length; continue; }
        m = RE_MAIL.exec(s);
        if (m) { nodes.push({ t: 'link', dest: 'mailto:' + m[1], title: null, kids: [{ t: 'text', s: m[1] }] }); pos += m[0].length; continue; }
        pushText('<'); pos++;                            // raw HTML is shown as text
      } else if (c === 'h' && !brackets.length && (pos === 0 || /[\s(]/.test(s[pos - 1]))) {
        RE_BARE.lastIndex = pos;
        const m = RE_BARE.exec(s);
        if (m) {
          const url = m[0].replace(/[.,;:!?'"*_]+$/, '');
          if (url.length > 8) { nodes.push({ t: 'link', dest: url, title: null, kids: [{ t: 'text', s: url }] }); pos += url.length; continue; }
        }
        pushText('h'); pos++;
      } else if (c === '!' || c === 'h') {
        pushText(c); pos++;
      } else {
        PLAIN.lastIndex = pos;
        const m = PLAIN.exec(s);
        pushText(m[0]); pos += m[0].length;
      }
    }
    processEmphasis(nodes, delims);
    return nodes;
  }

  const plain = nodes => nodes.map(n => n.t === 'text' || n.t === 'code' ? n.s : n.t === 'soft' || n.t === 'br' ? ' ' : n.kids ? plain(n.kids) : '').join('');

  function renderNodes(nodes, ctx) {
    return nodes.map(n => {
      switch (n.t) {
        case 'text': return esc(n.s);
        case 'code': return '<code>' + esc(n.s) + '</code>';
        case 'soft': return '\n';
        case 'br': return '<br>\n';
        case 'emph': return '<em>' + renderNodes(n.kids, ctx) + '</em>';
        case 'strong': return '<strong>' + renderNodes(n.kids, ctx) + '</strong>';
        case 'link': {
          const inner = renderNodes(n.kids, ctx);
          let m;
          if ((m = /^asset:([\w-]+)$/.exec(n.dest))) return ctx.link ? ctx.link(m[1], inner) : inner;
          if ((m = /^term:([\w-]+)$/.exec(n.dest))) return ctx.term ? ctx.term(m[1], inner) : inner;
          const u = safeUrl(n.dest);
          if (u === null) return inner;
          const ext = isExternal(u);
          return `<a href="${esc(u)}"${n.title ? ` title="${esc(n.title)}"` : ''}${ext ? ' target="_blank" rel="noopener"' : ''}>${inner}${ext ? '<span class="sr-only"> (opens a new tab)</span>' : ''}</a>`;
        }
        case 'image': {
          const alt = plain(n.kids);
          let m;
          if ((m = /^asset:([\w-]+)$/.exec(n.dest))) return ctx.figure ? ctx.figure(m[1], alt, true) : esc(alt);
          const u = safeUrl(n.dest);
          if (u === null || !isExternal(u)) return esc(alt);
          return `<img src="${esc(u)}" alt="${esc(alt)}"${n.title ? ` title="${esc(n.title)}"` : ''} loading="lazy">`;
        }
      }
      return '';
    }).join('');
  }
  const inline = (text, ctx, refs) => renderNodes(parseInline(String(text), refs || Object.create(null)), ctx || {});

  // ------------------------------------------------------------------ blocks
  const mk = (type, parent) => ({ type, parent: parent || null, children: [], open: true, content: '', lastLineBlank: false });
  const RE_DELIM_ROW = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
  const RE_STARTS_BLOCK = /^(?:>|#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}$|[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|\{\{(?:prompt:[\w-]+|microscope:[\w-]+|deeper)\}\}[ \t]*$)/;

  // the cells of one table row: leading and trailing pipe optional, "\|" is a pipe in the cell
  function splitRow(row) {
    let t = row.trim();
    if (t[0] === '|') t = t.slice(1);
    const cells = []; let cur = '';
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === '\\' && t[i + 1] === '|') { cur += '|'; i++; }
      else if (ch === '\\' && t[i + 1] === '\\') { cur += '\\\\'; i++; }
      else if (ch === '|') { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    if (cur.trim() !== '' || !/\|\s*$/.test(row)) cells.push(cur.trim());   // a trailing pipe ends the last cell without a new one
    return cells;
  }

  function parseBlocks(src) {
    const doc = mk('document');
    const refs = Object.create(null);
    const lines = src.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    let tip = doc, oldtip = doc, lastMatched = doc, allClosed = true;
    let line = '', lineNo = 0, offset = 0, column = 0, nextNonspace = 0, nextNonspaceColumn = 0, indent = 0, indented = false, blank = false, partialTab = false;

    function findNextNonspace() {
      let i = offset, cols = column, c;
      while ((c = line.charAt(i)) !== '') { if (c === ' ') { i++; cols++; } else if (c === '\t') { i++; cols += 4 - (cols % 4); } else break; }
      blank = c === '';
      nextNonspace = i; nextNonspaceColumn = cols; indent = cols - column; indented = indent >= 4;
    }
    function advanceNextNonspace() { offset = nextNonspace; column = nextNonspaceColumn; partialTab = false; }
    function advanceOffset(count, columns) {
      let c;
      while (count > 0 && (c = line[offset])) {
        if (c === '\t') {
          const toTab = 4 - (column % 4);
          if (columns) { partialTab = toTab > count; const adv = toTab > count ? count : toTab; column += adv; offset += partialTab ? 0 : 1; count -= adv; }
          else { partialTab = false; column += toTab; offset += 1; count -= 1; }
        } else { partialTab = false; offset += 1; column += 1; count -= 1; }
      }
    }
    function addLine() {
      if (partialTab) { offset += 1; const toTab = 4 - (column % 4); tip.content += ' '.repeat(toTab); }
      tip.content += line.slice(offset) + '\n';
    }
    const canContain = (parent, t) => parent === 'list' ? t === 'item' : (parent === 'document' || parent === 'block_quote' || parent === 'item') && t !== 'item';
    function addChild(type) {
      while (!canContain(tip.type, type)) finalize(tip);
      const n = mk(type, tip); tip.children.push(n); tip = n; return n;
    }
    function unlink(b) { const p = b.parent; if (p) p.children.splice(p.children.indexOf(b), 1); }
    function closeUnmatched() {
      if (allClosed) return;
      while (oldtip !== lastMatched) { const p = oldtip.parent; finalize(oldtip); oldtip = p; }
      allClosed = true;
    }
    const endsWithBlank = b => {
      while (b) {
        if (b.lastLineBlank) return true;
        if (b.type === 'list' || b.type === 'item') b = b.children[b.children.length - 1]; else break;
      }
      return false;
    };
    function finalize(b) {
      b.open = false; tip = b.parent;
      switch (b.type) {
        case 'paragraph': {
          let used;
          while (b.content[0] === '[' && (used = refDefAt(b.content, refs))) b.content = b.content.slice(used);
          if (!b.content.trim()) unlink(b);
          break;
        }
        case 'code_block':
          if (b.fenced) { const k = b.content.indexOf('\n'); b.info = unescapeStr(b.content.slice(0, k).trim()); b.content = b.content.slice(k + 1); }
          else b.content = b.content.replace(/(\n *)+$/, '\n');
          break;
        case 'list': {
          b.tight = true;
          for (let i = 0; i < b.children.length && b.tight; i++) {
            const item = b.children[i];
            if (endsWithBlank(item) && i < b.children.length - 1) { b.tight = false; break; }
            for (let j = 0; j < item.children.length; j++) {
              if (endsWithBlank(item.children[j]) && (i < b.children.length - 1 || j < item.children.length - 1)) { b.tight = false; break; }
            }
          }
          break;
        }
        case 'table':
          b.rows = b.content.split('\n').filter(r => r.trim()).map(splitRow);
          break;
      }
    }

    // --- how each open block decides whether the line continues it: 0 yes, 1 no, 2 the line is used up
    function cont(b) {
      switch (b.type) {
        case 'block_quote':
          if (!indented && line[nextNonspace] === '>') { advanceNextNonspace(); advanceOffset(1, false); if (line[offset] === ' ' || line[offset] === '\t') advanceOffset(1, true); return 0; }
          return 1;
        case 'item':
          if (blank) { if (!b.children.length) return 1; advanceNextNonspace(); }
          else if (indent >= b.markerOffset + b.padding) advanceOffset(b.markerOffset + b.padding, true);
          else return 1;
          return 0;
        case 'code_block':
          if (b.fenced) {
            const m = indent <= 3 && line[nextNonspace] === b.fenceChar && /^(?:`{3,}|~{3,})(?=[ \t]*$)/.exec(line.slice(nextNonspace));
            if (m && m[0].length >= b.fenceLength) { finalize(b); return 2; }
            let i = b.fenceOffset; while (i > 0 && (line[offset] === ' ' || line[offset] === '\t')) { advanceOffset(1, true); i--; }
          } else if (indent >= 4) advanceOffset(4, true);
          else if (blank) advanceNextNonspace();
          else return 1;
          return 0;
        case 'paragraph': return blank ? 1 : 0;
        case 'table': return (blank || (!indented && RE_STARTS_BLOCK.test(line.slice(nextNonspace)))) ? 1 : 0;
        case 'list': case 'document': return 0;
        default: return 1;                                  // heading, thematic break, directive
      }
    }
    const accepts = t => t === 'paragraph' || t === 'code_block' || t === 'table';

    function parseListMarker(container) {
      if (indent >= 4) return null;
      const rest = line.slice(nextNonspace);
      const data = { markerOffset: indent };
      let m;
      if ((m = /^[*+-]/.exec(rest))) { data.type = 'bullet'; data.bulletChar = m[0]; }
      else if ((m = /^(\d{1,9})([.)])/.exec(rest)) && (container.type !== 'paragraph' || m[1] === '1')) { data.type = 'ordered'; data.start = parseInt(m[1], 10); data.delimiter = m[2]; }
      else return null;
      const nextc = line[nextNonspace + m[0].length];
      if (!(nextc === undefined || nextc === ' ' || nextc === '\t')) return null;
      if (container.type === 'paragraph' && !/\S/.test(line.slice(nextNonspace + m[0].length))) return null;
      advanceNextNonspace(); advanceOffset(m[0].length, true);
      const spacesStartCol = column, spacesStartOffset = offset;
      let nc;
      do { advanceOffset(1, true); nc = line[offset]; } while (column - spacesStartCol < 5 && (nc === ' ' || nc === '\t'));
      const blankItem = line[offset] === undefined;
      const spaces = column - spacesStartCol;
      if (spaces >= 5 || spaces < 1 || blankItem) {
        data.padding = m[0].length + 1; column = spacesStartCol; offset = spacesStartOffset;
        if (line[offset] === ' ' || line[offset] === '\t') advanceOffset(1, true);
      } else data.padding = m[0].length + spaces;
      return data;
    }
    const listsMatch = (a, b) => a.type === b.type && a.delimiter === b.delimiter && a.bulletChar === b.bulletChar;

    // --- what starts a new block here: 0 nothing, 1 a container (look again), 2 a leaf (the rest of the line is its)
    const starts = [
      function quote(container) {
        if (!indented && line[nextNonspace] === '>') {
          advanceNextNonspace(); advanceOffset(1, false);
          if (line[offset] === ' ' || line[offset] === '\t') advanceOffset(1, true);
          closeUnmatched(); addChild('block_quote'); return 1;
        }
        return 0;
      },
      function atx() {
        let m;
        if (!indented && (m = /^#{1,6}(?:[ \t]+|$)/.exec(line.slice(nextNonspace)))) {
          advanceNextNonspace(); advanceOffset(m[0].length, false); closeUnmatched();
          const h = addChild('heading'); h.level = m[0].trim().length;
          h.content = line.slice(offset).replace(/^[ \t]*#+[ \t]*$/, '').replace(/[ \t]+#+[ \t]*$/, '');
          advanceOffset(line.length - offset, false); return 2;
        }
        return 0;
      },
      function fence() {
        let m;
        if (!indented && (m = /^`{3,}(?!.*`)|^~{3,}/.exec(line.slice(nextNonspace)))) {
          const len = m[0].length; closeUnmatched();
          const b = addChild('code_block'); b.fenced = true; b.fenceLength = len; b.fenceChar = m[0][0]; b.fenceOffset = indent;
          advanceNextNonspace(); advanceOffset(len, false); return 2;
        }
        return 0;
      },
      function directive(container) {                           // {{prompt:id}} {{microscope:id}} {{deeper}} on a line of their own
        if (indented) return 0;
        const m = /^\{\{(?:(prompt|microscope):([\w-]+)|(deeper))\}\}[ \t]*$/.exec(line.slice(nextNonspace));
        if (!m) return 0;
        if (m[3]) {                                              // the fold: top level only (a list whose last item did not match is closed by it)
          for (let c = container; c; c = c.parent) if (c.type !== 'document' && c.type !== 'list') return 0;
        }
        closeUnmatched();
        const d = addChild('directive'); d.kind = m[1] || 'deeper'; d.id = m[2] || null;
        advanceOffset(line.length - offset, false); return 2;
      },
      function table(container) {                               // GFM table: the line above is the head, this line the "---|---" row
        if (indented || container.type !== 'paragraph') return 0;
        const rest = line.slice(nextNonspace);
        if (rest.indexOf('|') < 0 || !RE_DELIM_ROW.test(rest)) return 0;
        const ls = container.content.replace(/\n$/, '').split('\n');
        const head = splitRow(ls[ls.length - 1]), delim = splitRow(rest);
        if (head.length !== delim.length) return 0;
        closeUnmatched();
        ls.pop();
        if (ls.length) { container.content = ls.join('\n') + '\n'; finalize(container); } else { container.open = false; unlink(container); tip = container.parent; }
        const t = addChild('table');
        t.head = head; t.aligns = delim.map(c => (c[0] === ':' ? (c[c.length - 1] === ':' ? 'center' : 'left') : (c[c.length - 1] === ':' ? 'right' : null)));
        advanceOffset(line.length - offset, false); return 2;
      },
      function setext(container) {
        let m;
        if (!indented && container.type === 'paragraph' && (m = /^(?:=+|-+)[ \t]*$/.exec(line.slice(nextNonspace)))) {
          closeUnmatched();
          let used;
          while (container.content[0] === '[' && (used = refDefAt(container.content, refs))) container.content = container.content.slice(used);
          if (container.content.length > 0) {
            const h = mk('heading', container.parent); h.level = m[0][0] === '=' ? 1 : 2; h.content = container.content;
            const p = container.parent; p.children.splice(p.children.indexOf(container), 1, h);
            container.open = false; tip = h; h.open = true;
            advanceOffset(line.length - offset, false); return 2;
          }
        }
        return 0;
      },
      function thematic() {
        if (!indented && /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/.test(line.slice(nextNonspace))) {
          closeUnmatched(); addChild('thematic'); advanceOffset(line.length - offset, false); return 2;
        }
        return 0;
      },
      function listItem(container) {
        let data;
        if ((!indented || container.type === 'list') && (data = parseListMarker(container))) {
          closeUnmatched();
          if (tip.type !== 'list' || !listsMatch(tip.listData, data)) { const l = addChild('list'); l.listData = data; }
          const it = addChild('item'); it.listData = data; it.markerOffset = data.markerOffset; it.padding = data.padding; it.startLine = lineNo;
          return 1;
        }
        return 0;
      },
      function indentedCode() {
        if (indented && tip.type !== 'paragraph' && !blank) {
          advanceOffset(4, true); closeUnmatched(); addChild('code_block'); return 2;
        }
        return 0;
      }
    ];
    const MAYBE_SPECIAL = /^[#`~*+_=<>0-9{|:\-]/;

    for (const ln of lines) {
      lineNo++; line = ln; offset = 0; column = 0; blank = false; partialTab = false;
      let container = doc; oldtip = tip; allClosed = true;
      let last, matchedAll = true, consumed = false;
      while ((last = container.children[container.children.length - 1]) && last.open) {
        container = last;
        findNextNonspace();
        const r = cont(container);
        if (r === 1) { matchedAll = false; container = container.parent; break; }
        if (r === 2) { consumed = true; break; }
      }
      if (consumed) continue;
      allClosed = container === oldtip; lastMatched = container;
      let matchedLeaf = container.type !== 'paragraph' && accepts(container.type);
      while (!matchedLeaf) {
        findNextNonspace();
        if (!indented && !MAYBE_SPECIAL.test(line.slice(nextNonspace))) { advanceNextNonspace(); break; }
        let i = 0;
        for (; i < starts.length; i++) {
          const res = starts[i](container);
          if (res === 1) { container = tip; break; }
          if (res === 2) { container = tip; matchedLeaf = true; break; }
        }
        if (i === starts.length) { advanceNextNonspace(); break; }
      }
      if (!allClosed && !blank && tip.type === 'paragraph') addLine();      // lazy continuation of a paragraph
      else {
        closeUnmatched();
        if (blank && container.children.length) container.children[container.children.length - 1].lastLineBlank = true;
        const t = container.type;
        const lastBlank = blank && !(t === 'block_quote' || (t === 'code_block' && container.fenced) || (t === 'item' && !container.children.length && container.startLine === lineNo));
        for (let cn = container; cn; cn = cn.parent) cn.lastLineBlank = lastBlank;
        if (accepts(t)) addLine();
        else if (offset < line.length && !blank) { addChild('paragraph'); advanceNextNonspace(); addLine(); }
      }
    }
    while (tip) finalize(tip);
    return { doc, refs };
  }

  // ------------------------------------------------------------------ blocks -> HTML
  function renderBlocks(list, refs, ctx, tight) { return list.map(b => renderBlock(b, refs, ctx, tight)).filter(x => x !== '').join('\n'); }

  function renderBlock(b, refs, ctx, tight) {
    switch (b.type) {
      case 'paragraph': {
        const text = b.content.replace(/\s+$/, '');
        const nodes = parseInline(text, refs);
        if (!tight && nodes.length === 1 && nodes[0].t === 'image' && /^asset:[\w-]+$/.test(nodes[0].dest) && ctx.figure) {
          return ctx.figure(nodes[0].dest.slice(6), plain(nodes[0].kids), false);         // a picture alone on its line is a figure
        }
        const html = renderNodes(nodes, ctx);
        if (tight) return html;
        return /^\u{2192}/u.test(text) ? `<p class="links-line">${html}</p>` : `<p>${html}</p>`;
      }
      case 'heading': {
        const raw = b.content.trim();
        const html = renderNodes(parseInline(raw, refs), ctx);
        return ctx.heading ? ctx.heading(b.level, raw, html) : `<h${b.level}>${html}</h${b.level}>`;
      }
      case 'thematic': return '<hr>';
      case 'block_quote': { const inner = renderBlocks(b.children, refs, ctx, false); return '<blockquote>\n' + (inner ? inner + '\n' : '') + '</blockquote>'; }
      case 'code_block': {
        const lang = b.fenced && b.info ? b.info.split(/\s+/)[0].replace(/[^\w+#.\-]/g, '') : '';
        return `<pre class="code" tabindex="0"><code${lang ? ` class="language-${lang}"` : ''}>${esc(b.content)}</code></pre>`;
      }
      case 'list': {
        const ordered = b.listData.type === 'ordered';
        const tag = ordered ? 'ol' : 'ul';
        const start = ordered && b.listData.start !== 1 ? ` start="${b.listData.start}"` : '';
        return `<${tag}${start}>\n` + b.children.map(it => renderItem(it, refs, ctx, b.tight) + '\n').join('') + `</${tag}>`;
      }
      case 'table': {
        const al = i => (b.aligns[i] ? ` style="text-align:${b.aligns[i]}"` : '');
        const n = b.head.length;
        const cell = (c, i, row) => { const h = renderNodes(parseInline(c, refs), ctx); return (row && i === 0) ? `<th scope="row"${al(i)}>${h}</th>` : row ? `<td${al(i)}>${h}</td>` : `<th scope="col"${al(i)}>${h}</th>`; };
        const body = b.rows.map(r => { const cs = r.slice(0, n); while (cs.length < n) cs.push(''); return '<tr>' + cs.map((c, i) => cell(c, i, true)).join('') + '</tr>'; }).join('');
        return '<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table><thead><tr>' + b.head.map((c, i) => cell(c, i, false)).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>';
      }
      case 'directive':
        if (b.kind === 'prompt') return ctx.prompt ? ctx.prompt(b.id) : '';
        if (b.kind === 'microscope') return ctx.microscope ? ctx.microscope(b.id) : '';
        ctx._deeper = true;
        return '<details class="deeper"><summary>Go deeper</summary>';
    }
    return '';
  }

  function renderItem(it, refs, ctx, tight) {
    let box = null;
    const first = it.children[0];
    if (first && first.type === 'paragraph') {
      const m = /^\[( |x)\][ \t]+/.exec(first.content);
      if (m) { box = m[1]; first.content = first.content.slice(m[0].length); }
    }
    const body = it.children.map(c => renderBlock(c, refs, ctx, tight)).filter(x => x !== '').join('\n');
    if (box !== null) return `<li class="task"><span class="box" aria-hidden="true">${box === 'x' ? '\u{2713}' : ''}</span>${body}</li>`;
    return `<li>${body}</li>`;
  }

  function render(md, ctx) {
    ctx = ctx || {};
    const src = String(md).replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '\u{fffd}');
    const { doc, refs } = parseBlocks(src);
    let out = renderBlocks(doc.children, refs, ctx, false);
    if (ctx._deeper) { out += '\n</details>'; ctx._deeper = false; }
    return out;
  }

  window.MD = { render, inline, esc };
})();
