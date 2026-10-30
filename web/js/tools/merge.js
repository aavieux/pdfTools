import { PAGE_SIZES, baseName, openPdfLib, parseRange, readBytes, savePdf, simpleTool } from '../core.js';
import { embedUpright } from '../pdfgeom.js';

export function mount(root, tool) {
  simpleTool(root, {
    tool,
    multiple: true,
    actionLabel: 'Merge PDFs',
    busyText: 'Gluing your PDFs together…',
    dropTitle: 'Drop the PDFs you want to merge ♡',
    fields: [
      { name: 'size', label: 'Page size', type: 'select', value: 'keep', options: [['keep', 'Keep each page’s own size'], ['first', 'Same as first page'], ...Object.keys(PAGE_SIZES).map((k) => [k, k])], hint: 'Pick a size to make all pages the same; each page is scaled to fit and centered.' },
      { name: 'orient', label: 'Orientation', type: 'radio', value: 'keep', options: [['keep', 'Like each page'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], show: (v) => v.size !== 'keep' },
      { name: 'blank', label: 'Add a blank page after documents with an odd page count (for double-sided printing)', type: 'checkbox', value: false },
      { name: 'ranges', label: 'Only some pages?', type: 'textarea', rows: 3, placeholder: 'Optional, one line per file in order, e.g.\n1-3\nall\n2, 5-', hint: 'Leave empty to merge all pages.' },
    ],
    async run(files, v) {
      if (files.length < 2) throw new Error(tr('Add at least two PDFs to merge ♡'));
      const lines = (v.ranges || '').split('\n');
      const out = await PDFLib.PDFDocument.create();
      // With a fixed size every page is redrawn onto a new page of that size; 'first' takes it from the first page.
      let base = PAGE_SIZES[v.size] || null;
      for (const [k, file] of files.entries()) {
        const src = await openPdfLib(await readBytes(file), file.name);
        const spec = (lines[k] || '').trim();
        const idx = !spec || ['all', tr('all')].includes(spec.toLowerCase()) ? src.getPageIndices() : parseRange(spec, src.getPageCount());
        if (v.size === 'keep') {
          (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
        } else {
          for (const i of idx) {
            const page = src.getPage(i);
            // A page without any content (truly blank) can't be embedded, so it just becomes a blank page.
            const emb = page.node.Contents() ? await embedUpright(out, page) : null;
            const { width: pw, height: ph } = emb || page.getSize();
            base ||= [pw, ph];
            let [w, h] = base;
            const land = v.orient === 'landscape' || (v.orient === 'keep' && pw > ph);
            if (land !== (w > h)) [w, h] = [h, w];
            const target = out.addPage([w, h]);
            if (!emb) continue;
            const s = Math.min(w / pw, h / ph);
            emb.draw(target, { x: (w - pw * s) / 2, y: (h - ph * s) / 2, width: pw * s, height: ph * s });
          }
        }
        if (v.blank && idx.length % 2 === 1 && k < files.length - 1) {
          const last = out.getPage(out.getPageCount() - 1).getSize();
          out.addPage([last.width, last.height]);
        }
      }
      return [{ name: `${baseName(files[0].name)}-merged.pdf`, data: await savePdf(out), type: 'application/pdf' }];
    },
  });
}
