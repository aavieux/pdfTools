import {
  $, baseName, busyText, esc, h, lazyThumb, openPdfLib, openPdfjs, parseRange, readBytes, savePdf, simpleTool, toast,
} from '../core.js';

async function pagesToPdf(src, indices) {
  const out = await PDFLib.PDFDocument.create();
  (await out.copyPages(src, indices)).forEach((p) => out.addPage(p));
  return savePdf(out);
}

/** Top-level bookmarks → page indices where each chapter starts. */
async function chapterStarts(bytes, name) {
  const doc = await openPdfjs(bytes, name);
  const outline = (await doc.getOutline()) || [];
  const starts = [];
  for (const item of outline) {
    try {
      let dest = item.dest;
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (!dest) continue;
      const idx = typeof dest[0] === 'object' ? await doc.getPageIndex(dest[0]) : dest[0];
      starts.push({ idx, title: item.title });
    } catch { /* ignore broken bookmarks */ }
  }
  return starts.sort((a, b) => a.idx - b.idx);
}

/* One colour per document in the page picker (kept by document, so deleting one doesn't recolour the rest). */
const COLORS = ['#3b82f6', '#f97316', '#22a35a', '#8b5cf6', '#ca8a04', '#14b8a6', '#ef4444', '#ec4899', '#a16207', '#64748b'];

/** Sorted page indices → "1-3, 5". */
function rangeText(idx) {
  const parts = [];
  for (let i = 0; i < idx.length; i++) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    parts.push(j > i ? `${idx[i] + 1}-${idx[j] + 1}` : `${idx[i] + 1}`);
    i = j;
  }
  return parts.join(', ');
}

/**
 * Page overview for "Pick the pages myself": start a document, click its pages, finish it and give it a name,
 * then start the next one. Every document has its own colour. groups() gives [{ idx, name }] in document order.
 */
function pagePicker(file) {
  const base = baseName(file.name);
  const el = h(`<div class="panel-box stack">
      <div class="row between"><h3 style="margin:0;color:var(--accent)">${tr('♡ Pages')}</h3><span class="muted small" data-free></span></div>
      <div class="row split-ctl"></div>
      <div class="split-docs"></div>
      <div class="pages"><p class="muted">${tr('Opening…')}</p></div>
    </div>`);
  const ctl = $('.split-ctl', el);
  const list = $('.split-docs', el);
  const grid = $('.pages', el);

  let owner = []; // page index → id of the document it is in, or -1
  const docs = []; // { id, name }
  let nextId = 0;
  let active = null; // document whose pages are being picked
  let naming = false; // picking done, asking for its name
  let isNew = false;
  let before = []; // owner before `active` was started, for Cancel
  let last = -1; // last clicked page, for shift-click

  const color = (d) => COLORS[d.id % COLORS.length];
  const pagesOf = (d) => [...owner.keys()].filter((i) => owner[i] === d.id);
  const num = (d) => docs.indexOf(d) + 1;

  const drawCtl = () => {
    if (!active) {
      ctl.innerHTML = `<button class="btn primary" data-a="start">${tr('＋ Start document {n}', { n: docs.length + 1 })}</button>
        <span class="muted small">${tr(docs.length ? 'Pick the pages of the next document, or press “Split PDF” when you are done ✿' : 'Press the button, then click the pages that belong in the first PDF ✿')}</span>`;
    } else if (!naming) {
      ctl.innerHTML = `<span class="split-dot" style="--g:${color(active)}"></span><b>${tr('Document {n}', { n: num(active) })}</b>
        <button class="btn primary" data-a="finish">${tr('✓ Finish document {n}', { n: num(active) })}</button>
        <button class="btn" data-a="cancel">${tr('Cancel')}</button>
        <span class="muted small hint">${tr('click its pages (shift-click for a run of pages) · {k} picked', { k: pagesOf(active).length })}</span>`;
    } else {
      ctl.innerHTML = `<span class="split-dot" style="--g:${color(active)}"></span>
        <label class="field" style="flex:1;min-width:200px"><span>${tr('Name for document {n}', { n: num(active) })}</span><input type="text" data-name value="${esc(active.name)}"></label>
        <button class="btn primary" data-a="save">${tr('Save name ♡')}</button>
        <button class="btn" data-a="back">${tr('← Back to its pages')}</button>`;
      const input = $('[data-name]', ctl);
      input.focus();
      input.select();
    }
  };

  const drawList = () => {
    list.replaceChildren(...docs.map((d) => {
      const idx = pagesOf(d);
      const row = h(`<div class="split-doc${d === active ? ' on' : ''}" style="--g:${color(d)}">
          <span class="split-dot">${num(d)}</span>
          ${d === active ? `<b>${esc(d.name)}</b>` : `<input type="text" value="${esc(d.name)}" title="${esc(tr('Rename'))}">`}
          <span class="muted small">${idx.length ? `${trn(idx.length, '{n} page', '{n} pages')}: ${rangeText(idx)}` : tr('no pages yet')}</span>
          ${active ? '' : `<button class="btn" data-a="edit">${tr('✎ Pages')}</button><button class="btn" data-a="del" title="${esc(tr('Delete'))}">✕</button>`}
        </div>`);
      row._doc = d;
      return row;
    }));
  };

  const paint = () => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    for (const pg of grid.children) {
      const d = byId.get(owner[pg._i]);
      pg.classList.toggle('grp', !!d);
      pg.classList.toggle('cur', !!d && d === active);
      pg.classList.toggle('selectable', !!active);
      pg.style.setProperty('--g', d ? color(d) : '');
      const badge = $('.split-badge', pg);
      badge.hidden = !d;
      badge.textContent = d ? num(d) : '';
    }
    const free = owner.filter((o) => !byId.has(o)).length;
    $('[data-free]', el).textContent = free ? trn(free, '{n} page not in any document', '{n} pages not in any document') : tr('every page is in a document ✿');
  };

  const draw = () => { drawCtl(); drawList(); paint(); };

  const begin = (d, fresh) => {
    before = owner.slice();
    isNew = fresh;
    active = d;
    naming = false;
    last = -1;
    draw();
  };
  const end = () => { active = null; naming = false; draw(); };

  ctl.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'start') {
      const d = { id: nextId++, name: `${base}-part${docs.length + 1}` };
      docs.push(d);
      begin(d, true);
    } else if (a === 'finish') {
      if (!pagesOf(active).length) { toast('Click at least one page for this document ♡', 'error'); return; }
      naming = true;
      drawCtl();
    } else if (a === 'cancel') {
      owner = before;
      if (isNew) docs.splice(docs.indexOf(active), 1);
      end();
    } else if (a === 'back') {
      naming = false;
      drawCtl();
    } else if (a === 'save') {
      end();
    }
  });
  ctl.addEventListener('input', (e) => { if (e.target.matches('[data-name]')) active.name = e.target.value; });
  ctl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-name]')) { e.preventDefault(); end(); } });

  list.addEventListener('input', (e) => { const row = e.target.closest('.split-doc'); if (row) row._doc.name = e.target.value; });
  list.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    const d = e.target.closest('.split-doc')?._doc;
    if (!a || !d) return;
    if (a === 'edit') begin(d, false);
    if (a === 'del') {
      owner = owner.map((o) => (o === d.id ? -1 : o));
      docs.splice(docs.indexOf(d), 1);
      draw();
    }
  });

  grid.addEventListener('click', (e) => {
    const pg = e.target.closest('.pg');
    if (!pg) return;
    if (!active) { toast(tr('Press “{b}” first ♡', { b: tr('＋ Start document {n}', { n: docs.length + 1 }) }), 'error'); return; }
    const i = pg._i;
    if (e.shiftKey && last >= 0) {
      for (let k = Math.min(last, i); k <= Math.max(last, i); k++) owner[k] = active.id;
    } else {
      owner[i] = owner[i] === active.id ? -1 : active.id;
    }
    last = i;
    if (naming) naming = false;
    draw();
  });

  (async () => {
    try {
      const doc = await openPdfjs(await readBytes(file), file.name);
      owner = Array(doc.numPages).fill(-1);
      grid.replaceChildren(...owner.map((_, i) => {
        const pg = h(`<div class="pg"><span class="split-badge" hidden></span><div class="pg-img"></div><div class="pg-num">${i + 1}</div></div>`);
        pg._i = i;
        lazyThumb($('.pg-img', pg), doc, i, { width: 150 });
        return pg;
      }));
      draw();
    } catch (err) {
      grid.innerHTML = `<p class="muted">${esc(trMsg(err.message))}</p>`;
    }
  })();

  return {
    el,
    /** The documents to write; a document still being picked counts too. */
    groups() {
      if (active) {
        if (isNew && !pagesOf(active).length) docs.splice(docs.indexOf(active), 1);
        end();
      }
      return docs.map((d, k) => ({ idx: pagesOf(d), name: d.name, fallback: `${base}-part${k + 1}` })).filter((g) => g.idx.length);
    },
  };
}

export function mount(root, tool) {
  let picker = null;
  simpleTool(root, {
    tool,
    manyOutputs: true,
    actionLabel: 'Split PDF',
    busyText: 'Splitting…',
    fields: [
      { name: 'mode', label: 'How should I split it?', type: 'select', value: 'pick', options: [
        ['pick', 'Pick the pages myself'], ['each', 'Every page into its own PDF'], ['n', 'Every N pages'], ['ranges', 'By page ranges'],
        ['at', 'Split after specific pages'], ['oddeven', 'Odd and even pages'], ['half', 'In two halves'],
        ['bookmarks', 'By chapters (top-level bookmarks)']] },
      { name: 'n', label: 'Pages per file', type: 'number', value: 2, min: 1, show: (v) => v.mode === 'n' },
      { name: 'ranges', label: 'Ranges (one file each)', type: 'text', placeholder: 'e.g. 1-3; 4-10; 11-', hint: 'Separate files with ; — within a file use commas, e.g. 1-2,5; 3-4', show: (v) => v.mode === 'ranges' },
      { name: 'at', label: 'Split after page(s)', type: 'text', placeholder: 'e.g. 3, 7', show: (v) => v.mode === 'at' },
    ],
    extraLeft(form, [file]) {
      picker = pagePicker(file);
      const sync = () => { picker.el.hidden = form.values().mode !== 'pick'; };
      form.el.addEventListener('change', sync);
      sync();
      return picker.el;
    },
    async run([file], v) {
      const bytes = await readBytes(file);
      const src = await openPdfLib(bytes, file.name);
      const count = src.getPageCount();
      const name = baseName(file.name);
      const all = [...Array(count).keys()];
      let groups = [];
      switch (v.mode) {
        case 'pick':
          groups = picker.groups();
          if (!groups.length) throw new Error(tr('Start a document and click its pages first ♡'));
          break;
        case 'each': groups = all.map((i) => ({ idx: [i], label: `page${i + 1}` })); break;
        case 'n': {
          const n = Math.max(1, Math.floor(v.n || 1));
          for (let i = 0; i < count; i += n) groups.push({ idx: all.slice(i, i + n), label: `pages${i + 1}-${Math.min(count, i + n)}` });
          break;
        }
        case 'ranges':
          groups = (v.ranges || '').split(';').map((s) => s.trim()).filter(Boolean)
            .map((s) => ({ idx: parseRange(s, count), label: `pages${s.replace(/[^0-9-]+/g, '_')}` }));
          if (!groups.length) throw new Error(tr('Please type some ranges, e.g. 1-3; 4-6'));
          break;
        case 'at': {
          const cuts = [...new Set(parseRange(v.at || '', count))].sort((a, b) => a - b).filter((i) => i < count - 1);
          let prev = 0;
          for (const c of [...cuts, count - 1]) { groups.push({ idx: all.slice(prev, c + 1), label: `pages${prev + 1}-${c + 1}` }); prev = c + 1; }
          break;
        }
        case 'oddeven':
          groups = [{ idx: all.filter((i) => i % 2 === 0), label: 'odd' }, { idx: all.filter((i) => i % 2 === 1), label: 'even' }].filter((g) => g.idx.length);
          break;
        case 'half': {
          const m = Math.ceil(count / 2);
          groups = [{ idx: all.slice(0, m), label: 'part1' }, { idx: all.slice(m), label: 'part2' }].filter((g) => g.idx.length);
          break;
        }
        case 'bookmarks': {
          const starts = await chapterStarts(bytes, file.name);
          if (!starts.length) throw new Error(tr('This PDF has no bookmarks to split by 🙀'));
          if (starts[0].idx > 0) starts.unshift({ idx: 0, title: 'start' });
          starts.forEach((s, k) => {
            const end = k + 1 < starts.length ? starts[k + 1].idx : count;
            if (end > s.idx) groups.push({ idx: all.slice(s.idx, end), label: s.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) || `part${k + 1}` });
          });
          break;
        }
        default:
      }
      const outputs = [];
      const used = new Set();
      for (const [k, g] of groups.entries()) {
        busyText(tr('Writing file {k} of {n}…', { k: k + 1, n: groups.length }));
        // Picked documents carry the name typed for them; two with the same name get (2), (3), …
        const wanted = g.name === undefined ? `${name}-${g.label}`
          : g.name.replace(/[\\/:*?"<>|]+/g, '').replace(/\.pdf$/i, '').trim().slice(0, 120) || g.fallback;
        let stem = wanted;
        for (let n = 2; used.has(stem.toLowerCase()); n++) stem = `${wanted} (${n})`;
        used.add(stem.toLowerCase());
        outputs.push({ name: `${stem}.pdf`, data: await pagesToPdf(src, g.idx), type: 'application/pdf' });
      }
      return outputs;
    },
  });
}
