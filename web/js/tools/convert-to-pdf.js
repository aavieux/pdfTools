import { PAGE_SIZES, apiBlob, baseName, busyText, extOf, openPdfLib, savePdf, simpleTool } from '../core.js';
import { IMAGE_EXT, IMAGE_FIELDS, addImagePages } from '../imagepdf.js';
import { addPagesSized } from '../pdfgeom.js';

/*
 * One “Convert to PDF” for every kind of file: drop anything and it figures out how to convert it.
 * Images are laid out on pages right here in the browser; Office documents, text, Markdown,
 * HTML, EPUB, … are converted on the NAS. Optionally merge everything into one PDF and/or give
 * every page the same size.
 */
const isImage = (file) => IMAGE_EXT.has(extOf(file.name));

// When every page gets one size, the image-only size options would just be overridden, so they hide;
// with a paper size images are laid out on it directly (so “Fill page” and margins still work).
const IMAGE_FIELDS_HERE = IMAGE_FIELDS.map((f) => {
  if (f.name === 'size' || f.name === 'orient') return { ...f, show: (v) => v.pageSize === 'keep' && (!f.show || f.show(v)) };
  if (f.name === 'fit') return { ...f, show: (v) => (v.pageSize === 'keep' ? f.show(v) : !!PAGE_SIZES[v.pageSize]) };
  return f;
});

export function mount(root, tool) {
  simpleTool(root, {
    tool,
    accept: '*',
    multiple: true,
    actionLabel: 'Convert to PDF',
    dropTitle: 'Drop any files here ♡',
    busyText: 'Converting to PDF…',
    intro: 'Word, Excel, PowerPoint, OpenOffice, Publisher, images, text, Markdown, HTML, EPUB… just drop them in, I’ll work out the rest ✿',
    fields: (files) => [
      { name: 'merge', label: 'Merge everything into one PDF', type: 'checkbox', value: files.length > 1 && files.every(isImage) },
      { name: 'pageSize', label: 'Page size', type: 'select', value: 'keep', options: [['keep', 'Keep each page’s own size'], ['first', 'Same as first page'], ...Object.keys(PAGE_SIZES).map((k) => [k, k])], hint: 'Pick a size to make all pages the same; each page is scaled to fit and centered.' },
      { name: 'pageOrient', label: 'Orientation', type: 'radio', value: 'keep', options: [['keep', 'Like each page'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], show: (v) => v.pageSize !== 'keep' },
      ...(files.some(isImage) ? IMAGE_FIELDS_HERE : []),
    ],
    async run(files, values) {
      const sized = values.pageSize !== 'keep';
      const paper = PAGE_SIZES[values.pageSize];
      const imageValues = !sized ? values : { ...values, size: paper ? values.pageSize : 'fit', orient: values.pageOrient === 'keep' ? 'auto' : values.pageOrient };
      const pdfs = [];
      for (const [k, file] of files.entries()) {
        busyText(tr('Converting {k} of {n}…', { k: k + 1, n: files.length }), file.name);
        let data;
        if (extOf(file.name) === 'pdf') {
          data = new Uint8Array(await file.arrayBuffer());
        } else if (isImage(file)) {
          const doc = await PDFLib.PDFDocument.create();
          await addImagePages(doc, file, imageValues);
          data = await savePdf(doc);
        } else {
          data = await apiBlob('/api/convert/to-pdf', { file });
        }
        pdfs.push({ name: `${baseName(file.name)}.pdf`, data, type: 'application/pdf' });
      }
      const merge = values.merge && pdfs.length > 1;
      if (!merge && !sized) return pdfs;
      busyText(merge ? 'Merging…' : 'Resizing pages…');
      // 'first' takes the size from the very first page, and every later file keeps to it.
      let base = paper || null;
      const addAll = async (out, p) => {
        const bytes = p.data instanceof Blob ? new Uint8Array(await p.data.arrayBuffer()) : p.data;
        const src = await openPdfLib(bytes, p.name);
        if (sized) base = await addPagesSized(out, src, src.getPageIndices(), base, values.pageOrient);
        else (await out.copyPages(src, src.getPageIndices())).forEach((pg) => out.addPage(pg));
      };
      if (!merge) {
        for (const p of pdfs) {
          const out = await PDFLib.PDFDocument.create();
          await addAll(out, p);
          p.data = await savePdf(out);
        }
        return pdfs;
      }
      const out = await PDFLib.PDFDocument.create();
      for (const p of pdfs) await addAll(out, p);
      return [{ name: `${baseName(files[0].name)}${files.length > 1 ? '-and-more' : ''}.pdf`, data: await savePdf(out), type: 'application/pdf' }];
    },
  });
}
