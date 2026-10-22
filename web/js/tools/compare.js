import { $, dropzone, esc, h, openPdfjs, readBytes, renderPage, toolHeader, withBusy } from '../core.js';

/** Word-level diff (Myers O(ND)), returns [{op: '=', '-', '+', words}]. */
function diffWords(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Map([[1, 0]]);
  const trace = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? v.get(k + 1) ?? 0 : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= n && y >= m) break outer;
    }
    if (d > 4000) return null; // too different: caller falls back
  }
  const ops = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && (vv.get(k - 1) ?? -1) < (vv.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevX = vv.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push(['=', a[x - 1]]); x--; y--; }
    if (d > 0) { if (x === prevX) ops.push(['+', b[y - 1]]); else ops.push(['-', a[x - 1]]); }
    x = prevX; y = prevY;
  }
  ops.reverse();
  const out = [];
  for (const [op, w] of ops) {
    if (out.length && out.at(-1).op === op) out.at(-1).words.push(w); else out.push({ op, words: [w] });
  }
  return out;
}

async function pageTexts(doc) {
  const out = [];
  for (let i = 0; i < doc.numPages; i++) {
    const c = await (await doc.getPage(i + 1)).getTextContent();
    out.push(c.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').split(/\s+/).filter(Boolean));
  }
  return out;
}

export function mount(root, tool) {
  root.innerHTML = `<div class="tool wide">${toolHeader(tool)}
    <div class="cols" style="grid-template-columns:1fr 1fr">
      <div class="panel-box stack"><h3 style="margin:0;color:var(--accent)">${tr('Old version')}</h3><div id="a"></div></div>
      <div class="panel-box stack"><h3 style="margin:0;color:var(--accent)">${tr('New version')}</h3><div id="b"></div></div>
    </div>
    <div class="row" style="justify-content:center;margin:14px 0"><button class="btn primary big" id="go">${tr('Compare ♡')}</button></div>
    <div id="out"></div></div>`;
  const files = {};
  for (const k of ['a', 'b']) {
    const slot = $(`#${k}`, root);
    const dz = dropzone({ compact: true, title: 'Drop a PDF', onFiles: ([f]) => { files[k] = f; slot.replaceChildren(h(`<div class="row between"><span>📄 ${esc(f.name)}</span></div>`), dz); } });
    slot.appendChild(dz);
  }
  $('#go', root).onclick = async () => {
    if (!files.a || !files.b) return;
    const res = await withBusy('Comparing…', async () => {
      const A = await openPdfjs(await readBytes(files.a), files.a.name);
      const B = await openPdfjs(await readBytes(files.b), files.b.name);
      const ta = await pageTexts(A);
      const tb = await pageTexts(B);
      let parts = diffWords(ta.flat(), tb.flat());
      if (!parts) { // very different documents: compare page by page
        parts = [];
        for (let i = 0; i < Math.max(ta.length, tb.length); i++) parts.push(...(diffWords(ta[i] || [], tb[i] || []) || [{ op: '-', words: ta[i] || [] }, { op: '+', words: tb[i] || [] }]));
      }
      return { A, B, parts };
    });
    if (!res) return;
    const { A, B, parts } = res;
    const del = parts.filter((p) => p.op === '-').reduce((s, p) => s + p.words.length, 0);
    const ins = parts.filter((p) => p.op === '+').reduce((s, p) => s + p.words.length, 0);
    const out = $('#out', root);
    out.replaceChildren(h(`<div class="stack">
        <div class="panel-box row between"><div class="radio-tiles" id="mode"><label><input type="radio" name="cm" value="text" checked>${tr('📝 Text changes')}</label><label><input type="radio" name="cm" value="visual">${tr('👀 Visual changes')}</label></div>
          <span><span class="diff-del">&nbsp;${trn(del, '{n} word removed', '{n} words removed')}&nbsp;</span> · <span class="diff-ins">&nbsp;${trn(ins, '{n} word added', '{n} words added')}&nbsp;</span></span></div>
        <div id="view"></div></div>`));
    const viewEl = $('#view', out);
    const showText = () => {
      if (!del && !ins) { viewEl.replaceChildren(h(`<div class="result"><span class="cat" data-cat="friend" data-n="1" data-size="5"></span><h2>${tr('The text is identical ♡')}</h2><p class="muted">${tr('Check “Visual changes” for layout or image differences.')}</p></div>`)); return; }
      const html = parts.map((p) => {
        const t = esc(p.words.join(' '));
        if (p.op === '=') return p.words.length > 60 ? `${esc(p.words.slice(0, 25).join(' '))} <span class="muted">… ${tr('{n} unchanged words', { n: p.words.length - 50 })} …</span> ${esc(p.words.slice(-25).join(' '))}` : t;
        return `<span class="${p.op === '-' ? 'diff-del' : 'diff-ins'}">${t}</span>`;
      }).join(' ');
      viewEl.replaceChildren(h(`<div class="panel-box" style="line-height:1.8;max-height:70vh;overflow:auto">${html}</div>`));
    };
    let pageNo = 1;
    const showVisual = async () => {
      const n = Math.max(A.numPages, B.numPages);
      viewEl.replaceChildren(h(`<div class="stack"><div class="row" style="justify-content:center"><button class="btn icon" id="vp">‹</button><span>${tr('Page {n} of {total}', { n: pageNo, total: n })}</span><button class="btn icon" id="vn">›</button><span class="muted small">${tr('pink = differences')}</span></div>
        <div class="sheet-wrap" id="cv" style="gap:12px;flex-wrap:wrap"></div></div>`));
      $('#vp', viewEl).onclick = () => { pageNo = Math.max(1, pageNo - 1); showVisual(); };
      $('#vn', viewEl).onclick = () => { pageNo = Math.min(n, pageNo + 1); showVisual(); };
      const W = 520;
      const ca = pageNo <= A.numPages ? await renderPage(await A.getPage(pageNo), { width: W }) : null;
      const cb = pageNo <= B.numPages ? await renderPage(await B.getPage(pageNo), { width: W }) : null;
      const hgt = Math.max(ca?.height || 0, cb?.height || 0);
      const diff = document.createElement('canvas');
      diff.width = W; diff.height = hgt;
      const dctx = diff.getContext('2d');
      dctx.fillStyle = '#fff'; dctx.fillRect(0, 0, W, hgt);
      const get = (c) => { if (!c) return null; const t = document.createElement('canvas'); t.width = W; t.height = hgt; const x = t.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, hgt); x.drawImage(c, 0, 0); return x.getImageData(0, 0, W, hgt); };
      const da = get(ca); const db = get(cb);
      const out = dctx.getImageData(0, 0, W, hgt);
      let changed = 0;
      for (let i = 0; i < out.data.length; i += 4) {
        const a = da ? (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 3 : 255;
        const b = db ? (db.data[i] + db.data[i + 1] + db.data[i + 2]) / 3 : 255;
        const d = da && db ? Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2]) : (a < 250 || b < 250 ? 255 : 0);
        if (d > 60) { out.data.set([236, 77, 143, 255], i); changed++; } else {
          const g = 255 - (255 - Math.min(a, b)) * 0.35; // unchanged content, faded
          out.data.set([g, g, g, 255], i);
        }
      }
      dctx.putImageData(out, 0, 0);
      const fig = (c, label) => { const f = h(`<figure style="margin:0;text-align:center"><figcaption class="muted small">${label}</figcaption></figure>`); if (c) { c.style.width = '300px'; c.style.boxShadow = 'var(--shadow)'; f.prepend(c); } else f.prepend(h(`<div class="muted" style="width:300px">${tr('no page')}</div>`)); return f; };
      $('#cv', viewEl).append(fig(ca, tr('Old')), fig(cb, tr('New')), fig(diff, changed ? tr('{n} changed pixels', { n: changed }) : tr('identical ♡')));
    };
    $('#mode', out).onchange = (e) => (e.target.value === 'text' ? showText() : showVisual());
    showText();
  };
}
