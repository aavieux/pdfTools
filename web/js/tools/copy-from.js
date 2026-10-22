import { $, apiJson, canvasToBlob, download, dropzone, esc, h, openPdfjs, readBytes, renderPage, toast, toolHeader, withBusy } from '../core.js';
import { PageView } from '../editor.js';

/** Copy text even without a secure context (plain http on the NAS). */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function toDisplay(page, [x1, y1, x2, y2]) {
  const [vx1, vy1, vx2, vy2] = page.view;
  const norm = (px, py) => {
    const u0 = (px - vx1) / (vx2 - vx1);
    const v0 = (vy2 - py) / (vy2 - vy1);
    switch (page.rot) {
      case 90: return [1 - v0, u0];
      case 180: return [1 - u0, 1 - v0];
      case 270: return [v0, 1 - u0];
      default: return [u0, v0];
    }
  };
  const a = norm(x1, y1);
  const b = norm(x2, y2);
  return { l: Math.min(a[0], b[0]), t: Math.min(a[1], b[1]), r: Math.max(a[0], b[0]), b: Math.max(a[1], b[1]) };
}

export function mount(root, tool) {
  root.innerHTML = `<div class="tool wide">${toolHeader(tool)}<div id="st" class="stack"></div></div>`;
  const st = $('#st', root);
  let view = null;
  st.appendChild(dropzone({ onFiles: ([f]) => load(f) }));

  async function load(file) {
    const res = await withBusy('Finding paragraphs, tables and pictures…', async () => {
      const blocks = await apiJson('/api/blocks', { file });
      const doc = await openPdfjs(await readBytes(file), file.name);
      return { blocks, doc };
    });
    if (!res) return;
    const { blocks, doc } = res;
    const ui = h(`<div class="cols">
        <div class="viewer-wrap" id="area"></div>
        <div class="panel-box stack sticky-side">
          <p class="note sticky">${tr('Hover the page and click a {p}, {t} or {i} to copy it ✿', { p: `<b style="color:#2563eb">${tr('paragraph')}</b>`, t: `<b style="color:#16a34a">${tr('table')}</b>`, i: `<b style="color:#ec4d8f">${tr('picture')}</b>` })}</p>
          <h3 style="margin:0;color:var(--accent)">${tr('♡ Last copied')}</h3>
          <div id="last" class="muted small">${tr('nothing yet')}</div>
          <button class="btn" id="all">${tr('📋 Copy all text')}</button>
        </div>
      </div>`);
    st.replaceChildren(ui);
    view?.destroy();
    view = new PageView($('#area', ui));
    await view.open(doc);
    new ResizeObserver(() => view.layout()).observe($('#area', ui));
    const colors = { text: '37,99,235', table: '22,163,74', image: '236,77,143' };
    blocks.pages.forEach((list, i) => {
      const page = view.pages[i];
      for (const b of list) {
        const r = toDisplay(page, b.rect);
        const el = h(`<div class="obj" style="left:${r.l * 100}%;top:${r.t * 100}%;width:${(r.r - r.l) * 100}%;height:${(r.b - r.t) * 100}%;cursor:copy;border-radius:3px" title="${tr({ text: 'Click to copy this paragraph', table: 'Click to copy this table', image: 'Click to copy this picture' }[b.type])}"></div>`);
        el.onmouseenter = () => { el.style.background = `rgba(${colors[b.type]},.15)`; el.style.outline = `2px solid rgba(${colors[b.type]},.7)`; };
        el.onmouseleave = () => { el.style.background = ''; el.style.outline = ''; };
        el.onclick = async () => {
          if (b.type === 'image') {
            const p = await doc.getPage(i + 1);
            const full = await renderPage(p, { scale: 3 });
            const c = document.createElement('canvas');
            c.width = Math.round((r.r - r.l) * full.width);
            c.height = Math.round((r.b - r.t) * full.height);
            c.getContext('2d').drawImage(full, -r.l * full.width, -r.t * full.height);
            const blob = await canvasToBlob(c, 'image/png');
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              toast('Picture copied ♡');
            } catch {
              download(blob, `picture-page${i + 1}.png`);
              toast('Your browser only allows copying pictures over https — I downloaded it instead ♡');
            }
            $('#last', ui).replaceChildren(Object.assign(c, { style: 'max-width:100%;border-radius:8px' }));
            return;
          }
          const text = b.type === 'table' ? b.rows.map((row) => row.map((c) => String(c).replace(/\s+/g, ' ')).join('\t')).join('\n') : b.text;
          if (await copyText(text)) toast(b.type === 'table' ? 'Table copied — paste it into Excel ♡' : 'Text copied ♡');
          $('#last', ui).innerHTML = b.type === 'table'
            ? `<table class="tbl">${b.rows.slice(0, 8).map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`
            : `<div style="white-space:pre-wrap;color:var(--text)">${esc(text.slice(0, 600))}</div>`;
        };
        page.layer.appendChild(el);
      }
    });
    $('#all', ui).onclick = async () => {
      const text = blocks.pages.map((list) => list.filter((b) => b.type !== 'image').map((b) => (b.type === 'table' ? b.rows.map((r) => r.join('\t')).join('\n') : b.text)).join('\n\n')).join('\n\n');
      if (await copyText(text)) toast('All text copied ♡');
    };
  }
  return () => view?.destroy();
}
