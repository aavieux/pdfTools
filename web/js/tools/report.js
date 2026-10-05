import { $, apiJson, dropzone, esc, h, toolHeader, withBusy } from '../core.js';

const ICON = { pass: '✓', fail: '✗', warn: '!' };

export function mount(root, tool) {
  const op = tool.opts.op;
  root.innerHTML = `<div class="tool">${toolHeader(tool)}<div id="st" class="stack"></div></div>`;
  const st = $('#st', root);
  const start = () => st.replaceChildren(dropzone({ multiple: true, onFiles: run }));

  async function run(files) {
    const results = await withBusy('Checking…', async () => {
      const out = [];
      for (const file of files) out.push({ file, data: await apiJson(`/api/${op}`, { file }) });
      return out;
    });
    if (!results) return;
    st.replaceChildren(...results.map(({ file, data }) => sigCard(file, data)),
      h('<div class="row"><button class="btn">↺ Check other files</button></div>'));
    st.querySelector('.row:last-child .btn').onclick = start;
  }

  function sigCard(file, d) {
    if (!d.count) {
      return h(`<div class="panel-box stack"><b>📄 ${esc(file.name)}</b><p>This PDF has no digital signatures. <span class="muted">(Drawn signatures from “Sign PDF” are pictures, not cryptographic signatures.)</span></p></div>`);
    }
    return h(`<div class="panel-box stack"><b>📄 ${esc(file.name)} · ${d.count} signature${d.count > 1 ? 's' : ''}</b>
      ${d.signatures.map((s) => {
        const status = s.error ? 'fail' : s.intact && s.valid ? (s.trusted ? 'pass' : 'warn') : 'fail';
        return `<div class="check-item ${status}"><span class="st">${ICON[status]}</span><div>
          <div><b>${esc(s.signer || s.field)}</b> — ${s.error ? esc(s.error) : s.intact ? (s.valid ? (s.trusted ? 'valid and trusted' : 'intact & cryptographically valid, signer not in a trust list') : 'signature invalid') : 'document was changed after signing!'}</div>
          <div class="ci-sub">${[
            s.signed_at && `Signed: ${esc(s.signed_at)}`, s.issuer && `Issuer: ${esc(s.issuer)}`,
            s.cert_valid_from && `Certificate valid ${esc(s.cert_valid_from)} → ${esc(s.cert_valid_to)}`,
            s.coverage && `Coverage: ${esc(s.coverage)}`, s.modification && `Changes after signing: ${esc(s.modification)}`,
            s.md_algorithm && `Hash: ${esc(s.md_algorithm)}`, s.timestamp && `Timestamp: ${esc(s.timestamp)}`,
          ].filter(Boolean).join('<br>')}</div></div></div>`;
      }).join('')}
      <p class="muted small">${esc(d.note)}</p></div>`);
  }
  start();
}
