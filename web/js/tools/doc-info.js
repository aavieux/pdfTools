import {
  $, baseName, dropzone, esc, h, openPdfLib, optionsForm, readBytes, savePdf, showResult, toolHeader, withBusy,
} from '../core.js';

const LAYOUTS = [['', 'Reader default'], ['SinglePage', 'Single page'], ['OneColumn', 'Continuous scroll'], ['TwoColumnLeft', 'Two pages, continuous (odd left)'],
  ['TwoColumnRight', 'Two pages, continuous (cover alone)'], ['TwoPageLeft', 'Two pages (odd left)'], ['TwoPageRight', 'Two pages (cover alone)']];
const MODES = [['', 'Reader default'], ['UseNone', 'Just the page'], ['UseOutlines', 'Show bookmarks panel'], ['UseThumbs', 'Show page thumbnails'],
  ['FullScreen', 'Full screen'], ['UseAttachments', 'Show attachments panel']];

function toLocalInput(d) {
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function mount(root, tool) {
  const prefs = tool.opts.mode === 'prefs';
  root.innerHTML = `<div class="tool">${toolHeader(tool)}<div class="stack" id="st"></div></div>`;
  const st = $('#st', root);
  const start = () => st.replaceChildren(dropzone({ onFiles: ([f]) => load(f) }));

  async function load(file) {
    const bytes = await readBytes(file);
    const doc = await withBusy('Opening…', () => openPdfLib(bytes, file.name));
    if (!doc) return;
    const { PDFName } = PDFLib;
    let form;
    if (!prefs) {
      form = optionsForm([
        { name: 'title', label: 'Title', type: 'text', value: doc.getTitle() || '' },
        { name: 'author', label: 'Author', type: 'text', value: doc.getAuthor() || '' },
        { name: 'subject', label: 'Subject', type: 'text', value: doc.getSubject() || '' },
        { name: 'keywords', label: 'Keywords', type: 'text', value: doc.getKeywords() || '', hint: 'separate with commas' },
        { name: 'creator', label: 'Creator (app that made the original)', type: 'text', value: doc.getCreator() || '' },
        { name: 'producer', label: 'Producer (app that made the PDF)', type: 'text', value: doc.getProducer() || '' },
        { name: 'created', label: 'Created', type: 'datetime-local', value: toLocalInput(doc.getCreationDate()) },
        { name: 'modified', label: 'Modified', type: 'datetime-local', value: toLocalInput(doc.getModificationDate() || new Date()) },
        { name: 'lang', label: 'Language (e.g. en, de-DE)', type: 'text', value: String(doc.catalog.get(PDFName.of('Lang'))?.decodeText?.() ?? '') },
      ]);
    } else {
      const vp = doc.catalog.getViewerPreferences();
      const name = (k) => { const val = doc.catalog.get(PDFName.of(k)); return val instanceof PDFName ? val.decodeText() : ''; };
      const bool = (getter) => { try { return vp ? !!vp[getter]() : false; } catch { return false; } };
      form = optionsForm([
        { name: 'layout', label: 'Page layout', type: 'select', value: name('PageLayout'), options: LAYOUTS },
        { name: 'mode', label: 'When the file opens, show', type: 'select', value: name('PageMode'), options: MODES },
        { name: 'openPage', label: 'Open at page', type: 'number', value: 1, min: 1, max: doc.getPageCount() },
        { name: 'zoom', label: 'Zoom', type: 'select', value: '', options: [['', 'Reader default'], ['Fit', 'Fit page'], ['FitH', 'Fit width'], ['50', '50%'], ['75', '75%'], ['100', '100%'], ['125', '125%'], ['150', '150%'], ['200', '200%']] },
        { name: 'displayDocTitle', label: 'Show document title in the window (instead of file name)', type: 'checkbox', value: bool('getDisplayDocTitle') },
        { name: 'fitWindow', label: 'Resize window to fit the first page', type: 'checkbox', value: bool('getFitWindow') },
        { name: 'centerWindow', label: 'Center the window on screen', type: 'checkbox', value: bool('getCenterWindow') },
        { name: 'hideToolbar', label: 'Hide the toolbar', type: 'checkbox', value: bool('getHideToolbar') },
        { name: 'hideMenubar', label: 'Hide the menu bar', type: 'checkbox', value: bool('getHideMenubar') },
        { name: 'hideWindowUI', label: 'Hide scrollbars & navigation', type: 'checkbox', value: bool('getHideWindowUI') },
        { name: 'duplex', label: 'Print duplex', type: 'select', value: '', options: [['', 'Printer default'], ['Simplex', 'One-sided'], ['DuplexFlipLongEdge', 'Double-sided (long edge)'], ['DuplexFlipShortEdge', 'Double-sided (short edge)']] },
      ]);
    }
    const panel = h(`<div class="panel-box stack"><div class="row between"><b>📄 ${esc(file.name)}</b><span class="muted small">${trn(doc.getPageCount(), '{n} page', '{n} pages')}</span></div></div>`);
    const go = h(`<button class="btn primary big">${tr('Save ♡')}</button>`);
    const result = h('<div></div>');
    panel.append(form.el, go);
    st.replaceChildren(panel, result);

    go.onclick = async () => {
      const v = form.values();
      const out = await withBusy('Saving…', async () => {
        const d = await openPdfLib(bytes, file.name);
        if (!prefs) {
          d.setTitle(v.title, { showInWindowTitleBar: true });
          d.setAuthor(v.author);
          d.setSubject(v.subject);
          d.setKeywords(v.keywords.split(',').map((s) => s.trim()).filter(Boolean));
          d.setCreator(v.creator);
          d.setProducer(v.producer);
          if (v.created) d.setCreationDate(new Date(v.created));
          d.setModificationDate(v.modified ? new Date(v.modified) : new Date());
          if (v.lang) d.catalog.set(PDFName.of('Lang'), PDFLib.PDFString.of(v.lang));
        } else {
          const p = d.catalog.getOrCreateViewerPreferences();
          p.setDisplayDocTitle(v.displayDocTitle);
          p.setFitWindow(v.fitWindow);
          p.setCenterWindow(v.centerWindow);
          p.setHideToolbar(v.hideToolbar);
          p.setHideMenubar(v.hideMenubar);
          p.setHideWindowUI(v.hideWindowUI);
          if (v.duplex) p.setDuplex(PDFLib.Duplex[v.duplex]);
          const setName = (k, val) => { if (val) d.catalog.set(PDFName.of(k), PDFName.of(val)); else d.catalog.delete(PDFName.of(k)); };
          setName('PageLayout', v.layout);
          setName('PageMode', v.mode);
          const page = d.getPage(Math.min(d.getPageCount(), Math.max(1, v.openPage || 1)) - 1);
          if (v.zoom || v.openPage > 1) {
            const arr = d.context.obj([page.ref]);
            if (v.zoom === 'Fit' || !v.zoom) arr.push(PDFName.of('Fit'));
            else if (v.zoom === 'FitH') { arr.push(PDFName.of('FitH')); arr.push(PDFLib.PDFNull); }
            else { arr.push(PDFName.of('XYZ')); arr.push(PDFLib.PDFNull); arr.push(PDFLib.PDFNull); arr.push(d.context.obj(parseFloat(v.zoom) / 100)); }
            d.catalog.set(PDFName.of('OpenAction'), arr);
          }
        }
        return [{ name: `${baseName(file.name)}.pdf`, data: await savePdf(d), type: 'application/pdf' }];
      });
      if (out) showResult(result, out, { again: start });
    };
  }
  start();
}
