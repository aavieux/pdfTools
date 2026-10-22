import { $, esc, h, htmlToPdf, pickFiles, showResult, toolHeader, withBusy, zoomControls } from '../core.js';
import { createDesigner, exportHTML, photoFromFile, stickerPicker } from '../designer.js';

const SIZES = { 'A4 portrait': [210, 297], 'A4 landscape': [297, 210], 'Square 20 cm': [200, 200], 'Letter portrait': [215.9, 279.4], 'Postcard': [148, 105], 'Instagram 4:5': [160, 200] };
const MAX_PHOTOS = 24;

/* ---------------- Themes ----------------
 * bg: page background · gap/margin: mm · radius: corner mm · frame/frameBottom: border mm
 * jitter: random tilt in degrees · style: preferred layout · title: heading text · tape / stickers: decorations
 */
const KRAFT = 'repeating-linear-gradient(0deg, rgba(120,80,40,.05) 0 2px, transparent 2px 5px), #d8c1a0';
const THEMES = [
  { id: 'clean', group: 'Minimal', name: 'Clean', bg: '#ffffff', gap: 3, margin: 8 },
  { id: 'edge', group: 'Minimal', name: 'Edge to edge', bg: '#ffffff', gap: 0, margin: 0 },
  { id: 'gallery', group: 'Minimal', name: 'Gallery', bg: '#f6f4f0', gap: 10, margin: 18, frame: 4, frameColor: '#ffffff', shadow: true },
  { id: 'lines', group: 'Minimal', name: 'Thin lines', bg: '#ffffff', gap: 6, margin: 12, frame: 0.35, frameColor: '#222222', shadow: false },
  { id: 'linen', group: 'Minimal', name: 'Linen', bg: '#eee7db', gap: 5, margin: 12, radius: 1.5 },
  { id: 'noir', group: 'Minimal', name: 'Noir', bg: '#111111', gap: 2, margin: 6 },
  { id: 'pink', group: 'Cute', name: 'Pink dream', bg: '#fff5f9', gap: 4, margin: 8, radius: 3, frame: 2.5, frameColor: '#ffffff', shadow: true,
    title: { text: tr('Our memories ♡'), font: 'Pacifico', color: '#ec4d8f' } },
  { id: 'polaroid', group: 'Cute', name: 'Polaroids', bg: '#efe6d8', gap: 4, margin: 8, frame: 3, frameBottom: 11, frameColor: '#ffffff', shadow: true, style: 'scatter',
    title: { text: tr('summer days ☀'), font: 'Caveat', color: '#5b4636' } },
  { id: 'scrapbook', group: 'Cute', name: 'Scrapbook', bg: KRAFT, gap: 9, margin: 11, frame: 2, frameColor: '#fffdf6', shadow: true, jitter: 4, tape: true,
    title: { text: tr('little moments'), font: 'Caveat', color: '#4a3424' } },
  { id: 'pastel', group: 'Cute', name: 'Pastel dots', bg: 'radial-gradient(#f7cfe0 1.2px, #ffffff 1.3px) 0 0/14px 14px', gap: 5, margin: 9, radius: 4 },
  { id: 'love', group: 'Cute', name: 'Love', bg: '#ffe4ee', gap: 5, margin: 12, radius: 3, frame: 2, frameColor: '#ffffff', shadow: true,
    title: { text: tr('with love ♡'), font: 'Pacifico', color: '#d6336c' }, stickers: ['heart', '💖', 'heart', '🌸'] },
  { id: 'night', group: 'Cute', name: 'Starry night', bg: 'radial-gradient(#ffffff 0.7px, transparent 1px) 0 0/19px 19px, radial-gradient(#fff6 0.6px, transparent 1px) 9px 11px/23px 23px, #1f2340',
    gap: 4, margin: 9, radius: 2, frame: 1.5, frameColor: '#e9e4ff', shadow: true, title: { text: tr('✨ good times ✨'), font: 'Pacifico', color: '#ffe8a3' } },
];
const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));
const BGS = ['#ffffff', '#f6f4f0', '#111111', '#fff5f9', '#ffe4ee', '#fdf2c4', '#e7f6ee', '#e8eefc', '#f1e8ff', '#2e1a25'];
const TAPE = ['#f9c5d5', '#bfe3d0', '#fde68a', '#c7d2fe', '#fbcfe8'];

/* ---------------- Layouts for any number of photos ----------------
 * Each returns rectangles {x, y, w, h, rot} in % of the usable area. `aspect` is its real width / height.
 */
function seeded(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** n cells in a rectangle, as square-ish as possible; a short last row is stretched to fill. */
function grid(n, r, aspect, { cols } = {}) {
  let c = cols;
  if (!c) {
    let best = Infinity;
    for (let k = 1; k <= n; k++) {
      const rows = Math.ceil(n / k);
      const cell = ((r.w / k) / (r.h / rows)) * aspect;
      const score = Math.abs(Math.log(cell)) + (k * rows - n) * 0.25;
      if (score < best) { best = score; c = k; }
    }
  }
  const rows = Math.ceil(n / c);
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / c);
    const inRow = row === rows - 1 ? n - row * c : c;
    const col = i - row * c;
    out.push({ x: r.x + (col * r.w) / inRow, y: r.y + (row * r.h) / rows, w: r.w / inRow, h: r.h / rows });
  }
  return out;
}

/** Split recursively into two groups along the longer side. */
function mosaic(n, r, aspect, rnd) {
  if (n === 1) return [r];
  const a = Math.max(1, Math.min(n - 1, Math.round(n / 2 + (rnd() - 0.5))));
  const t = Math.min(0.75, Math.max(0.25, a / n + (rnd() - 0.5) * 0.2));
  if ((r.w / r.h) * aspect >= 1) {
    return [...mosaic(a, { ...r, w: r.w * t }, aspect, rnd), ...mosaic(n - a, { ...r, x: r.x + r.w * t, w: r.w * (1 - t) }, aspect, rnd)];
  }
  return [...mosaic(a, { ...r, h: r.h * t }, aspect, rnd), ...mosaic(n - a, { ...r, y: r.y + r.h * t, h: r.h * (1 - t) }, aspect, rnd)];
}

const FULL = { x: 0, y: 0, w: 100, h: 100 };
const LAYOUTS = {
  grid: { name: 'Grid', make: (n, a) => grid(n, FULL, a) },
  feature: {
    name: 'Big + small',
    make: (n, a) => {
      if (n === 1) return [FULL];
      if (a >= 1) return [{ x: 0, y: 0, w: 62, h: 100 }, ...grid(n - 1, { x: 62, y: 0, w: 38, h: 100 }, a)];
      return [{ x: 0, y: 0, w: 100, h: 60 }, ...grid(n - 1, { x: 0, y: 60, w: 100, h: 40 }, a)];
    },
  },
  mosaic: { name: 'Mosaic', make: (n, a, rnd) => mosaic(n, FULL, a, rnd) },
  masonry: {
    name: 'Masonry',
    make: (n, a, rnd) => {
      const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * a))));
      const out = [];
      for (let c = 0; c < cols; c++) {
        const k = Math.floor(n / cols) + (c < n % cols ? 1 : 0);
        const hs = Array.from({ length: k }, () => 0.7 + rnd() * 0.6);
        const sum = hs.reduce((s, v) => s + v, 0);
        let y = 0;
        hs.forEach((v) => { out.push({ x: (c * 100) / cols, y, w: 100 / cols, h: (v / sum) * 100 }); y += (v / sum) * 100; });
      }
      return out;
    },
  },
  strips: { name: 'Strips', max: 8, make: (n, a) => grid(n, FULL, a, { cols: a >= 1 ? n : 1 }) },
  scatter: {
    name: 'Polaroids',
    make: (n, a, rnd) => grid(n, FULL, a).map((r) => {
      const s = 0.8;
      return { x: r.x + r.w * ((1 - s) / 2 + (rnd() - 0.5) * 0.1), y: r.y + r.h * ((1 - s) / 2 + (rnd() - 0.5) * 0.1), w: r.w * s, h: r.h * s, rot: (rnd() - 0.5) * 14 };
    }),
  },
};

/** Tiny SVG preview of a layout for the picker. */
function layoutPreview(key, n, aspect, seed) {
  const rects = LAYOUTS[key].make(n, aspect, seeded(seed));
  const W = 44;
  const H = Math.round(W / aspect);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${rects.map((r) => {
    const x = (r.x / 100) * W + 0.8; const y = (r.y / 100) * H + 0.8;
    const w = Math.max(0.5, (r.w / 100) * W - 1.6); const hh = Math.max(0.5, (r.h / 100) * H - 1.6);
    return `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="1" transform="rotate(${r.rot || 0} ${x + w / 2} ${y + hh / 2})"/>`;
  }).join('')}</svg>`;
}

export function mount(root, tool) {
  root.innerHTML = `<div class="tool wide">${toolHeader(tool)}
    <div class="cols" style="grid-template-columns:minmax(0,1fr) 340px">
      <div class="stack" style="gap:8px"><div class="row between"><span class="muted small">${tr('Pinch or hold Ctrl/⌘ and scroll to zoom ✿')}</span><span id="zoomBar"></span></div><div class="sheet-wrap design-area" id="wrap"></div></div>
      <div class="panel-box stack sticky-side side collage-side" id="side" style="max-height:calc(100vh - 160px);overflow:auto">
        <h3>${tr('📷 Photos')}</h3>
        <div class="row between">
          <div class="stepper"><button class="btn icon" id="less" title="${tr('One photo less')}">−</button><output id="count"></output><button class="btn icon" id="more" title="${tr('One photo more')}">+</button></div>
          <span class="muted small">${tr('photos on the page')}</span>
        </div>
        <button class="btn" id="fill">${tr('📷 Add photos…')}</button>
        <p class="muted small" style="margin:0">${tr('Click a spot on the page to change its photo. Adding more photos than spots adds spots.')}</p>
        <h3>${tr('🎨 Theme')}</h3><div id="themes" class="stack" style="gap:6px"></div>
        <div class="row between"><h3>${tr('🧩 Layout')}</h3><button class="btn" id="shuffle" title="${tr('Mix the layout up')}">${tr('🎲 Shuffle')}</button></div>
        <div class="layout-picker" id="layouts"></div>
        <div class="field-row"><label class="field"><span>${tr('Page')}</span><select id="size">${Object.keys(SIZES).map((k) => `<option value="${k}">${tr(k)}</option>`).join('')}</select></label>
          <label class="field"><span>${tr('Gap')} <output id="gapOut"></output></span><input type="range" id="gap" min="0" max="16" step="0.5"></label></div>
        <label class="field check"><input type="checkbox" id="titleOn"><span>${tr('Show a title')}</span></label>
        <h3>${tr('🖌️ Background')}</h3><div class="row" id="bgs"></div>
        <h3>${tr('✨ Add')}</h3>
        <button class="btn" id="text">${tr('🔤 Add text')}</button>
        <div id="stickers"></div>
        <div id="selbox" class="stack"></div>
        <button class="btn primary big wide" id="save">${tr('Save as PDF ♡')}</button>
      </div>
    </div><div id="result"></div></div>`;

  const state = { sheets: [{ wMM: 210, hMM: 297, bg: '#ffffff', elements: [] }], current: 0 };
  const opts = { count: 4, theme: 'clean', layout: 'grid', seed: 1, gap: 3, title: false };
  let photos = []; // photos[i] → { src, px, py, zoom } for spot i (kept when the count goes down and up again)
  const designer = createDesigner($('#wrap', root), $('#side', root), state);
  $('#zoomBar', root).replaceWith(zoomControls(designer.view, { fit: 'fit', fitLabel: 'Fit page' }));
  const theme = () => THEME_BY_ID[opts.theme];

  /** Remember photos (and how they were moved/zoomed) from the current spots. */
  const syncPhotos = () => {
    state.sheets[0].elements.filter((e) => e.type === 'slot').forEach((e, i) => {
      photos[i] = e.src ? { src: e.src, px: e.px, py: e.py, zoom: e.zoom } : null;
    });
  };

  const usable = () => {
    const sheet = state.sheets[0];
    const t = theme();
    const m = t.margin;
    const titleH = opts.title && t.title !== undefined ? Math.max(14, sheet.hMM * 0.09) : 0;
    return { x: m, y: m + titleH, w: sheet.wMM - 2 * m, h: sheet.hMM - 2 * m - titleH, titleH };
  };

  const applyLayout = () => {
    syncPhotos();
    const sheet = state.sheets[0];
    [sheet.wMM, sheet.hMM] = SIZES[$('#size', root).value];
    const t = theme();
    sheet.bg = opts.bg || t.bg;
    const u = usable();
    const rnd = seeded(opts.seed);
    const rects = LAYOUTS[opts.layout].make(opts.count, u.w / u.h, rnd);
    const g = opts.gap;
    const pct = (mm, total) => (mm / total) * 100;
    const slots = rects.map((r, i) => {
      const p = photos[i] || {};
      const x = u.x + (r.x / 100) * u.w + g / 2;
      const y = u.y + (r.y / 100) * u.h + g / 2;
      const w = Math.max(4, (r.w / 100) * u.w - g);
      const hh = Math.max(4, (r.h / 100) * u.h - g);
      return {
        id: `slot${i}`, type: 'slot', src: p.src || null, px: p.px, py: p.py, zoom: p.zoom, z: 1,
        x: pct(x, sheet.wMM), y: pct(y, sheet.hMM), w: pct(w, sheet.wMM), h: pct(hh, sheet.hMM),
        rot: (r.rot || 0) + (t.jitter ? (rnd() - 0.5) * 2 * t.jitter : 0),
        radius: t.radius || 0, frame: t.frame || 0, frameBottom: t.frameBottom || 0, frameColor: t.frameColor, shadow: t.shadow,
      };
    });
    // Theme decorations are rebuilt every time; the user's own text and stickers stay.
    const keep = sheet.elements.filter((e) => e.type !== 'slot' && !e.theme);
    const deco = [];
    if (t.tape) {
      for (const s of slots) {
        const w = Math.min(s.w * 0.45, 14);
        deco.push({ id: `tape-${s.id}`, type: 'rect', theme: true, fill: TAPE[deco.length % TAPE.length], opacity: 0.8, radius: 0.4, z: 6,
          x: s.x + s.w / 2 - w / 2, y: s.y - pct(3, sheet.hMM), w, h: pct(7, sheet.hMM), rot: (rnd() - 0.5) * 16 });
      }
    }
    if (t.stickers) {
      const size = 9; // % of the page height
      const sw = size * (sheet.hMM / sheet.wMM);
      [[1.5, 1.5], [100 - sw - 1.5, 1.5], [1.5, 100 - size - 1.5], [100 - sw - 1.5, 100 - size - 1.5]].forEach(([x, y], i) => {
        const value = t.stickers[i % t.stickers.length];
        deco.push({ id: `deco${i}`, type: 'sticker', theme: true, value, x, y, w: sw, h: size, rot: (i % 2 ? 12 : -12), z: 30 });
      });
    }
    if (opts.title && t.title) {
      deco.push({ id: 'title', type: 'text', theme: true, text: opts.titleText ?? t.title.text, font: t.title.font, color: t.title.color, size: Math.round(u.titleH * 1.25),
        align: 'center', x: 5, y: pct(t.margin * 0.6, sheet.hMM), w: 90, h: pct(u.titleH, sheet.hMM), z: 20 });
    }
    sheet.elements = [...slots, ...deco, ...keep];
    designer.render();
    renderControls();
  };

  const renderControls = () => {
    $('#count', root).textContent = opts.count;
    $('#less', root).disabled = opts.count <= 1;
    $('#more', root).disabled = opts.count >= MAX_PHOTOS;
    $('#gap', root).value = opts.gap;
    $('#gapOut', root).textContent = `${fmtNum(opts.gap)} ${tr('mm')}`;
    $('#titleOn', root).checked = opts.title;
    $('#titleOn', root).disabled = !theme().title;
    const u = usable();
    const aspect = u.w / u.h;
    $('#layouts', root).innerHTML = Object.entries(LAYOUTS).filter(([, l]) => !l.max || opts.count <= l.max).map(([k, l]) =>
      `<button class="${k === opts.layout ? 'on' : ''}" data-layout="${k}" title="${esc(tr(l.name))}">${layoutPreview(k, opts.count, aspect, opts.seed)}<span>${esc(tr(l.name))}</span></button>`).join('');
    const byGroup = (g) => THEMES.filter((t) => t.group === g).map((t) =>
      `<button class="${t.id === opts.theme ? 'on' : ''}" data-theme="${t.id}"><span class="theme-sample" style="background:${t.bg}"><i style="border-radius:${Math.min(t.radius || 0, 3)}px;${t.frame ? `outline:${Math.max(1, Math.min(t.frame, 3))}px solid ${t.frameColor};` : ''}"></i></span>${esc(tr(t.name))}</button>`).join('');
    $('#themes', root).innerHTML = `<span class="muted small">${tr('Minimal')}</span><div class="theme-picker">${byGroup('Minimal')}</div>
      <span class="muted small">${tr('Cute')}</span><div class="theme-picker">${byGroup('Cute')}</div>`;
  };

  const setCount = (n) => { opts.count = Math.max(1, Math.min(MAX_PHOTOS, n)); applyLayout(); };
  $('#less', root).onclick = () => setCount(opts.count - 1);
  $('#more', root).onclick = () => setCount(opts.count + 1);
  $('#shuffle', root).onclick = () => { opts.seed++; applyLayout(); };
  $('#layouts', root).onclick = (e) => {
    const b = e.target.closest('[data-layout]');
    if (b) { opts.layout = b.dataset.layout; applyLayout(); }
  };
  $('#themes', root).onclick = (e) => {
    const b = e.target.closest('[data-theme]');
    if (!b) return;
    const t = THEME_BY_ID[b.dataset.theme];
    syncTitle();
    opts.theme = t.id;
    opts.gap = t.gap;
    opts.bg = null;
    opts.title = !!t.title;
    opts.titleText = undefined;
    if (t.style) opts.layout = t.style;
    else if (opts.layout === 'scatter') opts.layout = 'grid';
    applyLayout();
  };
  // Keep the user's edits to the title text when switching themes or layouts.
  const syncTitle = () => {
    const el = state.sheets[0].elements.find((e) => e.id === 'title');
    if (el && el.text !== theme().title?.text) opts.titleText = el.text;
  };
  $('#gap', root).oninput = (e) => { syncTitle(); opts.gap = parseFloat(e.target.value); applyLayout(); };
  $('#size', root).onchange = () => { syncTitle(); applyLayout(); };
  $('#titleOn', root).onchange = (e) => { syncTitle(); opts.title = e.target.checked; applyLayout(); };
  $('#bgs', root).append(...BGS.map((bg) => {
    const b = h(`<button class="btn icon" style="width:30px;height:30px;background:${bg};border:2px solid var(--border)" title="${tr('Background')}"></button>`);
    b.onclick = () => { opts.bg = bg; state.sheets[0].bg = bg; designer.render(); };
    return b;
  }));
  $('#text', root).onclick = () => designer.addText(tr('Our memories ♡'));
  $('#stickers', root).appendChild(stickerPicker((s) => designer.addSticker(s)));
  $('#fill', root).onclick = async () => {
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    if (!files.length) return;
    await withBusy('Placing photos…', async () => {
      syncPhotos();
      photos.length = Math.max(photos.length, opts.count);
      // Fill the empty spots first, then add spots for the rest.
      let i = 0;
      for (const f of files) {
        while (i < MAX_PHOTOS && photos[i]?.src) i++;
        if (i >= MAX_PHOTOS) break;
        photos[i] = { src: await photoFromFile(f) };
      }
      opts.count = Math.min(MAX_PHOTOS, Math.max(opts.count, photos.filter((p) => p?.src).length, i + 1));
    });
    syncTitle();
    state.sheets[0].elements = state.sheets[0].elements.filter((e) => e.type !== 'slot');
    applyLayout();
  };
  $('#save', root).onclick = async () => {
    const out = await withBusy('Printing your collage…', async () => {
      const blob = await htmlToPdf(exportHTML(state.sheets), 'collage');
      return [{ name: 'photo-collage.pdf', data: blob, type: 'application/pdf' }];
    });
    if (out) showResult($('#result', root), out);
  };
  applyLayout();
  return () => designer.destroy();
}
