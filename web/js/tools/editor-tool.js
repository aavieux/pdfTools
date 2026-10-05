import {
  $, apiBlob, baseName, canvasToBlob, dropzone, esc, h, loadImage, openPdfLib, openPdfjs, pickFiles, readBytes,
  savePdf, showResult, toast, toolHeader, withBusy, zoomControls,
} from '../core.js';
import { Editor } from '../editor.js';

const TOOLS = {
  select: ['🖱️', 'Select & move (Esc)'],
  text: ['🔤', 'Text — click where it should go'],
  image: ['🖼️', 'Image — choose a picture, then click to place it'],
  signature: ['🖋️', 'Signature — pick one on the right, then click to place it'],
  rect: ['⬜', 'Rectangle — drag'],
  ellipse: ['⚪', 'Ellipse — drag'],
  line: ['➖', 'Line — drag'],
  arrow: ['➡️', 'Arrow — drag'],
  pen: ['✏️', 'Freehand pen — draw'],
  highlight: ['🖍️', 'Highlighter — drag over text'],
  whiteout: ['🩹', 'White-out — cover things up'],
  note: ['💬', 'Sticky note — click to add a comment'],
  field: ['🔲', 'Form field — drag a box'],
  redact: ['⬛', 'Redaction box — drag over what must disappear'],
};

const MODES = {
  edit: { tools: ['select', 'text', 'image', 'rect', 'ellipse', 'line', 'arrow', 'pen', 'highlight', 'whiteout', 'note'], start: 'text',
    tip: 'Pick a tool on the left, then click or drag on a page. Double-click text to edit it ✿' },
  sign: { tools: ['select', 'signature', 'text', 'image'], start: 'signature',
    tip: 'Create your signature on the right, click it, then click on the page to place it 🖋️' },
  fillable: { tools: ['select', 'field', 'text'], start: 'field',
    tip: 'Choose a field type on the right, then drag a box where it should go ☑️' },
  redact: { tools: ['select', 'redact'], start: 'redact', server: true,
    tip: 'Drag black boxes over anything secret, or search for words. Redaction really deletes it — not just covers it ⬛' },
};

const FIELD_TYPES = [['text', '𝐓 Text'], ['multiline', '¶ Long text'], ['checkbox', '☑ Checkbox'], ['radio', '◉ Radio button'], ['dropdown', '▾ Dropdown'], ['list', '☰ List'], ['date', '📅 Date']];
const COLORS = ['#222222', '#ec4d8f', '#7c3aed', '#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#ffffff'];
const SIG_KEY = 'mariapdf.signatures';

export function mount(root, tool) {
  const mode = MODES[tool.opts.mode];
  root.innerHTML = `<div class="tool wide">${toolHeader(tool)}<div id="st" class="stack"></div></div>`;
  const st = $('#st', root);
  let editor = null;

  const start = () => {
    st.replaceChildren(dropzone({ onFiles: async ([f]) => open(await readBytes(f), f.name) }));
  };

  async function open(bytes, name) {
    const doc = await withBusy('Opening…', () => openPdfjs(bytes, name));
    if (!doc) return;
    editor?.destroy();
    const ui = h(`<div class="stack">
      <div class="panel-box row between">
        <div class="row"><b>📄 ${esc(name)}</b>
          <button class="btn icon" id="undo" title="Undo (Ctrl+Z)">↶</button><button class="btn icon" id="redo" title="Redo (Ctrl+Shift+Z)">↷</button>
          <span id="zoom"></span>
        </div>
        <div class="row"><button class="btn" id="other">Open another</button><button class="btn primary big" id="save">${mode.server ? 'Redact & save' : 'Save PDF'} ♡</button></div>
      </div>
      <div class="editor">
        <div class="toolbox" id="toolbox">${mode.tools.map((t) => `<button data-tool="${t}" title="${esc(TOOLS[t][1])}">${TOOLS[t][0]}</button>`).join('')}</div>
        <div class="canvas-area" id="area"></div>
        <div class="side" id="side"></div>
      </div>
      <div id="result"></div>
    </div>`);
    st.replaceChildren(ui);
    const side = $('#side', ui);
    editor = new Editor({
      area: $('#area', ui),
      onSelect: (o, opts) => renderSide(o, opts),
      onChange: () => syncUndo(),
    });
    const setTool = (t) => {
      editor.setTool(t);
      ui.querySelectorAll('#toolbox button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
      // Keep showing a just-created note/field so it can be filled in right away.
      const sel = editor.selected && editor.get(editor.selected);
      renderSide(sel || null, { focus: sel && (sel.type === 'note' || sel.type === 'field') });
    };
    editor.onToolDone = () => setTool('select');
    editor.setToolExternal = setTool;
    $('#toolbox', ui).onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tool === 'image') { chooseImage(); return; }
      setTool(b.dataset.tool);
    };
    const syncUndo = () => {
      $('#undo', ui).disabled = !editor.undoStack.length;
      $('#redo', ui).disabled = !editor.redoStack.length;
    };
    $('#undo', ui).onclick = () => editor.undo();
    $('#redo', ui).onclick = () => editor.redo();
    $('#zoom', ui).replaceWith(zoomControls(editor.view));
    $('#other', ui).onclick = start;
    new ResizeObserver(() => { if (editor.view.zoom === 'width') editor.view.layout(); }).observe($('#area', ui));
    await editor.open(doc);
    syncUndo();

    /* ----- placing images & signatures ----- */
    let pending = null; // { image, w, h }
    editor.onPlace = (page, x, y) => {
      if (!pending) { toast(editor.tool === 'signature' ? 'Pick or create a signature on the right first ♡' : 'Choose an image first ♡', 'error'); return; }
      const pw = editor.view.pages[page].w;
      const w = Math.min(pending.w, pw * 0.6);
      const hh = w * (pending.h / pending.w);
      editor.add({ type: 'image', page, image: pending.image, x: x - w / 2, y: y - hh / 2, w, h: hh, opacity: 1 });
      if (editor.tool === 'image') { pending = null; }
      setTool('select');
    };
    async function chooseImage() {
      const [f] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml' });
      if (!f) return;
      pending = await imageFromFile(f, 300);
      setTool('image');
      toast('Now click on the page where the image should go ✿');
    }
    async function imageFromFile(f, maxPt) {
      const img = await loadImage(URL.createObjectURL(f));
      const isJpg = /jpe?g/.test(f.type);
      const c = document.createElement('canvas');
      const s = Math.min(1, 2400 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      c.width = Math.round((img.naturalWidth || 600) * s);
      c.height = Math.round((img.naturalHeight || 400) * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const blob = await canvasToBlob(c, isJpg ? 'image/jpeg' : 'image/png', 0.92);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const id = editor.addImage(c.toDataURL(isJpg ? 'image/jpeg' : 'image/png', 0.8), bytes, isJpg ? 'jpg' : 'png', c.width, c.height);
      const w = Math.min(maxPt, c.width * 0.75);
      return { image: id, w, h: w * (c.height / c.width) };
    }

    /* ----- side panel ----- */
    const style = editor.style;
    function styleControls(target, isObj) {
      const t = isObj ? target.type : editor.tool;
      const src = isObj ? target : style;
      const set = (props) => { if (isObj) editor.update(target.id, props); else Object.assign(style, props); };
      const wrap = h('<div class="stack"></div>');
      const colorRow = (label, key, allowNone) => {
        const row = h(`<label class="field"><span>${label}</span><div class="row">${COLORS.map((c) => `<button class="btn icon" data-c="${c}" style="width:26px;height:26px;background:${c};border:2px solid ${src[key] === c ? 'var(--accent)' : 'var(--border)'}"></button>`).join('')}
          ${allowNone ? '<button class="btn" data-c="" style="padding:2px 8px;font-size:12px">none</button>' : ''}<input type="color" value="${src[key] || '#ffffff'}"></div></label>`);
        row.onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) { e.preventDefault(); set({ [key]: b.dataset.c }); renderSide(isObj ? editor.get(target.id) : null); } };
        row.querySelector('input').onchange = (e) => { set({ [key]: e.target.value }); };
        return row;
      };
      if (['text', 'rect', 'ellipse', 'line', 'arrow', 'pen'].includes(t)) wrap.appendChild(colorRow('Color', 'color'));
      if (t === 'highlight') wrap.appendChild(colorRow('Highlighter color', isObj ? 'color' : 'highlight'));
      if (['rect', 'ellipse'].includes(t)) wrap.appendChild(colorRow('Fill', 'fill', true));
      if (['rect', 'ellipse', 'line', 'arrow', 'pen'].includes(t)) {
        const r = h(`<label class="field"><span>Line width</span><div class="row"><input type="range" min="0.5" max="20" step="0.5" value="${src.width ?? 2}" style="flex:1"><output>${src.width ?? 2}</output></div></label>`);
        r.querySelector('input').oninput = (e) => { r.querySelector('output').textContent = e.target.value; };
        r.querySelector('input').onchange = (e) => set({ width: parseFloat(e.target.value) });
        wrap.appendChild(r);
      }
      if (t === 'text') {
        const r = h(`<div class="field-row"><label class="field"><span>Size</span><input type="number" min="4" max="200" value="${src.size}"></label>
          <label class="field"><span>Align</span><select>${['left', 'center', 'right'].map((a) => `<option${src.align === a ? ' selected' : ''}>${a}</option>`).join('')}</select></label></div>`);
        r.querySelector('input').onchange = (e) => set({ size: parseFloat(e.target.value) || 12 });
        r.querySelector('select').onchange = (e) => set({ align: e.target.value });
        wrap.appendChild(r);
        const b = h(`<label class="field check"><input type="checkbox"${src.bold ? ' checked' : ''}><span>Bold</span></label>`);
        b.querySelector('input').onchange = (e) => set({ bold: e.target.checked });
        wrap.appendChild(b);
      }
      if (['text', 'image', 'rect', 'ellipse', 'line', 'arrow', 'pen'].includes(t)) {
        const r = h(`<label class="field"><span>Opacity</span><input type="range" min="10" max="100" value="${Math.round((src.opacity ?? 1) * 100)}"></label>`);
        r.querySelector('input').onchange = (e) => set({ opacity: e.target.value / 100 });
        wrap.appendChild(r);
      }
      return wrap;
    }

    function fieldEditor(o, focus) {
      const wrap = h(`<div class="stack">
          <label class="field"><span>Field name</span><input type="text" data-k="name" value="${esc(o.name)}"></label>
          <label class="field"><span>Type</span><select data-k="fieldType">${FIELD_TYPES.map(([k, l]) => `<option value="${k}"${o.fieldType === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          ${o.fieldType === 'dropdown' || o.fieldType === 'list' ? `<label class="field"><span>Choices (one per line)</span><textarea data-k="options" rows="4">${esc(o.options.join('\n'))}</textarea></label>` : ''}
          ${o.fieldType === 'radio' ? `<label class="field"><span>Group (radio buttons with the same group belong together)</span><input type="text" data-k="group" value="${esc(o.group || '')}"></label>
            <label class="field"><span>Value of this button</span><input type="text" data-k="value" value="${esc(o.value || '')}"></label>` : ''}
          ${o.fieldType === 'text' || o.fieldType === 'multiline' || o.fieldType === 'date' ? `<label class="field"><span>Default text</span><input type="text" data-k="value" value="${esc(o.value || '')}"></label>
            <label class="field"><span>Font size (0 = auto)</span><input type="number" data-k="fontSize" min="0" max="72" value="${o.fontSize || 0}"></label>` : ''}
          ${o.fieldType === 'checkbox' ? `<label class="field check"><input type="checkbox" data-k="checked"${o.value === 'on' ? ' checked' : ''}><span>Checked by default</span></label>` : ''}
          <label class="field check"><input type="checkbox" data-k="required"${o.required ? ' checked' : ''}><span>Required</span></label>
        </div>`);
      wrap.addEventListener('change', (e) => {
        const k = e.target.dataset.k;
        if (!k) return;
        let v = e.target.value;
        if (k === 'options') v = v.split('\n').map((s) => s.trim()).filter(Boolean);
        if (k === 'required') v = e.target.checked;
        if (k === 'fontSize') v = parseFloat(v) || 0;
        if (k === 'checked') { editor.update(o.id, { value: e.target.checked ? 'on' : '' }); return; }
        if (k === 'fieldType') { editor.update(o.id, { fieldType: v, ...editor.newField(v, o), name: o.name }); renderSide(editor.get(o.id)); return; }
        editor.update(o.id, { [k]: v });
      });
      if (focus) setTimeout(() => wrap.querySelector('input')?.select(), 30);
      return wrap;
    }

    function signaturePanel() {
      const wrap = h(`<div class="stack">
          <h3>🖋️ Your signatures</h3>
          <div class="sig-list" id="sigs"></div>
          <div class="radio-tiles" id="sigMode"><label><input type="radio" name="sm" value="draw" checked>Draw</label><label><input type="radio" name="sm" value="type">Type</label><label><input type="radio" name="sm" value="upload">Upload</label></div>
          <div id="sigBody"></div>
        </div>`);
      const list = $('#sigs', wrap);
      const load = () => { try { return JSON.parse(localStorage.getItem(SIG_KEY) || '[]'); } catch { return []; } };
      const store = (arr) => { try { localStorage.setItem(SIG_KEY, JSON.stringify(arr.slice(-6))); } catch { /* private mode */ } };
      const use = async (dataUrl) => {
        const img = await loadImage(dataUrl);
        const bytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
        const id = editor.addImage(dataUrl, bytes, 'png', img.naturalWidth, img.naturalHeight);
        const w = 160;
        pending = { image: id, w, h: w * (img.naturalHeight / img.naturalWidth) };
        setTool('signature');
        toast('Click on the page to place your signature ✿');
      };
      const drawList = () => {
        const sigs = load();
        list.innerHTML = sigs.length ? '' : '<span class="muted small">None yet — make one below ♡</span>';
        sigs.forEach((s, i) => {
          const b = h(`<button title="Use this signature"><img src="${s}" alt="signature"></button>`);
          b.onclick = () => use(s);
          b.oncontextmenu = (e) => { e.preventDefault(); if (confirm('Delete this signature?')) { const a = load(); a.splice(i, 1); store(a); drawList(); } };
          list.appendChild(b);
        });
      };
      const save = (dataUrl) => { const a = load(); a.push(dataUrl); store(a); drawList(); use(dataUrl); };
      const trim = (canvas) => {
        const ctx = canvas.getContext('2d');
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let x0 = width; let y0 = height; let x1 = 0; let y1 = 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        if (x1 <= x0) return null;
        const out = document.createElement('canvas');
        out.width = x1 - x0 + 8; out.height = y1 - y0 + 8;
        out.getContext('2d').drawImage(canvas, x0 - 4, y0 - 4, out.width, out.height, 0, 0, out.width, out.height);
        return out.toDataURL('image/png');
      };
      const body = $('#sigBody', wrap);
      const show = (m) => {
        if (m === 'draw') {
          body.innerHTML = `<canvas class="sig-pad" width="800" height="300"></canvas>
            <div class="row"><input type="color" value="#1d3b8f" id="ink"><button class="btn" id="clr">Clear</button><button class="btn primary" id="ok">Use ♡</button></div>`;
          const c = $('canvas', body);
          const ctx = c.getContext('2d');
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          let drawing = false; let last = null;
          const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
          c.onpointerdown = (e) => { drawing = true; last = pos(e); c.setPointerCapture(e.pointerId); };
          c.onpointermove = (e) => {
            if (!drawing) return;
            const p = pos(e);
            ctx.strokeStyle = $('#ink', body).value;
            ctx.lineWidth = 2 + Math.min(4, (e.pressure || 0.5) * 6);
            ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
            last = p;
          };
          c.onpointerup = () => { drawing = false; };
          $('#clr', body).onclick = () => ctx.clearRect(0, 0, c.width, c.height);
          $('#ok', body).onclick = () => { const d = trim(c); if (d) save(d); else toast('Draw your signature first ♡', 'error'); };
        } else if (m === 'type') {
          body.innerHTML = `<input type="text" id="name" placeholder="Your name" value="Maria">
            <div class="row"><select id="font"><option value="Pacifico">Pacifico</option><option value="Caveat">Caveat</option><option value="cursive">Cursive</option></select><input type="color" id="ink" value="#1d3b8f"><button class="btn primary" id="ok">Use ♡</button></div>
            <p class="muted small">Preview:</p><div id="pv" style="font-size:34px;background:#fff;border-radius:12px;padding:8px 12px;color:#1d3b8f"></div>`;
          const pv = $('#pv', body);
          const upd = () => { pv.textContent = $('#name', body).value; pv.style.fontFamily = $('#font', body).value; pv.style.color = $('#ink', body).value; };
          body.oninput = upd; body.onchange = upd; upd();
          $('#ok', body).onclick = async () => {
            const text = $('#name', body).value.trim();
            if (!text) return;
            await document.fonts.load(`80px ${$('#font', body).value}`);
            const c = document.createElement('canvas');
            c.width = 1200; c.height = 300;
            const ctx = c.getContext('2d');
            ctx.font = `110px ${$('#font', body).value}`;
            ctx.fillStyle = $('#ink', body).value;
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 20, 150);
            const d = trim(c);
            if (d) save(d);
          };
        } else {
          body.innerHTML = `<button class="btn" id="up">Choose an image of your signature…</button>
            <label class="field check"><input type="checkbox" id="rmbg" checked><span>Remove white background</span></label>`;
          $('#up', body).onclick = async () => {
            const [f] = await pickFiles({ accept: 'image/*' });
            if (!f) return;
            const img = await loadImage(URL.createObjectURL(f));
            const c = document.createElement('canvas');
            const s = Math.min(1, 1400 / img.naturalWidth);
            c.width = img.naturalWidth * s; c.height = img.naturalHeight * s;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0, c.width, c.height);
            if ($('#rmbg', body).checked) {
              const d = ctx.getImageData(0, 0, c.width, c.height);
              for (let i = 0; i < d.data.length; i += 4) {
                const l = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
                if (l > 200) d.data[i + 3] = 0; else if (l > 150) d.data[i + 3] = Math.round(255 * (200 - l) / 50);
              }
              ctx.putImageData(d, 0, 0);
            }
            const out = trim(c);
            if (out) save(out);
          };
        }
      };
      $('#sigMode', wrap).onchange = (e) => show(e.target.value);
      drawList();
      show('draw');
      return wrap;
    }

    let redactTerms = null;
    function renderSide(o, opts = {}) {
      side.replaceChildren();
      if (o) {
        side.appendChild(h(`<h3>${TOOLS[o.type === 'image' ? 'image' : o.type]?.[0] || '✿'} Selected ${o.type === 'field' ? 'field' : o.type}</h3>`));
        if (o.type === 'note') {
          const ta = h(`<label class="field"><span>Comment</span><textarea rows="5" placeholder="Write your note…">${esc(o.text)}</textarea></label>`);
          ta.querySelector('textarea').onchange = (e) => editor.update(o.id, { text: e.target.value });
          side.appendChild(ta);
          if (opts.focus) setTimeout(() => ta.querySelector('textarea').focus(), 30);
        } else if (o.type === 'field') {
          side.appendChild(fieldEditor(o, opts.focus));
        } else {
          side.appendChild(styleControls(o, true));
        }
        const actions = h('<div class="row"><button class="btn" data-a="dup">Duplicate</button><button class="btn danger" data-a="del">Delete</button></div>');
        actions.onclick = (e) => { const a = e.target.dataset.a; if (a === 'dup') editor.duplicate(o.id); if (a === 'del') editor.remove(o.id); };
        side.appendChild(actions);
        if (o.type === 'text') side.appendChild(h('<p class="muted small">Double-click the text (or press Enter) to change it.</p>'));
        return;
      }
      const t = editor.tool;
      side.appendChild(h(`<p class="note sticky">${esc(mode.tip)}</p>`));
      if (t !== 'select') side.appendChild(h(`<h3>${TOOLS[t][0]} ${esc(TOOLS[t][1].split(' — ')[0])}</h3>`));
      if (t === 'field') {
        const ft = h(`<label class="field"><span>Field type</span><select>${FIELD_TYPES.map(([k, l]) => `<option value="${k}"${style.fieldType === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`);
        ft.querySelector('select').onchange = (e) => { style.fieldType = e.target.value; };
        side.appendChild(ft);
      }
      if (mode.tools.includes('signature') && (t === 'signature' || t === 'select')) side.appendChild(signaturePanel());
      if (tool.opts.mode === 'redact') {
        redactTerms ||= h(`<div class="stack"><h3>🔎 Redact words everywhere</h3>
            <textarea rows="4" placeholder="One word or phrase per line, e.g. names, IBAN, phone numbers"></textarea>
            <label class="field"><span>Images under boxes</span><select><option value="pixels">Black out covered pixels</option><option value="remove">Remove whole images</option><option value="none">Keep images</option></select></label>
            <label class="field check"><input type="checkbox" checked><span>Also remove metadata & hidden text</span></label></div>`);
        side.appendChild(redactTerms);
      }
      if (['text', 'rect', 'ellipse', 'line', 'arrow', 'pen', 'highlight'].includes(t)) side.appendChild(styleControls(null, false));
      if (tool.opts.mode === 'fillable') {
        const n = editor.objects.filter((x) => x.type === 'field').length;
        side.appendChild(h(`<p class="muted small">${n} new field${n === 1 ? '' : 's'} ✿ Tip: select a field to rename it or change its type.</p>`));
      }
    }
    setTool(mode.start);

    /* ----- saving ----- */
    $('#save', ui).onclick = async () => {
      if (editor.editing) editor.stopEditing();
      const out = await withBusy(mode.server ? 'Redacting on your NAS…' : 'Saving…', async () => {
        const pdf = await openPdfLib(bytes, name);
        if (mode.server) {
          const areas = editor.redactions(pdf.getPages());
          const [ta, sel, chk] = [redactTerms?.querySelector('textarea'), redactTerms?.querySelector('select'), redactTerms?.querySelector('input')];
          const terms = (ta?.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
          if (!areas.length && !terms.length) throw new Error('Mark some areas or type words to redact first ⬛');
          const file = new File([bytes], name, { type: 'application/pdf' });
          const blob = await apiBlob('/api/redact', { file, fields: { areas, terms, images: sel?.value || 'pixels', scrub: chk ? chk.checked : true } });
          return [{ name: `${baseName(name)}-redacted.pdf`, data: blob, type: 'application/pdf' }];
        }
        await editor.drawInto(pdf);
        editor.addNotes(pdf);
        if (editor.objects.some((o) => o.type === 'field')) await editor.addFields(pdf);
        const suffix = { edit: 'edited', sign: 'signed', fillable: 'fillable' }[tool.opts.mode];
        return [{ name: `${baseName(name)}-${suffix}.pdf`, data: await savePdf(pdf), type: 'application/pdf' }];
      });
      if (out) showResult($('#result', ui), out);
    };
  }

  start();
  return () => editor?.destroy();
}
