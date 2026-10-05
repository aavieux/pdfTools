import {
  MM, PAGES_FIELDS, baseName, canvasToBlob, embedFont, h, hexToRgb, loadImage, openPdfLib, pagesFromChoice, pickFiles, readBytes, savePdf, simpleTool,
} from '../core.js';
import { drawInBox, drawTextDisplay, pageGeom, sendLastStreamToBack } from '../pdfgeom.js';

const POS = [['tl', '↖ Top left'], ['tc', '↑ Top center'], ['tr', '↗ Top right'], ['ml', '← Middle left'], ['mc', '● Center'], ['mr', '→ Middle right'], ['bl', '↙ Bottom left'], ['bc', '↓ Bottom center'], ['br', '↘ Bottom right']];

/** Anchor point (display space) for a 3×3 position code. */
function anchor(g, pos, margin) {
  const x = pos[1] === 'l' ? margin : pos[1] === 'r' ? g.width - margin : g.width / 2;
  const y = pos[0] === 't' ? g.height - margin : pos[0] === 'b' ? margin : g.height / 2;
  return { x, y, align: pos[1] === 'l' ? 'left' : pos[1] === 'r' ? 'right' : 'center' };
}

const numberFormats = [
  ['{n}', '1, 2, 3'], ['Page {n}', 'Page 1'], ['Page {n} of {total}', 'Page 1 of 10'], ['{n} / {total}', '1 / 10'],
  ['- {n} -', '- 1 -'], ['custom', 'Custom…'],
];

function roman(n) {
  const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

export function mount(root, tool) {
  const numbers = tool.opts.mode === 'numbers';
  let stampImage = null; // { bytes, png, w, h, name }

  const fields = numbers ? [
    { name: 'pos', label: 'Position', type: 'select', value: 'bc', options: POS.filter(([k]) => k[0] !== 'm') },
    { name: 'format', label: 'Format', type: 'select', value: '{n}', options: numberFormats },
    { name: 'custom', label: 'Custom text', type: 'text', value: 'Seite {n} von {total}', hint: '{n} = page number, {total} = number of pages', show: (v) => v.format === 'custom' },
    { name: 'style', label: 'Numbers', type: 'radio', value: 'arabic', options: [['arabic', '1 2 3'], ['roman', 'i ii iii'], ['ROMAN', 'I II III']] },
    { name: 'start', label: 'Start counting at', type: 'number', value: 1, min: 0 },
    { name: 'from', label: 'First page to number', type: 'number', value: 1, min: 1, hint: 'e.g. 2 to skip a cover page' },
    { name: 'mirror', label: 'Mirror left/right on even pages (books)', type: 'checkbox', value: false },
    { name: 'size', label: 'Font size', type: 'number', value: 11, min: 4, max: 72 },
    { name: 'bold', label: 'Bold', type: 'checkbox', value: false },
    { name: 'color', label: 'Color', type: 'color', value: '#333333' },
    { name: 'margin', label: 'Distance from edge (mm)', type: 'number', value: 10, min: 0 },
  ] : [
    { name: 'kind', label: 'Watermark', type: 'radio', value: 'text', options: [['text', 'Text'], ['image', 'Image']] },
    { name: 'text', label: 'Text', type: 'text', value: 'CONFIDENTIAL', show: (v) => v.kind === 'text' },
    { name: 'size', label: 'Font size', type: 'number', value: 60, min: 4, max: 400, show: (v) => v.kind === 'text' },
    { name: 'bold', label: 'Bold', type: 'checkbox', value: true, show: (v) => v.kind === 'text' },
    { name: 'color', label: 'Color', type: 'color', value: '#ec4d8f', show: (v) => v.kind === 'text' },
    { name: 'scale', label: 'Image width (% of page)', type: 'range', value: 40, min: 5, max: 100, unit: '%', show: (v) => v.kind === 'image' },
    { name: 'opacity', label: 'Opacity', type: 'range', value: 30, min: 5, max: 100, unit: '%' },
    { name: 'angle', label: 'Rotation (degrees)', type: 'number', value: 45, min: -360, max: 360 },
    { name: 'pos', label: 'Position', type: 'select', value: 'mc', options: [...POS, ['tile', '✿ Tiled all over']] },
    { name: 'margin', label: 'Distance from edge (mm)', type: 'number', value: 15, min: 0, show: (v) => v.pos !== 'mc' && v.pos !== 'tile' },
    { name: 'behind', label: 'Put it behind the page content', type: 'checkbox', value: false },
  ];

  simpleTool(root, {
    tool,
    preview: true,
    actionLabel: numbers ? 'Add page numbers' : 'Add watermark',
    fields: [...fields, ...PAGES_FIELDS],
    extraPanel: numbers ? null : (form) => {
      const el = h('<div class="stack" hidden><button class="btn">🖼️ Choose image…</button><span class="muted small">No image chosen</span></div>');
      const sync = () => { el.hidden = form.values().kind !== 'image'; };
      form.el.addEventListener('change', sync);
      el.querySelector('button').onclick = async () => {
        const [f] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp,image/svg+xml' });
        if (!f) return;
        const img = await loadImage(URL.createObjectURL(f));
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || 800; c.height = img.naturalHeight || 800;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        stampImage = { bytes: new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer()), w: c.width, h: c.height };
        el.querySelector('span').textContent = f.name;
        form.el.dispatchEvent(new Event('change'));
      };
      sync();
      return el;
    },
    async run([file], v, ctx) {
      const doc = await openPdfLib(await readBytes(file), file.name);
      const total = doc.getPageCount();
      const chosen = new Set(pagesFromChoice(v.pages, v.range, total));
      if (ctx.preview) while (doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
      const font = numbers || v.kind === 'text' ? await embedFont(doc, v.bold) : null;
      const color = hexToRgb(v.color);
      const margin = (v.margin || 0) * MM;
      let image = null;
      if (!numbers && v.kind === 'image') {
        if (!stampImage) throw new Error('Choose an image for the watermark ♡');
        image = await doc.embedPng(stampImage.bytes);
      }
      for (const [i, page] of doc.getPages().entries()) {
        if (!chosen.has(i)) continue;
        const g = pageGeom(page);
        if (numbers) {
          if (i + 1 < v.from) continue;
          const n = i + 1 - v.from + (v.start ?? 1);
          const ns = v.style === 'roman' ? roman(n) : v.style === 'ROMAN' ? roman(n).toUpperCase() : String(n);
          const fmt = v.format === 'custom' ? v.custom : v.format;
          const text = fmt.replaceAll('{n}', ns).replaceAll('{total}', String(total - v.from + (v.start ?? 1)));
          let pos = v.pos;
          if (v.mirror && (i + 1) % 2 === 0) pos = pos.replace('l', 'X').replace('r', 'l').replace('X', 'r');
          const a = anchor(g, pos, margin);
          drawTextDisplay(page, text, { x: a.x, y: a.y, size: v.size, font, color, anchor: a.align });
          continue;
        }
        const opacity = v.opacity / 100;
        const spots = [];
        if (v.pos === 'tile') {
          const step = image ? g.width * (v.scale / 100) * 1.6 : Math.max(v.size * 4, font.widthOfTextAtSize(v.text, v.size) * 0.9);
          for (let y = step / 2; y < g.height + step; y += step * 0.75) {
            for (let x = ((y / step) % 2) * step / 2; x < g.width + step; x += step) spots.push({ x, y, align: 'center' });
          }
        } else {
          spots.push(anchor(g, v.pos, margin));
        }
        for (const s of spots) {
          if (image) {
            const w = g.width * (v.scale / 100);
            const hgt = w * (stampImage.h / stampImage.w);
            const x = s.align === 'left' ? s.x : s.align === 'right' ? s.x - w : s.x - w / 2;
            const y = v.pos[0] === 't' ? s.y - hgt : v.pos[0] === 'b' ? s.y : s.y - hgt / 2;
            drawInBox(page, image, { x, y, width: w, height: hgt, opacity, angle: v.angle });
          } else {
            const size = v.size;
            const yAdj = v.pos === 'tile' ? 0 : v.pos[0] === 't' ? -size * 0.4 : v.pos[0] === 'b' ? size * 0.4 : 0;
            drawTextDisplay(page, v.text, { x: s.x, y: s.y + yAdj, size, font, color, opacity, angle: v.angle, anchor: v.pos === 'tile' ? 'center' : s.align });
          }
        }
        if (v.behind) sendLastStreamToBack(page);
      }
      return [{ name: `${baseName(file.name)}-${numbers ? 'numbered' : 'watermarked'}.pdf`, data: await savePdf(doc), type: 'application/pdf' }];
    },
  });
}
