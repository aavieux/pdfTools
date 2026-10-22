import {
  $, apiBlob, apiJson, baseName, dropzone, esc, h, openPdfjs, readBytes, renderPage, showResult, toast, toolHeader, withBusy,
} from '../core.js';

/* Bookmark editor: rows with title, page and indent level. */
export function mount(root, tool) {
  root.innerHTML = `<div class="tool">${toolHeader(tool)}<div id="st" class="stack"></div></div>`;
  const st = $('#st', root);
  const start = () => st.replaceChildren(dropzone({ onFiles: ([f]) => load(f) }));

  async function load(file) {
    const data = await withBusy('Reading bookmarks…', () => apiJson('/api/bookmarks/get', { file }));
    if (!data) return;
    const doc = await openPdfjs(await readBytes(file), file.name);
    let items = data.bookmarks.map((b) => ({ ...b }));
    const ui = h(`<div class="cols">
        <div class="panel-box stack">
          <div class="row between"><b>📄 ${esc(file.name)}</b><span class="muted small">${trn(data.pages, '{n} page', '{n} pages')}</span></div>
          <table class="tbl"><thead><tr><th style="width:52%">${tr('Title')}</th><th>${tr('Page')}</th><th></th></tr></thead><tbody id="rows"></tbody></table>
          <div class="row"><button class="btn" id="add">${tr('＋ Add bookmark')}</button><button class="btn" id="auto">${tr('✨ One per page')}</button><button class="btn danger" id="clear">${tr('Remove all')}</button></div>
          <p class="note">${tr('psst~ use ⇥ / ⇤ to nest bookmarks inside each other ♡')}</p>
        </div>
        <div class="panel-box stack sticky-side">
          <div class="sheet-wrap" id="prev" style="min-height:200px"><p class="muted">${tr('Click a bookmark to see its page')}</p></div>
          <button class="btn primary big wide" id="save">${tr('Save bookmarks ♡')}</button>
        </div>
      </div>`);
    const result = h('<div></div>');
    st.replaceChildren(ui, result);
    const rows = $('#rows', ui);
    const preview = async (n) => {
      const p = await doc.getPage(Math.min(doc.numPages, Math.max(1, n)));
      const c = await renderPage(p, { width: 520 });
      c.style.width = '260px';
      $('#prev', ui).replaceChildren(c);
    };
    const draw = () => {
      rows.innerHTML = items.map((b, i) => `<tr data-i="${i}">
          <td><div class="row" style="padding-left:${(b.level - 1) * 18}px;flex-wrap:nowrap">${b.level > 1 ? '↳' : '🔖'}<input type="text" data-k="title" value="${esc(b.title)}"></div></td>
          <td><input type="number" data-k="page" min="1" max="${data.pages}" value="${b.page}" style="width:70px"></td>
          <td><div class="row" style="flex-wrap:nowrap">
            <button class="btn icon" data-a="out" title="${tr('Outdent')}">⇤</button><button class="btn icon" data-a="in" title="${tr('Indent')}">⇥</button>
            <button class="btn icon" data-a="up" title="${tr('Move up')}">↑</button><button class="btn icon" data-a="down" title="${tr('Move down')}">↓</button>
            <button class="btn icon" data-a="del" title="${tr('Delete')}">✕</button></div></td></tr>`).join('') || `<tr><td colspan="3" class="muted">${tr('No bookmarks yet ✿')}</td></tr>`;
    };
    rows.addEventListener('input', (e) => {
      const i = +e.target.closest('tr').dataset.i;
      const k = e.target.dataset.k;
      items[i][k] = k === 'page' ? parseInt(e.target.value, 10) || 1 : e.target.value;
      if (k === 'page') preview(items[i].page);
    });
    rows.addEventListener('focusin', (e) => { const row = e.target.closest('tr'); if (row?.dataset.i) preview(items[+row.dataset.i].page); });
    rows.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (!a) return;
      const i = +e.target.closest('tr').dataset.i;
      const b = items[i];
      if (a === 'in' && i > 0) b.level = Math.min(items[i - 1].level + 1, b.level + 1);
      if (a === 'out') b.level = Math.max(1, b.level - 1);
      if (a === 'up' && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
      if (a === 'down' && i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]];
      if (a === 'del') items.splice(i, 1);
      if (items[0]) items[0].level = 1;
      draw();
    });
    $('#add', ui).onclick = () => { items.push({ level: 1, title: tr('Chapter {n}', { n: items.length + 1 }), page: Math.min(data.pages, (items.at(-1)?.page || 0) + 1) }); draw(); rows.querySelector('tr:last-child input')?.select(); };
    $('#auto', ui).onclick = () => { items = [...Array(data.pages).keys()].map((i) => ({ level: 1, title: tr('Page {n}', { n: i + 1 }), page: i + 1 })); draw(); };
    $('#clear', ui).onclick = () => { if (!items.length || confirm(tr('Remove all bookmarks?'))) { items = []; draw(); } };
    $('#save', ui).onclick = async () => {
      if (items.some((b) => b.page < 1 || b.page > data.pages)) { toast(tr('Pages must be between 1 and {n}', { n: data.pages }), 'error'); return; }
      const out = await withBusy('Saving bookmarks…', async () => {
        const blob = await apiBlob('/api/bookmarks/set', { file, fields: { bookmarks: items } });
        return [{ name: `${baseName(file.name)}-bookmarked.pdf`, data: blob, type: 'application/pdf' }];
      });
      if (out) showResult(result, out, { again: start });
    };
    draw();
    preview(1);
  }
  start();
}
