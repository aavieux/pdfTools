import {
  $, PAGE_SIZES, baseName, busyText, canvasToBlob, dropzone, esc, extOf, h, openPdfjs, optionsForm, readBytes, renderPage, savePdf,
  showResult, toast, toolHeader, withBusy,
} from '../core.js';
import { IMAGE_EXT, decode } from '../imagepdf.js';
import { detectPage, enhance, guessMode, orderCorners, rng, warp, warpSize } from '../scanfx.js';

/*
 * Make it look scanned: photos (JPG, PNG, HEIC, WEBP, …) and PDF pages become a clean,
 * scanner-like PDF, the way the Notes app's document scanner does it. Every page is
 * straightened along the paper's edges (found automatically, adjustable by dragging the
 * corners), shadows and uneven light are removed and the paper turns white.
 * Pages can be reordered, rotated, removed and given their own look.
 *
 * A page: { id, name, kind, natural: [w, h], pt, load(scale), preview, small, rot, corners, guess, mode, seed }
 *   natural – size of the source at scale 1 (pixels for photos, points for PDF pages), before `rot`
 *   corners – the page's corners in 0–1 of the rotated picture, or null for the whole picture
 *   mode    – this page's own look, or null to follow the options
 */
const PREVIEW = 900; // longest side of the picture used for editing corners
const SMALL = 380; // … and for the thumbnails and the automatic checks
const MODES = [['auto', '✨ Auto'], ['color', '🎨 Colour'], ['gray', '◐ Grayscale'], ['bw', '◼ Black & white'], ['photo', '🖼️ Photo']];
const MODE_NAME = Object.fromEntries(MODES);

const isImage = (f) => IMAGE_EXT.has(extOf(f.name));
const ACCEPT = `.pdf,${[...IMAGE_EXT].filter((x) => x !== 'svg').map((x) => `.${x}`).join(',')}`;

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Draw `src` (image or canvas) scaled so its longest side is at most `max` px. */
function scaled(src, max) {
  const w = src.naturalWidth || src.width;
  const hh = src.naturalHeight || src.height;
  const k = Math.min(1, max / Math.max(w, hh));
  const c = canvasOf(w * k, hh * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function rotated(src, rot) {
  if (!rot) return src;
  const side = rot % 180 !== 0;
  const c = canvasOf(side ? src.height : src.width, side ? src.width : src.height);
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

const pixels = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
function toCanvas(img) {
  const c = canvasOf(img.width, img.height);
  c.getContext('2d').putImageData(img instanceof ImageData ? img : new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

/** Rotate the page, then cut it out along its corners and straighten it. */
function cutOut(p, src) {
  const r = rotated(src, p.rot);
  if (!p.corners) return pixels(r);
  const q = p.corners.map(([x, y]) => [x * r.width, y * r.height]);
  const [w, hh] = warpSize(q);
  return warp(pixels(r), q, w, hh);
}

const lookOf = (p, v) => p.mode || (v.mode === 'auto' ? p.guess : v.mode);

/** The finished page: cut out, cleaned up and (if asked) made to look a little crooked. */
function scanPage(p, src, v) {
  const img = enhance(cutOut(p, src), {
    mode: lookOf(p, v), clean: v.clean, brightness: v.brightness, contrast: v.contrast, sharpen: v.sharpen,
    threshold: v.threshold, grain: v.feel ? v.grain : 0, seed: p.seed,
  });
  const c = toCanvas(img);
  if (!v.feel || !v.tilt) return c;
  const angle = ((rng(p.seed + 1)() * 2 - 1) * v.tilt * Math.PI) / 180;
  const out = canvasOf(c.width, c.height);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(angle);
  ctx.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

/** Turn corners (and the guessed look) along with the picture when a page is rotated by 90° steps. */
function turnCorners(corners, by) {
  if (!corners) return null;
  let pts = corners;
  for (let k = 0; k < ((by / 90) % 4 + 4) % 4; k++) pts = pts.map(([x, y]) => [1 - y, x]);
  return orderCorners(pts);
}

const FULL = [[0, 0], [1, 0], [1, 1], [0, 1]];
const isFull = (q) => q.every(([x, y], i) => Math.abs(x - FULL[i][0]) < 0.005 && Math.abs(y - FULL[i][1]) < 0.005);

export function mount(root, tool) {
  root.innerHTML = `<div class="tool wide">${toolHeader(tool)}<div class="stack" id="st"></div></div>`;
  const st = $('#st', root);
  let pages = [];
  let firstName = 'scan';
  let seq = 0;
  let timer = 0;
  let editor = null; // the open page editor, if any
  const pdfDocs = [];

  const form = optionsForm([
    { name: 'mode', label: 'Look', type: 'radio', value: 'auto', options: MODES,
      hint: 'Auto picks Colour, Grayscale or Photo for every page by itself.' },
    { name: 'clean', label: 'Clean-up (white paper, no shadows)', type: 'range', value: 70, min: 0, max: 100, unit: '%' },
    { name: 'threshold', label: 'Black & white: how much turns black', type: 'range', value: 50, min: 0, max: 100, show: (v) => v.mode === 'bw' || pages.some((p) => p.mode === 'bw') },
    { name: 'brightness', label: 'Brightness', type: 'range', value: 0, min: -50, max: 50 },
    { name: 'contrast', label: 'Contrast', type: 'range', value: 10, min: -50, max: 50 },
    { name: 'sharpen', label: 'Sharpen text', type: 'range', value: 30, min: 0, max: 100 },
    { name: 'feel', label: 'Make it look like a real scan (a little crooked, paper grain)', type: 'checkbox', value: false },
    { name: 'tilt', label: 'Crooked by up to', type: 'range', value: 0.8, min: 0, max: 3, step: 0.1, unit: '°', show: (v) => v.feel },
    { name: 'grain', label: 'Paper grain', type: 'range', value: 25, min: 0, max: 100, show: (v) => v.feel },
    { name: 'auto', label: 'Find the page edges in new photos automatically', type: 'checkbox', value: true },
    { name: 'size', label: 'Page size', type: 'select', value: 'auto', options: [['auto', 'Auto (A4, or the PDF’s own size)'], ['A4', 'A4'], ['Letter', 'Letter'], ['A5', 'A5'], ['fit', 'Same as the picture']] },
    { name: 'dpi', label: 'Sharpness', type: 'select', value: '200', options: [['150', '150 dpi · small file'], ['200', '200 dpi · good'], ['300', '300 dpi · sharpest']] },
    { name: 'quality', label: 'Quality', type: 'range', value: 80, min: 40, max: 95, unit: '%' },
  ], () => schedule());

  const start = () => {
    pages = [];
    editor?.close();
    pdfDocs.splice(0).forEach((d) => d.destroy());
    st.replaceChildren(
      dropzone({ accept: ACCEPT, multiple: true, title: 'Drop photos or PDFs here ♡', hint: 'JPG, PNG, HEIC, WEBP, TIFF, … and PDFs — every picture and page becomes a scanned page ✿', onFiles: (f) => addFiles(f, true) }),
      h(`<p class="note sticky">${tr('Snap your documents with your phone, drop the photos here and I’ll straighten them and make them look freshly scanned — like the Notes app does ✿')}</p>`),
    );
  };

  /* ---------- Loading ---------- */

  async function pagesFromFile(file, auto) {
    const out = [];
    const add = (p) => {
      p.small = scaled(p.preview, SMALL);
      p.rot = 0;
      p.mode = null;
      p.seed = Math.floor(Math.random() * 1e9);
      p.id = Math.random().toString(36).slice(2);
      p.corners = auto ? detectPage(pixels(p.small)) : null;
      p.guess = guessMode(cutOut(p, p.small));
      out.push(p);
    };
    if (extOf(file.name) === 'pdf') {
      const doc = await openPdfjs(await readBytes(file), file.name);
      pdfDocs.push(doc);
      for (let i = 0; i < doc.numPages; i++) {
        busyText(tr('Reading page {k} of {n}…', { k: i + 1, n: doc.numPages }), file.name);
        const page = await doc.getPage(i + 1);
        const vp = page.getViewport({ scale: 1, rotation: page.rotate });
        const preview = await renderPage(page, { scale: PREVIEW / Math.max(vp.width, vp.height) });
        add({ kind: 'pdf', name: `${file.name} · ${i + 1}`, natural: [vp.width, vp.height], pt: [vp.width, vp.height], preview,
          load: (scale) => renderPage(page, { scale, maxPixels: 40e6 }) });
      }
    } else {
      busyText('Reading your photos…', file.name);
      const frames = await decode(file);
      frames.forEach(({ img }, k) => {
        add({ kind: 'image', name: frames.length > 1 ? `${file.name} · ${k + 1}` : file.name, natural: [img.naturalWidth || img.width, img.naturalHeight || img.height], pt: null,
          preview: scaled(img, PREVIEW), load: async (scale) => scaled(img, scale * Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height)) });
      });
    }
    return out;
  }

  async function addFiles(files, fresh) {
    if (fresh) firstName = baseName(files[0].name);
    const auto = form.values().auto;
    const added = await withBusy('Reading your files…', async () => {
      const out = [];
      for (const f of files) {
        try { out.push(...await pagesFromFile(f, auto)); } catch (e) { toast(`${f.name}: ${trMsg(e.message)}`, 'error'); }
      }
      return out;
    });
    if (!added?.length) { if (fresh) start(); return; }
    if (fresh) { pages = added; layout(); } else { pages.push(...added); drawGrid(); }
    const found = added.filter((p) => p.corners).length;
    if (found) toast(tr('Found the paper’s edges on {n} of {total} page(s) ✂️', { n: found, total: added.length }));
  }

  /* ---------- Board ---------- */

  let grid; let result; let countEl;
  function layout() {
    const bar = h(`<div class="panel-box row between">
        <div class="row">
          <button class="btn" data-a="detect" title="${esc(tr('Look for the paper’s edges on every page again'))}">${tr('✨ Find edges on all pages')}</button>
          <button class="btn" data-a="whole">${tr('⬜ Use whole pages')}</button>
          <button class="btn" data-a="rotate">${tr('⟳ Rotate all')}</button>
          <button class="btn" data-a="reverse">${tr('⇅ Reverse order')}</button>
        </div>
        <span class="muted small" id="count"></span>
      </div>`);
    grid = h('<div class="pages scan-pages"></div>');
    result = h('<div></div>');
    const more = dropzone({ accept: ACCEPT, multiple: true, compact: true, title: '＋ Add more photos or PDFs', onFiles: (f) => addFiles(f, false) });
    const go = h(`<button class="btn primary big wide">${tr('Make scanned PDF ♡')}</button>`);
    const cols = h(`<div class="cols">
        <div class="stack" id="left"></div>
        <div class="panel-box stack sticky-side scan-opts" id="right"><h3 style="margin:0;color:var(--accent)">${tr('♡ Options')}</h3></div>
      </div>`);
    $('#left', cols).append(bar, h(`<p class="note">${tr('Drag pages to change the order · click a page to move its corners or give it its own look')}</p>`), grid, more);
    $('#right', cols).append(form.el, go);
    st.replaceChildren(cols, result);
    countEl = $('#count', bar);

    bar.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      if (a === 'detect') {
        let found = 0;
        for (const p of pages) { p.corners = detectPage(pixels(rotated(p.small, p.rot))); if (p.corners) found++; p.guess = guessMode(cutOut(p, p.small)); }
        toast(found ? tr('Found the paper’s edges on {n} of {total} page(s) ✂️', { n: found, total: pages.length }) : tr('No paper edges found — the whole pages are used'), found ? '' : 'error');
      }
      if (a === 'whole') pages.forEach((p) => { p.corners = null; p.guess = guessMode(cutOut(p, p.small)); });
      if (a === 'rotate') pages.forEach((p) => { p.rot = (p.rot + 90) % 360; p.corners = turnCorners(p.corners, 90); });
      if (a === 'reverse') pages.reverse();
      drawGrid();
    });

    Sortable.create(grid, {
      animation: 180,
      filter: 'button',
      onEnd: () => {
        const order = [...grid.children].map((el) => el.dataset.id);
        pages.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
        renumber();
      },
    });
    grid.addEventListener('click', (e) => {
      const el = e.target.closest('.pg');
      if (!el) return;
      const p = pages.find((x) => x.id === el.dataset.id);
      const t = e.target.closest('button')?.dataset.t;
      if (t === 'del') {
        pages = pages.filter((x) => x !== p);
        el.remove();
        if (!pages.length) { start(); return; }
        renumber();
        return;
      }
      if (t === 'rr') { p.rot = (p.rot + 90) % 360; p.corners = turnCorners(p.corners, 90); drawThumb(p); return; }
      openEditor(p);
    });

    go.onclick = () => save();
    drawGrid();
  }

  const label = (p, i) => `${i + 1} · ${tr(MODE_NAME[lookOf(p, form.values())].replace(/^\S+ /, ''))}${!p.mode && form.values().mode === 'auto' ? ` <span class="muted">${tr('(auto)')}</span>` : ''}${p.corners ? ' ✂️' : ''}`;

  function renumber() {
    [...grid.children].forEach((el, i) => { $('.pg-num', el).innerHTML = label(pages[i], i); });
    countEl.textContent = trn(pages.length, '{n} page', '{n} pages');
    form.refresh(); // e.g. the black & white slider shows when a page is black & white
  }

  function drawGrid() {
    grid.replaceChildren(...pages.map((p) => {
      const el = h(`<div class="pg sortable" data-id="${p.id}" title="${esc(p.name)}">
          <div class="pg-tools">
            <button data-t="edit" title="${esc(tr('Corners & look'))}">✎</button>
            <button data-t="rr" title="${esc(tr('Rotate'))}">⟳</button>
            <button data-t="del" title="${esc(tr('Delete'))}">✕</button>
          </div>
          <div class="pg-img"></div>
          <div class="pg-num"></div>
        </div>`);
      p.el = el;
      return el;
    }));
    renumber();
    schedule(0);
  }

  function drawThumb(p) {
    if (!p.el?.isConnected) return;
    const c = scanPage(p, p.small, form.values());
    $('.pg-img', p.el).replaceChildren(c);
    $('.pg-num', p.el).innerHTML = label(p, pages.indexOf(p));
  }

  /** Redraw every thumbnail (and the open editor) after a change, one page at a time so the page stays responsive. */
  function schedule(delay = 200) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const my = ++seq;
      editor?.refresh();
      for (const p of [...pages]) {
        await new Promise((r) => requestAnimationFrame(r));
        if (my !== seq) return;
        drawThumb(p);
      }
    }, delay);
  }

  /* ---------- One page: corners and look ---------- */

  function openEditor(p) {
    editor?.close();
    const dlg = h(`<dialog class="settings scan-editor" aria-label="${esc(tr('Corners & look'))}">
      <form method="dialog" class="stack">
        <div class="row between"><h2>✂️ ${tr('Page {k}', { k: pages.indexOf(p) + 1 })} <span class="muted small" id="pname"></span></h2>
          <div class="row"><button type="button" class="btn icon" data-a="prev" title="${esc(tr('Previous page'))}">‹</button><button type="button" class="btn icon" data-a="next" title="${esc(tr('Next page'))}">›</button>
          <button class="btn icon" value="close" title="${esc(tr('Close'))}">✕</button></div></div>
        <div class="scan-edit">
          <div class="stack">
            <p class="muted small">${tr('Drag the dots onto the corners of the paper.')}</p>
            <div class="corner-stage" id="stage"><svg id="poly"><polygon></polygon></svg></div>
            <div class="row">
              <button type="button" class="btn" data-a="detect">${tr('✨ Find edges')}</button>
              <button type="button" class="btn" data-a="whole">${tr('⬜ Whole picture')}</button>
              <button type="button" class="btn" data-a="rl">${tr('⟲ Left')}</button>
              <button type="button" class="btn" data-a="rr">${tr('⟳ Right')}</button>
            </div>
          </div>
          <div class="stack">
            <p class="muted small">${tr('Result')}</p>
            <div class="scan-result" id="res"></div>
            <label class="field"><span>${tr('Look of this page')}</span><select id="pmode"></select></label>
            <button type="button" class="btn" data-a="all">${tr('Use this look for every page')}</button>
          </div>
        </div>
        <div class="row end"><button class="btn primary" value="close">${tr('Done ♡')}</button></div>
      </form>
    </dialog>`);
    document.body.appendChild(dlg);
    const stage = $('#stage', dlg);
    const poly = $('#poly polygon', dlg);
    let pic = null;
    let handles = [];
    let previewTimer = 0;

    const pts = () => p.corners || FULL;
    const place = () => {
      const q = pts();
      handles.forEach((hd, i) => { hd.style.left = `${q[i][0] * 100}%`; hd.style.top = `${q[i][1] * 100}%`; });
      const w = pic.clientWidth; const hh = pic.clientHeight;
      poly.setAttribute('points', q.map(([x, y]) => `${x * w},${y * hh}`).join(' '));
    };
    const preview = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        const c = scanPage(p, p.preview, form.values());
        $('#res', dlg).replaceChildren(c);
      }, 60);
    };
    const show = () => {
      $('h2', dlg).firstChild.textContent = `✂️ ${tr('Page {k}', { k: pages.indexOf(p) + 1 })} `;
      $('#pname', dlg).textContent = p.name;
      pic = rotated(p.preview, p.rot);
      pic.className = 'corner-pic';
      stage.querySelector('canvas')?.remove();
      stage.prepend(pic);
      handles.forEach((hd) => hd.remove());
      handles = [0, 1, 2, 3].map((i) => {
        const hd = h(`<span class="corner" data-i="${i}" tabindex="0" role="slider" aria-label="${esc(tr(['Top-left corner', 'Top-right corner', 'Bottom-right corner', 'Bottom-left corner'][i]))}"></span>`);
        stage.appendChild(hd);
        return hd;
      });
      const guess = `${tr('Like the other pages')} (${tr(MODE_NAME[form.values().mode === 'auto' ? p.guess : form.values().mode].replace(/^\S+ /, ''))})`;
      $('#pmode', dlg).innerHTML = `<option value="">${esc(guess)}</option>${MODES.filter(([k]) => k !== 'auto').map(([k, l]) => `<option value="${k}"${p.mode === k ? ' selected' : ''}>${esc(tr(l))}</option>`).join('')}`;
      requestAnimationFrame(place);
      preview();
    };
    const changed = () => {
      p.guess = guessMode(cutOut(p, p.small));
      place();
      preview();
      drawThumb(p);
    };

    // Dragging a corner.
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      const hd = e.target.closest('.corner');
      if (!hd) return;
      e.preventDefault();
      hd.setPointerCapture(e.pointerId);
      drag = { i: +hd.dataset.i, q: pts().map((pt) => [...pt]) };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = pic.getBoundingClientRect();
      drag.q[drag.i] = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
      p.corners = drag.q;
      place();
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      // Corners dragged past each other are put back in order; the full picture means “no cut”.
      p.corners = isFull(p.corners) ? null : orderCorners(p.corners);
      changed();
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    // Arrow keys nudge a focused corner.
    stage.addEventListener('keydown', (e) => {
      const hd = e.target.closest('.corner');
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!hd || !d) return;
      e.preventDefault();
      const q = pts().map((pt) => [...pt]);
      const step = e.shiftKey ? 0.02 : 0.004;
      const i = +hd.dataset.i;
      q[i] = [Math.min(1, Math.max(0, q[i][0] + d[0] * step)), Math.min(1, Math.max(0, q[i][1] + d[1] * step))];
      p.corners = isFull(q) ? null : q;
      changed();
    });

    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) { dlg.close(); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      const i = pages.indexOf(p);
      if (a === 'prev' || a === 'next') {
        const next = pages[i + (a === 'prev' ? -1 : 1)];
        if (next) { p = next; show(); }
        return;
      }
      if (a === 'detect') {
        p.corners = detectPage(pixels(rotated(p.small, p.rot)));
        if (!p.corners) toast('No page edges found — the whole picture is used', 'error');
      }
      if (a === 'whole') p.corners = null;
      if (a === 'rl' || a === 'rr') {
        const by = a === 'rr' ? 90 : 270;
        p.rot = (p.rot + by) % 360;
        p.corners = turnCorners(p.corners, by);
        show();
      }
      if (a === 'all') {
        const look = p.mode || (form.values().mode === 'auto' ? p.guess : form.values().mode);
        pages.forEach((x) => { x.mode = null; });
        form.set('mode', look);
        schedule(0);
        toast(tr('Every page now uses {look}', { look: tr(MODE_NAME[look].replace(/^\S+ /, '')) }));
        return;
      }
      changed();
    });
    $('#pmode', dlg).addEventListener('change', (e) => { p.mode = e.target.value || null; preview(); drawThumb(p); form.refresh(); });
    const onResize = () => place();
    window.addEventListener('resize', onResize);
    dlg.addEventListener('close', () => { window.removeEventListener('resize', onResize); dlg.remove(); if (editor?.dlg === dlg) editor = null; });
    editor = { dlg, refresh: preview, close: () => dlg.close() };
    dlg.showModal();
    show();
  }

  /* ---------- Saving ---------- */

  async function save() {
    if (!pages.length) { toast('Add a photo or PDF first ♡', 'error'); return; }
    const v = form.values();
    const dpi = Number(v.dpi);
    const out = await withBusy('Scanning your pages…', async () => {
      const doc = await PDFLib.PDFDocument.create();
      for (const [k, p] of pages.entries()) {
        busyText(tr('Scanning page {k} of {n}…', { k: k + 1, n: pages.length }), p.name);
        let scale;
        if (p.kind === 'pdf') scale = dpi / 72;
        else {
          // Photos: just enough pixels for an A4 page at the chosen sharpness.
          const [w, hh] = p.rot % 180 ? [p.natural[1], p.natural[0]] : p.natural;
          const [qw, qh] = p.corners ? warpSize(p.corners.map(([x, y]) => [x * w, y * hh])) : [w, hh];
          scale = Math.min(1, (11.69 * dpi) / Math.max(qw, qh));
        }
        const src = await p.load(scale);
        const c = scanPage(p, src, v);
        src.width = src.height = 0; // let the browser have its memory back
        const bytes = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', v.quality / 100)).arrayBuffer());
        const image = await doc.embedJpg(bytes);
        const land = c.width > c.height;
        let pw; let ph; let dw; let dh;
        if (v.size === 'fit') {
          [pw, ph] = [(c.width * 72) / dpi, (c.height * 72) / dpi];
          [dw, dh] = [pw, ph];
        } else {
          let box;
          if (v.size === 'auto' && p.pt) box = p.rot % 180 ? [p.pt[1], p.pt[0]] : p.pt;
          else {
            box = PAGE_SIZES[v.size === 'auto' ? 'A4' : v.size];
            if (land) box = [box[1], box[0]];
          }
          const s = Math.min(box[0] / c.width, box[1] / c.height);
          [dw, dh] = [c.width * s, c.height * s];
          // Auto: the page is exactly the scanned sheet; a chosen size keeps white around it.
          [pw, ph] = v.size === 'auto' ? [dw, dh] : box;
        }
        doc.addPage([pw, ph]).drawImage(image, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
        c.width = c.height = 0;
      }
      doc.setTitle(firstName);
      doc.setProducer("Maria's PDF Tools");
      return [{ name: `${firstName}-scanned.pdf`, data: await savePdf(doc), type: 'application/pdf' }];
    });
    if (out) {
      showResult(result, out, {
        again: start,
        extra: `<p class="muted small">${tr('Tip: open it in “PDF OCR” (What next? below) to make the text searchable and copyable ✿')}</p>`,
      });
    }
  }

  start();
  return () => { editor?.close(); pdfDocs.forEach((d) => d.destroy()); };
}
