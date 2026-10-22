import { PAGES_FIELDS, baseName, busyText, canvasToBlob, openPdfjs, pagesFromChoice, readBytes, renderPage, savePdf, simpleTool } from '../core.js';

/* PDF → images (JPG/PNG), and “rasterize”: every page becomes an image inside a new PDF. */
export function mount(root, tool) {
  const raster = tool.opts.mode === 'rasterize';
  const fixed = tool.opts.format;
  simpleTool(root, {
    tool,
    multiple: true,
    manyOutputs: !raster,
    actionLabel: raster ? 'Rasterize' : 'Convert to images',
    intro: raster ? 'Rasterized pages can’t be edited or have text copied out of them — handy for sharing safely ✿' : undefined,
    fields: [
      ...(raster || fixed ? [] : [{ name: 'format', label: 'Image format', type: 'radio', value: 'jpg', options: [['jpg', 'JPG'], ['png', 'PNG']] }]),
      { name: 'dpi', label: 'Resolution', type: 'select', value: raster ? '150' : '150', options: [['72', '72 dpi (screen)'], ['100', '100 dpi'], ['150', '150 dpi (good)'], ['200', '200 dpi'], ['300', '300 dpi (print)'], ['600', '600 dpi']] },
      { name: 'quality', label: 'JPG quality', type: 'range', value: 85, min: 30, max: 100, step: 5, unit: '%', show: (v) => raster || (fixed || v.format) === 'jpg' },
      { name: 'gray', label: 'Black & white', type: 'checkbox', value: false },
      ...PAGES_FIELDS,
    ],
    async run(files, v) {
      const fmt = raster ? 'jpg' : (fixed || v.format);
      const outputs = [];
      for (const file of files) {
        const doc = await openPdfjs(await readBytes(file), file.name);
        const pages = pagesFromChoice(v.pages, v.range, doc.numPages);
        const out = raster ? await PDFLib.PDFDocument.create() : null;
        for (const [k, i] of pages.entries()) {
          busyText(tr('Rendering page {k} of {n}…', { k: k + 1, n: pages.length }), file.name);
          const page = await doc.getPage(i + 1);
          const canvas = await renderPage(page, { scale: v.dpi / 72, maxPixels: 60e6 });
          if (v.gray) {
            const ctx = canvas.getContext('2d');
            ctx.globalCompositeOperation = 'saturation';
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          const blob = await canvasToBlob(canvas, fmt === 'png' ? 'image/png' : 'image/jpeg', v.quality / 100);
          if (raster) {
            const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
            const vp = page.getViewport({ scale: 1 });
            out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
          } else {
            outputs.push({ name: `${baseName(file.name)}-page${String(i + 1).padStart(3, '0')}.${fmt}`, data: blob });
          }
          canvas.width = canvas.height = 0;
        }
        if (raster) outputs.push({ name: `${baseName(file.name)}-rasterized.pdf`, data: await savePdf(out), type: 'application/pdf' });
      }
      return outputs;
    },
  });
}
