import { Handoff, busy, busyText, celebrate, continueWith, done, onZoomGesture, toast } from '../core.js';

/*
 * Crop PDF — page-by-page cropping with undo/redo, auto-detect, rotation and
 * apply-to-pages. (The original standalone cropper, mounted as a tool.)
 */
const MARKUP = `<div class="crop-tool"><div class="ctoolbar">

    <button id="btnOpen" class="btn" title="${tr('Open PDF (Ctrl+O)')}">${tr('Open PDF')}</button>
    <input id="fileInput" type="file" accept="application/pdf,.pdf" hidden>
    <span id="fileName" class="file-name"></span>

    <div class="group">
      <button id="btnUndo" class="btn icon" title="${tr('Undo (Ctrl+Z)')}" disabled>
        <svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/></svg>
      </button>
      <button id="btnRedo" class="btn icon" title="${tr('Redo (Ctrl+Shift+Z)')}" disabled>
        <svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"/></svg>
      </button>
    </div>

    <div class="group">
      <button id="btnPrev" class="btn icon" title="${tr('Previous page (←)')}" disabled>
        <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <input id="pageInput" class="page-input" type="number" min="1" value="1" disabled aria-label="${tr('Page number')}">
      <span class="muted">/ <span id="pageCount">0</span></span>
      <button id="btnNext" class="btn icon" title="${tr('Next page (→)')}" disabled>
        <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>

    <div class="group">
      <button id="btnZoomOut" class="btn icon" title="${tr('Zoom out (−)')}" disabled>
        <svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>
      </button>
      <select id="zoomSelect" disabled aria-label="${tr('Zoom')}">
        <option value="fit">${tr('Fit page')}</option>
        <option value="width">${tr('Fit width')}</option>
        <option value="0.5">50%</option>
        <option value="0.75">75%</option>
        <option value="1">100%</option>
        <option value="1.25">125%</option>
        <option value="1.5">150%</option>
        <option value="2">200%</option>
        <option value="3">300%</option>
        <option value="custom" hidden>—</option>
      </select>
      <button id="btnZoomIn" class="btn icon" title="${tr('Zoom in (+)')}" disabled>
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </div>

    <label class="toggle" title="${tr('Preview cropped result (P)')}">
      <input id="previewToggle" type="checkbox" disabled> ${tr('Preview')}
    </label>

    <div class="spacer"></div>
    <button id="btnNextTool" class="btn" title="${tr('Open the cropped PDF in another tool, with or without saving it')}" disabled>${tr('↪ Other tool')}</button>
    <button id="btnSave" class="btn primary" title="${tr('Save cropped PDF (Ctrl+S)')}" disabled>${tr('Save PDF')}</button>
  </div>
    <aside class="thumbs" id="thumbs" aria-label="${tr('Pages')}"></aside>

    <section class="viewer" id="viewer">
      <div class="empty" id="emptyState">
        <div class="empty-cat">
          <span class="float-heart h1"></span><span class="float-heart h2"></span><span class="float-heart h3"></span>
          <span class="cat big" data-cat="main" data-size="6"></span>
        </div>
        <h2>${tr('Drop a PDF here, cutie ♡')}</h2>
        <p>${tr('or {link}', { link: `<button class="link" id="btnOpen2">${tr('choose a file')}</button>` })}</p>
        <p class="note">${tr('everything stays in your browser ~ nothing gets uploaded ✿')}</p>
      </div>
      <div class="stage" id="stage" hidden>
        <canvas id="pageCanvas"></canvas>
        <div class="crop" id="cropBox">
          <span class="h nw" data-handle="nw"></span><span class="h n" data-handle="n"></span>
          <span class="h ne" data-handle="ne"></span><span class="h e" data-handle="e"></span>
          <span class="h se" data-handle="se"></span><span class="h s" data-handle="s"></span>
          <span class="h sw" data-handle="sw"></span><span class="h w" data-handle="w"></span>
        </div>
      </div>
    </section>

    <aside class="cpanel" id="panel">
      <section>
        <h3>${tr('Page')} <span id="panelPage">–</span></h3>
        <dl class="info">
          <dt>${tr('Original')}</dt><dd id="infoOrig">–</dd>
          <dt>${tr('Cropped')}</dt><dd id="infoCrop">–</dd>
        </dl>
        <p class="note sticky">${tr('psst~ drag on the page to draw a crop box ✂ pull the edges or corners to resize, grab the middle to move it, or hold Alt to draw a fresh one ♡')}</p>
      </section>

      <section>
        <div class="crow between">
          <h3>${tr('♡ Margins')}</h3>
          <select id="unitSelect" aria-label="${tr('Unit')}">
            <option value="pt">pt</option>
            <option value="mm" selected>mm</option>
            <option value="in">in</option>
            <option value="%">%</option>
          </select>
        </div>
        <div class="margins">
          <label class="m-top">${tr('Top')}<input type="number" step="any" min="0" data-m="t" disabled></label>
          <label class="m-left">${tr('Left')}<input type="number" step="any" min="0" data-m="l" disabled></label>
          <label class="m-right">${tr('Right')}<input type="number" step="any" min="0" data-m="r" disabled></label>
          <label class="m-bottom">${tr('Bottom')}<input type="number" step="any" min="0" data-m="b" disabled></label>
        </div>
      </section>

      <section>
        <h3>${tr('✿ Tools')}</h3>
        <div class="crow">
          <button class="btn" id="btnAuto" disabled title="${tr('Crop to the visible content (A)')}">${tr('Auto-detect content')}</button>
          <label class="inline">${tr('pad')} <input id="autoPad" type="number" value="6" min="0" step="1"> pt</label>
        </div>
        <div class="crow">
          <button class="btn" id="btnRotL" disabled title="${tr('Rotate page left (Shift+R)')}">${tr('⟲ Rotate')}</button>
          <button class="btn" id="btnRotR" disabled title="${tr('Rotate page right (R)')}">${tr('⟳ Rotate')}</button>
          <button class="btn" id="btnClear" disabled title="${tr('Remove the crop on this page (Delete)')}">${tr('Clear crop')}</button>
        </div>
        <div class="crow">
          <button class="btn" id="btnCopy" disabled title="${tr('Copy this page\'s crop (Ctrl+C)')}">${tr('Copy crop')}</button>
          <button class="btn" id="btnPaste" disabled title="${tr('Paste crop onto this page (Ctrl+V)')}">${tr('Paste crop')}</button>
        </div>
      </section>

      <section>
        <h3>${tr('♡ Apply this crop to')}</h3>
        <div class="crow">
          <select id="applyScope" disabled aria-label="${tr('Pages')}">
            <option value="all">${tr('All pages')}</option>
            <option value="odd">${tr('Odd pages')}</option>
            <option value="even">${tr('Even pages')}</option>
            <option value="range">${tr('Page range…')}</option>
          </select>
          <input id="applyRange" type="text" placeholder="${tr('e.g. 1-3, 5, 8-')}" hidden aria-label="${tr('Page range')}">
        </div>
        <div class="crow">
          <select id="applyMatch" disabled aria-label="${tr('Match mode')}" title="${tr('How to transfer the crop to pages of a different size')}">
            <option value="rel">${tr('Same margins (% of page)')}</option>
            <option value="abs">${tr('Same margins (absolute)')}</option>
          </select>
          <button class="btn" id="btnApply" disabled>${tr('Apply')}</button>
        </div>
        <label class="check"><input type="checkbox" id="linkAll" disabled> ${tr('Link all pages — every edit applies to all pages')}</label>
      </section>

      <section>
        <h3>${tr('✿ All pages')}</h3>
        <div class="crow">
          <button class="btn" id="btnAutoAll" disabled title="${tr('Auto-detect content on every page individually')}">${tr('Auto-detect each page')}</button>
        </div>
        <div class="crow">
          <button class="btn" id="btnRotAllL" disabled>${tr('⟲ Rotate all')}</button>
          <button class="btn" id="btnRotAllR" disabled>${tr('⟳ Rotate all')}</button>
        </div>
      </section>

      <section>
        <h3>${tr('↺ Revert')}</h3>
        <div class="crow">
          <button class="btn" id="btnRevertPage" disabled title="${tr('Undo all crop and rotation changes on this page')}">${tr('Revert page')}</button>
          <button class="btn danger" id="btnRevertAll" disabled title="${tr('Undo all crop and rotation changes on every page')}">${tr('Revert all pages')}</button>
        </div>
      </section>

      <section>
        <h3>${tr('♡ Save')}</h3>
        <label class="check" title="${tr('Also sets MediaBox, TrimBox, BleedBox and ArtBox, so every viewer and printer respects the crop. The hidden content stays in the file.')}">
          <input type="checkbox" id="hardCrop" checked> ${tr('Set all page boxes (most compatible)')}
        </label>
        <button class="btn primary wide" id="btnSave2" disabled>${tr('Save cropped PDF ♡')}</button>
        <button class="btn wide" id="btnNextTool2" disabled>${tr('↪ Continue in another tool')}</button>
      </section>

      <details class="shortcuts">
        <summary>${tr('Keyboard shortcuts')}</summary>
        <dl>
          <dt>← / →</dt><dd>${tr('Previous / next page')}</dd>
          <dt>Ctrl+Z / Ctrl+Shift+Z</dt><dd>${tr('Undo / redo')}</dd>
          <dt>Ctrl+C / Ctrl+V</dt><dd>${tr('Copy / paste crop')}</dd>
          <dt>Delete</dt><dd>${tr('Clear crop on page')}</dd>
          <dt>A</dt><dd>${tr('Auto-detect content')}</dd>
          <dt>R / Shift+R</dt><dd>${tr('Rotate right / left')}</dd>
          <dt>P</dt><dd>${tr('Toggle preview')}</dd>
          <dt>+ / − / 0</dt><dd>${tr('Zoom in / out / fit')}</dd>
          <dt>${tr('Pinch / Ctrl+scroll')}</dt><dd>${tr('Zoom freely')}</dd>
          <dt>Ctrl+S</dt><dd>${tr('Save')}</dd>
          <dt>Esc</dt><dd>${tr('Cancel drag')}</dd>
        </dl>
      </details>
    </aside>
  </div>`;

export function mount(root) {
  root.innerHTML = MARKUP;
  const cleanups = [];
  // While parked off the page (see main.js), keys and drops are for the tool on screen.
  const listen = (target, type, fn, opts) => {
    if (type !== 'beforeunload') { const f = fn; fn = (e) => { if (dropOverlay.isConnected) f(e); }; }
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };
  const dropOverlay = document.createElement('div');
  dropOverlay.className = 'drop-overlay';
  dropOverlay.hidden = true;
  root.appendChild(dropOverlay);

  const THUMB_W = 120;
  const MAX_HISTORY = 300;
  const MAX_CANVAS_PIXELS = 16e6;
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  const PT_PER = { pt: 1, mm: 72 / 25.4, in: 72 };

  const $ = (sel) => root.querySelector(sel);
  const els = {
    fileInput: $('#fileInput'), fileName: $('#fileName'),
    btnOpen: $('#btnOpen'), btnOpen2: $('#btnOpen2'),
    btnUndo: $('#btnUndo'), btnRedo: $('#btnRedo'),
    btnPrev: $('#btnPrev'), btnNext: $('#btnNext'), pageInput: $('#pageInput'), pageCount: $('#pageCount'),
    btnZoomIn: $('#btnZoomIn'), btnZoomOut: $('#btnZoomOut'), zoomSelect: $('#zoomSelect'),
    previewToggle: $('#previewToggle'),
    btnSave: $('#btnSave'), btnSave2: $('#btnSave2'), hardCrop: $('#hardCrop'),
    btnNextTool: $('#btnNextTool'), btnNextTool2: $('#btnNextTool2'),
    thumbs: $('#thumbs'), viewer: $('#viewer'), empty: $('#emptyState'),
    stage: $('#stage'), canvas: $('#pageCanvas'), cropBox: $('#cropBox'),
    panelPage: $('#panelPage'), infoOrig: $('#infoOrig'), infoCrop: $('#infoCrop'),
    unitSelect: $('#unitSelect'), marginInputs: [...root.querySelectorAll('[data-m]')],
    btnAuto: $('#btnAuto'), autoPad: $('#autoPad'),
    btnRotL: $('#btnRotL'), btnRotR: $('#btnRotR'), btnClear: $('#btnClear'),
    btnCopy: $('#btnCopy'), btnPaste: $('#btnPaste'),
    applyScope: $('#applyScope'), applyRange: $('#applyRange'), applyMatch: $('#applyMatch'),
    btnApply: $('#btnApply'), linkAll: $('#linkAll'),
    btnAutoAll: $('#btnAutoAll'), btnRotAllL: $('#btnRotAllL'), btnRotAllR: $('#btnRotAllR'),
    btnRevertPage: $('#btnRevertPage'), btnRevertAll: $('#btnRevertAll'),
  };

  /*
   * State. Crops are stored per page in PDF user-space coordinates
   * ({x1, y1, x2, y2}, or null for "no crop"), so they stay correct no matter
   * how the page is rotated or zoomed. `rots` holds the user's extra rotation
   * on top of the page's own /Rotate.
   */
  const S = {
    doc: null,
    bytes: null,
    fileName: '',
    pages: [],          // [{ view: [x1, y1, x2, y2], rotate }]
    crops: [],
    rots: [],
    cur: 0,
    zoom: 'fit',        // 'fit' | 'width' | number
    scale: 1,
    undo: [],
    redo: [],
    clip: null,
    preview: false,
    drag: null,
    version: 0,
    savedVersion: 0,
    thumbEls: [],
    thumbRendered: [],  // rotation each thumbnail was rendered at, or undefined
  };

  /* ================= Geometry ================= */

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const totalRot = (i) => (((S.pages[i].rotate + S.rots[i]) % 360) + 360) % 360;

  function pageDims(i) {
    const [x1, y1, x2, y2] = S.pages[i].view;
    return [x2 - x1, y2 - y1];
  }

  /** Width/height in points as displayed (after rotation). */
  function dispDims(i) {
    const [w, h] = pageDims(i);
    return totalRot(i) % 180 ? [h, w] : [w, h];
  }

  /** PDF point -> normalized display coords (0..1, origin top-left, rotation applied). */
  function pdfToNorm(i, px, py) {
    const [x1, y1, x2, y2] = S.pages[i].view;
    const u0 = (px - x1) / (x2 - x1);
    const v0 = (y2 - py) / (y2 - y1);
    switch (totalRot(i)) {
      case 90: return [1 - v0, u0];
      case 180: return [1 - u0, 1 - v0];
      case 270: return [v0, 1 - u0];
      default: return [u0, v0];
    }
  }

  function normToPdf(i, u, v) {
    const [x1, y1, x2, y2] = S.pages[i].view;
    let u0, v0;
    switch (totalRot(i)) {
      case 90: u0 = v; v0 = 1 - u; break;
      case 180: u0 = 1 - u; v0 = 1 - v; break;
      case 270: u0 = 1 - v; v0 = u; break;
      default: u0 = u; v0 = v;
    }
    return [x1 + u0 * (x2 - x1), y2 - v0 * (y2 - y1)];
  }

  const FULL = Object.freeze({ l: 0, t: 0, r: 1, b: 1 });

  /** Crop of page i as a normalized display rect {l, t, r, b}. */
  function cropNorm(i) {
    const c = S.crops[i];
    if (!c) return { ...FULL };
    const a = pdfToNorm(i, c.x1, c.y1);
    const b = pdfToNorm(i, c.x2, c.y2);
    return {
      l: Math.min(a[0], b[0]), t: Math.min(a[1], b[1]),
      r: Math.max(a[0], b[0]), b: Math.max(a[1], b[1]),
    };
  }

  function isFull(n) {
    const e = 1e-4;
    return n.l <= e && n.t <= e && n.r >= 1 - e && n.b >= 1 - e;
  }

  /** Normalized display rect -> stored PDF crop (null when it covers the whole page). */
  function normToCrop(i, n) {
    n = { l: clamp(n.l, 0, 1), t: clamp(n.t, 0, 1), r: clamp(n.r, 0, 1), b: clamp(n.b, 0, 1) };
    if (isFull(n)) return null;
    const a = normToPdf(i, n.l, n.t);
    const b = normToPdf(i, n.r, n.b);
    return {
      x1: Math.min(a[0], b[0]), y1: Math.min(a[1], b[1]),
      x2: Math.max(a[0], b[0]), y2: Math.max(a[1], b[1]),
    };
  }

  /** Margins in points (display orientation) of a normalized rect on page i. */
  function normToMargins(i, n) {
    const [w, h] = dispDims(i);
    return { l: n.l * w, t: n.t * h, r: (1 - n.r) * w, b: (1 - n.b) * h };
  }

  function marginsToNorm(i, m) {
    const [w, h] = dispDims(i);
    return { l: m.l / w, t: m.t / h, r: 1 - m.r / w, b: 1 - m.b / h };
  }

  /** Is n a usable crop rect (at least ~1pt in each direction)? */
  function validNorm(i, n) {
    const [w, h] = dispDims(i);
    return (n.r - n.l) * w >= 1 && (n.b - n.t) * h >= 1;
  }

  /* ================= History ================= */

  function snapshot() {
    return { crops: S.crops.map((c) => (c ? { ...c } : null)), rots: [...S.rots] };
  }

  /** Run a mutation as one undoable step. */
  function commit(label, mutate) {
    const before = snapshot();
    mutate();
    if (sameState(before, S)) return;
    S.undo.push({ ...before, label });
    if (S.undo.length > MAX_HISTORY) S.undo.shift();
    S.redo = [];
    S.version++;
    afterChange(before.rots);
  }

  function sameState(a, b) {
    for (let i = 0; i < b.crops.length; i++) {
      if (a.rots[i] !== b.rots[i]) return false;
      const x = a.crops[i], y = b.crops[i];
      if (!x !== !y) return false;
      if (x && (x.x1 !== y.x1 || x.y1 !== y.y1 || x.x2 !== y.x2 || x.y2 !== y.y2)) return false;
    }
    return true;
  }

  function restore(from, to) {
    const entry = from.pop();
    if (!entry) return;
    const prevRots = [...S.rots];
    to.push({ ...snapshot(), label: entry.label });
    S.crops = entry.crops;
    S.rots = entry.rots;
    S.version++;
    afterChange(prevRots);
    toast(tr(from === S.undo ? 'Undid: {action}' : 'Redid: {action}', { action: entry.label }));
  }

  const undo = () => restore(S.undo, S.redo);
  const redo = () => restore(S.redo, S.undo);

  /** Refresh everything that depends on crops/rotations. */
  function afterChange(prevRots) {
    const rotChanged = prevRots.some((r, i) => r !== S.rots[i]);
    for (let i = 0; i < S.pages.length; i++) {
      if (prevRots[i] !== S.rots[i]) layoutThumb(i);
      updateThumbOverlay(i);
    }
    if (rotChanged && prevRots[S.cur] !== S.rots[S.cur]) renderMain();
    else updateOverlay();
    updateUI();
  }

  /* ================= Loading ================= */

  async function openFile(file) {
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      toast('That file is not a PDF.', 'error');
      return;
    }
    if (isDirty() && !confirm(tr('You have unsaved changes. Open another file anyway?'))) return;

    showBusy('Opening…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const task = pdfjsLib.getDocument({ data: bytes.slice() });
      task.onPassword = (update, reason) => {
        const pw = prompt(tr(reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD
          ? 'Incorrect password. Try again:' : 'This PDF is password protected. Password:'));
        if (pw === null) task.destroy(); else update(pw);
      };
      const doc = await task.promise;

      const pages = [];
      for (let n = 1; n <= doc.numPages; n++) {
        if (n % 25 === 0) showBusy(`${tr('Reading pages…')} ${n}/${doc.numPages}`);
        const p = await doc.getPage(n);
        pages.push({ view: [...p.view], rotate: p.rotate || 0 });
      }

      if (S.doc) S.doc.destroy();
      Object.assign(S, {
        doc, bytes, fileName: file.name, pages,
        crops: pages.map(() => null), rots: pages.map(() => 0),
        cur: 0, undo: [], redo: [], version: 0, savedVersion: 0, drag: null,
      });
      S.isEncrypted = false;
      try {
        // pdf-lib cannot write encrypted files; detect it up front.
        await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      } catch (e) {
        S.isEncrypted = /encrypt/i.test(String(e && e.message));
      }

      els.fileName.textContent = file.name;
      els.fileName.title = file.name;
      els.empty.hidden = true;
      els.stage.hidden = false;
      buildThumbs();
      await renderMain();
      updateUI();
      Handoff.note([file]);
      Handoff.live = async () => [croppedFile(await buildPdf())];
      if (S.isEncrypted) toast('This PDF is encrypted; saving may not be possible.', 'error');
    } catch (err) {
      console.error(err);
      if (err && err.name === 'PasswordException') toast('Opening cancelled.', 'error');
      else toast(tr('Could not open PDF: {error}', { error: trMsg(err && err.message ? err.message : err) }), 'error');
    } finally {
      hideBusy();
    }
  }

  /* ================= Main page rendering ================= */

  let renderTask = null;
  let renderSeq = 0;

  function computeScale(i) {
    const [w, h] = dispDims(i);
    const cs = getComputedStyle(els.viewer);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availW = Math.max(100, els.viewer.clientWidth - padX);
    const availH = Math.max(100, els.viewer.clientHeight - padY);
    if (S.zoom === 'fit') return Math.min(availW / w, availH / h);
    if (S.zoom === 'width') return availW / w;
    return S.zoom;
  }

  // While pinching/scrolling to zoom, only resize the stage (the old canvas stretches along)
  // and draw the page sharply once the gesture pauses.
  let sharpenTimer = 0;
  function resizeMain() {
    if (!S.doc) return;
    const [w, h] = dispDims(S.cur);
    S.scale = computeScale(S.cur);
    els.stage.style.width = `${Math.round(w * S.scale)}px`;
    els.stage.style.height = `${Math.round(h * S.scale)}px`;
    updateOverlay();
    updateUI();
    clearTimeout(sharpenTimer);
    sharpenTimer = setTimeout(renderMain, 150);
  }

  async function renderMain() {
    if (!S.doc) return;
    clearTimeout(sharpenTimer);
    const seq = ++renderSeq;
    const i = S.cur;
    const scale = computeScale(i);
    const [w, h] = dispDims(i);
    S.scale = scale;

    // Size the stage right away so the overlay is usable while the canvas renders.
    els.stage.style.width = `${Math.round(w * scale)}px`;
    els.stage.style.height = `${Math.round(h * scale)}px`;
    updateOverlay();
    updateUI();

    const page = await S.doc.getPage(i + 1);
    if (seq !== renderSeq) return;
    if (renderTask) renderTask.cancel();

    let pxScale = scale * (window.devicePixelRatio || 1);
    const maxScale = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));
    pxScale = Math.min(pxScale, maxScale);
    const vp = page.getViewport({ scale: pxScale, rotation: totalRot(i) });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const task = page.render({ canvasContext: ctx, viewport: vp });
    renderTask = task;
    try {
      await task.promise;
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return;
      console.error(err);
      toast('Failed to render page.', 'error');
      return;
    } finally {
      if (renderTask === task) renderTask = null;
    }
    if (seq !== renderSeq) return;
    canvas.id = 'pageCanvas';
    els.canvas.replaceWith(canvas);
    els.canvas = canvas;
  }

  function updateOverlay() {
    if (!S.doc) return;
    const n = S.drag ? S.drag.n : cropNorm(S.cur);
    const box = els.cropBox.style;
    box.left = `${n.l * 100}%`;
    box.top = `${n.t * 100}%`;
    box.width = `${(n.r - n.l) * 100}%`;
    box.height = `${(n.b - n.t) * 100}%`;
    els.cropBox.classList.toggle('uncropped', !S.drag && !S.crops[S.cur]);
    els.stage.classList.toggle('preview', S.preview);
    updateMarginInputs(n);
  }

  /* ================= Thumbnails ================= */

  let thumbObserver = null;
  let thumbQueue = Promise.resolve();

  function buildThumbs() {
    if (thumbObserver) thumbObserver.disconnect();
    els.thumbs.innerHTML = '';
    S.thumbEls = [];
    S.thumbRendered = [];
    thumbObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) queueThumb(Number(e.target.dataset.index));
      }
    }, { root: els.thumbs, rootMargin: '400px' });

    const frag = document.createDocumentFragment();
    S.pages.forEach((_, i) => {
      const btn = document.createElement('button');
      btn.className = 'thumb';
      btn.dataset.index = i;
      btn.title = `Page ${i + 1}`;
      btn.innerHTML = `<div class="thumb-page"><canvas></canvas><div class="thumb-crop" hidden></div></div>
        <div class="thumb-label"><span>${i + 1}</span><span class="badge" hidden></span></div>`;
      btn.addEventListener('click', () => goTo(i));
      frag.appendChild(btn);
      const t = {
        root: btn,
        page: btn.querySelector('.thumb-page'),
        canvas: btn.querySelector('canvas'),
        crop: btn.querySelector('.thumb-crop'),
        badge: btn.querySelector('.badge'),
      };
      S.thumbEls.push(t);
      layoutThumb(i);
      updateThumbOverlay(i);
      thumbObserver.observe(btn);
    });
    els.thumbs.appendChild(frag);
  }

  function layoutThumb(i) {
    const t = S.thumbEls[i];
    if (!t) return;
    const [w, h] = dispDims(i);
    t.page.style.aspectRatio = `${w} / ${h}`;
    if (S.thumbRendered[i] !== undefined && S.thumbRendered[i] !== totalRot(i)) {
      S.thumbRendered[i] = undefined;
      const r = t.root.getBoundingClientRect();
      const c = els.thumbs.getBoundingClientRect();
      const visible = r.bottom > c.top - 400 && r.top < c.bottom + 400 &&
        r.right > c.left - 400 && r.left < c.right + 400;
      if (visible) queueThumb(i);
    }
  }

  function queueThumb(i) {
    if (S.thumbRendered[i] === totalRot(i)) return;
    const doc = S.doc;
    thumbQueue = thumbQueue.then(() => renderThumb(doc, i)).catch((e) => console.error(e));
  }

  async function renderThumb(doc, i) {
    if (doc !== S.doc) return;
    const rot = totalRot(i);
    if (S.thumbRendered[i] === rot) return;
    const page = await doc.getPage(i + 1);
    const [w] = dispDims(i);
    const vp = page.getViewport({ scale: (THUMB_W * (window.devicePixelRatio || 1)) / w, rotation: rot });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    if (doc !== S.doc || totalRot(i) !== rot) return;
    const t = S.thumbEls[i];
    t.canvas.replaceWith(canvas);
    t.canvas = canvas;
    S.thumbRendered[i] = rot;
  }

  function updateThumbOverlay(i) {
    const t = S.thumbEls[i];
    if (!t) return;
    const cropped = !!S.crops[i];
    t.crop.hidden = !cropped;
    if (cropped) {
      const n = cropNorm(i);
      Object.assign(t.crop.style, {
        left: `${n.l * 100}%`, top: `${n.t * 100}%`,
        width: `${(n.r - n.l) * 100}%`, height: `${(n.b - n.t) * 100}%`,
      });
    }
    const tags = [];
    if (cropped) tags.push('crop');
    if (S.rots[i]) tags.push(`${S.rots[i]}°`);
    t.badge.hidden = !tags.length;
    t.badge.textContent = tags.join(' · ');
  }

  /* ================= Navigation & zoom ================= */

  function goTo(i) {
    if (!S.doc) return;
    i = clamp(i, 0, S.pages.length - 1);
    if (i === S.cur && els.canvas.width) return;
    S.drag = null;
    S.cur = i;
    renderMain();
    const t = S.thumbEls[i];
    if (t) t.root.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function setZoom(z) {
    S.zoom = z;
    renderMain();
  }

  function zoomStep(dir) {
    const cur = S.scale;
    const next = dir > 0
      ? ZOOM_STEPS.find((z) => z > cur + 0.01) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
      : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.01) ?? ZOOM_STEPS[0];
    setZoom(next);
  }

  /* ================= Crop editing (mouse / touch) ================= */

  els.stage.addEventListener('pointerdown', (e) => {
    if (!S.doc || S.preview || e.button !== 0) return;
    const rect = els.stage.getBoundingClientRect();
    const p = [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
    const handle = e.target.dataset.handle;
    // Uncropped pages show a full-page box; dragging inside it should draw, not move.
    const canMove = e.target === els.cropBox && !!S.crops[S.cur] && !e.altKey;
    const mode = handle ? 'resize' : canMove ? 'move' : 'draw';
    const start = cropNorm(S.cur);
    S.drag = { mode, handle, start, p0: p, n: { ...start }, rect, moved: false };
    els.stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  els.stage.addEventListener('pointermove', (e) => {
    const d = S.drag;
    if (!d) return;
    const { rect, start, p0 } = d;
    const px = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const py = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    const dx = px - p0[0];
    const dy = py - p0[1];
    const minW = 8 / rect.width;
    const minH = 8 / rect.height;
    if (Math.abs(dx) * rect.width > 2 || Math.abs(dy) * rect.height > 2) d.moved = true;
    const n = { ...start };

    if (d.mode === 'move') {
      const w = start.r - start.l;
      const h = start.b - start.t;
      n.l = clamp(start.l + dx, 0, 1 - w); n.r = n.l + w;
      n.t = clamp(start.t + dy, 0, 1 - h); n.b = n.t + h;
    } else if (d.mode === 'resize') {
      const hd = d.handle;
      if (hd.includes('w')) n.l = clamp(start.l + dx, 0, start.r - minW);
      if (hd.includes('e')) n.r = clamp(start.r + dx, start.l + minW, 1);
      if (hd.includes('n')) n.t = clamp(start.t + dy, 0, start.b - minH);
      if (hd.includes('s')) n.b = clamp(start.b + dy, start.t + minH, 1);
    } else {
      n.l = Math.min(p0[0], px); n.r = Math.max(p0[0], px);
      n.t = Math.min(p0[1], py); n.b = Math.max(p0[1], py);
    }
    d.n = n;
    updateOverlay();
  });

  function endDrag(e) {
    const d = S.drag;
    if (!d) return;
    S.drag = null;
    if (els.stage.hasPointerCapture(e.pointerId)) els.stage.releasePointerCapture(e.pointerId);
    const tooSmall = (d.n.r - d.n.l) * d.rect.width < 6 || (d.n.b - d.n.t) * d.rect.height < 6;
    if (!d.moved || (d.mode === 'draw' && tooSmall)) {
      updateOverlay();
      return;
    }
    const label = d.mode === 'move' ? 'Move crop' : d.mode === 'resize' ? 'Resize crop' : 'Draw crop';
    setCrop(d.n, tr(label));
  }

  els.stage.addEventListener('pointerup', endDrag);
  els.stage.addEventListener('pointercancel', (e) => { S.drag = null; endDrag(e); updateOverlay(); });

  function cancelDrag() {
    if (!S.drag) return false;
    S.drag = null;
    updateOverlay();
    return true;
  }

  /**
   * Set the crop on the current page (or every page when "Link all pages" is on).
   */
  function setCrop(n, label) {
    commit(label, () => {
      if (els.linkAll.checked) {
        for (let i = 0; i < S.pages.length; i++) S.crops[i] = normToCrop(i, n);
      } else {
        S.crops[S.cur] = normToCrop(S.cur, n);
      }
    });
  }

  /* ================= Margin inputs ================= */

  function fmt(v, unit) {
    const d = unit === 'in' ? 3 : unit === 'pt' ? 1 : 2;
    return String(Number(v.toFixed(d)));
  }

  function ptToUnit(pt, unit, dimPt) {
    return unit === '%' ? (pt / dimPt) * 100 : pt / PT_PER[unit];
  }

  function unitToPt(v, unit, dimPt) {
    return unit === '%' ? (v / 100) * dimPt : v * PT_PER[unit];
  }

  function updateMarginInputs(n) {
    const unit = els.unitSelect.value;
    const m = normToMargins(S.cur, n);
    const [w, h] = dispDims(S.cur);
    for (const input of els.marginInputs) {
      if (document.activeElement === input) continue;
      const k = input.dataset.m;
      input.value = fmt(ptToUnit(Math.max(0, m[k]), unit, k === 'l' || k === 'r' ? w : h), unit);
      input.classList.remove('invalid');
    }
    updateInfo(n);
  }

  function onMarginChange() {
    if (!S.doc) return;
    const unit = els.unitSelect.value;
    const [w, h] = dispDims(S.cur);
    const m = {};
    for (const input of els.marginInputs) {
      const k = input.dataset.m;
      const v = parseFloat(input.value);
      m[k] = Number.isFinite(v) ? Math.max(0, unitToPt(v, unit, k === 'l' || k === 'r' ? w : h)) : 0;
    }
    const n = marginsToNorm(S.cur, m);
    if (!validNorm(S.cur, n)) {
      els.marginInputs.forEach((x) => x.classList.add('invalid'));
      toast('Margins leave no visible area.', 'error');
      return;
    }
    els.marginInputs.forEach((x) => x.classList.remove('invalid'));
    setCrop(n, tr('Edit margins'));
  }

  /* ================= Page tools ================= */

  function rotate(indices, delta, label) {
    commit(label, () => {
      for (const i of indices) S.rots[i] = (((S.rots[i] + delta) % 360) + 360) % 360;
    });
  }

  function clearCrop() {
    commit(tr('Clear crop'), () => {
      if (els.linkAll.checked) S.crops = S.crops.map(() => null);
      else S.crops[S.cur] = null;
    });
  }

  function revertPage() {
    commit(tr('Revert page {n}', { n: S.cur + 1 }), () => {
      S.crops[S.cur] = null;
      S.rots[S.cur] = 0;
    });
  }

  function revertAll() {
    if (!confirm(tr('Remove all crops and rotations from every page?'))) return;
    commit(tr('Revert all pages'), () => {
      S.crops = S.crops.map(() => null);
      S.rots = S.rots.map(() => 0);
    });
  }

  function copyCrop() {
    const n = cropNorm(S.cur);
    S.clip = { n, m: normToMargins(S.cur, n), from: S.cur };
    toast(tr('Copied crop from page {n}', { n: S.cur + 1 }));
    updateUI();
  }

  function pasteCrop() {
    if (!S.clip) return;
    const n = transferCrop(S.clip, S.cur, els.applyMatch.value);
    if (!n) { toast('Copied crop does not fit this page.', 'error'); return; }
    setCrop(n, tr('Paste crop'));
  }

  /** Convert a source crop {n, m} for use on page `i`, either relative or absolute. */
  function transferCrop(src, i, mode) {
    if (isFull(src.n)) return { ...FULL };
    if (mode === 'rel') return { ...src.n };
    const [w, h] = dispDims(i);
    const n = {
      l: clamp(src.m.l / w, 0, 1), t: clamp(src.m.t / h, 0, 1),
      r: clamp(1 - src.m.r / w, 0, 1), b: clamp(1 - src.m.b / h, 0, 1),
    };
    return validNorm(i, n) ? n : null;
  }

  function parseRange(text, count) {
    const out = new Set();
    const parts = text.split(/[,;\s]+/).filter(Boolean);
    if (!parts.length) throw new Error(tr('Enter a page range, e.g. 1-3, 5'));
    for (const part of parts) {
      const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
      if (m) {
        const a = m[1] ? parseInt(m[1], 10) : 1;
        const b = m[2] ? parseInt(m[2], 10) : count;
        if (a < 1 || b > count || a > b) throw new Error(tr('Invalid range "{part}"', { part }));
        for (let k = a; k <= b; k++) out.add(k - 1);
      } else if (/^\d+$/.test(part)) {
        const k = parseInt(part, 10);
        if (k < 1 || k > count) throw new Error(tr('Page {k} does not exist', { k }));
        out.add(k - 1);
      } else {
        throw new Error(tr('Cannot read "{part}"', { part }));
      }
    }
    return [...out].sort((a, b) => a - b);
  }

  function targetPages() {
    const count = S.pages.length;
    const all = [...Array(count).keys()];
    switch (els.applyScope.value) {
      case 'odd': return all.filter((i) => i % 2 === 0);
      case 'even': return all.filter((i) => i % 2 === 1);
      case 'range': return parseRange(els.applyRange.value, count);
      default: return all;
    }
  }

  function applyToPages() {
    let targets;
    try { targets = targetPages(); } catch (e) { toast(e.message, 'error'); return; }
    const n = cropNorm(S.cur);
    const src = { n, m: normToMargins(S.cur, n) };
    const mode = els.applyMatch.value;
    let skipped = 0;
    commit(tr('Apply crop to {n} page(s)', { n: targets.length }), () => {
      for (const i of targets) {
        const t = transferCrop(src, i, mode);
        if (t) S.crops[i] = normToCrop(i, t); else skipped++;
      }
    });
    toast(tr('Applied to {n} page(s)', { n: targets.length - skipped }) + (skipped ? tr(', {n} skipped (too small)', { n: skipped }) : ''));
  }

  /** Render page i offscreen and find the bounding box of non-white pixels. */
  async function detectContent(i, padPt) {
    const page = await S.doc.getPage(i + 1);
    const [w, h] = dispDims(i);
    const scale = Math.min(1200 / Math.max(w, h), 4);
    const vp = page.getViewport({ scale, rotation: totalRot(i) });
    const canvas = document.createElement('canvas');
    const W = (canvas.width = Math.ceil(vp.width));
    const H = (canvas.height = Math.ceil(vp.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const data = ctx.getImageData(0, 0, W, H).data;

    const THR = 235;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) {
      let row = y * W * 4;
      for (let x = 0; x < W; x++, row += 4) {
        if (data[row] < THR || data[row + 1] < THR || data[row + 2] < THR) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    canvas.width = canvas.height = 0;
    if (maxX < 0) return null;
    const pad = padPt * scale;
    return {
      l: clamp((minX - pad) / W, 0, 1), t: clamp((minY - pad) / H, 0, 1),
      r: clamp((maxX + 1 + pad) / W, 0, 1), b: clamp((maxY + 1 + pad) / H, 0, 1),
    };
  }

  function autoPad() {
    const v = parseFloat(els.autoPad.value);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }

  async function autoDetect() {
    showBusy('Detecting content…');
    try {
      const n = await detectContent(S.cur, autoPad());
      if (!n) { toast('This page looks blank~ nothing to crop', 'error'); return; }
      setCrop(n, tr('Auto-detect content'));
    } catch (e) {
      console.error(e);
      toast('Auto-detect failed.', 'error');
    } finally {
      hideBusy();
    }
  }

  async function autoDetectAll() {
    const pad = autoPad();
    const results = [];
    try {
      for (let i = 0; i < S.pages.length; i++) {
        showBusy(`${tr('Detecting content…')} ${i + 1}/${S.pages.length}`);
        results.push(await detectContent(i, pad));
      }
    } catch (e) {
      console.error(e);
      toast('Auto-detect failed.', 'error');
      hideBusy();
      return;
    }
    hideBusy();
    commit(tr('Auto-detect all pages'), () => {
      results.forEach((n, i) => { if (n) S.crops[i] = normToCrop(i, n); });
    });
    const blank = results.filter((r) => !r).length;
    toast(tr('Auto-cropped {n} page(s)', { n: results.length - blank }) + (blank ? tr(', {n} blank page(s) left as is', { n: blank }) : ''));
  }

  /* ================= Saving ================= */

  /** The PDF with every crop and rotation applied. */
  async function buildPdf() {
    const pdf = await PDFLib.PDFDocument.load(S.bytes, { ignoreEncryption: true, updateMetadata: false });
    const pages = pdf.getPages();
    const hard = els.hardCrop.checked;
    pages.forEach((p, i) => {
      const c = S.crops[i];
      if (c) {
        const args = [c.x1, c.y1, c.x2 - c.x1, c.y2 - c.y1];
        p.setCropBox(...args);
        if (hard) {
          p.setMediaBox(...args);
          p.setTrimBox(...args);
          p.setBleedBox(...args);
          p.setArtBox(...args);
        }
      }
      if (S.rots[i]) p.setRotation(PDFLib.degrees(totalRot(i)));
    });
    return pdf.save();
  }

  const croppedFile = (bytes) => new File([bytes], outputName(), { type: 'application/pdf' });

  /** Hand the cropped PDF on to another tool; the picker can save a copy first. */
  async function continueElsewhere() {
    if (!S.doc) return;
    showBusy('Getting your file ready…');
    let file;
    try {
      file = croppedFile(await buildPdf());
    } catch (e) {
      console.error(e);
      toast(tr('Save failed: {error}', { error: trMsg(e && e.message ? e.message : e) }), 'error');
      return;
    } finally {
      hideBusy();
    }
    // Leaving with unsaved changes is fine here: they travel with the file.
    S.savedVersion = S.version;
    continueWith([file], { save: false, title: 'Open the cropped PDF in another tool' });
  }

  async function save() {
    if (!S.doc) return;
    showBusy('Saving…');
    try {
      const out = await buildPdf();
      download(out, outputName());
      S.savedVersion = S.version;
      updateUI();
      toast('Saved! Your PDF is all cropped ♡');
      celebrate();
    } catch (e) {
      console.error(e);
      toast(tr('Save failed: {error}', { error: trMsg(e && e.message ? e.message : e) }), 'error');
    } finally {
      hideBusy();
    }
  }

  function outputName() {
    const base = S.fileName.replace(/\.pdf$/i, '') || 'document';
    return `${base}-cropped.pdf`;
  }

  function download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /* ================= UI state ================= */

  const isDirty = () => !!S.doc && S.version !== S.savedVersion;

  function updateInfo(n) {
    const i = S.cur;
    const unit = els.unitSelect.value === '%' ? 'mm' : els.unitSelect.value;
    const [w, h] = dispDims(i);
    const show = (pw, ph) => `${fmtNum(fmt(pw / PT_PER[unit], unit))} × ${fmtNum(fmt(ph / PT_PER[unit], unit))} ${tr(unit)}`;
    els.infoOrig.textContent = show(w, h) + (S.rots[i] ? ` · ${tr('rotated {deg}°', { deg: S.rots[i] })}` : '');
    els.infoCrop.textContent = isFull(n) ? tr('not cropped') : show((n.r - n.l) * w, (n.b - n.t) * h);
  }

  function updateUI() {
    const has = !!S.doc;
    const count = S.pages.length;
    const set = (el, enabled) => { el.disabled = !enabled; };

    [els.btnZoomIn, els.btnZoomOut, els.zoomSelect, els.pageInput, els.previewToggle,
      els.btnSave, els.btnSave2, els.btnNextTool, els.btnNextTool2, els.btnAuto, els.btnRotL, els.btnRotR, els.btnCopy,
      els.applyScope, els.applyMatch, els.btnApply, els.linkAll, els.btnAutoAll,
      els.btnRotAllL, els.btnRotAllR, els.btnRevertAll, ...els.marginInputs].forEach((el) => set(el, has));
    els.marginInputs.forEach((el) => set(el, has && !S.preview));

    set(els.btnUndo, S.undo.length > 0);
    set(els.btnRedo, S.redo.length > 0);
    els.btnUndo.title = S.undo.length ? tr('Undo {action} (Ctrl+Z)', { action: S.undo[S.undo.length - 1].label }) : tr('Undo (Ctrl+Z)');
    els.btnRedo.title = S.redo.length ? tr('Redo {action} (Ctrl+Shift+Z)', { action: S.redo[S.redo.length - 1].label }) : tr('Redo (Ctrl+Shift+Z)');
    set(els.btnPrev, has && S.cur > 0);
    set(els.btnNext, has && S.cur < count - 1);
    set(els.btnClear, has && (!!S.crops[S.cur] || els.linkAll.checked));
    set(els.btnPaste, has && !!S.clip);
    set(els.btnRevertPage, has && (!!S.crops[S.cur] || !!S.rots[S.cur]));
    els.btnSave.textContent = isDirty() ? `${tr('Save PDF')} •` : tr('Save PDF');

    els.pageCount.textContent = count;
    els.pageInput.max = count;
    if (document.activeElement !== els.pageInput) els.pageInput.value = has ? S.cur + 1 : 1;
    els.panelPage.textContent = has ? tr('{k} of {n}', { k: S.cur + 1, n: count }) : '–';

    const zoomVal = String(S.zoom);
    const known = [...els.zoomSelect.options].some((o) => o.value === zoomVal && !o.hidden);
    const custom = els.zoomSelect.querySelector('[value="custom"]');
    custom.textContent = `${Math.round(S.scale * 100)}%`;
    els.zoomSelect.value = known ? zoomVal : 'custom';

    els.applyRange.hidden = els.applyScope.value !== 'range';
    S.thumbEls.forEach((t, i) => t.root.classList.toggle('active', i === S.cur));
  }

  const showBusy = (t) => { if (busyOn) busyText(t); else { busyOn = true; busy(t); } };
  const hideBusy = () => { if (busyOn) { busyOn = false; done(); } };
  let busyOn = false;

  /* ================= Wiring ================= */

  const openPicker = () => els.fileInput.click();
  els.btnOpen.addEventListener('click', openPicker);
  els.btnOpen2.addEventListener('click', openPicker);
  els.fileInput.addEventListener('change', () => {
    openFile(els.fileInput.files[0]);
    els.fileInput.value = '';
  });

  els.btnUndo.addEventListener('click', undo);
  els.btnRedo.addEventListener('click', redo);
  els.btnPrev.addEventListener('click', () => goTo(S.cur - 1));
  els.btnNext.addEventListener('click', () => goTo(S.cur + 1));
  els.pageInput.addEventListener('change', () => {
    const v = parseInt(els.pageInput.value, 10);
    if (Number.isFinite(v)) goTo(v - 1);
    els.pageInput.value = S.cur + 1;
  });

  els.btnZoomIn.addEventListener('click', () => zoomStep(1));
  els.btnZoomOut.addEventListener('click', () => zoomStep(-1));
  els.zoomSelect.addEventListener('change', () => {
    const v = els.zoomSelect.value;
    if (v === 'custom') return;
    setZoom(v === 'fit' || v === 'width' ? v : parseFloat(v));
  });

  els.previewToggle.addEventListener('change', () => {
    S.preview = els.previewToggle.checked;
    cancelDrag();
    updateOverlay();
    updateUI();
  });

  els.btnSave.addEventListener('click', save);
  els.btnSave2.addEventListener('click', save);
  els.btnNextTool.addEventListener('click', continueElsewhere);
  els.btnNextTool2.addEventListener('click', continueElsewhere);

  els.unitSelect.addEventListener('change', () => { if (S.doc) updateOverlay(); });
  els.marginInputs.forEach((input) => {
    input.addEventListener('change', onMarginChange);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  });

  els.btnAuto.addEventListener('click', autoDetect);
  els.btnAutoAll.addEventListener('click', autoDetectAll);
  els.btnRotL.addEventListener('click', () => rotate([S.cur], -90, tr('Rotate left')));
  els.btnRotR.addEventListener('click', () => rotate([S.cur], 90, tr('Rotate right')));
  els.btnRotAllL.addEventListener('click', () => rotate(S.pages.map((_, i) => i), -90, tr('Rotate all left')));
  els.btnRotAllR.addEventListener('click', () => rotate(S.pages.map((_, i) => i), 90, tr('Rotate all right')));
  els.btnClear.addEventListener('click', clearCrop);
  els.btnCopy.addEventListener('click', copyCrop);
  els.btnPaste.addEventListener('click', pasteCrop);
  els.applyScope.addEventListener('change', () => {
    updateUI();
    if (els.applyScope.value === 'range') els.applyRange.focus();
  });
  els.applyRange.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyToPages(); });
  els.btnApply.addEventListener('click', applyToPages);
  els.linkAll.addEventListener('change', updateUI);
  els.btnRevertPage.addEventListener('click', revertPage);
  els.btnRevertAll.addEventListener('click', revertAll);

  // Drag & drop anywhere on the window.
  let dragDepth = 0;
  listen(window, 'dragenter', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    dragDepth++;
    dropOverlay.hidden = false;
  });
  listen(window, 'dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOverlay.hidden = true;
  });
  listen(window, 'dragover', (e) => e.preventDefault());
  listen(window, 'drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    const file = [...e.dataTransfer.files].find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (file) openFile(file); else toast('Drop a PDF file.', 'error');
  });

  // Re-fit on resize.
  let resizeTimer = 0;
  const resizeObs = new ResizeObserver(() => {
    if (!els.viewer.isConnected) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (S.doc && typeof S.zoom === 'string') renderMain();
    }, 120);
  });
  resizeObs.observe(els.viewer);

  // Pinch, or Ctrl/Cmd + wheel, zooms freely around the pointer.
  const offZoom = onZoomGesture(els.viewer, (factor, cx, cy) => {
    if (!S.doc) return;
    const v = els.viewer;
    const before = els.stage.getBoundingClientRect();
    const fx = (cx - before.left) / before.width;
    const fy = (cy - before.top) / before.height;
    S.zoom = clamp(S.scale * factor, 0.1, 8);
    resizeMain();
    // Keep the same spot of the page under the pointer.
    const after = els.stage.getBoundingClientRect();
    v.scrollLeft += after.left + fx * after.width - cx;
    v.scrollTop += after.top + fy * after.height - cy;
  });
  cleanups.push(offZoom);

  listen(document, 'keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === 'o') { e.preventDefault(); openPicker(); return; }
    if (!S.doc) return;
    if (mod && key === 's') { e.preventDefault(); save(); return; }

    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); redo(); return; }
    if (mod && key === 'c') {
      if (String(window.getSelection())) return;
      e.preventDefault(); copyCrop(); return;
    }
    if (mod && key === 'v') { e.preventDefault(); pasteCrop(); return; }
    if (mod || e.altKey) return;

    switch (e.key) {
      case 'ArrowLeft': case 'PageUp': e.preventDefault(); goTo(S.cur - 1); break;
      case 'ArrowRight': case 'PageDown': e.preventDefault(); goTo(S.cur + 1); break;
      case 'Home': e.preventDefault(); goTo(0); break;
      case 'End': e.preventDefault(); goTo(S.pages.length - 1); break;
      case 'Delete': case 'Backspace': e.preventDefault(); clearCrop(); break;
      case 'Escape': cancelDrag(); break;
      case '+': case '=': zoomStep(1); break;
      case '-': case '_': zoomStep(-1); break;
      case '0': setZoom('fit'); break;
      default:
        if (key === 'a') autoDetect();
        else if (key === 'r') rotate([S.cur], e.shiftKey ? -90 : 90, tr(e.shiftKey ? 'Rotate left' : 'Rotate right'));
        else if (key === 'p') { els.previewToggle.checked = !els.previewToggle.checked; els.previewToggle.dispatchEvent(new Event('change')); }
    }
  });

  listen(window, 'beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  updateUI();

  // A PDF handed on from another tool opens straight away.
  const handed = Handoff.take();
  if (handed?.length) openFile(handed[0]);

  return () => {
    cleanups.forEach((fn) => fn());
    resizeObs.disconnect();
    if (S.doc) S.doc.destroy();
  };
}
