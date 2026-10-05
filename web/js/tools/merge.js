import { baseName, openPdfLib, parseRange, readBytes, savePdf, simpleTool } from '../core.js';

export function mount(root, tool) {
  simpleTool(root, {
    tool,
    multiple: true,
    actionLabel: 'Merge PDFs',
    busyText: 'Gluing your PDFs together…',
    dropTitle: 'Drop the PDFs you want to merge ♡',
    fields: [
      { name: 'blank', label: 'Add a blank page after documents with an odd page count (for double-sided printing)', type: 'checkbox', value: false },
      { name: 'ranges', label: 'Only some pages?', type: 'textarea', rows: 3, placeholder: 'Optional, one line per file in order, e.g.\n1-3\nall\n2, 5-', hint: 'Leave empty to merge all pages.' },
    ],
    async run(files, v) {
      if (files.length < 2) throw new Error('Add at least two PDFs to merge ♡');
      const lines = (v.ranges || '').split('\n');
      const out = await PDFLib.PDFDocument.create();
      for (const [k, file] of files.entries()) {
        const src = await openPdfLib(await readBytes(file), file.name);
        const spec = (lines[k] || '').trim();
        const idx = !spec || spec.toLowerCase() === 'all' ? src.getPageIndices() : parseRange(spec, src.getPageCount());
        (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
        if (v.blank && idx.length % 2 === 1 && k < files.length - 1) {
          const last = out.getPage(out.getPageCount() - 1).getSize();
          out.addPage([last.width, last.height]);
        }
      }
      return [{ name: `${baseName(files[0].name)}-merged.pdf`, data: await savePdf(out), type: 'application/pdf' }];
    },
  });
}
