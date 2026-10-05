import { MM, PAGES_FIELDS, PAGE_SIZES, baseName, openPdfLib, pagesFromChoice, readBytes, savePdf, simpleTool } from '../core.js';
import { embedUpright } from '../pdfgeom.js';

export function mount(root, tool) {
  simpleTool(root, {
    tool,
    preview: true,
    actionLabel: 'Change page size',
    fields: [
      { name: 'size', label: 'New page size', type: 'select', value: 'A4', options: [...Object.keys(PAGE_SIZES).map((k) => [k, k]), ['custom', 'Custom…']] },
      { name: 'cw', label: 'Width (mm)', type: 'number', value: 210, min: 10, show: (v) => v.size === 'custom' },
      { name: 'ch', label: 'Height (mm)', type: 'number', value: 297, min: 10, show: (v) => v.size === 'custom' },
      { name: 'orient', label: 'Orientation', type: 'radio', value: 'keep', options: [['keep', 'Like each page'], ['portrait', 'Portrait'], ['landscape', 'Landscape']] },
      { name: 'fit', label: 'Content', type: 'radio', value: 'fit', options: [['fit', 'Scale to fit'], ['fill', 'Scale to fill (crop)'], ['none', 'Don’t scale (center)'], ['stretch', 'Stretch']] },
      { name: 'margin', label: 'Margin (mm)', type: 'number', value: 0, min: 0 },
      ...PAGES_FIELDS,
    ],
    async run([file], v) {
      const src = await openPdfLib(await readBytes(file), file.name);
      const out = await PDFLib.PDFDocument.create();
      const chosen = new Set(pagesFromChoice(v.pages, v.range, src.getPageCount()));
      const base = v.size === 'custom' ? [v.cw * MM, v.ch * MM] : PAGE_SIZES[v.size];
      const m = (v.margin || 0) * MM;
      for (const [i, page] of src.getPages().entries()) {
        if (!chosen.has(i)) { const [p] = await out.copyPages(src, [i]); out.addPage(p); continue; }
        const emb = await embedUpright(out, page);
        let [w, h] = base;
        const land = v.orient === 'landscape' || (v.orient === 'keep' && emb.width > emb.height);
        if (land !== (w > h)) [w, h] = [h, w];
        const target = out.addPage([w, h]);
        const bw = w - 2 * m;
        const bh = h - 2 * m;
        let dw; let dh;
        if (v.fit === 'stretch') { dw = bw; dh = bh; } else {
          const s = v.fit === 'none' ? 1 : v.fit === 'fill' ? Math.max(bw / emb.width, bh / emb.height) : Math.min(bw / emb.width, bh / emb.height);
          dw = emb.width * s; dh = emb.height * s;
        }
        emb.draw(target, { x: m + (bw - dw) / 2, y: m + (bh - dh) / 2, width: dw, height: dh });
      }
      return [{ name: `${baseName(file.name)}-${v.size === 'custom' ? 'resized' : v.size}.pdf`, data: await savePdf(out), type: 'application/pdf' }];
    },
  });
}
