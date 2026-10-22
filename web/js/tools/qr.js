import { $, canvasToBlob, download, esc, h, loadImage, optionsForm, pickFiles, toolHeader } from '../core.js';

qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

const KINDS = [['url', '🔗 Link / text'], ['wifi', '📶 Wi-Fi'], ['contact', '👤 Contact card'], ['email', '✉️ Email'], ['phone', '📞 Phone'], ['sms', '💬 SMS'], ['geo', '📍 Location']];
const escWifi = (s) => String(s).replace(/([\;,:"])/g, '\\$1');

function payload(v) {
  switch (v.kind) {
    case 'wifi': return `WIFI:T:${v.enc};S:${escWifi(v.ssid)};${v.enc !== 'nopass' ? `P:${escWifi(v.pass)};` : ''}${v.hidden ? 'H:true;' : ''};`;
    case 'contact': return ['BEGIN:VCARD', 'VERSION:3.0', `N:${v.last};${v.first}`, `FN:${v.first} ${v.last}`.trim(), v.org && `ORG:${v.org}`, v.tel && `TEL:${v.tel}`, v.mail && `EMAIL:${v.mail}`, v.web && `URL:${v.web}`, 'END:VCARD'].filter(Boolean).join('\n');
    case 'email': return `mailto:${v.to}?subject=${encodeURIComponent(v.subject)}&body=${encodeURIComponent(v.body)}`;
    case 'phone': return `tel:${v.tel}`;
    case 'sms': return `SMSTO:${v.tel}:${v.body}`;
    case 'geo': return `geo:${v.lat},${v.lng}`;
    default: return v.text;
  }
}

function svgFor(text, s, logo) {
  const qr = qrcode(0, logo ? 'H' : s.ecc);
  qr.addData(text || ' ');
  qr.make();
  const n = qr.getModuleCount();
  const m = s.margin;
  const size = n + m * 2;
  const isEye = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const fill = s.gradient ? 'url(#g)' : s.fg;
  let body = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c) || isEye(r, c)) continue;
      const x = c + m; const y = r + m;
      if (s.shape === 'dots') body += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.42"/>`;
      else if (s.shape === 'rounded') body += `<rect x="${x + 0.06}" y="${y + 0.06}" width="0.88" height="0.88" rx="0.35"/>`;
      else if (s.shape === 'hearts') body += `<path transform="translate(${x} ${y})" d="M.5 .9 C.1 .6 0 .4 .1 .25 .2 .05 .45 .1 .5 .3 .55 .1 .8 .05 .9 .25 1 .4 .9 .6 .5 .9Z"/>`;
      else body += `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`;
    }
  }
  const eye = (r, c) => {
    const x = c + m; const y = r + m;
    const rr = s.eye === 'circle' ? 3.5 : s.eye === 'rounded' ? 1.6 : 0;
    const ri = s.eye === 'circle' ? 1.5 : s.eye === 'rounded' ? 0.8 : 0;
    return `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="${rr}" fill="none" stroke="${s.eyeColor}" stroke-width="1"/>
      <rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="${ri}" fill="${s.eyeColor}"/>`;
  };
  const logoSize = n * 0.22;
  const logoXY = (size - logoSize) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${s.px}" height="${s.px}" shape-rendering="${s.shape === 'square' ? 'crispEdges' : 'geometricPrecision'}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.fg}"/><stop offset="1" stop-color="${s.fg2}"/></linearGradient></defs>
    <rect width="${size}" height="${size}" fill="${s.transparent ? 'none' : s.bg}" rx="${s.round ? size * 0.06 : 0}"/>
    <g fill="${fill}">${body}</g>${eye(0, 0)}${eye(0, n - 7)}${eye(n - 7, 0)}
    ${logo ? `<rect x="${logoXY - 0.6}" y="${logoXY - 0.6}" width="${logoSize + 1.2}" height="${logoSize + 1.2}" rx="1" fill="${s.bg}"/><image href="${logo}" x="${logoXY}" y="${logoXY}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>` : ''}
  </svg>`;
}

export function mount(root, tool) {
  root.innerHTML = `<div class="tool">${toolHeader(tool)}<div class="cols">
      <div class="stack">
        <div class="panel-box stack" id="content"></div>
        <div class="panel-box stack" id="style"></div>
      </div>
      <div class="panel-box stack sticky-side">
        <div class="qr-out" id="out"></div>
        <div class="row"><button class="btn primary" data-f="png">⬇ PNG</button><button class="btn" data-f="svg">⬇ SVG</button><button class="btn" data-f="pdf">⬇ PDF</button></div>
        <p class="note">${tr('Always test-scan your QR code with your phone before printing ✿')}</p>
      </div></div></div>`;
  let logo = null;
  const content = optionsForm([
    { name: 'kind', label: 'What should it open?', type: 'select', value: 'url', options: KINDS },
    { name: 'text', label: 'Link or text', type: 'textarea', rows: 3, value: 'https://example.com', show: (v) => v.kind === 'url' },
    { name: 'ssid', label: 'Network name', type: 'text', show: (v) => v.kind === 'wifi' },
    { name: 'pass', label: 'Password', type: 'text', show: (v) => v.kind === 'wifi' && v.enc !== 'nopass' },
    { name: 'enc', label: 'Security', type: 'select', value: 'WPA', options: [['WPA', 'WPA/WPA2/WPA3'], ['WEP', 'WEP'], ['nopass', 'None']], show: (v) => v.kind === 'wifi' },
    { name: 'hidden', label: 'Hidden network', type: 'checkbox', show: (v) => v.kind === 'wifi' },
    { name: 'first', label: 'First name', type: 'text', value: tr('Maria'), show: (v) => v.kind === 'contact' },
    { name: 'last', label: 'Last name', type: 'text', show: (v) => v.kind === 'contact' },
    { name: 'org', label: 'Company', type: 'text', show: (v) => v.kind === 'contact' },
    { name: 'web', label: 'Website', type: 'text', show: (v) => v.kind === 'contact' },
    { name: 'mail', label: 'Email', type: 'email', show: (v) => v.kind === 'contact' },
    { name: 'to', label: 'To', type: 'email', show: (v) => v.kind === 'email' },
    { name: 'subject', label: 'Subject', type: 'text', show: (v) => v.kind === 'email' },
    { name: 'tel', label: 'Phone number', type: 'tel', show: (v) => ['contact', 'phone', 'sms'].includes(v.kind) },
    { name: 'body', label: 'Message', type: 'textarea', rows: 2, show: (v) => ['email', 'sms'].includes(v.kind) },
    { name: 'lat', label: 'Latitude', type: 'text', value: '52.5200', show: (v) => v.kind === 'geo' },
    { name: 'lng', label: 'Longitude', type: 'text', value: '13.4050', show: (v) => v.kind === 'geo' },
  ], () => draw());
  const style = optionsForm([
    { name: 'shape', label: 'Dots', type: 'radio', value: 'rounded', options: [['square', '■ Square'], ['rounded', '▢ Rounded'], ['dots', '● Dots'], ['hearts', '♥ Hearts']] },
    { name: 'eye', label: 'Corners', type: 'radio', value: 'rounded', options: [['square', 'Square'], ['rounded', 'Rounded'], ['circle', 'Circle']] },
    { name: 'fg', label: 'Color', type: 'color', value: '#c2185b' },
    { name: 'gradient', label: 'Gradient', type: 'checkbox', value: true },
    { name: 'fg2', label: 'Second color', type: 'color', value: '#7c3aed', show: (v) => v.gradient },
    { name: 'eyeColor', label: 'Corner color', type: 'color', value: '#4a2638' },
    { name: 'bg', label: 'Background', type: 'color', value: '#ffffff' },
    { name: 'transparent', label: 'Transparent background', type: 'checkbox' },
    { name: 'round', label: 'Rounded background', type: 'checkbox', value: true },
    { name: 'margin', label: 'Quiet zone', type: 'range', value: 3, min: 0, max: 8 },
    { name: 'ecc', label: 'Error correction', type: 'select', value: 'M', options: [['L', 'Low (7%)'], ['M', 'Medium (15%)'], ['Q', 'Quartile (25%)'], ['H', 'High (30%)']] },
    { name: 'px', label: 'Size (pixels)', type: 'number', value: 1000, min: 100, max: 4000 },
  ], () => draw());
  $('#content', root).append(h(`<h3 style="margin:0;color:var(--accent)">${tr('♡ Content')}</h3>`), content.el);
  const logoBtn = h(`<div class="row"><button class="btn">${tr('🖼️ Add a logo…')}</button><button class="btn" hidden>${tr('Remove logo')}</button></div>`);
  logoBtn.children[0].onclick = async () => {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (!f) return;
    const img = await loadImage(URL.createObjectURL(f));
    const c = document.createElement('canvas');
    c.width = c.height = 300;
    const s = Math.min(300 / img.naturalWidth, 300 / img.naturalHeight);
    c.getContext('2d').drawImage(img, (300 - img.naturalWidth * s) / 2, (300 - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    logo = c.toDataURL('image/png');
    logoBtn.children[1].hidden = false;
    draw();
  };
  logoBtn.children[1].onclick = () => { logo = null; logoBtn.children[1].hidden = true; draw(); };
  $('#style', root).append(h(`<h3 style="margin:0;color:var(--accent)">${tr('🎨 Style')}</h3>`), style.el, logoBtn);

  let svg = '';
  function draw() {
    try {
      svg = svgFor(payload(content.values()), style.values(), logo);
      $('#out', root).innerHTML = svg;
      $('#out svg', root).style.width = '280px';
      $('#out svg', root).style.height = '280px';
    } catch (e) {
      $('#out', root).innerHTML = `<p class="muted">${esc(e.message.includes('overflow') ? tr('Too much text for one QR code 🙀') : trMsg(e.message))}</p>`;
    }
  }
  root.querySelector('.sticky-side .row').onclick = async (e) => {
    const f = e.target.dataset.f;
    if (!f || !svg) return;
    if (f === 'svg') { download(new Blob([svg], { type: 'image/svg+xml' }), 'qr-code.svg'); return; }
    const px = style.values().px;
    const img = await loadImage(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })));
    const c = document.createElement('canvas');
    c.width = c.height = px;
    c.getContext('2d').drawImage(img, 0, 0, px, px);
    const png = await canvasToBlob(c, 'image/png');
    if (f === 'png') { download(png, 'qr-code.png'); return; }
    const doc = await PDFLib.PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    const im = await doc.embedPng(new Uint8Array(await png.arrayBuffer()));
    page.drawImage(im, { x: (595.28 - 300) / 2, y: (841.89 - 300) / 2, width: 300, height: 300 });
    download(await doc.save(), 'qr-code.pdf', 'application/pdf');
  };
  draw();
}
