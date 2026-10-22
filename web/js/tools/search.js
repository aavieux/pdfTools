import { $, dropzone, esc, fileList, h, openPdfjs, readBytes, renderPage, toolHeader, withBusy, busyText } from '../core.js';

export function mount(root, tool) {
  root.innerHTML = `<div class="tool">${toolHeader(tool)}<div class="stack">
      <div class="panel-box stack">
        <div class="row"><input type="search" id="q" placeholder="${tr('What are you looking for?')}" style="flex:1;font-size:17px"><button class="btn primary big" id="go">${tr('Search ♡')}</button></div>
        <div class="row"><label class="field check"><input type="checkbox" id="case"><span>${tr('Match case')}</span></label><label class="field check"><input type="checkbox" id="word"><span>${tr('Whole words')}</span></label></div>
      </div>
      <div id="files"></div><div id="add"></div><div id="res" class="stack"></div><div id="pv"></div></div></div>`;
  const list = fileList({ sortable: false });
  $('#files', root).appendChild(list.el);
  $('#add', root).appendChild(dropzone({ multiple: true, compact: true, title: '＋ Add PDFs to search in', onFiles: (f) => list.add(f) }));
  const cache = new Map();

  const run = async () => {
    const q = $('#q', root).value.trim();
    const files = list.files();
    if (!q || !files.length) return;
    const flags = $('#case', root).checked ? 'gu' : 'giu';
    const pat = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Unicode-aware word edges (\b only knows Latin letters, so it would fail for Cyrillic).
    const re = new RegExp($('#word', root).checked ? `(?<![\\p{L}\\p{N}_])${pat}(?![\\p{L}\\p{N}_])` : pat, flags);
    const results = await withBusy('Searching…', async () => {
      const out = [];
      for (const f of files) {
        busyText('Searching…', f.name);
        if (!cache.has(f)) {
          const doc = await openPdfjs(await readBytes(f), f.name);
          const pages = [];
          for (let i = 0; i < doc.numPages; i++) {
            const c = await (await doc.getPage(i + 1)).getTextContent();
            pages.push(c.items.map((it) => it.str + (it.hasEOL ? ' ' : '')).join(''));
          }
          cache.set(f, { doc, pages });
        }
        const { doc, pages } = cache.get(f);
        const hits = [];
        pages.forEach((text, i) => {
          for (const m of text.matchAll(re)) hits.push({ page: i, snippet: [text.slice(Math.max(0, m.index - 50), m.index), m[0], text.slice(m.index + m[0].length, m.index + m[0].length + 50)] });
        });
        out.push({ f, doc, hits });
      }
      return out;
    });
    if (!results) return;
    const total = results.reduce((s, r) => s + r.hits.length, 0);
    const res = $('#res', root);
    res.replaceChildren(h(`<p class="note">${total ? trn(total, 'Found {n} match in {files} file(s) ✿', 'Found {n} matches in {files} file(s) ✿', { files: results.filter((r) => r.hits.length).length }) : tr('Nothing found 🙀 — scanned PDFs need “PDF OCR” first.')}</p>`));
    for (const r of results) {
      if (!r.hits.length) continue;
      const box = h(`<div class="panel-box stack"><b>📄 ${esc(r.f.name)} <span class="muted small">${trn(r.hits.length, '{n} match', '{n} matches')}</span></b></div>`);
      for (const hit of r.hits.slice(0, 100)) {
        const b = h(`<button class="btn ghost" style="justify-content:flex-start;white-space:normal;text-align:left;border-radius:12px"><span class="badge">${tr('p{n}', { n: hit.page + 1 })}</span> …${esc(hit.snippet[0])}<mark>${esc(hit.snippet[1])}</mark>${esc(hit.snippet[2])}…</button>`);
        b.onclick = async () => {
          const page = await r.doc.getPage(hit.page + 1);
          const c = await renderPage(page, { width: 1000 });
          // Highlight matching text items on the page image.
          const vp = page.getViewport({ scale: c.width / page.getViewport({ scale: 1 }).width });
          const ctx = c.getContext('2d');
          ctx.fillStyle = 'rgba(236,77,143,0.35)';
          const content = await page.getTextContent();
          for (const it of content.items) {
            if (!it.str || !new RegExp(re.source, re.flags.replace('g', '')).test(it.str)) continue;
            const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
            const hgt = Math.hypot(it.transform[2], it.transform[3]) * vp.scale;
            ctx.fillRect(x, y - hgt, it.width * vp.scale, hgt * 1.2);
          }
          c.style.width = '100%';
          c.style.maxWidth = '640px';
          $('#pv', root).replaceChildren(h(`<div class="panel-box stack"><b>${esc(r.f.name)} — ${tr('page {n}', { n: hit.page + 1 })}</b></div>`));
          $('#pv .panel-box', root).appendChild(c);
          $('#pv', root).scrollIntoView({ behavior: 'smooth' });
        };
        box.appendChild(b);
      }
      res.appendChild(box);
    }
  };
  $('#go', root).onclick = run;
  $('#q', root).onkeydown = (e) => { if (e.key === 'Enter') run(); };
}
