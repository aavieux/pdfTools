/*
 * Page editor shared by Edit / Sign / Make fillable / Redact.
 *
 * Objects live in "display space" of a page: points, origin at the top-left of the page
 * as the reader sees it (rotation applied), y pointing down. Saving converts them to PDF
 * user space with pdfgeom.pageGeom().
 */
import { clamp, embedFont, esc, h, hexToRgb, onZoomGesture, queueRender, renderPage } from './core.js';
import { pageGeom } from './pdfgeom.js';

let idSeq = 1;
const NOTO_ASC = 1.069;
const NOTO_DESC = 0.293;
const LINE_H = 1.2;

/* ------------------------------------------------------------------ page view */

export class PageView {
  constructor(scrollEl) {
    this.scrollEl = scrollEl;
    this.stack = h('<div class="page-stack"></div>');
    scrollEl.replaceChildren(this.stack);
    this.pages = [];
    this.zoom = 'width';
    this.scale = 1;
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) this.renderPage(e.target._page);
    }, { root: scrollEl, rootMargin: '600px' });
    this.offGesture = onZoomGesture(scrollEl, (f, x, y) => this.zoomBy(f, x, y));
  }

  async open(doc) {
    this.doc = doc;
    this.pages = [];
    this.stack.replaceChildren();
    for (let i = 0; i < doc.numPages; i++) {
      const p = await doc.getPage(i + 1);
      const vp = p.getViewport({ scale: 1 });
      const el = h(`<div class="page-box" data-page="${i}"><canvas class="pdf"></canvas><div class="layer"></div></div>`);
      const page = { index: i, el, layer: el.querySelector('.layer'), w: vp.width, h: vp.height, rot: p.rotate, view: p.view, rendered: 0 };
      el._page = page;
      this.pages.push(page);
      this.stack.appendChild(el);
      this.stack.appendChild(h(`<div class="page-label">${i + 1} / ${doc.numPages}</div>`));
      this.observer.observe(el);
    }
    this.layout();
  }

  layout() {
    const avail = this.scrollEl.clientWidth - 48;
    const maxW = Math.max(...this.pages.map((p) => p.w), 1);
    this.scale = this.zoom === 'width' ? clamp(avail / maxW, 0.1, 6) : this.zoom;
    for (const p of this.pages) {
      p.el.style.width = `${p.w * this.scale}px`;
      p.el.style.height = `${p.h * this.scale}px`;
      p.el.style.setProperty('--s', this.scale);
    }
    // While zooming the old canvases are just stretched; sharpen the visible pages once it settles.
    clearTimeout(this.sharpenTimer);
    this.sharpenTimer = setTimeout(() => {
      const c = this.scrollEl.getBoundingClientRect();
      for (const p of this.pages) {
        if (!p.rendered || Math.abs(p.rendered - this.scale) < 0.01) continue;
        const r = p.el.getBoundingClientRect();
        if (r.bottom > c.top - 600 && r.top < c.bottom + 600) this.renderPage(p);
      }
    }, 150);
    this.onLayout?.();
    this.onZoom?.(this.scale);
  }

  setZoom(z) {
    this.zoom = z;
    this.layout();
  }

  /** Zoom by a factor, keeping the point under (clientX, clientY) — or the centre — in place. */
  zoomBy(factor, clientX, clientY) {
    const el = this.scrollEl;
    const r = el.getBoundingClientRect();
    const ox = (clientX ?? r.left + r.width / 2) - r.left;
    const oy = (clientY ?? r.top + r.height / 2) - r.top;
    const old = this.scale;
    const px = el.scrollLeft + ox;
    const py = el.scrollTop + oy;
    this.setZoom(clamp(old * factor, 0.1, 6));
    const k = this.scale / old;
    el.scrollLeft = px * k - ox;
    el.scrollTop = py * k - oy;
  }

  renderPage(p) {
    if (Math.abs(p.rendered - this.scale) < 0.01 || p.rendering) return;
    p.rendering = true;
    const scale = this.scale;
    queueRender(async () => {
      try {
        const page = await this.doc.getPage(p.index + 1);
        const canvas = await renderPage(page, { scale: scale * (window.devicePixelRatio || 1) });
        canvas.className = 'pdf';
        p.el.querySelector('canvas.pdf').replaceWith(canvas);
        p.rendered = scale;
      } finally {
        p.rendering = false;
      }
      if (Math.abs(this.scale - scale) >= 0.01) this.renderPage(p);
    });
  }

  /** The page in the middle of the view. */
  current() {
    const r = this.scrollEl.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    return this.pages.find((p) => p.el.getBoundingClientRect().bottom >= mid) || this.pages.at(-1);
  }

  /** Page + display-space point under a pointer event. */
  hit(e) {
    const box = e.target.closest?.('.page-box');
    if (!box) return null;
    const r = box.getBoundingClientRect();
    return { page: box._page, x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };
  }

  destroy() {
    this.observer.disconnect();
    this.offGesture();
    clearTimeout(this.sharpenTimer);
  }
}

/* ------------------------------------------------------------------ editor */

const DRAG_TOOLS = new Set(['rect', 'ellipse', 'line', 'arrow', 'highlight', 'whiteout', 'redact', 'field', 'pen']);

export class Editor {
  /**
   * opts: { area, defaults: { color, size, … }, onSelect(obj), onChange() }
   */
  constructor({ area, onSelect, onChange }) {
    this.view = new PageView(area);
    this.area = area;
    this.objects = [];
    this.images = new Map(); // id → { src, bytes, kind, w, h }
    this.undoStack = [];
    this.redoStack = [];
    this.tool = 'select';
    this.selected = null;
    this.style = { color: '#ec4d8f', fill: '', width: 2, size: 14, bold: false, opacity: 1, align: 'left', fieldType: 'text' };
    this.onSelect = onSelect;
    this.onChange = onChange;
    this.view.onLayout = () => this.renderAll();
    this._bind();
  }

  async open(doc) {
    await this.view.open(doc);
    this.objects = [];
    this.undoStack = [];
    this.redoStack = [];
    this.renderAll();
  }

  /** Show `doc`, which has a new page at index `at`; objects on later pages move along with their page. */
  async pageInserted(doc, at) {
    const shift = (list) => { for (const o of list) if (o.page >= at) o.page += 1; return list; };
    shift(this.objects);
    this.undoStack = this.undoStack.map((s) => JSON.stringify(shift(JSON.parse(s))));
    this.redoStack = this.redoStack.map((s) => JSON.stringify(shift(JSON.parse(s))));
    this.select(null);
    const old = this.view.doc;
    await this.view.open(doc);
    old?.destroy();
    this.setTool(this.tool);
  }

  /* ---------- history ---------- */
  snapshot() { return JSON.stringify(this.objects); }
  commit(before) {
    if (before === this.snapshot()) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.onChange?.();
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.objects = JSON.parse(this.undoStack.pop());
    this.select(null);
    this.renderAll();
    this.onChange?.();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.objects = JSON.parse(this.redoStack.pop());
    this.select(null);
    this.renderAll();
    this.onChange?.();
  }

  /* ---------- objects ---------- */
  add(obj, { select = true } = {}) {
    const before = this.snapshot();
    obj.id ||= `o${idSeq++}`;
    this.objects.push(obj);
    this.commit(before);
    this.renderAll();
    if (select) this.select(obj.id);
    return obj;
  }

  update(id, props) {
    const o = this.get(id);
    if (!o) return;
    const before = this.snapshot();
    Object.assign(o, props);
    this.commit(before);
    this.renderObject(o);
    if (o.type === 'text') this.fitText(o);
  }

  remove(id) {
    const before = this.snapshot();
    this.objects = this.objects.filter((o) => o.id !== id);
    this.commit(before);
    if (this.selected === id) this.select(null);
    this.renderAll();
  }

  duplicate(id) {
    const o = this.get(id);
    if (!o) return;
    const copy = JSON.parse(JSON.stringify(o));
    copy.id = undefined;
    copy.x += 12;
    copy.y += 12;
    if (copy.type === 'field') copy.name = `${o.name}_copy`;
    this.add(copy);
  }

  get(id) { return this.objects.find((o) => o.id === id); }

  addImage(src, bytes, kind, w, h) {
    const id = `img${idSeq++}`;
    this.images.set(id, { src, bytes, kind, w, h });
    return id;
  }

  setTool(tool) {
    this.tool = tool;
    this.area.classList.toggle('creating', tool !== 'select');
    this.view.pages.forEach((p) => {
      p.layer.classList.toggle('drawing', DRAG_TOOLS.has(tool));
      p.layer.classList.toggle('texting', tool === 'text' || tool === 'note');
    });
    if (tool !== 'select') this.select(null);
  }

  select(id) {
    if (this.editing) this.stopEditing();
    this.selected = id;
    this.area.querySelectorAll('.obj.sel').forEach((el) => el.classList.remove('sel'));
    if (id) this.area.querySelector(`.obj[data-id="${id}"]`)?.classList.add('sel');
    this.onSelect?.(id ? this.get(id) : null);
  }

  /* ---------- rendering ---------- */
  renderAll() {
    for (const p of this.view.pages) p.layer.replaceChildren();
    for (const o of this.objects) this.renderObject(o);
    if (this.selected) this.area.querySelector(`.obj[data-id="${this.selected}"]`)?.classList.add('sel');
  }

  renderObject(o) {
    const page = this.view.pages[o.page];
    if (!page) return;
    let el = page.layer.querySelector(`.obj[data-id="${o.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'obj';
      el.dataset.id = o.id;
      page.layer.appendChild(el);
    }
    const pct = (v, total) => `${(v / total) * 100}%`;
    Object.assign(el.style, { left: pct(o.x, page.w), top: pct(o.y, page.h), width: pct(o.w, page.w), height: pct(o.h, page.h), opacity: o.opacity ?? 1 });
    el.classList.toggle('field', o.type === 'field');
    el.classList.toggle('redact', o.type === 'redact');
    const handles = '<span class="h nw" data-h="nw"></span><span class="h ne" data-h="ne"></span><span class="h se" data-h="se"></span><span class="h sw" data-h="sw"></span>';
    const svg = (inner) => `<svg viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none">${inner}</svg>`;
    const sw = o.width ?? 2;
    switch (o.type) {
      case 'text': {
        const editing = this.editing === o.id;
        if (!editing) {
          el.innerHTML = `<div class="txt" style="font-size:calc(${o.size}px * var(--s));color:${o.color};font-weight:${o.bold ? 700 : 400};text-align:${o.align}">${esc(o.text)}</div>${handles}`;
        }
        break;
      }
      case 'image': {
        const img = this.images.get(o.image);
        el.innerHTML = `<img src="${img?.src || ''}" alt="">${handles}`;
        break;
      }
      case 'rect': case 'whiteout': case 'highlight':
        el.innerHTML = svg(`<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, o.w - sw)}" height="${Math.max(0, o.h - sw)}"
          fill="${o.type === 'whiteout' ? '#fff' : o.fill || 'none'}" stroke="${o.type === 'rect' ? o.color : 'none'}" stroke-width="${o.type === 'rect' ? sw : 0}"
          ${o.type === 'highlight' ? `style="mix-blend-mode:multiply" fill-opacity="1"` : ''}/>`) + handles;
        if (o.type === 'highlight') el.querySelector('rect').setAttribute('fill', o.color);
        if (o.type === 'whiteout') el.style.outline = this.selected === o.id ? '' : '1px dashed rgba(0,0,0,.15)';
        break;
      case 'ellipse':
        el.innerHTML = svg(`<ellipse cx="${o.w / 2}" cy="${o.h / 2}" rx="${Math.max(0, o.w / 2 - sw / 2)}" ry="${Math.max(0, o.h / 2 - sw / 2)}" fill="${o.fill || 'none'}" stroke="${o.color}" stroke-width="${sw}"/>`) + handles;
        break;
      case 'line': case 'arrow': {
        const [x1, y1, x2, y2] = lineEnds(o);
        let head = '';
        if (o.type === 'arrow') {
          const [a, b] = arrowHead(x1, y1, x2, y2, sw);
          head = `<polyline points="${a[0]},${a[1]} ${x2},${y2} ${b[0]},${b[1]}" fill="none" stroke="${o.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
        el.innerHTML = svg(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.color}" stroke-width="${sw}" stroke-linecap="round"/>${head}`) + handles;
        break;
      }
      case 'pen': {
        const pts = o.points.map(([u, v]) => `${(u * o.w).toFixed(2)},${(v * o.h).toFixed(2)}`).join(' ');
        el.innerHTML = svg(`<polyline points="${pts}" fill="none" stroke="${o.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`) + handles;
        break;
      }
      case 'note':
        el.innerHTML = `<div style="width:100%;height:100%;background:#ffd84d;border:1px solid #c99a00;border-radius:3px;display:grid;place-items:center;font-size:calc(12px * var(--s))" title="${esc(o.text)}">💬</div>`;
        break;
      case 'field': {
        const icon = { text: '𝐓', multiline: '¶', checkbox: '☑', radio: '◉', dropdown: '▾', list: '☰', date: '📅' }[o.fieldType] || '?';
        el.innerHTML = `<span style="font-size:calc(10px * var(--s))">${icon} ${esc(o.name)}</span>${handles}`;
        break;
      }
      case 'redact':
        el.innerHTML = handles;
        break;
      default:
    }
  }

  /** Grow a text box to fit its content height. */
  fitText(o) {
    const el = this.area.querySelector(`.obj[data-id="${o.id}"] .txt`);
    if (!el) return;
    const needed = el.scrollHeight / this.view.scale;
    if (needed > o.h + 0.5) {
      o.h = needed;
      this.renderObject(o);
    }
  }

  startEditing(o) {
    this.editing = o.id;
    const el = this.area.querySelector(`.obj[data-id="${o.id}"]`);
    el.classList.add('editing');
    const txt = el.querySelector('.txt');
    txt.contentEditable = 'plaintext-only';
    if (txt.contentEditable !== 'plaintext-only') txt.contentEditable = 'true';
    txt.focus();
    const range = document.createRange();
    range.selectNodeContents(txt);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    this._editBefore = this.snapshot();
    txt.oninput = () => this.fitText(o);
  }

  stopEditing() {
    const id = this.editing;
    if (!id) return;
    this.editing = null;
    const o = this.get(id);
    const el = this.area.querySelector(`.obj[data-id="${id}"]`);
    if (!o || !el) return;
    const txt = el.querySelector('.txt');
    o.text = txt.innerText.replace(/\n$/, '');
    el.classList.remove('editing');
    txt.contentEditable = 'false';
    if (!o.text.trim()) {
      this.objects = this.objects.filter((x) => x.id !== id);
      el.remove();
    } else {
      this.renderObject(o);
      this.fitText(o);
    }
    this.commit(this._editBefore);
  }

  /* ---------- pointer interaction ---------- */
  _bind() {
    const area = this.area;
    area.addEventListener('pointerdown', (e) => this._down(e));
    area.addEventListener('dblclick', (e) => {
      const el = e.target.closest('.obj');
      const o = el && this.get(el.dataset.id);
      if (o?.type === 'text') { this.select(o.id); this.startEditing(o); }
      if (o?.type === 'note' || o?.type === 'field') this.onSelect?.(o, { focus: true });
    });
    this._key = (e) => this._keydown(e);
    document.addEventListener('keydown', this._key);
  }

  destroy() {
    document.removeEventListener('keydown', this._key);
    this.view.destroy();
  }

  _down(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.txt[contenteditable="true"], .txt[contenteditable="plaintext-only"]')) return;
    const hit = this.view.hit(e);
    if (!hit) { if (this.tool === 'select') this.select(null); return; }
    const objEl = e.target.closest('.obj');
    const handle = e.target.dataset?.h;
    const scale = this.view.scale;

    if (this.tool === 'select') {
      if (!objEl) { this.select(null); return; }
      const o = this.get(objEl.dataset.id);
      this.select(o.id);
      const start = { ...o };
      const before = this.snapshot();
      const x0 = e.clientX;
      const y0 = e.clientY;
      let moved = false;
      const move = (ev) => {
        const dx = (ev.clientX - x0) / scale;
        const dy = (ev.clientY - y0) / scale;
        if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
        if (!handle) {
          o.x = clamp(start.x + dx, -o.w / 2, hit.page.w - o.w / 2);
          o.y = clamp(start.y + dy, -o.h / 2, hit.page.h - o.h / 2);
        } else {
          const keep = o.type === 'image' || (ev.shiftKey && o.type !== 'text');
          let { x, y, w, h: hh } = start;
          if (handle.includes('e')) w = Math.max(6, start.w + dx);
          if (handle.includes('s')) hh = Math.max(6, start.h + dy);
          if (handle.includes('w')) { w = Math.max(6, start.w - dx); x = start.x + start.w - w; }
          if (handle.includes('n')) { hh = Math.max(6, start.h - dy); y = start.y + start.h - hh; }
          if (keep) {
            const ratio = start.w / start.h;
            if (w / hh > ratio) w = hh * ratio; else hh = w / ratio;
            if (handle.includes('w')) x = start.x + start.w - w;
            if (handle.includes('n')) y = start.y + start.h - hh;
          }
          Object.assign(o, { x, y, w, h: hh });
        }
        this.renderObject(o);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) { if (o.type === 'text') this.fitText(o); this.commit(before); }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      e.preventDefault();
      return;
    }

    const page = hit.page;
    const st = this.style;
    if (this.tool === 'text') {
      e.preventDefault();
      const o = this.add({ type: 'text', page: page.index, x: hit.x, y: hit.y - st.size * 0.7, w: Math.min(220, page.w - hit.x - 4), h: st.size * LINE_H + 2,
        text: tr('Text'), size: st.size, color: st.color, bold: st.bold, align: st.align, opacity: st.opacity });
      requestAnimationFrame(() => this.startEditing(o));
      this.onToolDone?.();
      return;
    }
    if (this.tool === 'note') {
      e.preventDefault();
      const o = this.add({ type: 'note', page: page.index, x: hit.x - 10, y: hit.y - 10, w: 20, h: 20, text: '' });
      this.onSelect?.(o, { focus: true });
      this.onToolDone?.();
      return;
    }
    if (this.tool === 'image' || this.tool === 'signature') {
      e.preventDefault();
      this.onPlace?.(page.index, hit.x, hit.y);
      return;
    }
    if (!DRAG_TOOLS.has(this.tool)) return;

    e.preventDefault();
    const tool = this.tool;
    const x0 = hit.x;
    const y0 = hit.y;
    const pts = [[x0, y0]];
    const r = page.el.getBoundingClientRect();
    const ghost = { id: 'ghost', type: tool === 'field' ? 'field' : tool, page: page.index, x: x0, y: y0, w: 1, h: 1,
      color: tool === 'highlight' ? (st.highlight || '#ffe14d') : st.color, fill: st.fill, width: st.width, opacity: tool === 'highlight' ? 0.45 : st.opacity,
      points: [[0, 0]], flipX: false, flipY: false, fieldType: st.fieldType, name: '…' };
    this.objects.push(ghost);
    const move = (ev) => {
      const x = clamp((ev.clientX - r.left) / scale, 0, page.w);
      const y = clamp((ev.clientY - r.top) / scale, 0, page.h);
      if (tool === 'pen') {
        pts.push([x, y]);
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const minX = Math.min(...xs); const minY = Math.min(...ys);
        const w = Math.max(1, Math.max(...xs) - minX); const hh = Math.max(1, Math.max(...ys) - minY);
        Object.assign(ghost, { x: minX, y: minY, w, h: hh, points: pts.map(([px, py]) => [(px - minX) / w, (py - minY) / hh]) });
      } else {
        Object.assign(ghost, { x: Math.min(x0, x), y: Math.min(y0, y), w: Math.max(1, Math.abs(x - x0)), h: Math.max(1, Math.abs(y - y0)), flipX: x < x0, flipY: y < y0 });
      }
      this.renderObject(ghost);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.objects = this.objects.filter((o) => o !== ghost);
      page.layer.querySelector('.obj[data-id="ghost"]')?.remove();
      const tiny = tool === 'pen' ? pts.length < 2 : (ghost.w < 4 && ghost.h < 4);
      if (tiny && tool !== 'field') return;
      if (tiny) Object.assign(ghost, { w: 150, h: 22 }); // a click creates a default-size field
      const obj = { ...ghost, id: undefined };
      if (tool === 'line' || tool === 'arrow') { obj.w = Math.max(obj.w, 1); obj.h = Math.max(obj.h, 1); }
      if (tool === 'field') {
        Object.assign(obj, this.newField(st.fieldType, obj));
      }
      const added = this.add(obj, { select: tool !== 'pen' && tool !== 'highlight' && tool !== 'redact' });
      if (tool === 'field') this.onSelect?.(added, { focus: true });
      if (!['pen', 'highlight', 'redact', 'whiteout'].includes(tool)) this.onToolDone?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  newField(fieldType, box) {
    const n = this.objects.filter((o) => o.type === 'field').length + 1;
    const base = { text: 'Text', multiline: 'Notes', checkbox: 'Check', radio: 'Choice', dropdown: 'Select', list: 'List', date: 'Date' }[fieldType] || 'Field';
    const out = { fieldType, name: `${base}${n}`, required: false, fontSize: 0, options: fieldType === 'dropdown' || fieldType === 'list' ? [tr('Option {n}', { n: 1 }), tr('Option {n}', { n: 2 })] : [], value: '' };
    if (fieldType === 'checkbox' || fieldType === 'radio') {
      const s = Math.max(12, Math.min(box.w, box.h, 24));
      Object.assign(out, { w: s, h: s, group: fieldType === 'radio' ? 'Group1' : undefined, value: fieldType === 'radio' ? `Option${n}` : '' });
    }
    if (fieldType === 'multiline' && box.h < 40) out.h = 60;
    return out;
  }

  _keydown(e) {
    if (!this.area.isConnected) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {
      if (e.key === 'Escape' && this.editing) { e.preventDefault(); this.stopEditing(); }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
    const o = this.selected && this.get(this.selected);
    if (!o) { if (e.key === 'Escape') this.setToolExternal?.('select'); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicate(o.id); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(o.id); return; }
    if (e.key === 'Escape') { this.select(null); return; }
    if (e.key === 'Enter' && o.type === 'text') { e.preventDefault(); this.startEditing(o); return; }
    const step = e.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (delta) { e.preventDefault(); this.update(o.id, { x: o.x + delta[0], y: o.y + delta[1] }); }
  }

  /* ---------- export ---------- */

  /** Line breaks exactly as the browser laid out the text box. */
  textLines(o) {
    const el = this.area.querySelector(`.obj[data-id="${o.id}"] .txt`);
    if (!el || !el.firstChild) return o.text.split('\n');
    const lines = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let cur = '';
    let lastTop = null;
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const t = node.textContent;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '\n') { lines.push(cur); cur = ''; lastTop = null; continue; }
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getClientRects()[0];
        const top = rect ? Math.round(rect.top) : lastTop;
        if (lastTop !== null && top !== null && top > lastTop + 2) { lines.push(cur.replace(/\s+$/, '')); cur = ''; }
        if (top !== null) lastTop = top;
        cur += t[i];
      }
    }
    lines.push(cur);
    return lines;
  }

  /**
   * Draw the visual objects into a pdf-lib document.
   * kinds: which object types to flatten into page content.
   */
  async drawInto(pdf, kinds = ['text', 'image', 'rect', 'ellipse', 'line', 'arrow', 'pen', 'highlight', 'whiteout']) {
    const fonts = {};
    const font = async (bold) => (fonts[bold ? 'b' : 'r'] ||= await embedFont(pdf, bold));
    const embedded = new Map();
    for (const o of this.objects) {
      if (!kinds.includes(o.type)) continue;
      const page = pdf.getPage(o.page);
      const g = pageGeom(page);
      const P = (x, y) => g.pt(x, g.height - y); // display (y down) → PDF
      const rot = PDFLib.degrees(g.rot);
      const color = hexToRgb(o.color);
      const opacity = o.opacity ?? 1;
      const bl = P(o.x, o.y + o.h); // bottom-left corner of the box
      switch (o.type) {
        case 'text': {
          const f = await font(o.bold);
          const lines = this.textLines(o);
          lines.forEach((line, i) => {
            if (!line) return;
            const lw = f.widthOfTextAtSize(line, o.size);
            const dx = o.align === 'center' ? (o.w - lw) / 2 : o.align === 'right' ? o.w - lw : 0;
            const baseline = o.y + i * o.size * LINE_H + ((LINE_H - NOTO_ASC - NOTO_DESC) / 2 + NOTO_ASC) * o.size;
            const p = P(o.x + dx, baseline);
            page.drawText(line, { x: p.x, y: p.y, size: o.size, font: f, color, opacity, rotate: rot });
          });
          break;
        }
        case 'image': {
          const img = this.images.get(o.image);
          if (!img) break;
          if (!embedded.has(o.image)) embedded.set(o.image, img.kind === 'jpg' ? await pdf.embedJpg(img.bytes) : await pdf.embedPng(img.bytes));
          page.drawImage(embedded.get(o.image), { x: bl.x, y: bl.y, width: o.w, height: o.h, rotate: rot, opacity });
          break;
        }
        case 'rect': case 'whiteout': case 'highlight': {
          const sw = o.type === 'rect' ? (o.width ?? 2) : 0;
          const inner = P(o.x + sw / 2, o.y + o.h - sw / 2);
          const opts = { x: inner.x, y: inner.y, width: Math.max(0, o.w - sw), height: Math.max(0, o.h - sw), rotate: rot, opacity, borderOpacity: opacity };
          if (o.type === 'whiteout') Object.assign(opts, { color: PDFLib.rgb(1, 1, 1) });
          else if (o.type === 'highlight') Object.assign(opts, { color, blendMode: PDFLib.BlendMode.Multiply });
          else {
            Object.assign(opts, { borderColor: color, borderWidth: sw });
            if (o.fill) opts.color = hexToRgb(o.fill);
          }
          page.drawRectangle(opts);
          break;
        }
        case 'ellipse': {
          const c = P(o.x + o.w / 2, o.y + o.h / 2);
          const sw = o.width ?? 2;
          page.drawEllipse({ x: c.x, y: c.y, xScale: Math.max(0, o.w / 2 - sw / 2), yScale: Math.max(0, o.h / 2 - sw / 2), rotate: rot,
            borderColor: color, borderWidth: sw, color: o.fill ? hexToRgb(o.fill) : undefined, opacity, borderOpacity: opacity });
          break;
        }
        case 'line': case 'arrow': case 'pen': {
          let pts;
          if (o.type === 'pen') pts = o.points.map(([u, v]) => [o.x + u * o.w, o.y + v * o.h]);
          else {
            const [x1, y1, x2, y2] = lineEnds(o);
            pts = [[o.x + x1, o.y + y1], [o.x + x2, o.y + y2]];
          }
          const toPath = (list) => list.map(([x, y], i) => { const p = P(x, y); return `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`; }).join(' ');
          const style = { x: 0, y: 0, borderColor: color, borderWidth: o.width ?? 2, borderOpacity: opacity, borderLineCap: PDFLib.LineCapStyle.Round };
          page.drawSvgPath(toPath(pts), style);
          if (o.type === 'arrow') {
            const [x1, y1, x2, y2] = lineEnds(o);
            const [a, b] = arrowHead(x1, y1, x2, y2, o.width ?? 2);
            page.drawSvgPath(toPath([[o.x + a[0], o.y + a[1]], [o.x + x2, o.y + y2], [o.x + b[0], o.y + b[1]]]), style);
          }
          break;
        }
        default:
      }
    }
  }

  /** Sticky notes → real PDF text annotations. */
  addNotes(pdf, author = 'Maria') {
    const { PDFName, PDFHexString, PDFString } = PDFLib;
    for (const o of this.objects.filter((x) => x.type === 'note' && x.text)) {
      const page = pdf.getPage(o.page);
      const g = pageGeom(page);
      const a = g.pt(o.x, g.height - o.y);
      const b = g.pt(o.x + o.w, g.height - o.y - o.h);
      const annot = pdf.context.obj({
        Type: 'Annot', Subtype: 'Text', Name: 'Comment', Open: false,
        Rect: [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)],
        Contents: PDFHexString.fromText(o.text), T: PDFHexString.fromText(author),
        M: PDFString.fromDate(new Date()), C: [1, 0.85, 0.3], F: 4,
      });
      const ref = pdf.context.register(annot);
      let annots = page.node.lookup(PDFName.of('Annots'));
      if (!annots) { annots = pdf.context.obj([]); page.node.set(PDFName.of('Annots'), annots); }
      annots.push(ref);
    }
  }

  /** Form-field objects → AcroForm fields. */
  async addFields(pdf) {
    const form = pdf.getForm();
    const font = await embedFont(pdf, false);
    const radios = {};
    const used = new Set(form.getFields().map((f) => f.getName()));
    const unique = (name) => { let n = name || 'Field'; let k = 2; while (used.has(n)) n = `${name}_${k++}`; used.add(n); return n; };
    for (const o of this.objects.filter((x) => x.type === 'field')) {
      const page = pdf.getPage(o.page);
      const g = pageGeom(page);
      const bl = g.pt(o.x, g.height - o.y - o.h);
      const opts = { x: bl.x, y: bl.y, width: o.w, height: o.h, rotate: PDFLib.degrees(g.rot), font,
        borderColor: PDFLib.rgb(0.55, 0.55, 0.6), borderWidth: 1, backgroundColor: PDFLib.rgb(0.95, 0.96, 1) };
      let field;
      switch (o.fieldType) {
        case 'checkbox':
          field = form.createCheckBox(unique(o.name));
          field.addToPage(page, opts);
          if (o.value === 'on') field.check();
          break;
        case 'radio': {
          const group = o.group || 'Group';
          if (!radios[group]) radios[group] = form.createRadioGroup(unique(group));
          radios[group].addOptionToPage(o.value || o.name, page, opts);
          field = radios[group];
          break;
        }
        case 'dropdown':
          field = form.createDropdown(unique(o.name));
          field.addOptions(o.options.length ? o.options : ['']);
          field.addToPage(page, opts);
          break;
        case 'list':
          field = form.createOptionList(unique(o.name));
          field.addOptions(o.options.length ? o.options : ['']);
          field.addToPage(page, opts);
          break;
        default:
          field = form.createTextField(unique(o.name));
          if (o.fieldType === 'multiline') field.enableMultiline();
          field.addToPage(page, opts);
          if (o.value) field.setText(o.value);
          if (o.fontSize) field.setFontSize(o.fontSize);
      }
      if (o.required) field.enableRequired();
    }
    form.updateFieldAppearances(font);
  }

  /** Redaction boxes → [{ page, rects: [[x1,y1,x2,y2], …] }] in PDF user space. */
  redactions(pdfPages) {
    const out = {};
    for (const o of this.objects.filter((x) => x.type === 'redact')) {
      const g = pageGeom(pdfPages[o.page]);
      const a = g.pt(o.x, g.height - o.y);
      const b = g.pt(o.x + o.w, g.height - o.y - o.h);
      (out[o.page] ||= []).push([Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)]);
    }
    return Object.entries(out).map(([page, rects]) => ({ page: Number(page), rects }));
  }
}

function lineEnds(o) {
  const x1 = o.flipX ? o.w : 0;
  const x2 = o.flipX ? 0 : o.w;
  const y1 = o.flipY ? o.h : 0;
  const y2 = o.flipY ? 0 : o.h;
  return [x1, y1, x2, y2];
}

function arrowHead(x1, y1, x2, y2, sw) {
  const len = Math.max(8, sw * 4);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const a1 = ang + Math.PI * 0.85;
  const a2 = ang - Math.PI * 0.85;
  return [[x2 + len * Math.cos(a1), y2 + len * Math.sin(a1)], [x2 + len * Math.cos(a2), y2 + len * Math.sin(a2)]];
}
