import { $, MM, PAGE_SIZES, canvasToBlob, h, loadImage, optionsForm, savePdf, showResult, toast, toolHeader, withBusy } from '../core.js';

/* Snap pages with the webcam / phone camera, clean them up and make a PDF. */
function applyFilter(src, filter, rotation) {
  const rot = ((rotation % 360) + 360) % 360;
  const c = document.createElement('canvas');
  const side = rot % 180 !== 0;
  c.width = side ? src.height : src.width;
  c.height = side ? src.width : src.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  if (filter === 'original') return c;
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  // Simple auto-levels from the brightness histogram.
  const hist = new Uint32Array(256);
  for (let i = 0; i < p.length; i += 4) hist[(p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0]++;
  const total = p.length / 4;
  let lo = 0; let hi = 255; let acc = 0;
  while (lo < 255 && (acc += hist[lo]) < total * 0.02) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < total * 0.05) hi--;
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < p.length; i += 4) {
    let r = ((p[i] - lo) / span) * 255;
    let g = ((p[i + 1] - lo) / span) * 255;
    let b = ((p[i + 2] - lo) / span) * 255;
    if (filter !== 'enhance') {
      const l = r * 0.299 + g * 0.587 + b * 0.114;
      r = g = b = filter === 'bw' ? (l > 150 ? 255 : l < 90 ? 0 : (l - 90) * 4.25) : l;
    }
    p[i] = r; p[i + 1] = g; p[i + 2] = b;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(d, 0, 0);
  return c;
}

export function mount(root, tool) {
  root.innerHTML = `<div class="tool">${toolHeader(tool)}<div class="cols">
      <div class="stack">
        <div class="panel-box stack" id="camBox">
          <video class="cam" id="video" playsinline muted hidden></video>
          <div class="row" style="justify-content:center">
            <button class="btn primary big" id="start">${tr('📸 Start camera')}</button>
            <button class="btn primary big" id="snap" hidden>${tr('📸 Snap page')}</button>
            <button class="btn" id="flip" hidden>${tr('🔄 Switch camera')}</button>
            <label class="btn">${tr('📁 Use photos / phone camera')}<input type="file" id="file" accept="image/*" capture="environment" multiple hidden></label>
          </div>
          <p class="note" id="hint"></p>
        </div>
        <div class="panel-box stack"><h3 style="margin:0;color:var(--accent)">${tr('♡ Your pages')} <span class="muted small">${tr('(drag to reorder, click to rotate)')}</span></h3><div class="shots" id="shots"><span class="muted small">${tr('No pages yet')}</span></div></div>
      </div>
      <div class="panel-box stack sticky-side" id="opts"><h3 style="margin:0;color:var(--accent)">${tr('♡ Options')}</h3></div>
    </div><div id="result"></div></div>`;
  const shots = []; // { img, rot, id }
  let stream = null;
  let facing = 'environment';
  const video = $('#video', root);
  const form = optionsForm([
    { name: 'filter', label: 'Look', type: 'radio', value: 'document', options: [['original', 'Original'], ['enhance', 'Brighter'], ['document', 'Gray document'], ['bw', 'Black & white']] },
    { name: 'size', label: 'Page size', type: 'select', value: 'A4', options: [['fit', 'Same as photo'], ['A4', 'A4'], ['Letter', 'Letter'], ['A5', 'A5']] },
    { name: 'margin', label: 'Margin (mm)', type: 'number', value: 0, min: 0 },
    { name: 'quality', label: 'Quality', type: 'range', value: 80, min: 40, max: 95, unit: '%' },
  ], () => drawShots());
  const go = h(`<button class="btn primary big wide">${tr('Make PDF ♡')}</button>`);
  $('#opts', root).append(form.el, go);
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $('#hint', root).textContent = tr('Live camera needs https — on your phone, use “Use photos / phone camera” to snap pages with the camera app ✿');
    $('#start', root).hidden = true;
  }

  const startCam = async () => {
    try {
      stream?.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      $('#start', root).hidden = true;
      $('#snap', root).hidden = false;
      $('#flip', root).hidden = false;
    } catch (e) {
      toast(tr('Camera not available: {error}', { error: e.message }), 'error');
    }
  };
  $('#start', root).onclick = startCam;
  $('#flip', root).onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; startCam(); };
  $('#snap', root).onclick = () => {
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    shots.push({ img: c, rot: 0, id: Math.random() });
    drawShots();
    video.animate([{ opacity: 0.2 }, { opacity: 1 }], 250);
  };
  $('#file', root).onchange = async (e) => {
    for (const f of e.target.files) shots.push({ img: await loadImage(URL.createObjectURL(f)), rot: 0, id: Math.random() });
    e.target.value = '';
    drawShots();
  };

  function drawShots() {
    const box = $('#shots', root);
    if (!shots.length) { box.innerHTML = `<span class="muted small">${tr('No pages yet')}</span>`; return; }
    const filter = form.values().filter;
    box.replaceChildren(...shots.map((s) => {
      const prev = document.createElement('canvas');
      const src = s.img;
      const sc = 220 / Math.max(src.width || src.naturalWidth, src.height || src.naturalHeight);
      prev.width = (src.width || src.naturalWidth) * sc;
      prev.height = (src.height || src.naturalHeight) * sc;
      prev.getContext('2d').drawImage(src, 0, 0, prev.width, prev.height);
      const out = applyFilter(prev, filter, s.rot);
      const wrap = h(`<div style="position:relative;cursor:pointer" title="${tr('Click to rotate')}"><button class="btn icon" style="position:absolute;top:2px;right:2px;padding:0 6px" title="${tr('Remove')}">✕</button></div>`);
      out.style.height = '110px';
      out.style.borderRadius = '10px';
      out.style.boxShadow = 'var(--shadow)';
      wrap.prepend(out);
      wrap.dataset.id = s.id;
      wrap.onclick = (e) => {
        if (e.target.closest('button')) shots.splice(shots.indexOf(s), 1); else s.rot += 90;
        drawShots();
      };
      return wrap;
    }));
    Sortable.create(box, { animation: 160, onEnd: () => {
      const order = [...box.children].map((el) => Number(el.dataset.id));
      shots.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    } });
  }

  go.onclick = async () => {
    if (!shots.length) { toast('Snap or choose at least one page ♡', 'error'); return; }
    const v = form.values();
    const out = await withBusy('Making your PDF…', async () => {
      const doc = await PDFLib.PDFDocument.create();
      for (const s of shots) {
        const c = applyFilter(s.img, v.filter, s.rot);
        const img = await doc.embedJpg(new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', v.quality / 100)).arrayBuffer()));
        const m = v.margin * MM;
        let pw; let ph;
        if (v.size === 'fit') { pw = (c.width * 72) / 200 + 2 * m; ph = (c.height * 72) / 200 + 2 * m; } else {
          [pw, ph] = PAGE_SIZES[v.size];
          if (c.width > c.height) [pw, ph] = [ph, pw];
        }
        const sc = Math.min((pw - 2 * m) / c.width, (ph - 2 * m) / c.height);
        doc.addPage([pw, ph]).drawImage(img, { x: (pw - c.width * sc) / 2, y: (ph - c.height * sc) / 2, width: c.width * sc, height: c.height * sc });
      }
      return [{ name: 'scan.pdf', data: await savePdf(doc), type: 'application/pdf' }];
    });
    if (out) showResult($('#result', root), out);
  };
  return () => stream?.getTracks().forEach((t) => t.stop());
}
