/*
 * Image clean-up for “Make it look scanned”: find the sheet of paper in a photo, straighten it,
 * and give it the flat, white look of a document scanner (like the one in the Notes app).
 * Everything works on ImageData-like objects { data, width, height } (no canvas needed).
 * Corners are [[x, y] × 4] in the order top-left, top-right, bottom-right, bottom-left.
 */

const lum = (r, g, b) => r * 0.299 + g * 0.587 + b * 0.114;
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Small deterministic random numbers, so the preview and the saved PDF get the same grain and tilt. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box blur of a single-channel image, in place (radius r, horizontal then vertical). */
function boxBlur(a, W, H, r) {
  const tmp = new Float32Array(a.length);
  const k = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const o = y * W;
    let s = 0;
    for (let x = -r; x <= r; x++) s += a[o + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[o + x] = s / k;
      s += a[o + Math.min(W - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      a[y * W + x] = s / k;
      s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
}

/** Otsu's threshold of values 0–255. */
function otsu(a) {
  const hist = new Float64Array(256);
  for (let i = 0; i < a.length; i++) hist[a[i] | 0]++;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0; let wB = 0; let best = 0; let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = a.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const d = sumB / wB - (sum - sumB) / wF;
    const between = wB * wF * d * d;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

function convexHull(pts) {
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const triArea = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;

export function quadArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i++) { const a = q[i]; const b = q[(i + 1) % 4]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

/** The biggest four-cornered shape whose corners lie on the hull: the sheet, even with curled corners. */
function largestQuad(hull) {
  const m = hull.length;
  let best = 0;
  let quad = null;
  for (let i = 0; i < m; i++) {
    for (let k = i + 2; k < m; k++) {
      let a1 = 0; let j1 = -1;
      for (let j = i + 1; j < k; j++) { const a = triArea(hull[i], hull[j], hull[k]); if (a > a1) { a1 = a; j1 = j; } }
      let a2 = 0; let l1 = -1;
      for (let l = k + 1; l < m + i; l++) { const a = triArea(hull[i], hull[k], hull[l % m]); if (a > a2) { a2 = a; l1 = l % m; } }
      if (j1 >= 0 && l1 >= 0 && a1 + a2 > best) { best = a1 + a2; quad = [hull[i], hull[j1], hull[k], hull[l1]]; }
    }
  }
  return quad;
}

/** Put four points in the order top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
  const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  const out = [...pts].sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
  let start = 0;
  out.forEach((p, i) => { if (p[0] + p[1] < out[start][0] + out[start][1]) start = i; });
  return [...out.slice(start), ...out.slice(0, start)].map((p) => [p[0], p[1]]);
}

/**
 * Find a sheet of paper lying on a darker background (a photo of a document).
 * Best with an image of 300–500 px. Returns corners in 0–1 coordinates, or null when the whole
 * image already is the page (a scan, a screenshot, a normal PDF page) or nothing clear was found.
 */
export function detectPage(img) {
  const { width: W, height: H, data } = img;
  const n = W * H;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = lum(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  boxBlur(L, W, H, 2);
  boxBlur(L, W, H, 2);
  const thr = otsu(L);
  // The paper is the bright part that covers the middle of the picture.
  // Close the gaps that lines of text, tables and headings leave in it (grow, then shrink back).
  const r = Math.max(2, Math.round(Math.min(W, H) * 0.02));
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = L[i] > thr ? 1 : 0;
  boxBlur(m, W, H, r);
  for (let i = 0; i < n; i++) m[i] = m[i] > 0.001 ? 1 : 0;
  boxBlur(m, W, H, r);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = m[i] > 0.999 ? 1 : 0;
  const comp = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let bestId = -1; let bestOverlap = 0; let bestSize = 0;
  const x0 = Math.floor(W * 0.3); const x1 = Math.ceil(W * 0.7);
  const y0 = Math.floor(H * 0.3); const y1 = Math.ceil(H * 0.7);
  let id = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = y * W + x;
      if (!mask[s] || comp[s] >= 0) continue;
      let top = 0; let size = 0; let overlap = 0;
      stack[top++] = s;
      comp[s] = id;
      while (top) {
        const p = stack[--top];
        size++;
        const px = p % W; const py = (p - px) / W;
        if (px >= x0 && px < x1 && py >= y0 && py < y1) overlap++;
        if (px > 0 && mask[p - 1] && comp[p - 1] < 0) { comp[p - 1] = id; stack[top++] = p - 1; }
        if (px < W - 1 && mask[p + 1] && comp[p + 1] < 0) { comp[p + 1] = id; stack[top++] = p + 1; }
        if (py > 0 && mask[p - W] && comp[p - W] < 0) { comp[p - W] = id; stack[top++] = p - W; }
        if (py < H - 1 && mask[p + W] && comp[p + W] < 0) { comp[p + W] = id; stack[top++] = p + W; }
      }
      if (overlap > bestOverlap) { bestOverlap = overlap; bestId = id; bestSize = size; }
      id++;
    }
  }
  if (bestId < 0 || bestSize < n * 0.12) return null;
  // Outline: the left- and rightmost paper pixel of every row is enough for the convex hull.
  const pts = [];
  let inSum = 0; let outSum = 0;
  for (let y = 0; y < H; y++) {
    let lo = -1; let hi = -1;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (comp[i] === bestId) { if (lo < 0) lo = x; hi = x; inSum += L[i]; } else outSum += L[i];
    }
    if (lo >= 0) { pts.push([lo, y], [hi + 1, y]); }
  }
  // A page that fills (nearly) the whole picture needs no straightening.
  if (bestSize > n * 0.9) return null;
  const contrast = inSum / bestSize - outSum / Math.max(1, n - bestSize);
  if (contrast < 25) return null;
  let hull = convexHull(pts);
  if (hull.length > 120) hull = hull.filter((_, i) => i % Math.ceil(hull.length / 120) === 0);
  const q = largestQuad(hull);
  if (!q) return null;
  const area = quadArea(q);
  // The sheet must look like a sheet: big enough, and mostly filled by the bright area.
  if (area < n * 0.12 || bestSize / area < 0.85) return null;
  // Pull the corners in a hair, so no sliver of the table shows along the edges.
  const cx = q.reduce((a, p) => a + p[0], 0) / 4;
  const cy = q.reduce((a, p) => a + p[1], 0) / 4;
  return orderCorners(q).map(([x, y]) => [(x + (cx - x) * 0.012) / W, (y + (cy - y) * 0.012) / H]);
}

/* ---------- Straightening ---------- */

/** Homography that maps the points `from` onto `to` (four pairs). */
function homography(from, to) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]; const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((row, i) => row[8] / row[i]), 1];
}

/** Width and height (px) the straightened page gets for corners `q` (in pixels). */
export function warpSize(q) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return [Math.max(d(q[0], q[1]), d(q[3], q[2])), Math.max(d(q[0], q[3]), d(q[1], q[2]))].map((v) => Math.max(1, Math.round(v)));
}

/** Cut the page with corners `q` (pixels) out of `src` and straighten it to outW × outH. */
export function warp(src, q, outW, outH) {
  const h = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], q);
  const { width: W, height: H, data: s } = src;
  const out = new Uint8ClampedArray(outW * outH * 4);
  let o = 0;
  for (let y = 0; y < outH; y++) {
    const fy = y + 0.5;
    for (let x = 0; x < outW; x++, o += 4) {
      const fx = x + 0.5;
      const w = h[6] * fx + h[7] * fy + h[8];
      const sx = (h[0] * fx + h[1] * fy + h[2]) / w - 0.5;
      const sy = (h[3] * fx + h[4] * fy + h[5]) / w - 0.5;
      const ix = Math.floor(sx); const iy = Math.floor(sy);
      if (ix < -1 || iy < -1 || ix >= W || iy >= H) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255; continue; }
      const ax = sx - ix; const ay = sy - iy;
      const x0 = Math.max(0, ix); const x1 = Math.min(W - 1, ix + 1);
      const y0 = Math.max(0, iy); const y1 = Math.min(H - 1, iy + 1);
      const i00 = (y0 * W + x0) * 4; const i10 = (y0 * W + x1) * 4;
      const i01 = (y1 * W + x0) * 4; const i11 = (y1 * W + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * ax;
        const bot = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * ax;
        out[o + c] = top + (bot - top) * ay;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

/* ---------- Scanner look ---------- */

/**
 * The paper colour around every spot: the bright end of each block of the image, spread a little
 * so text and small pictures don't count, then smoothed. Dividing by it removes shadows and
 * uneven light and turns the paper white (this is what makes a photo look scanned).
 */
function paperGrid(img) {
  const { width: W, height: H, data } = img;
  const bs = Math.max(4, Math.ceil(Math.max(W, H) / 40));
  const gw = Math.ceil(W / bs); const gh = Math.ceil(H / bs);
  let g = new Float32Array(gw * gh * 3);
  const hist = new Uint32Array(256);
  const step = bs > 24 ? 2 : 1;
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      hist.fill(0);
      let cnt = 0;
      const xe = Math.min(W, (bx + 1) * bs); const ye = Math.min(H, (by + 1) * bs);
      for (let y = by * bs; y < ye; y += step) {
        for (let x = bx * bs; x < xe; x += step) { const i = (y * W + x) * 4; hist[lum(data[i], data[i + 1], data[i + 2]) | 0]++; cnt++; }
      }
      let p = 255; let acc = 0;
      while (p > 0 && (acc += hist[p]) < cnt * 0.1) p--;
      let r = 0; let gg = 0; let b = 0; let k = 0;
      for (let y = by * bs; y < ye; y += step) {
        for (let x = bx * bs; x < xe; x += step) {
          const i = (y * W + x) * 4;
          if (lum(data[i], data[i + 1], data[i + 2]) >= p) { r += data[i]; gg += data[i + 1]; b += data[i + 2]; k++; }
        }
      }
      const o = (by * gw + bx) * 3;
      g[o] = r / k; g[o + 1] = gg / k; g[o + 2] = b / k;
    }
  }
  // Spread the brightest neighbour (covers blocks that are all text or picture), then smooth twice.
  const pass = (fn) => {
    const next = new Float32Array(g.length);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        for (let c = 0; c < 3; c++) {
          const vals = [];
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const yy = Math.min(gh - 1, Math.max(0, y + dy)); const xx = Math.min(gw - 1, Math.max(0, x + dx));
              vals.push(g[(yy * gw + xx) * 3 + c]);
            }
          }
          next[(y * gw + x) * 3 + c] = fn(vals);
        }
      }
    }
    g = next;
  };
  pass((v) => Math.max(...v));
  pass((v) => v.reduce((s, x) => s + x, 0) / v.length);
  pass((v) => v.reduce((s, x) => s + x, 0) / v.length);
  return { g, gw, gh, bs };
}

/** Flatten the light: every pixel divided by the paper colour around it (strength 0–1). */
function flatten(img, strength) {
  const { width: W, height: H, data } = img;
  const { g, gw, gh, bs } = paperGrid(img);
  const row = new Float32Array(gw * 3);
  for (let y = 0; y < H; y++) {
    const gy = Math.min(gh - 1, Math.max(0, (y + 0.5) / bs - 0.5));
    const y0 = Math.floor(gy); const y1 = Math.min(gh - 1, y0 + 1); const ay = gy - y0;
    for (let k = 0; k < gw * 3; k++) row[k] = g[y0 * gw * 3 + k] * (1 - ay) + g[y1 * gw * 3 + k] * ay;
    for (let x = 0; x < W; x++) {
      const gx = Math.min(gw - 1, Math.max(0, (x + 0.5) / bs - 0.5));
      const x0 = Math.floor(gx); const x1 = Math.min(gw - 1, x0 + 1); const ax = gx - x0;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const bg = Math.max(24, row[x0 * 3 + c] * (1 - ax) + row[x1 * 3 + c] * ax);
        const v = data[i + c];
        data[i + c] = clamp255(v + ((v * 255) / bg - v) * strength);
      }
    }
  }
}

/** Guess the best look for a page: 'photo' (mostly a picture), 'color' (a document with colour) or 'gray'. */
export function guessMode(img) {
  const copy = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  flatten(copy, 1);
  const d = copy.data;
  let colourful = 0; let mid = 0; let n = 0;
  for (let i = 0; i < d.length; i += 8) {
    const r = d[i]; const g = d[i + 1]; const b = d[i + 2];
    const l = lum(r, g, b);
    n++;
    if (l > 30 && l < 235) mid++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 48 && l > 25 && l < 240) colourful++;
  }
  if (colourful > n * 0.25 || mid > n * 0.55) return 'photo';
  if (colourful > n * 0.003) return 'color';
  return 'gray';
}

/** The value at fraction `f` (0–1) of the brightness histogram. */
function percentile(hist, total, f) {
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * f) return v; }
  return 255;
}

/**
 * Give an image the scanned look, in place.
 * o: { mode: 'color'|'gray'|'bw'|'photo', clean 0–100, brightness −50–50, contrast −50–50,
 *      sharpen 0–100, threshold 0–100 (black & white), grain 0–100, seed }
 */
export function enhance(img, o) {
  const { width: W, height: H, data } = img;
  const s = (o.clean ?? 70) / 100;
  const photo = o.mode === 'photo';
  if (s > 0) flatten(img, photo ? s * 0.35 : s);
  const gray = o.mode === 'gray' || o.mode === 'bw';
  // Levels: paper pushed to pure white, the darkest ink to black.
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) hist[lum(data[i], data[i + 1], data[i + 2]) | 0]++;
  const total = W * H;
  const black = Math.min(110, percentile(hist, total, photo ? 0.005 : 0.01)) * (photo ? 0.6 : 0.85) * Math.max(s, 0.2);
  const white = photo ? Math.max(200, percentile(hist, total, 0.995)) : 255 - 22 * s;
  const c = (o.contrast ?? 0) / 50;
  const factor = c >= 0 ? 1 + c : 1 + c / 2;
  const bright = (o.brightness ?? 0) * 1.6;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let x = ((v - black) / Math.max(1, white - black)) * 255;
    x = (x - 128) * factor + 128 + bright;
    lut[v] = clamp255(x);
  }
  const satBoost = o.mode === 'color' ? 1.15 : 1;
  const bw = o.mode === 'bw';
  const thr = 90 + (o.threshold ?? 50) * 1.4; // 90–230
  for (let i = 0; i < data.length; i += 4) {
    let r = lut[data[i] | 0]; let g = lut[data[i + 1] | 0]; let b = lut[data[i + 2] | 0];
    if (gray) {
      let l = lum(r, g, b);
      if (bw) l = clamp255((l - thr) * 8 + 128); // a soft edge keeps letters smooth
      r = g = b = l;
    } else if (satBoost !== 1) {
      const l = lum(r, g, b);
      r = l + (r - l) * satBoost; g = l + (g - l) * satBoost; b = l + (b - l) * satBoost;
    }
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  if (o.sharpen > 0 && !bw) sharpen(img, o.sharpen / 100);
  if (o.grain > 0) grain(img, o.grain / 100, o.seed || 1);
  return img;
}

/** Unsharp mask with a small blur: crisper letters. */
function sharpen(img, amount) {
  const { width: W, height: H, data } = img;
  const ch = new Float32Array(W * H);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < W * H; i++) ch[i] = data[i * 4 + c];
    const blur = Float32Array.from(ch);
    boxBlur(blur, W, H, 1);
    for (let i = 0; i < W * H; i++) data[i * 4 + c] = clamp255(ch[i] + (ch[i] - blur[i]) * amount * 1.6);
  }
}

/** Paper grain and a little toner noise. */
function grain(img, amount, seed) {
  const rand = rng(seed);
  const { data } = img;
  const a = amount * 34;
  for (let i = 0; i < data.length; i += 4) {
    const v = (rand() + rand() + rand() - 1.5) * a;
    data[i] = clamp255(data[i] + v); data[i + 1] = clamp255(data[i + 1] + v); data[i + 2] = clamp255(data[i + 2] + v);
  }
}
