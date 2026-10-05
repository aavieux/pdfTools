import { MM, PAGE_SIZES, baseName, openPdfLib, readBytes, savePdf, simpleTool } from '../core.js';
import { embedUpright, pageGeom } from '../pdfgeom.js';

const GRIDS = { 2: [2, 1], 4: [2, 2], 6: [3, 2], 8: [4, 2], 9: [3, 3], 12: [4, 3], 16: [4, 4] };

export function mount(root, tool) {
  simpleTool(root, {
    tool,
    preview: true,
    actionLabel: 'Arrange pages',
    fields: [
      { name: 'n', label: 'Pages per sheet', type: 'radio', value: '2', options: Object.keys(GRIDS).map((k) => [k, k]) },
      { name: 'size', label: 'Sheet size', type: 'select', value: 'A4', options: [['same', 'Same as first page'], ...['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid'].map((k) => [k, k])] },
      { name: 'orient', label: 'Sheet orientation', type: 'radio', value: 'auto', options: [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']] },
      { name: 'order', label: 'Order', type: 'select', value: 'h', options: [['h', 'Left to right, then down'], ['v', 'Top to bottom, then right'], ['hr', 'Right to left, then down']] },
      { name: 'margin', label: 'Outer margin (mm)', type: 'number', value: 5, min: 0 },
      { name: 'gap', label: 'Space between pages (mm)', type: 'number', value: 3, min: 0 },
      { name: 'border', label: 'Draw a thin border around each page', type: 'checkbox', value: false },
    ],
    async run([file], v) {
      const src = await openPdfLib(await readBytes(file), file.name);
      const out = await PDFLib.PDFDocument.create();
      const n = parseInt(v.n, 10);
      let [cols, rows] = GRIDS[n];
      const first = pageGeom(src.getPage(0));
      let [sw, sh] = v.size === 'same' ? [first.width, first.height] : PAGE_SIZES[v.size];
      // Auto: choose the orientation where the grid cells best match the source pages.
      const fitScore = (w, h, c, r) => Math.min((w / c) / first.width, (h / r) / first.height);
      let land = v.orient === 'landscape';
      if (v.orient === 'auto') land = fitScore(Math.max(sw, sh), Math.min(sw, sh), cols, rows) >= fitScore(Math.min(sw, sh), Math.max(sw, sh), rows, cols);
      if (land) { if (sw < sh) [sw, sh] = [sh, sw]; } else { if (sw > sh) [sw, sh] = [sh, sw]; [cols, rows] = [rows, cols]; }
      const m = (v.margin || 0) * MM;
      const gap = (v.gap || 0) * MM;
      const cw = (sw - 2 * m - gap * (cols - 1)) / cols;
      const ch = (sh - 2 * m - gap * (rows - 1)) / rows;
      const pages = src.getPages();
      for (let s = 0; s < pages.length; s += n) {
        const sheet = out.addPage([sw, sh]);
        for (let k = 0; k < n && s + k < pages.length; k++) {
          const emb = await embedUpright(out, pages[s + k]);
          let col; let row;
          if (v.order === 'v') { col = Math.floor(k / rows); row = k % rows; } else { col = k % cols; row = Math.floor(k / cols); }
          if (v.order === 'hr') col = cols - 1 - col;
          const scale = Math.min(cw / emb.width, ch / emb.height);
          const w = emb.width * scale;
          const h = emb.height * scale;
          const x = m + col * (cw + gap) + (cw - w) / 2;
          const y = sh - m - (row + 1) * ch - row * gap + (ch - h) / 2;
          emb.draw(sheet, { x, y, width: w, height: h });
          if (v.border) sheet.drawRectangle({ x, y, width: w, height: h, borderColor: PDFLib.rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
        }
      }
      return [{ name: `${baseName(file.name)}-${n}up.pdf`, data: await savePdf(out), type: 'application/pdf' }];
    },
  });
}
