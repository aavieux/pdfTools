import { MM, PAGE_SIZES, apiBlob, canvasToBlob, extOf, loadImage, readBytes } from './core.js';

/* Images → PDF pages, in the browser (HEIC/TIFF are decoded on the NAS). Used by “Convert to PDF”. */

export const IMAGE_EXT = new Set(['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'bmp', 'svg', 'heic', 'heif', 'tif', 'tiff']);

/** Decode one file into one or more images (TIFF can have many pages). Also used by “Make it look scanned”. */
export async function decode(file) {
  const ext = extOf(file.name);
  if (['heic', 'heif', 'tif', 'tiff'].includes(ext)) {
    const blob = await apiBlob('/api/images/convert', { file, fields: { to: 'png' } });
    if (blob.type.includes('zip')) {
      const zip = await JSZip.loadAsync(blob);
      const names = Object.keys(zip.files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const out = [];
      for (const n of names) out.push({ img: await loadImage(URL.createObjectURL(await zip.files[n].async('blob'))), kind: 'png' });
      return out;
    }
    return [{ img: await loadImage(URL.createObjectURL(blob)), kind: 'png', bytes: new Uint8Array(await blob.arrayBuffer()) }];
  }
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  const bytes = await readBytes(file);
  const kind = ext === 'png' ? 'png' : (ext === 'jpg' || ext === 'jpeg') ? (jpegOrientation(bytes) > 1 ? 'reencode' : 'jpg') : 'reencode';
  return [{ img, kind, bytes, svg: ext === 'svg' }];
}

/** EXIF orientation of a JPEG (1 = normal). */
function jpegOrientation(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return 1;
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && String.fromCharCode(...b.slice(i + 4, i + 8)) === 'Exif') {
      const t = i + 10;
      const le = b[t] === 0x49;
      const r16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const r32 = (o) => (le ? (r16(o) | (r16(o + 2) << 16)) : ((r16(o) << 16) | r16(o + 2)));
      const ifd = r32(4);
      const n = r16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (r16(e) === 0x0112) return r16(e + 8);
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

async function embed(doc, { img, kind, bytes, svg }) {
  if (kind === 'jpg') return doc.embedJpg(bytes);
  if (kind === 'png' && bytes) return doc.embedPng(bytes);
  // Re-encode through a canvas (WEBP, GIF, BMP, SVG, rotated JPEGs, …).
  const scale = svg ? Math.max(1, 2400 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1)) : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((img.naturalWidth || 800) * scale));
  c.height = Math.max(1, Math.round((img.naturalHeight || 600) * scale));
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const transparent = kind === 'png' || svg || ctx.getImageData(0, 0, 1, 1).data[3] < 255;
  const blob = await canvasToBlob(c, transparent ? 'image/png' : 'image/jpeg', 0.92);
  const out = new Uint8Array(await blob.arrayBuffer());
  return transparent ? doc.embedPng(out) : doc.embedJpg(out);
}

/** Page layout options for image files (shown by “Convert to PDF” when images are chosen). */
export const IMAGE_FIELDS = [
  { name: 'size', label: 'Image page size', type: 'select', value: 'fit', options: [['fit', 'Same as image'], ...Object.keys(PAGE_SIZES).filter((k) => !/^A[0-2]$/.test(k)).map((k) => [k, k])] },
  { name: 'orient', label: 'Orientation', type: 'radio', value: 'auto', options: [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], show: (v) => v.size !== 'fit' },
  { name: 'margin', label: 'Margin around images', type: 'radio', value: '0', options: [['0', 'None'], ['10', 'Small'], ['20', 'Big']] },
  { name: 'fit', label: 'Image placement', type: 'radio', value: 'contain', options: [['contain', 'Fit whole image'], ['cover', 'Fill page']], show: (v) => v.size !== 'fit' },
];

/** Add every frame of an image file as a page of `doc` (a pdf-lib document). */
export async function addImagePages(doc, file, v) {
  const margin = parseFloat(v.margin || 0) * MM;
  for (const frame of await decode(file)) {
    const image = await embed(doc, frame);
    const iw = image.width * 0.75; // px → pt at 96 dpi
    const ih = image.height * 0.75;
    let pw;
    let ph;
    if (!v.size || v.size === 'fit') {
      pw = iw + margin * 2;
      ph = ih + margin * 2;
    } else {
      [pw, ph] = PAGE_SIZES[v.size];
      const land = v.orient === 'landscape' || (v.orient === 'auto' && iw > ih);
      if (land) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const bw = pw - margin * 2;
    const bh = ph - margin * 2;
    const s = !v.size || v.size === 'fit' ? 1 : (v.fit === 'cover' ? Math.max(bw / iw, bh / ih) : Math.min(bw / iw, bh / ih));
    const w = iw * s;
    const h = ih * s;
    page.drawImage(image, { x: margin + (bw - w) / 2, y: margin + (bh - h) / 2, width: w, height: h });
  }
}
