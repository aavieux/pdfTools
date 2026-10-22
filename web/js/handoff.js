import { $, Handoff, acceptMatches, download, esc, fmtBytes, h, sleep } from './core.js';
import { TOOLS, orderedGroups, CATEGORY_BY_ID } from './registry.js';

/*
 * “Continue in another tool”: pick a tool and the file opens there right away, optionally saving
 * (downloading) a copy first. Used by result cards, the crop tool and the top bar.
 */

/** Tools that can open these files (a single-file tool takes the first one). */
export function toolsFor(files) {
  return TOOLS.filter((t) => t.accept && files.length && (t.many ? files : files.slice(0, 1)).every((f) => acceptMatches(f, t.accept)));
}

/** Open tool `id` with `files`, as if they had been dropped there. */
export function openIn(id, files) {
  Handoff.send(files);
  if (location.hash === `#/${id}`) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = `#/${id}`;
}

/**
 * files: the File[] to hand on.
 * save:  tick “Save a copy first” to begin with; null hides that option (e.g. the file is the one the user opened).
 */
export function openToolPicker(list, { save = false, title = 'Open in another tool', note = '' } = {}) {
  const hidden = new Set(Prefs.get('hiddenTools'));
  const here = location.hash.replace(/^#\/?/, '').split('?')[0];
  const dlg = h(`<dialog class="settings picker" aria-label="${esc(tr(title))}">
    <form method="dialog" class="stack">
      <div class="row between"><h2>↪ ${esc(tr(title))}</h2><button class="btn icon" value="close" title="${esc(tr('Close'))}">✕</button></div>
      <p class="muted small">${list.length === 1
        ? `📄 ${esc(list[0].name)} <span class="small">(${fmtBytes(list[0].size)})</span>`
        : tr('{n} files — tools that open one file at a time get the first one', { n: list.length })}</p>
      ${note ? `<p class="muted small">${esc(tr(note))}</p>` : ''}
      ${save === null ? '' : `<label class="field check save-first"><input type="checkbox" id="saveFirst"${save ? ' checked' : ''}><span>${tr('💾 Save a copy to this computer first')}</span></label>`}
      <label class="search"><span aria-hidden="true">🔎</span><input type="search" id="pq" placeholder="${esc(tr('Find a tool…'))}" autocomplete="off"></label>
      <div class="picker-list" id="plist"></div>
    </form>
  </dialog>`);
  document.body.appendChild(dlg);

  const render = () => {
    const words = $('#pq', dlg).value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const showHidden = words.length && Prefs.get('searchHidden');
    const ok = toolsFor(list).filter((t) => (showHidden || !hidden.has(t.id)) && words.every((w) => t.words.includes(w)));
    const favs = Prefs.get('favorites');
    const groups = orderedGroups().map((g) => ({ ...g, tools: ok.filter((t) => CATEGORY_BY_ID[t.cat].group === g.id) })).filter((g) => g.tools.length);
    const fav = ok.filter((t) => favs.includes(t.id));
    const btn = (t) => `<button type="button" class="pick-tool${hidden.has(t.id) ? ' is-hidden' : ''}" data-tool="${t.id}" style="--c:${t.color}">
        <span class="card-ico">${t.icon}</span><span>${esc(t.name)}${t.id === here ? ` <span class="muted small">${tr('(again)')}</span>` : ''}</span></button>`;
    const section = (name, tools) => `<section><h3>${name}</h3><div class="pick-grid">${tools.map(btn).join('')}</div></section>`;
    $('#plist', dlg).innerHTML = (fav.length && !words.length ? section(tr('★ Your favourites'), fav) : '')
      + groups.map((g) => section(`${g.icon} ${esc(g.name)}`, g.tools)).join('')
      || `<p class="muted">${tr(words.length ? 'No tool found ♡' : 'No tool can open this kind of file ♡')}</p>`;
  };

  dlg.addEventListener('input', (e) => { if (e.target.id === 'pq') render(); });
  dlg.addEventListener('click', async (e) => {
    if (e.target === dlg) { dlg.close(); return; }
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    const saveFirst = $('#saveFirst', dlg)?.checked;
    dlg.close();
    if (saveFirst) {
      // One after the other: browsers drop downloads that start at the same moment.
      for (const f of list) { download(f, f.name); if (list.length > 1) await sleep(350); }
    }
    openIn(b.dataset.tool, list);
  });
  dlg.addEventListener('close', () => dlg.remove());
  render();
  dlg.showModal();
  $('#pq', dlg).focus();
}
