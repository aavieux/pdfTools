import {
  $, baseName, dropzone, esc, h, lazyThumb, openPdfLib, openPdfjs, readBytes, savePdf, showResult, toast, toolHeader, withBusy,
} from '../core.js';

/*
 * Several documents side by side. Drag pages within or between documents,
 * rotate/delete pages, add blank pages, then save each document or merge them all.
 */
export function mount(root, tool) {
  root.innerHTML = `<div class="tool wide">${toolHeader(tool)}
    <div class="stack">
      <div class="panel-box row between">
        <div class="row">
          <button class="btn" id="newDoc">＋ New empty document</button>
          <span class="muted small">Drag pages between documents ♡ hover a page to rotate or delete it</span>
        </div>
        <div class="row">
          <button class="btn" id="saveEach">Save each document</button>
          <button class="btn primary big" id="saveAll">Merge all into one ♡</button>
        </div>
      </div>
      <div id="dz"></div>
      <div class="docs-cols" id="cols"></div>
      <div id="result"></div>
    </div></div>`;
  const cols = $('#cols', root);
  const sources = []; // { bytes, name, pdfjs, lib }
  let docSeq = 0;

  const addColumn = (title) => {
    const col = h(`<div class="doc-col">
        <div class="row between"><input type="text" value="${esc(title)}" style="flex:1"><button class="btn icon" title="Remove document">✕</button></div>
        <div class="pages"></div>
        <div class="row"><button class="btn" data-blank>＋ Blank page</button><span class="muted small" data-count></span></div>
      </div>`);
    const pages = $('.pages', col);
    Sortable.create(pages, { group: 'pages', animation: 180, filter: 'button', onSort: counts });
    col.querySelector('.btn.icon').onclick = () => { col.remove(); counts(); };
    col.querySelector('[data-blank]').onclick = () => { pages.appendChild(pageCard({ blank: true, rot: 0 })); counts(); };
    cols.appendChild(col);
    return pages;
  };

  const pageCard = (p) => {
    const el = h(`<div class="pg sortable">
        <div class="pg-tools"><button data-t="rr" title="Rotate">⟳</button><button data-t="del" title="Delete">✕</button></div>
        <div class="pg-img" style="aspect-ratio:1">${p.blank ? '<div class="badge-blank">blank page</div>' : ''}</div>
        <div class="pg-num">${p.blank ? '—' : `${esc(sources[p.src].name.slice(0, 14))} p${p.index + 1}`}</div>
      </div>`);
    el._p = p;
    if (!p.blank) {
      const box = el.querySelector('.pg-img');
      lazyThumb(box, sources[p.src].pdfjs, p.index, { width: 110 });
      new MutationObserver(() => applyRot(el)).observe(box, { childList: true });
    }
    return el;
  };
  const applyRot = (el) => {
    const c = el.querySelector('canvas');
    if (c) { c.style.transform = `rotate(${el._p.rot}deg)`; c.style.maxHeight = el._p.rot % 180 ? '75%' : '100%'; }
  };
  const counts = () => cols.querySelectorAll('.doc-col').forEach((col) => {
    col.querySelector('[data-count]').textContent = `${col.querySelectorAll('.pg').length} pages`;
  });

  cols.addEventListener('click', (e) => {
    const b = e.target.closest('.pg-tools button');
    if (!b) return;
    const el = b.closest('.pg');
    if (b.dataset.t === 'del') { el.remove(); counts(); } else { el._p.rot = (el._p.rot + 90) % 360; applyRot(el); }
  });

  const addFiles = async (files) => {
    await withBusy('Opening…', async () => {
      for (const f of files) {
        const bytes = await readBytes(f);
        const pdfjs = await openPdfjs(bytes, f.name);
        const src = sources.push({ bytes, name: f.name, pdfjs }) - 1;
        const pages = addColumn(baseName(f.name));
        for (let i = 0; i < pdfjs.numPages; i++) pages.appendChild(pageCard({ src, index: i, rot: 0 }));
      }
      counts();
    });
  };
  $('#dz', root).appendChild(dropzone({ multiple: true, compact: true, title: '＋ Add PDF documents', onFiles: addFiles }));
  $('#newDoc', root).onclick = () => { addColumn(`New document ${++docSeq}`); counts(); };

  const build = async (pageEls) => {
    const out = await PDFLib.PDFDocument.create();
    for (const el of pageEls) {
      const p = el._p;
      if (p.blank) {
        const prev = out.getPageCount() ? out.getPage(out.getPageCount() - 1).getSize() : { width: 595.28, height: 841.89 };
        const pg = out.addPage([prev.width, prev.height]);
        if (p.rot) pg.setRotation(PDFLib.degrees(p.rot));
        continue;
      }
      const s = sources[p.src];
      s.lib ||= await openPdfLib(s.bytes, s.name);
      const [pg] = await out.copyPages(s.lib, [p.index]);
      if (p.rot) pg.setRotation(PDFLib.degrees((pg.getRotation().angle + p.rot) % 360));
      out.addPage(pg);
    }
    return savePdf(out);
  };

  const columns = () => [...cols.querySelectorAll('.doc-col')].map((col) => ({
    name: col.querySelector('input').value.trim() || 'document',
    pages: [...col.querySelectorAll('.pg')],
  })).filter((c) => c.pages.length);

  $('#saveEach', root).onclick = async () => {
    const list = columns();
    if (!list.length) { toast('Add some documents first ♡', 'error'); return; }
    const outputs = await withBusy('Saving…', async () => {
      const res = [];
      for (const c of list) res.push({ name: `${c.name}.pdf`, data: await build(c.pages), type: 'application/pdf' });
      return res;
    });
    if (outputs) showResult($('#result', root), outputs);
  };
  $('#saveAll', root).onclick = async () => {
    const list = columns();
    if (!list.length) { toast('Add some documents first ♡', 'error'); return; }
    const outputs = await withBusy('Merging…', async () => [{ name: `${list[0].name}-assembled.pdf`, data: await build(list.flatMap((c) => c.pages)), type: 'application/pdf' }]);
    if (outputs) showResult($('#result', root), outputs);
  };
}
