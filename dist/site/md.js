// Letterman's Markdown reader. Ordinary Markdown plus the Academy's conventions:
//   ![alt](asset:id)   a visual, drawn from module.json assets[] with its credit
//   [text](asset:id)   an outbound link, drawn from assets[] (opens in a new tab)
//   {{prompt:id}}      a prompt, on a line of its own
//   {{microscope:id}}  an "Under a microscope" fold, on a line of its own (standard 1.3.0, §4c)
// Nothing here knows about any one module.
(function () {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function inline(text, ctx) {
    let s = esc(text);
    // images first (inline image inside a paragraph is rare; block images are handled in block())
    s = s.replace(/!\[([^\]]*)\]\(asset:([\w-]+)\)/g, (_, alt, id) => ctx.figure(id, alt, true));
    s = s.replace(/\[([^\]]+)\]\(asset:([\w-]+)\)/g, (_, t, id) => ctx.link(id, t));
    s = s.replace(/\[([^\]]+)\]\(term:([\w-]+)\)/g, (_, t, id) => ctx.term ? ctx.term(id, t) : t);   // the course glossary
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}<span class="sr-only"> (opens a new tab)</span></a>`);
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;])/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');   // bold may hold *italics*
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    return s;
  }

  function block(md, ctx) {
    const src = md.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n');
    const lines = src.split('\n');
    const out = [];
    let i = 0;
    const isList = l => /^\s{0,3}([-*]|\d+\.)\s+/.test(l);
    while (i < lines.length) {
      let l = lines[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = l.match(/^\{\{prompt:([\w-]+)\}\}\s*$/))) { out.push(ctx.prompt(m[1])); i++; continue; }
      if ((m = l.match(/^\{\{microscope:([\w-]+)\}\}\s*$/))) { out.push(ctx.microscope ? ctx.microscope(m[1]) : ''); i++; continue; } // 1.3.0, standard §4c
      if ((m = l.match(/^\{\{deeper\}\}\s*$/))) { out.push('<details class="deeper"><summary>Go deeper</summary>'); ctx._deeper = true; i++; continue; } // r3, ready
      if ((m = l.match(/^(#{1,4})\s+(.*)$/))) {
        const lvl = m[1].length, t = m[2];
        out.push(ctx.heading(lvl, t, inline(t, ctx)));
        i++; continue;
      }
      if (/^\s*---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
      if ((m = l.match(/^!\[([^\]]*)\]\(asset:([\w-]+)\)\s*$/))) { out.push(ctx.figure(m[2], m[1], false)); i++; continue; }
      if (/^\|/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        const cells = r => r.replace(/^\||\|\s*$/g, '').split('|').map(c => c.trim());
        const head = cells(rows[0]);
        const body = rows.slice(2).map(cells);
        out.push('<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table><thead><tr>' + head.map(h => `<th scope="col">${inline(h, ctx)}</th>`).join('') +
          '</tr></thead><tbody>' + body.map(r => '<tr>' + r.map((c, k) => k === 0 ? `<th scope="row">${inline(c, ctx)}</th>` : `<td>${inline(c, ctx)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }
      if (/^>\s?/.test(l)) {
        const q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push('<blockquote>' + block(q.join('\n'), ctx) + '</blockquote>');
        continue;
      }
      if (isList(l)) {
        const ordered = /^\s{0,3}\d+\./.test(l);
        const items = [];
        while (i < lines.length && (isList(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          const t = lines[i];
          if (isList(t)) items.push(t.replace(/^\s{0,3}([-*]|\d+\.)\s+/, ''));
          else items[items.length - 1] += '\n' + t.trim();
          i++;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>` + items.map(it => {
          const box = it.match(/^\[( |x)\]\s+(.*)$/s);
          const body = inline(box ? box[2] : it, ctx).replace(/\n/g, '<br>');
          return box ? `<li class="task"><span class="box" aria-hidden="true">${box[1] === 'x' ? '✓' : ''}</span>${body}</li>` : `<li>${body}</li>`;
        }).join('') + `</${tag}>`);
        continue;
      }
      // paragraph
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\{\{|\||>|\s*---+\s*$|!\[)/.test(lines[i]) && !isList(lines[i])) { para.push(lines[i].trim()); i++; }
      if (!para.length) { para.push(lines[i].trim()); i++; }
      const t = para.join(' ');
      out.push(/^→/.test(t) ? `<p class="links-line">${inline(t, ctx)}</p>` : `<p>${inline(t, ctx)}</p>`);
    }
    if (ctx._deeper) { out.push('</details>'); ctx._deeper = false; }
    return out.join('\n');
  }

  window.MD = { render: (md, ctx) => block(md, ctx), inline, esc };
})();
