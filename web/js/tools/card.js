import { $, h, htmlToPdf, showResult, toolHeader, withBusy, zoomControls } from '../core.js';
import { createDesigner, exportHTML, stickerPicker } from '../designer.js';

let n = 0;
const T = (text, x, y, w, hh, o = {}) => ({ id: `t${n++}`, type: 'text', text: tr(text), x, y, w, h: hh, font: 'Fredoka', size: 20, color: '#c2185b', align: 'center', z: 10, ...o });
const S = (x, y, w, hh, o = {}) => ({ id: `s${n++}`, type: 'slot', src: null, x, y, w, h: hh, radius: 3, z: 2, ...o });
const K = (value, x, y, w, hh, rot = 0) => ({ id: `k${n++}`, type: 'sticker', value, x, y, w, h: hh, rot, z: 30 });
const R = (x, y, w, hh, fill, o = {}) => ({ id: `r${n++}`, type: 'rect', x, y, w, h: hh, fill, z: 1, ...o });

/* Each template returns fresh sheets (sizes in mm). */
const TEMPLATES = {
  'Birthday card': {
    note: 'Folded card: print both pages double-sided on A4 (flip on short edge), then fold in the middle ✿',
    make: () => [
      { wMM: 297, hMM: 210, bg: '#fff5f9', elements: [ // outside: back (left) | front (right)
        T('made with love ♡', 5, 85, 40, 6, { font: 'Caveat', size: 16, color: '#a0657f' }),
        K('cat:ginger', 20, 60, 10, 12),
        R(50, 0, 50, 100, 'repeating-linear-gradient(45deg,#ffe4ee 0 14px,#fff5f9 14px 28px)'),
        S(58, 12, 34, 50, { radius: 6, frame: 3 }),
        T('Happy Birthday!', 52, 66, 46, 14, { font: 'Pacifico', size: 34 }),
        K('🎂', 60, 82, 8, 11), K('🎈', 84, 4, 8, 11, 10), K('cat:cream', 86, 80, 9, 11),
      ] },
      { wMM: 297, hMM: 210, bg: '#ffffff', elements: [ // inside: left | right
        K('🎉', 18, 30, 14, 20, -10), K('heart', 28, 55, 6, 8.5),
        T('Dear …,\n\nwishing you the sweetest day and a year full of cuddles and cake!\n\nLove,\nMaria', 55, 15, 40, 70, { font: 'Caveat', size: 24, color: '#4a2638', align: 'left' }),
      ] },
    ],
  },
  'Thank-you postcard': {
    note: 'Postcard, A6 landscape (148 × 105 mm).',
    make: () => [
      { wMM: 148, hMM: 105, bg: '#fff1e0', elements: [
        S(5, 7, 48, 86, { radius: 4 }),
        T('Thank you!', 55, 18, 42, 22, { font: 'Pacifico', size: 26 }),
        T('for being wonderful ♡', 55, 45, 42, 12, { font: 'Caveat', size: 18, color: '#7a5a2a' }),
        K('cat:gray', 78, 70, 12, 20), K('🌷', 60, 70, 10, 18),
      ] },
      { wMM: 148, hMM: 105, bg: '#ffffff', elements: [
        R(55, 10, 0.4, 80, '#e7a'), T('Dear …,\n\n', 5, 10, 47, 80, { font: 'Caveat', size: 18, color: '#333', align: 'left' }),
        R(60, 50, 34, 0.4, '#bbb'), R(60, 62, 34, 0.4, '#bbb'), R(60, 74, 34, 0.4, '#bbb'),
        R(80, 8, 14, 18, '#ffe4ee', { radius: 1 }), K('heart', 83.5, 11, 7, 10),
      ] },
    ],
  },
  'Party invitation': {
    note: 'A5 portrait invitation.',
    make: () => [{ wMM: 148, hMM: 210, bg: 'radial-gradient(#f7cfe0 1.4px, #fff5f9 1.4px) 0 0/16px 16px', elements: [
      K('🎈', 8, 4, 16, 12, -12), K('🎈', 76, 6, 16, 12, 12), K('✨', 45, 3, 10, 7),
      T("You're invited!", 8, 16, 84, 12, { font: 'Pacifico', size: 30 }),
      T('to Maria’s Cat Café Party', 10, 30, 80, 8, { size: 18, color: '#4a2638' }),
      S(18, 40, 64, 30, { radius: 6, frame: 2.5 }),
      T('📅 Saturday, 12 December · 15:00\n📍 Katzenweg 1, Berlin\n🎀 Dress code: cute & cozy', 8, 72, 84, 14, { size: 14, color: '#4a2638' }),
      T('RSVP to maria@example.com', 10, 88, 80, 5, { font: 'Caveat', size: 16, color: '#a0657f' }),
      K('cat:cream', 6, 86, 12, 9), K('cat:black', 82, 86, 12, 9),
    ] }],
  },
  'Gift voucher': {
    note: 'DL voucher, 210 × 99 mm.',
    make: () => [{ wMM: 210, hMM: 99, bg: '#2e1a25', elements: [
      R(3, 6, 94, 88, 'linear-gradient(135deg,#ffd6e7,#fff5f9)', { radius: 4 }),
      T('GIFT VOUCHER', 8, 14, 55, 14, { size: 26, bold: true, color: '#c2185b' }),
      T('for one cozy spa day', 8, 32, 55, 10, { font: 'Caveat', size: 22, color: '#4a2638' }),
      T('€ 50', 66, 18, 28, 26, { font: 'Pacifico', size: 40 }),
      T('For: ………………     From: ………………', 8, 62, 60, 8, { size: 12, color: '#4a2638', align: 'left' }),
      T('Valid until 31.12.2027 · No. 0001', 8, 76, 60, 7, { size: 10, color: '#a0657f', align: 'left' }),
      K('🎀', 74, 54, 10, 21), K('cat:ginger', 86, 66, 8, 17),
    ] }],
  },
  'Blank A5 card': {
    note: 'Start from scratch ✿',
    make: () => [{ wMM: 148, hMM: 210, bg: '#ffffff', elements: [T('Your text ♡', 10, 45, 80, 10, { font: 'Pacifico', size: 28 })] }],
  },
};

export function mount(root, tool) {
  root.innerHTML = `<div class="tool wide">${toolHeader(tool)}
    <div class="cols" style="grid-template-columns:minmax(0,1fr) 330px">
      <div class="stack"><div class="row" id="pages" style="justify-content:center"></div><div class="row between"><span class="muted small">${tr('Pinch or hold Ctrl/⌘ and scroll to zoom ✿')}</span><span id="zoomBar"></span></div><div class="sheet-wrap design-area" id="wrap" style="height:calc(100vh - 300px)"></div></div>
      <div class="panel-box stack sticky-side side" id="side" style="max-height:calc(100vh - 160px);overflow:auto">
        <h3 style="margin:0;color:var(--accent)">${tr('💌 Template')}</h3><div class="tpl-picker" id="tpls"></div>
        <p class="note" id="tplnote"></p>
        <h3 style="margin:0;color:var(--accent)">${tr('✨ Add')}</h3>
        <button class="btn" id="text">${tr('🔤 Add text')}</button>
        <div id="stickers"></div>
        <label class="field"><span>${tr('Page background')}</span><input type="color" id="bg" value="#ffffff"></label>
        <div id="selbox" class="stack"></div>
        <button class="btn primary big wide" id="save">${tr('Save card as PDF ♡')}</button>
      </div>
    </div><div id="result"></div></div>`;
  const state = { sheets: [], current: 0 };
  const designer = createDesigner($('#wrap', root), $('#side', root), state);
  $('#zoomBar', root).replaceWith(zoomControls(designer.view, { fit: 'fit', fitLabel: 'Fit page' }));
  const pagesBar = () => {
    $('#pages', root).replaceChildren(...state.sheets.map((_, i) => {
      const b = h(`<button class="btn${i === state.current ? ' on' : ''}">${state.sheets.length === 2 ? tr(['Outside', 'Inside'][i]) : tr('Page {n}', { n: i + 1 })}</button>`);
      b.onclick = () => { state.current = i; pagesBar(); designer.render(); };
      return b;
    }));
  };
  const use = (name) => {
    state.sheets = TEMPLATES[name].make();
    state.current = 0;
    $('#tplnote', root).textContent = tr(TEMPLATES[name].note);
    $('#tpls', root).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.name === name));
    pagesBar();
    designer.render();
  };
  $('#tpls', root).append(...Object.keys(TEMPLATES).map((k) => { const b = h(`<button data-name="${k}">${tr(k)}</button>`); b.onclick = () => use(k); return b; }));
  $('#text', root).onclick = () => designer.addText();
  $('#stickers', root).appendChild(stickerPicker((s) => designer.addSticker(s)));
  $('#bg', root).oninput = (e) => { state.sheets[state.current].bg = e.target.value; designer.render(); };
  $('#save', root).onclick = async () => {
    const out = await withBusy('Printing your card…', async () => [{ name: 'card.pdf', data: await htmlToPdf(exportHTML(state.sheets), 'card'), type: 'application/pdf' }]);
    if (out) showResult($('#result', root), out);
  };
  use('Birthday card');
  return () => designer.destroy();
}
