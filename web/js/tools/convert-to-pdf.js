import { apiBlob, baseName, busyText, extOf, openPdfLib, savePdf, simpleTool } from '../core.js';
import { IMAGE_EXT, IMAGE_FIELDS, addImagePages } from '../imagepdf.js';

/*
 * One “Convert to PDF” for every kind of file: drop anything and it figures out how to convert it.
 * Images are laid out on pages right here in the browser; Office documents, text, Markdown,
 * HTML, EPUB, … are converted on the NAS. Optionally merge everything into one PDF.
 */
const isImage = (file) => IMAGE_EXT.has(extOf(file.name));

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
      ...(files.some(isImage) ? IMAGE_FIELDS : []),
    ],
    async run(files, values) {
      const pdfs = [];
      for (const [k, file] of files.entries()) {
        busyText(tr('Converting {k} of {n}…', { k: k + 1, n: files.length }), file.name);
        let data;
        if (extOf(file.name) === 'pdf') {
          data = new Uint8Array(await file.arrayBuffer());
        } else if (isImage(file)) {
          const doc = await PDFLib.PDFDocument.create();
          await addImagePages(doc, file, values);
          data = await savePdf(doc);
        } else {
          data = await apiBlob('/api/convert/to-pdf', { file });
        }
        pdfs.push({ name: `${baseName(file.name)}.pdf`, data, type: 'application/pdf' });
      }
      if (!values.merge || pdfs.length < 2) return pdfs;
      busyText('Merging…');
      const out = await PDFLib.PDFDocument.create();
      for (const p of pdfs) {
        const bytes = p.data instanceof Blob ? new Uint8Array(await p.data.arrayBuffer()) : p.data;
        const src = await openPdfLib(bytes, p.name);
        (await out.copyPages(src, src.getPageIndices())).forEach((pg) => out.addPage(pg));
      }
      return [{ name: `${baseName(files[0].name)}${files.length > 1 ? '-and-more' : ''}.pdf`, data: await savePdf(out), type: 'application/pdf' }];
    },
  });
}
