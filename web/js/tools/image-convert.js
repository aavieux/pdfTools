import { apiBlob, baseName, canvasToBlob, loadImage, simpleTool } from '../core.js';

/* WEBP → JPG/PNG in the browser; HEIC and Photoshop PSD → JPG/PNG on the NAS. */
export function mount(root, tool) {
  const { from, to } = tool.opts;
  simpleTool(root, {
    tool,
    accept: { heic: '.heic,.heif', psd: '.psd,.psb', webp: '.webp' }[from],
    multiple: true,
    actionLabel: `Convert to ${to.toUpperCase()}`,
    fields: to === 'jpg' ? [{ name: 'quality', label: 'JPG quality', type: 'range', value: 90, min: 30, max: 100, step: 5, unit: '%' }] : [],
    async run(files, v) {
      const outputs = [];
      for (const file of files) {
        if (from === 'heic' || from === 'psd') {
          const blob = await apiBlob('/api/images/convert', { file, fields: { to, quality: v.quality || 90 } });
          // Multi-frame HEIC comes back as a ZIP of frames.
          outputs.push({ name: blob.filename || `${baseName(file.name)}.${to}`, data: blob, unzip: blob.type === 'application/zip' });
          continue;
        }
        const img = await loadImage(URL.createObjectURL(file));
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (to === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.drawImage(img, 0, 0);
        const blob = await canvasToBlob(c, to === 'jpg' ? 'image/jpeg' : 'image/png', (v.quality || 90) / 100);
        outputs.push({ name: `${baseName(file.name)}.${to}`, data: blob });
      }
      return outputs;
    },
  });
}
