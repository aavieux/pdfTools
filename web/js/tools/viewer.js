import { $, apiBlob, download, dropzone, esc, extOf, h, openPdfjs, readBytes, toolHeader, withBusy, zoomControls } from '../core.js';
import { PageView } from '../editor.js';

/* A comfy PDF reader with selectable text, search and bookmarks. Other files are converted on the NAS first. */
export function mount(root, tool) {
  root.innerHTML = `<div class="tool wide">${toolHeader(tool)}<div id="st" class="stack"></div></div>`;
  const st = $('#st', root);
  let view = null;
  const start = () => st.replaceChildren(dropzone({ accept: '*', title: 'Drop a PDF (or any document) to view ♡', onFiles: ([f]) => load(f) }));

  async function load(file) {
    const res = await withBusy(extOf(file.name) === 'pdf' ? 'Opening…' : 'Converting to PDF on your NAS…', async () => {
      let bytes;
      if (extOf(file.name) === 'pdf') bytes = await readBytes(file);
      else bytes = new Uint8Array(await (await apiBlob('/api/convert/to-pdf', { file })).arrayBuffer());
      return { bytes, doc: await openPdfjs(bytes, file.name) };
    });
    if (!res) return;
    const { bytes, doc } = res;
    const ui = h(`<div class="cols left">
        <div class="panel-box stack sticky-side" style="max-height:calc(100vh - 210px);overflow:auto">
          <div class="row"><input type="search" id="q" placeholder="${tr('Search…')}" style="flex:1"><button class="btn icon" id="prev" title="${tr('Previous')}">↑</button><button class="btn icon" id="next" title="${tr('Next')}">↓</button></div>
          <div class="muted small" id="hits"></div>
          <div id="results" class="stack" style="gap:4px"></div>
          <div id="outline"></div>
        </div>
        <div class="stack">
          <div class="panel-box row between">
            <div class="row"><b>📄 ${esc(file.name)}</b><span class="muted small">${trn(doc.numPages, '{n} page', '{n} pages')}</span></div>
            <div class="row">
              <span id="zoom"></span>
              <button class="btn" id="dl">${tr('⬇ Download PDF')}</button><button class="btn" id="other">${tr('Open another')}</button>
            </div>
          </div>
          <div class="viewer-wrap" id="area"></div>
        </div>
      </div>`);
    st.replaceChildren(ui);
    view?.destroy();
    view = new PageView($('#area', ui));
    let query = '';
    const texts = [];
    // Render a selectable text layer next to each canvas.
    const baseRender = view.renderPage.bind(view);
    view.renderPage = (p) => {
      baseRender(p);
      if (p.textScale === view.scale) return;
      p.textScale = view.scale;
      const scale = view.scale;
      (async () => {
        const page = await doc.getPage(p.index + 1);
        const content = texts[p.index] ||= await page.getTextContent();
        let layer = p.el.querySelector('.textLayer');
        if (layer) layer.remove();
        layer = document.createElement('div');
        layer.className = 'textLayer';
        layer.style.setProperty('--scale-factor', scale);
        p.el.appendChild(layer);
        const viewport = page.getViewport({ scale });
        const divs = [];
        await pdfjsLib.renderTextLayer({ textContentSource: content, container: layer, viewport, textDivs: divs }).promise;
        p.textDivs = divs;
        mark(p);
      })();
    };
    await view.open(doc);
    new ResizeObserver(() => { if (view.zoom === 'width') view.layout(); }).observe($('#area', ui));
    $('#zoom', ui).replaceWith(zoomControls(view));
    $('#dl', ui).onclick = () => download(bytes, file.name.replace(/\.[^.]+$/, '') + '.pdf', 'application/pdf');
    $('#other', ui).onclick = start;

    const mark = (p) => {
      for (const d of p.textDivs || []) {
        const t = d.textContent;
        if (!query || !t.toLowerCase().includes(query)) { if (d.querySelector('mark')) d.textContent = t; continue; }
        const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        d.innerHTML = esc(t).replace(re, (m) => `<span class="highlight">${m}</span>`);
      }
    };
    let hits = [];
    let cur = -1;
    const search = async () => {
      query = $('#q', ui).value.trim().toLowerCase();
      hits = [];
      cur = -1;
      $('#results', ui).replaceChildren();
      if (query.length >= 2) {
        for (let i = 0; i < doc.numPages; i++) {
          const content = texts[i] ||= await (await doc.getPage(i + 1)).getTextContent();
          const full = content.items.map((it) => it.str + (it.hasEOL ? ' ' : '')).join('');
          let k = full.toLowerCase().indexOf(query);
          while (k >= 0) {
            hits.push({ page: i, snippet: full.slice(Math.max(0, k - 30), k + query.length + 30) });
            k = full.toLowerCase().indexOf(query, k + query.length);
          }
        }
        $('#results', ui).append(...hits.slice(0, 200).map((hh, n) => {
          const b = h(`<button class="btn ghost" style="justify-content:flex-start;white-space:normal;text-align:left;border-radius:10px"><span class="muted small">${tr('p{n}', { n: hh.page + 1 })}</span> ${esc(hh.snippet)}</button>`);
          b.onclick = () => go(n);
          return b;
        }));
      }
      $('#hits', ui).textContent = query.length >= 2 ? trn(hits.length, '{n} result', '{n} results') : '';
      view.pages.forEach(mark);
    };
    const go = (n) => {
      if (!hits.length) return;
      cur = (n + hits.length) % hits.length;
      view.pages[hits[cur].page].el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#hits', ui).textContent = tr('{k} of {n}', { k: cur + 1, n: hits.length });
    };
    let t = 0;
    $('#q', ui).oninput = () => { clearTimeout(t); t = setTimeout(search, 250); };
    $('#q', ui).onkeydown = (e) => { if (e.key === 'Enter') go(cur + (e.shiftKey ? -1 : 1)); };
    $('#next', ui).onclick = () => go(cur + 1);
    $('#prev', ui).onclick = () => go(cur - 1);

    const outline = await doc.getOutline();
    if (outline?.length) {
      const box = $('#outline', ui);
      box.appendChild(h(`<h3 style="margin:8px 0 4px;color:var(--accent)">${tr('🔖 Bookmarks')}</h3>`));
      const add = (items, depth) => {
        for (const it of items) {
          const b = h(`<button class="btn ghost" style="justify-content:flex-start;padding-left:${8 + depth * 14}px;border-radius:10px;white-space:normal;text-align:left">${esc(it.title)}</button>`);
          b.onclick = async () => {
            let dest = it.dest;
            if (typeof dest === 'string') dest = await doc.getDestination(dest);
            if (!dest) return;
            const idx = typeof dest[0] === 'object' ? await doc.getPageIndex(dest[0]) : dest[0];
            view.pages[idx]?.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          };
          box.appendChild(b);
          if (it.items?.length) add(it.items, depth + 1);
        }
      };
      add(outline, 0);
    }
  }
  start();
  return () => view?.destroy();
}
