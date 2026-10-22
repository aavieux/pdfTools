import {
  $, baseName, dropzone, esc, h, lazyThumb, openPdfLib, openPdfjs, parseRange, readBytes, savePdf, showResult, toast, toolHeader, withBusy,
} from '../core.js';

/*
 * One page board for: rearrange, remove, extract and rotate.
 * Each page card keeps { index, rot, sel, removed }.
 */
const MODES = {
  rearrange: { save: 'Save new order', tip: 'Drag pages around to put them in a new order ♡' },
  remove: { save: 'Remove marked pages', tip: 'Click the pages you want to throw away 🗑️' },
  extract: { save: 'Extract selected pages', tip: 'Click the pages you want to keep in a new PDF ✿' },
  rotate: { save: 'Save rotation', tip: 'Hover a page and press ⟳, or select some pages and rotate them together' },
};

export function mount(root, tool) {
  const mode = tool.opts.mode;
  const cfg = MODES[mode];
  root.innerHTML = `<div class="tool wide">${toolHeader(tool)}<div class="stack" id="st"></div></div>`;
  const st = $('#st', root);

  const start = () => {
    st.replaceChildren(dropzone({ onFiles: ([f]) => load(f) }));
  };

  async function load(file) {
    const bytes = await readBytes(file);
    const doc = await withBusy('Opening…', () => openPdfjs(bytes, file.name));
    if (!doc) return;
    const cards = [...Array(doc.numPages).keys()].map((i) => ({ index: i, rot: 0, sel: false, removed: false }));
    const bar = h(`<div class="panel-box row between">
        <div class="row" id="bar"></div>
        <button class="btn primary big" id="save">${esc(tr(cfg.save))} ♡</button>
      </div>`);
    const grid = h('<div class="pages"></div>');
    const result = h('<div></div>');
    st.replaceChildren(bar, h(`<p class="note">${esc(tr(cfg.tip))} · ${trn(doc.numPages, '{n} page', '{n} pages')}</p>`), grid, result);

    const barEl = $('#bar', bar);
    const tools = {
      rearrange: `<button class="btn" data-a="reverse">${tr('⇅ Reverse order')}</button><button class="btn" data-a="reset">${tr('↺ Original order')}</button><button class="btn" data-a="del-sel">${tr('🗑️ Delete selected')}</button>`,
      remove: `<input type="text" id="rng" placeholder="${tr('or type pages, e.g. 2, 5-7')}"><button class="btn" data-a="mark">${tr('Mark')}</button><button class="btn" data-a="invert">${tr('Invert')}</button><button class="btn" data-a="clear">${tr('Clear')}</button>`,
      extract: `<input type="text" id="rng" placeholder="${tr('or type pages, e.g. 1-3, 8')}"><button class="btn" data-a="mark">${tr('Select')}</button><button class="btn" data-a="all">${trc('select', 'All')}</button><button class="btn" data-a="clear">${trc('select', 'None')}</button>
                <label class="field check"><input type="checkbox" id="separate"><span>${tr('One file per page')}</span></label>`,
      rotate: `<button class="btn" data-a="rl">${tr('⟲ Left')}</button><button class="btn" data-a="rr">${tr('⟳ Right')}</button><button class="btn" data-a="r180">↻ 180°</button>
               <span class="muted small" id="rotScope">${tr('all pages')}</span><button class="btn" data-a="all">${tr('Select all')}</button><button class="btn" data-a="clear">${tr('Select none')}</button><button class="btn" data-a="reset">${tr('↺ Reset')}</button>`,
    }[mode];
    barEl.innerHTML = tools;

    const draw = () => {
      grid.replaceChildren();
      for (const c of cards) {
        const el = h(`<div class="pg ${mode === 'rearrange' ? 'sortable' : 'selectable'}${c.sel ? ' sel' : ''}${c.removed ? ' removed' : ''}">
            <div class="pg-tools">
              ${mode !== 'remove' && mode !== 'extract' ? `<button data-t="rr" title="${tr('Rotate')}">⟳</button>` : ''}
              ${mode === 'rearrange' ? `<button data-t="del" title="${tr('Delete')}">✕</button>` : ''}
            </div>
            <div class="pg-img" style="aspect-ratio:1"></div>
            <div class="pg-num">${c.index + 1}${c.rot ? ` · ${c.rot}°` : ''}</div>
          </div>`);
        el._card = c;
        const box = el.querySelector('.pg-img');
        lazyThumb(box, doc, c.index, { width: 150 });
        new MutationObserver(() => applyRot(el)).observe(box, { childList: true });
        grid.appendChild(el);
      }
    };
    const applyRot = (el) => {
      const canvas = el.querySelector('canvas');
      if (canvas) {
        canvas.style.transform = `rotate(${el._card.rot}deg)`;
        canvas.style.maxHeight = el._card.rot % 180 ? '75%' : '100%';
      }
      el.querySelector('.pg-num').textContent = `${el._card.index + 1}${el._card.rot ? ` · ${el._card.rot}°` : ''}`;
      el.classList.toggle('sel', el._card.sel);
      el.classList.toggle('removed', el._card.removed);
    };
    const refresh = () => {
      [...grid.children].forEach(applyRot);
      if (mode === 'rotate') $('#rotScope', bar).textContent = cards.some((c) => c.sel) ? tr('{n} selected', { n: cards.filter((c) => c.sel).length }) : tr('all pages');
    };
    draw();

    if (mode === 'rearrange') {
      Sortable.create(grid, {
        animation: 180,
        filter: 'button',
        onEnd: () => {
          const order = [...grid.children].map((el) => el._card);
          cards.splice(0, cards.length, ...order);
        },
      });
    }

    grid.addEventListener('click', (e) => {
      const el = e.target.closest('.pg');
      if (!el) return;
      const c = el._card;
      const t = e.target.closest('button')?.dataset.t;
      if (t === 'rr') c.rot = (c.rot + 90) % 360;
      else if (t === 'del') { cards.splice(cards.indexOf(c), 1); el.remove(); return; }
      else if (mode === 'remove') c.removed = !c.removed;
      else c.sel = !c.sel;
      refresh();
    });

    barEl.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (!a) return;
      const targets = cards.some((c) => c.sel) ? cards.filter((c) => c.sel) : cards;
      try {
        switch (a) {
          case 'reverse': cards.reverse(); draw(); return;
          case 'reset': cards.sort((x, y) => x.index - y.index); cards.forEach((c) => { c.rot = 0; c.sel = false; }); draw(); return;
          case 'del-sel': {
            if (!cards.some((c) => c.sel)) { toast('Click some pages first to select them ♡', 'error'); return; }
            const keep = cards.filter((c) => !c.sel);
            cards.splice(0, cards.length, ...keep);
            draw();
            return;
          }
          case 'mark': {
            const idx = new Set(parseRange($('#rng', bar).value, doc.numPages));
            cards.forEach((c) => { if (idx.has(c.index)) { if (mode === 'remove') c.removed = true; else c.sel = true; } });
            break;
          }
          case 'invert': cards.forEach((c) => { c.removed = !c.removed; }); break;
          case 'all': cards.forEach((c) => { c.sel = true; }); break;
          case 'clear': cards.forEach((c) => { c.sel = false; c.removed = false; }); break;
          case 'rl': targets.forEach((c) => { c.rot = (c.rot + 270) % 360; }); break;
          case 'rr': targets.forEach((c) => { c.rot = (c.rot + 90) % 360; }); break;
          case 'r180': targets.forEach((c) => { c.rot = (c.rot + 180) % 360; }); break;
          default:
        }
      } catch (err) { toast(err.message, 'error'); }
      refresh();
    });

    $('#save', bar).onclick = async () => {
      let chosen = cards;
      if (mode === 'remove') chosen = cards.filter((c) => !c.removed);
      if (mode === 'extract') chosen = cards.filter((c) => c.sel);
      if (!chosen.length) { toast(mode === 'extract' ? 'Select at least one page ♡' : 'You can’t remove every page ♡', 'error'); return; }
      const separate = mode === 'extract' && $('#separate', bar).checked;
      const outputs = await withBusy('Saving…', async () => {
        const src = await openPdfLib(bytes, file.name);
        const build = async (list) => {
          const out = await PDFLib.PDFDocument.create();
          const pages = await out.copyPages(src, list.map((c) => c.index));
          pages.forEach((p, k) => {
            if (list[k].rot) p.setRotation(PDFLib.degrees((p.getRotation().angle + list[k].rot) % 360));
            out.addPage(p);
          });
          return savePdf(out);
        };
        if (separate) {
          const res = [];
          for (const c of chosen) res.push({ name: `${baseName(file.name)}-page${c.index + 1}.pdf`, data: await build([c]), type: 'application/pdf' });
          return res;
        }
        const suffix = { rearrange: 'reordered', remove: 'trimmed', extract: 'extract', rotate: 'rotated' }[mode];
        return [{ name: `${baseName(file.name)}-${suffix}.pdf`, data: await build(chosen), type: 'application/pdf' }];
      });
      if (outputs) showResult(result, outputs, { again: start });
    };
  }

  start();
}
