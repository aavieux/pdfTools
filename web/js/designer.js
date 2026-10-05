/*
 * A tiny page designer (used by Photo collage and Create card): sheets in millimetres with
 * photo slots, text boxes and stickers. Exports to HTML that the NAS prints to PDF.
 */
import { clamp, esc, h, loadImage, onZoomGesture, pickFiles } from './core.js';

let seq = 1;
export const FONTS = [['Fredoka', 'Fredoka'], ['Pacifico', 'Pacifico'], ['Caveat', 'Caveat'], ['Noto Sans', 'Noto Sans'], ['Georgia, serif', 'Serif']];
export const STICKERS = ['cat:cream', 'cat:ginger', 'cat:gray', 'cat:black', 'cat:bunny.white', 'cat:dog.brown', 'cat:fox.ginger', 'cat:bear.brown', 'cat:panda', 'heart', '💖', '🌸', '✨', '🎀', '🌷', '🍓', '🧁', '🎂', '🎈', '🎉', '⭐', '🌈', '🦋', '🐾', '☀️', '🍀', '💌', '👑', '🐰'];

/** Downscale big photos so the PDF stays a reasonable size. */
export async function photoFromFile(file, max = 2200) {
  const img = await loadImage(URL.createObjectURL(file));
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

function stickerHTML(el, forPrint) {
  if (el.value.startsWith('cat:')) {
    const svg = catSVG(el.value.slice(4), 10).replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"');
    return forPrint ? svg : `<span class="cat" data-painted="1" style="width:100%;height:100%;display:block">${svg}</span>`;
  }
  if (el.value === 'heart') return heartSVG(10).replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"');
  return `<div style="font-size:${el.hMM * 0.82}mm;line-height:1;text-align:center;width:100%;height:100%">${el.value}</div>`;
}

export function elementHTML(el, sheet, forPrint = false) {
  const pos = `left:${el.x}%;top:${el.y}%;width:${el.w}%;height:${el.h}%;transform:rotate(${el.rot || 0}deg);z-index:${el.z || 1};`;
  const hMM = (el.h / 100) * sheet.hMM;
  if (el.type === 'slot') {
    const inner = el.src
      ? `<img src="${el.src}" style="width:100%;height:100%;object-fit:cover;object-position:${el.px ?? 50}% ${el.py ?? 50}%;transform:scale(${el.zoom || 1});display:block" alt="">`
      : (forPrint ? '' : '<span>＋ photo</span>');
    const frame = (el.frame ? `border:${el.frame}mm solid ${el.frameColor || '#fff'};${el.frameBottom ? `border-bottom-width:${el.frameBottom}mm;` : ''}` : '')
      + (el.shadow ?? !!el.frame ? 'box-shadow:0 1mm 3mm rgba(0,0,0,.18);' : '');
    return `<div class="slot" data-id="${el.id}" style="${pos}border-radius:${el.radius || 0}mm;${frame}${el.src ? 'background:#fff' : ''}">${inner}</div>`;
  }
  if (el.type === 'text') {
    return `<div class="dtext" data-id="${el.id}" style="${pos}font-family:${el.font || 'Fredoka'};font-size:${el.size || 16}pt;color:${el.color || '#4a2638'};text-align:${el.align || 'center'};font-weight:${el.bold ? 700 : 400};font-style:${el.italic ? 'italic' : 'normal'};line-height:1.2;white-space:pre-wrap;overflow:visible;display:flex;flex-direction:column;justify-content:center"><div class="dtext-in">${esc(el.text)}</div></div>`;
  }
  if (el.type === 'rect') {
    return `<div class="drect" data-id="${el.id}" style="${pos}background:${el.fill};border-radius:${el.radius || 0}mm;opacity:${el.opacity ?? 1}"></div>`;
  }
  return `<div class="sticker" data-id="${el.id}" style="${pos}">${stickerHTML({ ...el, hMM }, forPrint)}</div>`;
}

export function sheetHTML(sheet, forPrint = false) {
  return `<div class="sheet" style="width:${sheet.wMM}mm;height:${sheet.hMM}mm;background:${sheet.bg || '#fff'}">${sheet.elements.map((e) => elementHTML(e, sheet, forPrint)).join('')}</div>`;
}

export function exportHTML(sheets) {
  const { wMM, hMM } = sheets[0];
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="vendor/fonts/fonts.css">
<style>@page{size:${wMM}mm ${hMM}mm;margin:0} html,body{margin:0;padding:0} .sheet{position:relative;overflow:hidden;page-break-after:always;break-after:page}
.sheet:last-child{page-break-after:auto;break-after:auto} .slot,.dtext,.drect,.sticker{position:absolute;box-sizing:border-box;overflow:hidden}
.dtext,.sticker{overflow:visible} .lids{opacity:0} svg{display:block}</style></head><body>${sheets.map((s) => sheetHTML(s, true)).join('')}</body></html>`;
}

/**
 * Mount the interactive designer.
 * state: { sheets: [...], current } — mutated in place. Returns { render, select, addText, addSticker, view }
 * where `view` is the zoom (use it with zoomControls()).
 */
export function createDesigner(wrap, side, state, { onChange } = {}) {
  let selected = null;
  const changed = () => onChange?.();

  const render = () => {
    const sheet = state.sheets[state.current];
    wrap.innerHTML = `<div class="sheet-zoom"><div class="sheet-scale">${sheetHTML(sheet)}</div></div>`;
    applyScale();
    if (selected) wrap.querySelector(`[data-id="${selected}"]`)?.classList.add('sel');
    wrap.querySelectorAll('.sticker, .dtext').forEach((el) => {
      el.insertAdjacentHTML('beforeend', '<span class="rs" style="position:absolute;right:-6px;bottom:-6px;width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid var(--accent);cursor:nwse-resize;display:none"></span>');
    });
    wrap.querySelectorAll('.sel .rs').forEach((r) => { r.style.display = 'block'; });
    renderSide();
  };

  const find = (id) => state.sheets[state.current].elements.find((e) => e.id === id);
  /*
   * Zoom: 'fit' shows the whole page, a number is the size compared to real paper (1 = 100%).
   * Zooming only rescales the page that's already drawn, so it stays smooth with big photos.
   */
  const PX_PER_MM = 3.7795;
  const view = { zoom: 'fit', scale: 1 };
  function applyScale() {
    const sheet = state.sheets[state.current];
    const w = sheet.wMM * PX_PER_MM;
    const hh = sheet.hMM * PX_PER_MM;
    const fit = Math.min((wrap.clientWidth - 40) / w, (wrap.clientHeight - 40) / hh);
    view.scale = view.zoom === 'fit' ? clamp(fit, 0.05, 1.4) : view.zoom;
    const outer = wrap.querySelector('.sheet-zoom');
    if (!outer) return;
    outer.style.width = `${w * view.scale}px`;
    outer.style.height = `${hh * view.scale}px`;
    outer.firstElementChild.style.transform = `scale(${view.scale})`;
    view.onZoom?.();
  }
  view.setZoom = (z) => { view.zoom = z === 'fit' ? 'fit' : clamp(z, 0.1, 4); applyScale(); };
  view.zoomBy = (factor, cx, cy) => {
    const r = wrap.getBoundingClientRect();
    const ox = (cx ?? r.left + r.width / 2) - r.left;
    const oy = (cy ?? r.top + r.height / 2) - r.top;
    const old = view.scale;
    const px = wrap.scrollLeft + ox;
    const py = wrap.scrollTop + oy;
    view.setZoom(old * factor);
    const k = view.scale / old;
    wrap.scrollLeft = px * k - ox;
    wrap.scrollTop = py * k - oy;
  };
  wrap.classList.add('zoomable');
  const offZoom = onZoomGesture(wrap, (f, x, y) => view.zoomBy(f, x, y));

  const select = (id) => { selected = id; render(); };

  wrap.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('[data-id]');
    const sheetEl = wrap.querySelector('.sheet');
    if (!node || !sheetEl) { if (!e.target.closest('.side')) { selected = null; render(); } return; }
    if (e.target.isContentEditable) return;
    const el = find(node.dataset.id);
    if (selected !== el.id) { selected = el.id; render(); }
    const sr = sheetEl.getBoundingClientRect();
    const x0 = e.clientX; const y0 = e.clientY;
    const start = { ...el };
    const resizing = e.target.classList.contains('rs');
    let moved = false;
    const move = (ev) => {
      const dx = ((ev.clientX - x0) / sr.width) * 100;
      const dy = ((ev.clientY - y0) / sr.height) * 100;
      if (Math.abs(dx) + Math.abs(dy) > 0.3) moved = true;
      if (el.type === 'slot') {
        if (!el.src) return;
        el.px = clamp((start.px ?? 50) - dx * 2, 0, 100);
        el.py = clamp((start.py ?? 50) - dy * 2, 0, 100);
      } else if (resizing) {
        const ratio = start.h / start.w;
        el.w = clamp(start.w + dx, 2, 150);
        el.h = el.type === 'sticker' ? el.w * ratio : clamp(start.h + dy, 2, 150);
      } else {
        el.x = start.x + dx;
        el.y = start.y + dy;
      }
      const n = wrap.querySelector(`[data-id="${el.id}"]`);
      n.outerHTML = elementHTML(el, state.sheets[state.current]);
      wrap.querySelector(`[data-id="${el.id}"]`).classList.add('sel');
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) { render(); changed(); return; }
      if (el.type === 'slot' && !el.src) {
        const [f] = await pickFiles({ accept: 'image/*' });
        if (f) { el.src = await photoFromFile(f); render(); changed(); }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  });
  wrap.addEventListener('dblclick', (e) => {
    const node = e.target.closest('.dtext');
    if (!node) return;
    const el = find(node.dataset.id);
    const inner = node.querySelector('.dtext-in');
    inner.contentEditable = 'true';
    inner.focus();
    document.getSelection().selectAllChildren(inner);
    inner.onblur = () => { el.text = inner.innerText.replace(/\n$/, ''); inner.contentEditable = 'false'; render(); changed(); };
  });
  wrap.addEventListener('dragover', (e) => e.preventDefault());
  wrap.addEventListener('drop', async (e) => {
    e.preventDefault();
    const node = e.target.closest('.slot');
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (!node || !f) return;
    find(node.dataset.id).src = await photoFromFile(f);
    render();
    changed();
  });
  const onKey = (e) => {
    if (!wrap.isConnected || !selected || e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const sheet = state.sheets[state.current];
      const el = find(selected);
      if (el.type === 'slot') el.src = null; else sheet.elements = sheet.elements.filter((x) => x.id !== selected);
      selected = null;
      render();
      changed();
    }
  };
  document.addEventListener('keydown', onKey);

  const addText = (text = 'Your text ♡') => {
    const el = { id: `d${seq++}`, type: 'text', x: 20, y: 40, w: 60, h: 12, text, font: 'Fredoka', size: 24, color: '#ec4d8f', align: 'center', z: 20 };
    state.sheets[state.current].elements.push(el);
    select(el.id);
    changed();
  };
  const addSticker = (value) => {
    const sheet = state.sheets[state.current];
    const w = 14 * (sheet.hMM / sheet.wMM);
    const el = { id: `d${seq++}`, type: 'sticker', value, x: 50 - w / 2 + (Math.random() * 20 - 10), y: 40 + (Math.random() * 20 - 10), w, h: value.startsWith('cat:') ? 14 * 0.8 : 14, rot: 0, z: 30 };
    if (value.startsWith('cat:')) el.w = el.h * (20 / 16) * (sheet.hMM / sheet.wMM);
    sheet.elements.push(el);
    select(el.id);
    changed();
  };

  function renderSide() {
    const box = side.querySelector('#selbox');
    if (!box) return;
    const el = selected && find(selected);
    if (!el) { box.innerHTML = '<p class="muted small">Click something on the page to change it. Drag text and stickers to move them ✿</p>'; return; }
    const common = `<label class="field"><span>Rotate</span><input type="range" data-k="rot" min="-45" max="45" value="${el.rot || 0}"></label>`;
    if (el.type === 'text') {
      box.innerHTML = `<h3>🔤 Text</h3><label class="field"><span>Text</span><textarea data-k="text" rows="3">${esc(el.text)}</textarea></label>
        <div class="field-row"><label class="field"><span>Font</span><select data-k="font">${FONTS.map(([v, l]) => `<option value="${v}"${el.font === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Size (pt)</span><input type="number" data-k="size" min="4" max="200" value="${el.size}"></label></div>
        <div class="row"><input type="color" data-k="color" value="${el.color}"><select data-k="align">${['left', 'center', 'right'].map((a) => `<option${el.align === a ? ' selected' : ''}>${a}</option>`).join('')}</select>
        <label class="field check"><input type="checkbox" data-k="bold"${el.bold ? ' checked' : ''}><span>Bold</span></label><label class="field check"><input type="checkbox" data-k="italic"${el.italic ? ' checked' : ''}><span>Italic</span></label></div>${common}`;
    } else if (el.type === 'slot') {
      box.innerHTML = `<h3>🖼️ Photo</h3><div class="row"><button class="btn" data-a="photo">${el.src ? 'Replace photo' : 'Choose photo'}</button>${el.src ? '<button class="btn danger" data-a="clear">Remove</button>' : ''}</div>
        ${el.src ? `<label class="field"><span>Zoom</span><input type="range" data-k="zoom" min="1" max="3" step="0.05" value="${el.zoom || 1}"></label><p class="muted small">Drag the photo to choose which part shows.</p>` : ''}
        <label class="field"><span>Rounded corners</span><input type="range" data-k="radius" min="0" max="40" value="${el.radius || 0}"></label>`;
    } else if (el.type === 'sticker') {
      box.innerHTML = `<h3>✨ Sticker</h3><p class="muted small">Drag the pink dot to resize. Delete removes it.</p>${common}
        <div class="row"><button class="btn" data-a="front">Bring to front</button><button class="btn danger" data-a="del">Delete</button></div>`;
    } else {
      box.innerHTML = `<h3>⬜ Shape</h3><input type="color" data-k="fill" value="${el.fill}"><div class="row"><button class="btn danger" data-a="del">Delete</button></div>`;
    }
    if (el.type === 'text') box.insertAdjacentHTML('beforeend', '<div class="row"><button class="btn" data-a="front">Bring to front</button><button class="btn danger" data-a="del">Delete</button></div>');
    box.oninput = box.onchange = (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      el[k] = e.target.type === 'checkbox' ? e.target.checked : ['size', 'rot', 'zoom', 'radius'].includes(k) ? parseFloat(e.target.value) : e.target.value;
      const n = wrap.querySelector(`[data-id="${el.id}"]`);
      if (n) { n.outerHTML = elementHTML(el, state.sheets[state.current]); wrap.querySelector(`[data-id="${el.id}"]`)?.classList.add('sel'); }
      if (e.type === 'change') changed();
    };
    box.onclick = async (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      const sheet = state.sheets[state.current];
      if (a === 'photo') { const [f] = await pickFiles({ accept: 'image/*' }); if (f) el.src = await photoFromFile(f); }
      if (a === 'clear') el.src = null;
      if (a === 'del') { sheet.elements = sheet.elements.filter((x) => x !== el); selected = null; }
      if (a === 'front') el.z = Math.max(...sheet.elements.map((x) => x.z || 1)) + 1;
      render();
      changed();
    };
  }

  new ResizeObserver(() => applyScale()).observe(wrap);
  return { render, select, addText, addSticker, view, destroy: () => { document.removeEventListener('keydown', onKey); offZoom(); } };
}

export function stickerPicker(onPick) {
  const el = h(`<div class="sticker-picker">${STICKERS.map((s) => `<button data-s="${s}" title="Add sticker">${s.startsWith('cat:') ? `<span class="cat" data-cat="${s.slice(4)}" data-size="1.6"></span>` : s === 'heart' ? '<span data-heart="3"></span>' : s}</button>`).join('')}</div>`);
  el.onclick = (e) => { const b = e.target.closest('button'); if (b) onPick(b.dataset.s); };
  return el;
}

