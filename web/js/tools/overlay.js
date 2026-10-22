import {
  $, PAGES_FIELDS, baseName, dropzone, esc, h, openPdfLib, optionsForm, pagesFromChoice, readBytes, renderPage, savePdf, showResult, toast, toolHeader, withBusy,
} from '../core.js';
import { embedUpright, pageGeom, sendLastStreamToBack } from '../pdfgeom.js';

/* Lay the pages of an overlay PDF (e.g. letterhead) over or behind a base PDF. */
export function mount(root, tool) {
  root.innerHTML = `<div class="tool">${toolHeader(tool)}
    <div class="cols">
      <div class="stack">
        <div class="panel-box stack"><h3 style="margin:0;color:var(--accent)">${tr('1. Your document')}</h3><div id="base"></div></div>
        <div class="panel-box stack"><h3 style="margin:0;color:var(--accent)">${tr('2. Overlay / letterhead PDF')}</h3><div id="over"></div></div>
        <div class="panel-box stack"><h3 style="margin:0;color:var(--accent)">${tr('♡ Preview')}</h3><div class="sheet-wrap" id="prev"><p class="muted">${tr('Choose both PDFs ✿')}</p></div></div>
      </div>
      <div class="panel-box stack sticky-side" id="opts"><h3 style="margin:0;color:var(--accent)">${tr('♡ Options')}</h3></div>
    </div><div id="result"></div></div>`;
  const files = { base: null, over: null };
  const slot = (key, el) => {
    const set = (f) => {
      files[key] = f;
      el.replaceChildren(h(`<div class="row between"><span>📄 ${esc(f.name)}</span><button class="btn">${tr('Change')}</button></div>`));
      el.querySelector('button').onclick = () => el.replaceChildren(dz);
      preview();
    };
    const dz = dropzone({ compact: true, title: key === 'base' ? 'Drop your PDF' : 'Drop the overlay PDF', onFiles: ([f]) => set(f) });
    el.appendChild(dz);
  };
  slot('base', $('#base', root));
  slot('over', $('#over', root));
  const form = optionsForm([
    { name: 'layer', label: 'Put the overlay', type: 'radio', value: 'front', options: [['front', 'On top'], ['back', 'Behind (like paper)']] },
    { name: 'repeat', label: 'If the overlay has fewer pages', type: 'select', value: 'last', options: [['last', 'Repeat its last page'], ['cycle', 'Start again from its first page'], ['first', 'Always use its first page'], ['stop', 'Stop overlaying']] },
    { name: 'fit', label: 'Overlay size', type: 'radio', value: 'stretch', options: [['stretch', 'Match each page'], ['keep', 'Keep its own size']] },
    { name: 'opacity', label: 'Opacity', type: 'range', value: 100, min: 5, max: 100, unit: '%' },
    ...PAGES_FIELDS,
  ], () => preview());
  const go = h(`<button class="btn primary big wide">${tr('Overlay PDFs ♡')}</button>`);
  $('#opts', root).append(form.el, go);

  async function build(previewOnly) {
    const v = form.values();
    const doc = await openPdfLib(await readBytes(files.base), files.base.name);
    const ov = await openPdfLib(await readBytes(files.over), files.over.name);
    if (previewOnly) while (doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
    const chosen = new Set(pagesFromChoice(v.pages, v.range, doc.getPageCount()));
    const n = ov.getPageCount();
    const cache = new Map();
    for (const [i, page] of doc.getPages().entries()) {
      if (!chosen.has(i)) continue;
      let k = v.repeat === 'first' ? 0 : i;
      if (k >= n) {
        if (v.repeat === 'stop') continue;
        k = v.repeat === 'cycle' ? i % n : n - 1;
      }
      if (!cache.has(k)) cache.set(k, await embedUpright(doc, ov.getPage(k)));
      const emb = cache.get(k);
      const g = pageGeom(page);
      const w = v.fit === 'stretch' ? g.width : emb.width;
      const hh = v.fit === 'stretch' ? g.height : emb.height;
      emb.draw(page, { x: (g.width - w) / 2, y: (g.height - hh) / 2, width: w, height: hh, opacity: v.opacity / 100 });
      if (v.layer === 'back') sendLastStreamToBack(page);
    }
    return savePdf(doc);
  }
  let seq = 0;
  async function preview() {
    if (!files.base || !files.over) return;
    const my = ++seq;
    try {
      const bytes = await build(true);
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const c = await renderPage(await pdf.getPage(1), { width: 900 });
      c.style.width = '440px';
      c.style.maxWidth = '100%';
      if (my === seq) $('#prev', root).replaceChildren(c);
    } catch (e) { $('#prev', root).innerHTML = `<p class="muted">${esc(trMsg(e.message))}</p>`; }
  }
  go.onclick = async () => {
    if (!files.base || !files.over) { toast('Choose both PDFs first ♡', 'error'); return; }
    const out = await withBusy('Overlaying…', async () => [{ name: `${baseName(files.base.name)}-overlay.pdf`, data: await build(false), type: 'application/pdf' }]);
    if (out) showResult($('#result', root), out);
  };
}
