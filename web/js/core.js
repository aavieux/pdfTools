/* Shared helpers for all tools. */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Build a DOM element from an HTML string (first element). */
export function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function baseName(name) {
  return String(name || 'document').replace(/\.[^.]+$/, '');
}

export function extOf(name) {
  const m = /\.([^.]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} ${tr('B')}`;
  if (n < 1024 * 1024) return `${fmtNum(n / 1024, 1)} ${tr('KB')}`;
  return `${fmtNum(n / 1024 / 1024, 2)} ${tr('MB')}`;
}

/* ---------------- Feedback ---------------- */

export function toast(msg, type = '') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = type === 'error' ? '' : catSVG(resolveBuddy('main'), 1.5);
  el.appendChild(document.createTextNode(trMsg(msg)));
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  const life = type === 'error' ? 5000 : 2400;
  setTimeout(() => { el.style.opacity = '0'; }, life);
  setTimeout(() => el.remove(), life + 400);
}

let busyDepth = 0;
export function busy(text = 'Working…', sub = '') {
  busyDepth++;
  $('#busyText').textContent = trMsg(text);
  $('#busySub').textContent = trMsg(sub);
  $('#busy').hidden = false;
}
export function busyText(text, sub = '') {
  $('#busyText').textContent = trMsg(text);
  $('#busySub').textContent = trMsg(sub);
}
export function done() {
  busyDepth = Math.max(0, busyDepth - 1);
  if (!busyDepth) $('#busy').hidden = true;
}

/** Run an async job with the busy overlay and friendly error reporting. */
export async function withBusy(text, fn) {
  busy(text);
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast(e && e.message ? e.message : String(e), 'error');
    return undefined;
  } finally {
    done();
  }
}

export function celebrate() {
  if (typeof heartBurst === 'function') heartBurst();
}

/* ---------------- Files ---------------- */

export async function readBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

export function download(data, name, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function zipFiles(files) {
  const zip = new JSZip();
  const used = new Set();
  for (const f of files) {
    let name = f.name;
    for (let k = 2; used.has(name); k++) name = f.name.replace(/(\.[^.]+)?$/, ` (${k})$1`);
    used.add(name);
    zip.file(name, f.data instanceof Blob ? f.data : f.data);
  }
  return zip.generateAsync({ type: 'blob' });
}

export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

/* ---------------- Handing files on to another tool ---------------- */

/**
 * Files travel from one tool to the next without a download in between: send(files), then open
 * a tool, and its first drop zone (or the crop tool) opens them as if they had been dropped.
 * `current` is what the open tool is working on and `live`, when a tool sets it, builds that
 * file with the edits made so far; the “↪ Other tool” button in the top bar uses them.
 */
export const Handoff = {
  pending: null,
  current: [],
  live: null,
  listeners: new Set(),
  send(files) { this.pending = files; },
  take() { const f = this.pending; this.pending = null; return f; },
  note(files, append = false) {
    this.current = append ? [...this.current, ...files] : [...files];
    this.listeners.forEach((fn) => fn());
  },
  reset() { this.pending = null; this.live = null; this.note([]); },
  onChange(fn) { this.listeners.add(fn); },
};

/** A tool result ({ name, data, type }) as a File another tool can open. */
export function outputFile(o) {
  return o instanceof File ? o : new File([o.data instanceof Blob ? o.data : new Blob([o.data])], o.name, { type: o.type || o.data?.type || '' });
}

/** Open the “continue in another tool” picker (lives in handoff.js, loaded when needed). */
export async function continueWith(files, opts) {
  const { openToolPicker } = await import('./handoff.js');
  openToolPicker(files, opts);
}

export function acceptMatches(file, accept) {
  if (!accept || accept === '*') return true;
  const ext = `.${extOf(file.name)}`;
  return accept.split(',').map((s) => s.trim().toLowerCase()).some((a) =>
    a === ext || (a.endsWith('/*') && file.type.startsWith(a.slice(0, -1))) || a === file.type);
}

/**
 * A cute drop zone. Calls onFiles(files) with the accepted files.
 * Also accepts files dropped anywhere on the window while it is on screen.
 */
export function dropzone({ accept = '.pdf', multiple = false, title, hint = '', compact = false, onFiles }) {
  const label = trMsg(title || (multiple ? 'Drop your files here ♡' : 'Drop your file here ♡'));
  const el = h(`<div class="dropzone${compact ? ' compact' : ''}" tabindex="0" role="button">
      ${compact ? '' : '<span class="cat" data-cat="main" data-size="5"></span>'}
      <h2>${esc(label)}</h2>
      <p>${tr(multiple ? 'or click to choose files' : 'or click to choose a file')}${accept && accept !== '*' && !compact ? ` <span class="small">(${esc(accept.replaceAll(',', ', '))})</span>` : ''}</p>
      ${hint ? `<p class="note">${esc(trMsg(hint))}</p>` : ''}
    </div>`);
  const handle = (files) => {
    const ok = files.filter((f) => acceptMatches(f, accept));
    if (!ok.length) { toast(accept === '.pdf' ? tr('Please choose a PDF') : tr('Please choose a {type} file', { type: accept }), 'error'); return; }
    if (ok.length < files.length) toast(tr('Skipped {n} file(s) of the wrong type', { n: files.length - ok.length }), 'error');
    const chosen = multiple ? ok : [ok[0]];
    Handoff.note(chosen, compact);
    onFiles(chosen);
  };
  el.addEventListener('click', async () => handle(await pickFiles({ accept: accept === '*' ? '' : accept, multiple })));
  el.addEventListener('keydown', async (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('over');
    handle([...e.dataTransfer.files]);
  });
  el._handle = handle;
  // Files handed on from another tool open in the first drop zone of the new tool.
  const handed = Handoff.take();
  if (handed) setTimeout(() => { if (el.isConnected) handle(handed); }, 0);
  return el;
}

/* ---------------- PDF helpers ---------------- */

/** Open with pdf.js, asking for a password if needed. */
export async function openPdfjs(bytes, name = 'PDF') {
  const task = pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false });
  task.onPassword = (update, reason) => {
    const pw = prompt(reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD
      ? tr('Wrong password for {name}. Try again:', { name }) : tr('{name} is password protected. Password:', { name }));
    if (pw === null) task.destroy(); else update(pw);
  };
  try {
    return await task.promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error(tr('{name} needs a password. Use “Unlock PDF” first ♡', { name }));
    throw new Error(tr('Could not read {name}: {error}', { name, error: e.message || e }));
  }
}

/** Open with pdf-lib for editing. */
export async function openPdfLib(bytes, name = 'PDF') {
  try {
    return await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(String(e.message))) {
      try {
        return await PDFLib.PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
      } catch { /* fall through */ }
      throw new Error(tr('{name} is encrypted. Use “Unlock PDF” first ♡', { name }));
    }
    throw new Error(tr('Could not read {name}: {error}', { name, error: e.message || e }));
  }
}

export async function savePdf(doc) {
  return doc.save({ useObjectStreams: true });
}

let fontCache = null;
/** Unicode font (Noto Sans) for text drawn into PDFs. */
export async function embedFont(doc, bold = false) {
  doc.registerFontkit(fontkit);
  fontCache ||= {};
  const key = bold ? 'b' : 'r';
  if (!fontCache[key]) {
    const res = await fetch(`vendor/fonts/NotoSans-${bold ? 'Bold' : 'Regular'}.ttf`);
    fontCache[key] = new Uint8Array(await res.arrayBuffer());
  }
  return doc.embedFont(fontCache[key], { subset: true });
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export const PAGE_SIZES = {
  A0: [2383.94, 3370.39], A1: [1683.78, 2383.94], A2: [1190.55, 1683.78], A3: [841.89, 1190.55],
  A4: [595.28, 841.89], A5: [419.53, 595.28], A6: [297.64, 419.53], B4: [708.66, 1000.63], B5: [498.9, 708.66],
  Letter: [612, 792], Legal: [612, 1008], Tabloid: [792, 1224], Executive: [521.86, 756],
};
export const MM = 72 / 25.4;

/** Render a pdf.js page into a new canvas. */
export async function renderPage(page, { width, scale, rotation, maxPixels = 16e6 } = {}) {
  const rot = rotation ?? page.rotate;
  const base = page.getViewport({ scale: 1, rotation: rot });
  let s = scale ?? (width ? width / base.width : 1);
  s = Math.min(s, Math.sqrt(maxPixels / (base.width * base.height)));
  const vp = page.getViewport({ scale: s, rotation: rot });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

/** Sequential render queue so dozens of thumbnails don't freeze the tab. */
let queue = Promise.resolve();
export function queueRender(fn) {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
}

/** Lazily render a thumbnail of page `index` (0-based) into `box` when it becomes visible. */
const lazyObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    lazyObserver.unobserve(e.target);
    e.target._render?.();
  }
}, { rootMargin: '300px' });

export function lazyThumb(box, doc, index, { width = 160, rotation = 0 } = {}) {
  box._render = () => queueRender(async () => {
    if (!box.isConnected) return;
    const page = await doc.getPage(index + 1);
    const canvas = await renderPage(page, { width: width * (window.devicePixelRatio || 1), rotation: (page.rotate + rotation) % 360 });
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.maxWidth = `${width}px`;
    box.replaceChildren(canvas);
  });
  lazyObserver.observe(box);
}

export function parseRange(text, count) {
  const out = [];
  const parts = String(text).split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) throw new Error(tr('Please enter pages, e.g. 1-3, 5'));
  for (const part of parts) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    if (m) {
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : count;
      if (a < 1 || b > count || a > b) throw new Error(tr('Invalid range “{part}” (the document has {count} pages)', { part, count }));
      for (let k = a; k <= b; k++) out.push(k - 1);
    } else if (/^\d+$/.test(part)) {
      const k = parseInt(part, 10);
      if (k < 1 || k > count) throw new Error(tr('Page {k} does not exist (the document has {count} pages)', { k, count }));
      out.push(k - 1);
    } else {
      throw new Error(tr('Cannot understand “{part}”', { part }));
    }
  }
  return out;
}

/** Page selection helper used by many tools: all / range / odd / even. */
export function pagesFromChoice(choice, rangeText, count) {
  const all = [...Array(count).keys()];
  if (choice === 'odd') return all.filter((i) => i % 2 === 0);
  if (choice === 'even') return all.filter((i) => i % 2 === 1);
  if (choice === 'range') return [...new Set(parseRange(rangeText, count))].sort((a, b) => a - b);
  return all;
}

/* ---------------- Images ---------------- */

export async function loadImage(src) {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

/* ---------------- Server API ---------------- */

async function apiFetch(path, { file, files, fields = {}, json } = {}) {
  let body;
  const headers = {};
  if (json !== undefined && !file && !files) {
    body = JSON.stringify(json);
    headers['Content-Type'] = 'application/json';
  } else {
    body = new FormData();
    if (file) body.append('file', file, file.name || 'file');
    for (const f of files || []) body.append('files', f, f.name || 'file');
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    if (json !== undefined) body.append('data', JSON.stringify(json));
  }
  let res;
  try {
    res = await fetch(path, { method: 'POST', body, headers });
  } catch {
    throw new Error(tr('Cannot reach the NAS server. Is the container running? ♡'));
  }
  if (!res.ok) {
    let msg = tr('Server error {status}', { status: res.status });
    try {
      const j = await res.json();
      msg = j.detail || j.error || msg;
    } catch { /* not JSON */ }
    if (res.status === 404 && location.protocol === 'file:') msg = 'This tool needs the NAS server; open the app from the container.';
    if (res.status === 413) msg = 'That file is too big for the server.';
    throw new Error(trMsg(msg));
  }
  return res;
}

export async function apiBlob(path, opts) {
  const res = await apiFetch(path, opts);
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  blob.filename = m ? decodeURIComponent(m[1] || m[2]) : undefined;
  blob.headers = res.headers;
  return blob;
}

/** Print an HTML document to PDF with the NAS's Chromium. */
export async function htmlToPdf(html, name = 'document') {
  return apiBlob('/api/html-to-pdf', { json: { html, name } });
}

export async function apiJson(path, opts) {
  const res = await apiFetch(path, opts);
  return res.json();
}

/* ---------------- Zooming ---------------- */

/**
 * Call cb(factor, clientX, clientY) when the user zooms over `el`: Ctrl/⌘ + mouse wheel,
 * trackpad pinch (Chrome, Edge, Firefox send it as Ctrl + wheel; Safari as gesture events)
 * and two-finger pinch on touch screens. Returns a function that removes the listeners.
 */
export function onZoomGesture(el, cb) {
  const wheel = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    cb(clamp(Math.exp(-dy * 0.01), 0.8, 1.25), e.clientX, e.clientY);
  };
  let gestureScale = 1;
  const gStart = (e) => { e.preventDefault(); gestureScale = 1; };
  const gChange = (e) => {
    e.preventDefault();
    cb(e.scale / gestureScale, e.clientX, e.clientY);
    gestureScale = e.scale;
  };
  const touches = new Map();
  let pinchDist = 0;
  const dist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const tDown = (e) => {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) pinchDist = dist();
  };
  const tMove = (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size !== 2 || !pinchDist) return;
    const d = dist();
    const [a, b] = [...touches.values()];
    cb(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinchDist = d;
  };
  const tUp = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinchDist = 0; };
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('gesturestart', gStart);
  el.addEventListener('gesturechange', gChange);
  el.addEventListener('pointerdown', tDown);
  el.addEventListener('pointermove', tMove);
  el.addEventListener('pointerup', tUp);
  el.addEventListener('pointercancel', tUp);
  return () => {
    el.removeEventListener('wheel', wheel);
    el.removeEventListener('gesturestart', gStart);
    el.removeEventListener('gesturechange', gChange);
    el.removeEventListener('pointerdown', tDown);
    el.removeEventListener('pointermove', tMove);
    el.removeEventListener('pointerup', tUp);
    el.removeEventListener('pointercancel', tUp);
  };
}

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/**
 * − [zoom ▾] + controls for anything with { scale, zoom, setZoom(z), zoomBy(factor), onZoom }.
 * `fit` is the name of the automatic mode ('width' or 'fit'). Keeps itself in sync when the
 * user pinches or Ctrl+scrolls.
 */
export function zoomControls(target, { fit = 'width', fitLabel = 'Fit width' } = {}) {
  const el = h(`<div class="zoombar" title="${esc(tr('Tip: pinch, or hold Ctrl/⌘ and scroll, to zoom'))}">
      <button type="button" class="btn icon" data-z="-1" title="${esc(tr('Zoom out'))}">−</button>
      <select aria-label="${esc(tr('Zoom'))}"><option value="${fit}">${esc(tr(fitLabel))}</option>${ZOOM_PRESETS.map((z) => `<option value="${z}">${Math.round(z * 100)}%</option>`).join('')}<option value="custom" hidden></option></select>
      <button type="button" class="btn icon" data-z="1" title="${esc(tr('Zoom in'))}">+</button>
    </div>`);
  const sel = el.querySelector('select');
  const custom = sel.querySelector('[value="custom"]');
  const sync = () => {
    if (target.zoom === fit) { sel.value = fit; return; }
    const known = ZOOM_PRESETS.find((z) => Math.abs(z - target.scale) < 0.005);
    if (known) { sel.value = String(known); return; }
    custom.textContent = `${Math.round(target.scale * 100)}%`;
    sel.value = 'custom';
  };
  sel.onchange = () => { if (sel.value !== 'custom') target.setZoom(sel.value === fit ? fit : parseFloat(sel.value)); };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-z]');
    if (b) target.zoomBy(b.dataset.z > 0 ? 1.25 : 0.8);
  });
  const prev = target.onZoom;
  target.onZoom = (...a) => { prev?.(...a); sync(); };
  sync();
  return el;
}

/**
 * A single-canvas preview the user can zoom and scroll freely. `draw(pixelWidth)` must return a
 * canvas rendered at that width; it is called again (debounced) after zooming for a sharp image.
 */
export function zoomablePreview(box, draw) {
  const view = { zoom: 'width', scale: 1, base: 1, canvas: null, seq: 0 };
  let timer = 0;
  const fitWidth = () => Math.max(120, Math.min(560, box.clientWidth - 40));
  const cssWidth = () => (view.zoom === 'width' ? fitWidth() : fitWidth() * view.scale);
  const apply = () => { if (view.canvas) view.canvas.style.width = `${cssWidth()}px`; };
  const redraw = async () => {
    const my = ++view.seq;
    const w = cssWidth();
    const canvas = await draw(Math.min(8000, w * (window.devicePixelRatio || 1)));
    if (!canvas || my !== view.seq) return;
    canvas.style.boxShadow = 'var(--shadow-lg)';
    view.canvas = canvas;
    apply();
    box.replaceChildren(canvas);
  };
  view.setZoom = (z) => {
    view.zoom = z;
    view.scale = z === 'width' ? 1 : clamp(z, 0.25, 8);
    apply();
    clearTimeout(timer);
    timer = setTimeout(redraw, 150);
    view.onZoom?.();
  };
  view.zoomBy = (f, cx, cy) => {
    const r = box.getBoundingClientRect();
    const ox = (cx ?? r.left + r.width / 2) - r.left;
    const oy = (cy ?? r.top + r.height / 2) - r.top;
    const old = view.scale;
    const px = box.scrollLeft + ox;
    const py = box.scrollTop + oy;
    view.setZoom(clamp(old * f, 0.25, 8));
    const k = view.scale / old;
    box.scrollLeft = px * k - ox;
    box.scrollTop = py * k - oy;
  };
  view.refresh = redraw;
  box.classList.add('zoomable');
  view.off = onZoomGesture(box, (f, x, y) => view.zoomBy(f, x, y));
  new ResizeObserver(() => { if (view.zoom === 'width') apply(); }).observe(box);
  return view;
}

/* ---------------- Layout pieces ---------------- */

export function toolHeader(tool) {
  return `<div class="tool-head" style="--c:${tool.color}">
    <div class="card-ico">${tool.icon}</div>
    <div><h1>${esc(tool.name)}</h1><p>${esc(tool.desc)} · <span class="small">${tr(tool.nas ? 'runs on your NAS' : 'stays in your browser')}</span></p></div>
    <span class="cat" data-cat="friend" data-n="${tool.id.length}" data-size="3"></span>
  </div>`;
}

/**
 * Options form from a small spec.
 * Field: { name, label, type: text|number|select|checkbox|color|range|password|textarea|radio|date,
 *          options: [[value, label]], value, min, max, step, hint, placeholder, show: (vals) => bool }
 */
export function optionsForm(spec, onChange) {
  const el = h('<div class="fields"></div>');
  const rows = [];
  for (const f of spec) {
    let ctrl;
    const id = `f_${f.name}_${Math.random().toString(36).slice(2, 7)}`;
    const attrs = `id="${id}" name="${f.name}"${f.placeholder ? ` placeholder="${esc(tr(f.placeholder))}"` : ''}${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}${f.step !== undefined ? ` step="${f.step}"` : ''}`;
    if (f.type === 'select') {
      ctrl = `<select ${attrs}>${f.options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(f.value) ? ' selected' : ''}>${esc(tr(l))}</option>`).join('')}</select>`;
    } else if (f.type === 'radio') {
      ctrl = `<div class="radio-tiles">${f.options.map(([v, l]) => `<label><input type="radio" name="${id}" value="${esc(v)}"${String(v) === String(f.value) ? ' checked' : ''}>${esc(tr(l))}</label>`).join('')}</div>`;
    } else if (f.type === 'checkbox') {
      ctrl = `<input type="checkbox" ${attrs}${f.value ? ' checked' : ''}>`;
    } else if (f.type === 'textarea') {
      ctrl = `<textarea ${attrs} rows="${f.rows || 4}">${esc(f.value ?? '')}</textarea>`;
    } else if (f.type === 'range') {
      ctrl = `<div class="row"><input type="range" ${attrs} value="${esc(f.value ?? '')}" style="flex:1"><output>${esc(f.value ?? '')}</output>${f.unit ? `<span class="muted small">${esc(tr(f.unit))}</span>` : ''}</div>`;
    } else {
      ctrl = `<input type="${f.type || 'text'}" ${attrs} value="${esc(f.value ?? '')}">`;
    }
    const row = f.type === 'checkbox'
      ? h(`<label class="field check" for="${id}">${ctrl}<span>${esc(tr(f.label))}</span></label>`)
      : h(`<label class="field"${f.type === 'radio' ? '' : ` for="${id}"`}><span>${esc(tr(f.label))}</span>${ctrl}${f.hint ? `<span class="hint">${esc(tr(f.hint))}</span>` : ''}</label>`);
    rows.push([f, row]);
    el.appendChild(row);
  }
  const values = () => {
    const v = {};
    for (const [f, row] of rows) {
      if (f.type === 'radio') v[f.name] = row.querySelector('input:checked')?.value;
      else if (f.type === 'checkbox') v[f.name] = row.querySelector('input').checked;
      else if (f.type === 'number' || f.type === 'range') v[f.name] = parseFloat(row.querySelector('input').value);
      else v[f.name] = row.querySelector('input,select,textarea').value;
    }
    return v;
  };
  const refresh = () => {
    const v = values();
    for (const [f, row] of rows) {
      if (f.show) row.hidden = !f.show(v);
      if (f.type === 'range') row.querySelector('output').textContent = row.querySelector('input').value;
    }
  };
  el.addEventListener('input', () => { refresh(); onChange?.(values()); });
  el.addEventListener('change', () => { refresh(); onChange?.(values()); });
  refresh();
  return { el, values, refresh, set(name, value) {
    const row = rows.find(([f]) => f.name === name)?.[1];
    if (!row) return;
    const input = row.querySelector('input,select,textarea');
    if (input.type === 'radio') row.querySelectorAll('input').forEach((r) => { r.checked = r.value === String(value); });
    else if (input.type === 'checkbox') input.checked = !!value; else input.value = value;
    refresh();
  } };
}

/** Pages field spec: all / odd / even / range. */
export const PAGES_FIELDS = [
  { name: 'pages', label: 'Pages', type: 'select', value: 'all', options: [['all', 'All pages'], ['odd', 'Odd pages'], ['even', 'Even pages'], ['range', 'Page range…']] },
  { name: 'range', label: 'Page range', type: 'text', placeholder: 'e.g. 1-3, 5, 8-', show: (v) => v.pages === 'range' },
];

/**
 * Show a result card with download buttons.
 * outputs: [{ name, data (Blob|Uint8Array), type }]
 */
export function showResult(container, outputs, { title = 'All done! ♡', again, extra = '', zipName = 'maria-pdf-tools.zip' } = {}) {
  const blobs = outputs.map((o) => ({ ...o, blob: o.data instanceof Blob ? o.data : new Blob([o.data], { type: o.type || 'application/octet-stream' }) }));
  // ZIPs can't be opened by any tool, so only the other files can be handed on.
  const onward = blobs.filter((b) => extOf(b.name) !== 'zip').map((b) => outputFile({ name: b.name, data: b.blob, type: b.blob.type }));
  const el = h(`<div class="result">
      <span class="cat bounce" data-cat="friend" data-n="${Math.floor(Math.random() * 12)}" data-size="5"></span>
      <h2>${esc(trMsg(title))}</h2>
      ${extra}
      ${blobs.length > 1 ? `<p class="muted small">${tr('{n} files · your browser may ask once whether this page may download several files ✿', { n: blobs.length })}</p><ul class="result-list">${blobs.map((b, i) => `<li><span>${esc(b.name)} <span class="muted small">${fmtBytes(b.blob.size)}</span></span><button class="btn" data-i="${i}">${tr('Download')}</button></li>`).join('')}</ul>` : ''}
      <div class="row">
        ${blobs.length === 1 ? `<button class="btn primary big" data-dl>${tr('Download')} ${esc(blobs[0].name)} <span class="small">(${fmtBytes(blobs[0].blob.size)})</span></button>` : ''}
        ${blobs.length > 1 ? `<button class="btn primary big" data-all>${tr('⬇ Download all {n} files', { n: blobs.length })}</button><button class="btn big" data-zip>${tr('🗜 Download as ZIP')}</button>` : ''}
        ${blobs.length === 1 && blobs[0].blob.type === 'application/pdf' ? `<button class="btn" data-view>${tr('Preview')}</button>` : ''}
        ${again ? `<button class="btn" data-again>${tr('↺ Start over')}</button>` : ''}
      </div>
      ${onward.length ? `<div class="row onward"><span class="muted small">${tr('What next?')}</span>
        <button class="btn" data-next="save">${tr('💾 Save & open in another tool')}</button>
        <button class="btn" data-next="">${tr('↪ Open in another tool without saving')}</button></div>` : ''}
    </div>`);
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.i !== undefined) download(blobs[+b.dataset.i].blob, blobs[+b.dataset.i].name);
    if (b.hasAttribute('data-dl')) download(blobs[0].blob, blobs[0].name);
    if (b.hasAttribute('data-view')) window.open(URL.createObjectURL(blobs[0].blob), '_blank');
    if (b.hasAttribute('data-zip')) download(await zipFiles(blobs.map((x) => ({ name: x.name, data: x.blob }))), zipName);
    if (b.hasAttribute('data-all')) {
      // One after the other: browsers drop downloads that start at the same moment.
      b.disabled = true;
      for (const x of blobs) { download(x.blob, x.name); await sleep(350); }
      b.disabled = false;
    }
    if (b.hasAttribute('data-again')) again();
    if (b.dataset.next !== undefined) continueWith(onward, { save: b.dataset.next === 'save' });
  });
  container.replaceChildren(el);
  celebrate();
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return el;
}

/**
 * Sortable list of chosen files with thumbnails. Returns { el, files(), add(files) }.
 */
export function fileList({ sortable = true, onChange } = {}) {
  const el = h('<div class="files"></div>');
  let items = [];
  const renumber = () => $$('.file-card', el).forEach((c, i) => { c.querySelector('.num').textContent = i + 1; });
  const render = async (item) => {
    const card = h(`<div class="file-card" data-id="${item.id}">
        <span class="num"></span><button class="x" title="${esc(tr('Remove'))}">✕</button>
        <div class="thumb-box"><span class="cat sleeping" data-cat="friend" data-n="2" data-size="3"></span></div>
        <div class="fname" title="${esc(item.file.name)}">${esc(item.file.name)}</div>
        <div class="fmeta">${fmtBytes(item.file.size)}</div>
      </div>`);
    card.querySelector('.x').onclick = () => {
      items = items.filter((x) => x !== item);
      card.remove();
      renumber();
      onChange?.(items.map((x) => x.file));
    };
    el.appendChild(card);
    renumber();
    const box = card.querySelector('.thumb-box');
    const ext = extOf(item.file.name);
    try {
      if (ext === 'pdf') {
        const doc = await openPdfjs(await readBytes(item.file), item.file.name);
        item.pages = doc.numPages;
        card.querySelector('.fmeta').textContent = `${fmtBytes(item.file.size)} · ${trn(doc.numPages, '{n} page', '{n} pages')}`;
        const page = await doc.getPage(1);
        const c = await queueRender(() => renderPage(page, { width: 260 }));
        box.replaceChildren(c);
      } else if (/^image\//.test(item.file.type) && !/hei[cf]|tiff/.test(item.file.type)) {
        const img = new Image();
        img.src = URL.createObjectURL(item.file);
        box.replaceChildren(img);
      } else {
        box.innerHTML = `<div style="font-size:34px">📄</div><div class="small muted">.${esc(ext)}</div>`;
      }
    } catch (e) {
      box.innerHTML = '<div style="font-size:30px">🙀</div>';
      card.querySelector('.fmeta').textContent = trMsg(e.message);
    }
  };
  if (sortable) {
    Sortable.create(el, {
      animation: 180,
      filter: '.x',
      onEnd: () => {
        const order = $$('.file-card', el).map((c) => c.dataset.id);
        items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        renumber();
        onChange?.(items.map((x) => x.file));
      },
    });
  }
  return {
    el,
    files: () => items.map((x) => x.file),
    items: () => items,
    add(files) {
      for (const file of files) {
        const item = { id: Math.random().toString(36).slice(2), file };
        items.push(item);
        render(item);
      }
      onChange?.(items.map((x) => x.file));
    },
    clear() { items = []; el.replaceChildren(); onChange?.([]); },
  };
}

/** Outputs marked `unzip` (ZIPs made by the server) become their separate files. */
async function unpackZips(outputs) {
  if (!outputs) return outputs;
  const out = [];
  for (const o of outputs) {
    if (!o.unzip) { out.push(o); continue; }
    const zip = await JSZip.loadAsync(o.data);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const n of names) out.push({ name: n.split('/').pop(), data: await zip.files[n].async('blob') });
  }
  return out;
}

/**
 * The common "choose files → set options → go → download" flow.
 * cfg: { tool, accept, multiple, manyOutputs, fields, actionLabel, intro, run: async (files, values, ctx) => outputs[] }
 * Outputs may set `unzip: true` to be unpacked into their files; when several files come out the
 * user can ask for one ZIP instead (manyOutputs shows that option even for a single input).
 */
export function simpleTool(root, cfg) {
  const { tool } = cfg;
  root.innerHTML = `<div class="tool">${toolHeader(tool)}<div class="stack" id="st"></div></div>`;
  const st = $('#st', root);
  const start = () => {
    const dz = dropzone({
      accept: cfg.accept ?? '.pdf',
      multiple: !!cfg.multiple,
      title: cfg.dropTitle,
      hint: cfg.hint || (tool.nas ? 'your files go only to your own NAS ✿' : 'your files never leave this browser ✿'),
      onFiles: (files) => configure(files),
    });
    st.replaceChildren(dz);
    if (cfg.intro) st.appendChild(h(`<p class="note sticky">${tr(cfg.intro)}</p>`));
  };
  const configure = (files) => {
    const list = fileList({ sortable: !!cfg.multiple });
    let schedulePreview = () => {};
    const spec = typeof cfg.fields === 'function' ? cfg.fields(files) : (cfg.fields || []);
    // Several files coming out? Ask whether to pack them into a ZIP (off by default).
    const zipOption = cfg.manyOutputs || files.length > 1;
    const form = optionsForm(zipOption ? [...spec, { name: 'zip', label: 'Make a ZIP file', type: 'checkbox', value: false, hint: 'Leave it off to get the files one by one. You can still choose on the next screen.' }] : spec, () => schedulePreview());
    const layout = h(`<div class="cols">
        <div class="stack" id="left"></div>
        <div class="panel-box stack sticky-side" id="right">
          <h3 style="margin:0;color:var(--accent)">${tr('♡ Options')}</h3>
        </div>
      </div>`);
    const left = $('#left', layout);
    const right = $('#right', layout);
    left.appendChild(list.el);
    if (cfg.multiple) {
      const more = dropzone({ accept: cfg.accept ?? '.pdf', multiple: true, compact: true, title: '+ Add more files', onFiles: (f) => list.add(f) });
      left.appendChild(more);
      if (list && cfg.sortHint !== false) left.appendChild(h(`<p class="note">${tr('psst~ drag the cards to change the order ♡')}</p>`));
    }
    if (spec.length || zipOption) right.appendChild(form.el);
    else right.appendChild(h(`<p class="muted small" style="margin:0">${tr('No options needed ~ just press the button ✿')}</p>`));
    if (cfg.extraPanel) right.appendChild(cfg.extraPanel(form));
    const go = h(`<button class="btn primary big wide">${esc(cfg.actionLabel ? tr(cfg.actionLabel) : tool.name)} ♡</button>`);
    right.appendChild(go);
    const result = h('<div></div>');
    st.replaceChildren(layout, result);
    list.add(files);
    if (cfg.preview) {
      // Live preview: run the tool on the first file and show the first page of the result.
      const box = h(`<div class="panel-box stack"><div class="row between"><h3 style="margin:0;color:var(--accent)">${tr('♡ Preview')} <span class="muted small">${tr('(first page)')}</span></h3></div><div class="sheet-wrap" style="min-height:200px;max-height:75vh"></div></div>`);
      left.appendChild(box);
      const wrap = $('.sheet-wrap', box);
      let page = null;
      const zoom = zoomablePreview(wrap, (px) => page && renderPage(page, { width: px }));
      $('.row', box).appendChild(zoomControls(zoom));
      let timer = 0;
      let seq = 0;
      let doc = null;
      schedulePreview = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const my = ++seq;
          const chosen = list.files();
          if (!chosen.length) return;
          try {
            const outs = await cfg.run(chosen.slice(0, 1), form.values(), { preview: true, items: list.items() });
            const first = outs?.[0];
            if (!first || my !== seq) return;
            const bytes = first.data instanceof Blob ? new Uint8Array(await first.data.arrayBuffer()) : first.data;
            const next = await pdfjsLib.getDocument({ data: bytes }).promise;
            if (my !== seq) { next.destroy(); return; }
            doc?.destroy();
            doc = next;
            page = await doc.getPage(1);
            await zoom.refresh();
          } catch (e) {
            if (my === seq) wrap.innerHTML = `<p class="muted">${esc(trMsg(e.message))}</p>`;
          }
        }, 350);
      };
      schedulePreview();
    }
    go.onclick = async () => {
      const chosen = list.files();
      if (!chosen.length) { toast('Add a file first ♡', 'error'); return; }
      const { zip, ...values } = form.values();
      const zipName = `${baseName(chosen[0].name)}${chosen.length > 1 ? '-and-more' : ''}.zip`;
      let outputs = await withBusy(cfg.busyText || 'Working on it…', async () => unpackZips(await cfg.run(chosen, values, { items: list.items() })));
      if (outputs && outputs.length) {
        const extra = cfg.resultExtra ? cfg.resultExtra(outputs, chosen) : '';
        if (zip && outputs.length > 1) outputs = [{ name: zipName, data: await zipFiles(outputs.map((o) => ({ name: o.name, data: o.data }))), type: 'application/zip' }];
        showResult(result, outputs, { again: start, extra, zipName });
      }
    };
  };
  start();
}
