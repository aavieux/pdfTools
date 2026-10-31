/*
 * Geometry for drawing onto pdf-lib pages "as the reader sees them":
 * display coordinates take the page's /Rotate into account and have their origin
 * at the bottom-left of the visible (crop) box, y pointing up.
 */

export function pageGeom(page) {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const W = box.width;
  const H = box.height;
  const side = rot % 180 !== 0;
  const dw = side ? H : W;
  const dh = side ? W : H;
  /** Display point (x right, y up from bottom-left) → PDF user space. */
  const pt = (x, y) => {
    const u = x / dw;
    const v = 1 - y / dh; // from top
    let u0;
    let v0;
    switch (rot) {
      case 90: u0 = v; v0 = 1 - u; break;
      case 180: u0 = 1 - u; v0 = 1 - v; break;
      case 270: u0 = 1 - v; v0 = u; break;
      default: u0 = u; v0 = v;
    }
    return { x: box.x + u0 * W, y: box.y + (1 - v0) * H };
  };
  return { width: dw, height: dh, rot, pt, box };
}

/**
 * Draw text so it reads upright on the displayed page.
 * (cx, cy) is where the text's centre (or anchor) should be in display space; angle is CCW degrees.
 */
export function drawTextDisplay(page, text, { x, y, size, font, color, opacity = 1, angle = 0, anchor = 'center' }) {
  const g = pageGeom(page);
  const w = font.widthOfTextAtSize(text, size);
  const capH = font.heightAtSize(size, { descender: false }) * 0.72;
  const ax = anchor === 'left' ? 0 : anchor === 'right' ? -w : -w / 2;
  const ay = -capH / 2;
  const a = (angle * Math.PI) / 180;
  const ox = x + ax * Math.cos(a) - ay * Math.sin(a);
  const oy = y + ax * Math.sin(a) + ay * Math.cos(a);
  const p = g.pt(ox, oy);
  page.drawText(text, { x: p.x, y: p.y, size, font, color, opacity, rotate: PDFLib.degrees(angle + g.rot) });
  return { width: w, height: capH };
}

/** Draw an image (or embedded page) into a display-space rectangle, upright, optionally rotated by `angle` around its centre. */
export function drawInBox(page, item, { x, y, width, height, opacity = 1, angle = 0, isPage = false }) {
  const g = pageGeom(page);
  const a = (angle * Math.PI) / 180;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const ox = cx + (-width / 2) * Math.cos(a) - (-height / 2) * Math.sin(a);
  const oy = cy + (-width / 2) * Math.sin(a) + (-height / 2) * Math.cos(a);
  const p = g.pt(ox, oy);
  const opts = { x: p.x, y: p.y, opacity, rotate: PDFLib.degrees(angle + g.rot) };
  if (isPage) page.drawPage(item, { ...opts, xScale: width / item.width, yScale: height / item.height });
  else page.drawImage(item, { ...opts, width, height });
}

/**
 * Embed `srcPage` (pdf-lib page from another doc) and return a function that draws it upright
 * into a display box on a target page, honouring the source's own rotation.
 */
export async function embedUpright(targetDoc, srcPage) {
  const crop = srcPage.getCropBox();
  const emb = await targetDoc.embedPage(srcPage, { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height });
  const rot = ((srcPage.getRotation().angle % 360) + 360) % 360;
  const side = rot % 180 !== 0;
  return {
    width: side ? crop.height : crop.width,
    height: side ? crop.width : crop.height,
    /** Draw so the source's visible page fills (x, y, w, h) in target display space. */
    draw(page, { x, y, width, height, opacity = 1 }) {
      const g = pageGeom(page);
      // The embedded (unrotated) page is W×H; it must be turned clockwise by `rot` to look right,
      // then by the target page's own rotation.
      const sx = (side ? height : width) / emb.width;
      const sy = (side ? width : height) / emb.height;
      // bottom-left origin of the rotated drawing inside the display box
      let ox = x;
      let oy = y;
      if (rot === 90) oy = y + height;
      else if (rot === 180) { ox = x + width; oy = y + height; }
      else if (rot === 270) ox = x + width;
      const p = g.pt(ox, oy);
      page.drawPage(emb, { x: p.x, y: p.y, xScale: sx, yScale: sy, opacity, rotate: PDFLib.degrees(g.rot - rot) });
    },
  };
}

/**
 * Add pages `idx` of `src` to `out`, each redrawn onto a page of size `base` ([w, h]) scaled to fit
 * and centred. `orient` is 'portrait', 'landscape' or 'keep' (turn `base` to match each page).
 * With no `base` the first page's size is used; returns the base so the next document can reuse it.
 */
export async function addPagesSized(out, src, idx, base, orient) {
  for (const i of idx) {
    const page = src.getPage(i);
    // A page without any content (truly blank) can't be embedded, so it just becomes a blank page.
    const emb = page.node.Contents() ? await embedUpright(out, page) : null;
    const { width: pw, height: ph } = emb || page.getSize();
    base ||= [pw, ph];
    let [w, h] = base;
    const land = orient === 'landscape' || (orient === 'keep' && pw > ph);
    if (land !== (w > h)) [w, h] = [h, w];
    const target = out.addPage([w, h]);
    if (!emb) continue;
    const s = Math.min(w / pw, h / ph);
    emb.draw(target, { x: (w - pw * s) / 2, y: (h - ph * s) / 2, width: pw * s, height: ph * s });
  }
  return base;
}

/** Move the most recently added content stream to the back (draw behind existing content). */
export function sendLastStreamToBack(page) {
  const { PDFArray, PDFName } = PDFLib;
  const contents = page.node.get(PDFName.of('Contents'));
  const arr = page.node.context.lookup(contents);
  if (!(arr instanceof PDFArray) || arr.size() < 2) return;
  const last = arr.get(arr.size() - 1);
  arr.remove(arr.size() - 1);
  arr.insert(0, last);
}
