import { $, esc, h, toast } from './core.js';
import { TOOL_BY_ID, orderedGroups } from './registry.js';

/*
 * The 🎀 Customize dialog: colour theme, background, home page layout and animal buddies.
 * Every change is applied right away and saved in this browser (see prefs.js).
 */
const TABS = [['look', '🎨 Look'], ['layout', '🧩 Layout'], ['buddies', '🐾 Buddies']];
let tab = 'look';

const pick = (name, value, label, extra = '') => {
  const on = String(Prefs.get(name)) === String(value);
  return `<button type="button" class="pill${on ? ' on' : ''}" data-set="${name}" data-value="${esc(value)}" aria-pressed="${on}"${extra}>${label}</button>`;
};

function lookTab() {
  const bgColor = Prefs.get('bgColor');
  return `
    <section class="stack"><h3>Colour theme</h3>
      <div class="swatches">${Object.entries(THEMES).map(([k, t]) => {
        const on = Prefs.get('theme') === k;
        return `<button type="button" class="swatch${on ? ' on' : ''}" data-set="theme" data-value="${k}" aria-pressed="${on}"><span style="background:${t.swatch}"></span>${esc(t.name)}</button>`;
      }).join('')}</div>
    </section>
    <section class="stack"><h3>Light or dark</h3>
      <div class="pills">${pick('mode', 'auto', '🌗 Like my computer')}${pick('mode', 'light', '☀️ Light')}${pick('mode', 'dark', '🌙 Dark')}</div>
    </section>
    <section class="stack"><h3>Background</h3>
      <div class="bg-tiles">${Object.entries(BACKGROUNDS).map(([k, b]) => {
        const on = Prefs.get('background') === k;
        const mask = patternMask(k);
        return `<button type="button" class="bg-tile${on ? ' on' : ''}${k === 'gradient' ? ' glow' : ''}" data-set="background" data-value="${k}" aria-pressed="${on}">
          <span class="bg-sample">${mask ? `<i style="${esc(`-webkit-mask:${mask} repeat;mask:${mask} repeat`)}"></i>` : ''}</span>${esc(b.name)}</button>`;
      }).join('')}</div>
      <div class="row"><label class="row" style="gap:6px">Background colour <input type="color" id="bgColor" value="${esc(bgColor || '#fff5f9')}"></label>
        <button type="button" class="btn" id="bgReset"${bgColor ? '' : ' disabled'}>Use the theme’s colour</button></div>
    </section>`;
}

function layoutTab() {
  const groups = orderedGroups();
  const nFav = Prefs.get('favorites').filter((id) => TOOL_BY_ID[id]).length;
  return `
    <section class="stack"><h3>Tool cards</h3>
      <div class="pills">${pick('view', 'cards', '▦ Cards')}${pick('view', 'compact', '▪ Compact')}${pick('view', 'list', '☰ List')}</div>
    </section>
    <section class="stack"><h3>Columns</h3>
      <div class="pills">${pick('cols', 'auto', 'Fit the window')}${[2, 3, 4, 5].map((n) => pick('cols', n, String(n))).join('')}</div>
      <label class="field check"><input type="checkbox" id="subcats"${Prefs.get('subcats') ? ' checked' : ''}><span>Split groups into smaller headings (Edit, Organize, …)</span></label>
    </section>
    <section class="stack"><h3>Groups on the home page</h3>
      <p class="muted small">Change the order with the arrows, or untick a group to hide it.</p>
      <ol class="group-order">${groups.map((g, i) => `<li style="--c:${g.color}">
        <label class="row grow"><input type="checkbox" data-show="${g.id}"${g.hidden ? '' : ' checked'}><span class="dot"></span>${g.icon} ${esc(g.name)}</label>
        <button type="button" class="btn icon" data-move="${g.id}" data-dir="-1" title="Move up"${i ? '' : ' disabled'}>↑</button>
        <button type="button" class="btn icon" data-move="${g.id}" data-dir="1" title="Move down"${i < groups.length - 1 ? '' : ' disabled'}>↓</button></li>`).join('')}</ol>
      <div class="row"><button type="button" class="btn" id="expandAll"${Prefs.get('collapsed').length ? '' : ' disabled'}>Open all folded groups</button>
        <button type="button" class="btn" id="clearFavs"${nFav ? '' : ' disabled'}>Clear ${nFav || ''} favourite${nFav === 1 ? '' : 's'}</button>
        <button type="button" class="btn" id="resetLayout">Reset layout</button></div>
      <p class="muted small" style="margin:0">Tip: click a group’s title on the home page to fold it away.</p>
    </section>`;
}

function buddiesTab() {
  const m = Prefs.get('mascot');
  const friends = Prefs.get('friends');
  const friendsOn = Prefs.get('showFriends');
  const animals = Object.keys(ANIMALS);
  const colorFor = (a) => (ANIMALS[a].fixed ? ANIMALS[a].color : m.color);
  const colors = Object.entries(CAT_PALETTES).filter(([, p]) => p.name && !p.hidden).map(([k]) => k);
  return `
    <section class="stack"><h3>Main buddy</h3>
      <p class="muted small">Shown in the corner, on the home page and while files are dropped or working.</p>
      <div class="buddy-pick">${animals.map((a) => `<button type="button" class="buddy${a === m.animal ? ' on' : ''}" data-animal="${a}" aria-pressed="${a === m.animal}">
        <span class="cat" data-cat="${a === m.animal ? `${a}.${colorFor(a)}` : a}" data-size="2.5"></span><span>${esc(ANIMALS[a].name)}</span></button>`).join('')}</div>
      ${ANIMALS[m.animal].fixed ? '' : `<div class="buddy-pick colors">${colors.map((c) => `<button type="button" class="buddy${c === m.color ? ' on' : ''}" data-color="${c}" aria-pressed="${c === m.color}">
        <span class="cat" data-cat="${m.animal}.${c}" data-size="2"></span><span>${esc(CAT_PALETTES[c].name)}</span></button>`).join('')}</div>`}
    </section>
    <section class="stack"><h3>Friends</h3>
      <label class="field check"><input type="checkbox" id="showFriends"${friendsOn ? ' checked' : ''}><span>Show animal friends (napping on the home page, living along the bottom, cheering when a file is ready)</span></label>
      ${friendsOn ? `<div class="row"><span class="muted small">Friends living along the bottom</span><div class="pills">${[0, 1, 2, 3].map((n) => pick('walkers', n, String(n))).join('')}</div></div>
      <p class="muted small">They wander about and stop to sit, nap, drink, eat, groom, play, stretch or chase butterflies. Click one to say hi ♡</p>` : ''}
      <div class="buddy-pick${friendsOn ? '' : ' disabled'}">${animals.map((a) => `<button type="button" class="buddy${friends.includes(a) ? ' on' : ''}" data-friend="${a}" aria-pressed="${friends.includes(a)}"${friendsOn ? '' : ' disabled'}>
        <span class="cat" data-cat="${a}" data-size="2"></span><span>${friends.includes(a) ? '✓ ' : ''}${esc(ANIMALS[a].name)}</span></button>`).join('')}</div>
    </section>`;
}

export function openSettings() {
  const dlg = h(`<dialog class="settings" aria-label="Customize">
    <form method="dialog" class="stack">
      <div class="row between"><h2>🎀 Customize</h2><button class="btn icon" value="close" title="Close">✕</button></div>
      <div class="tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" role="tab" data-tab="${id}">${label}</button>`).join('')}</div>
      <div class="stack" id="pane"></div>
      <p class="muted small" style="margin:0">Everything here is remembered in this browser ✿</p>
    </form>
  </dialog>`);
  document.body.appendChild(dlg);

  const render = () => {
    dlg.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
    $('#pane', dlg).innerHTML = { look: lookTab, layout: layoutTab, buddies: buddiesTab }[tab]();
  };

  const moveGroup = (id, dir) => {
    const order = orderedGroups().map((g) => g.id);
    const i = order.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    Prefs.set('groupOrder', order);
  };

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { dlg.close(); return; } // click on the backdrop
    const b = e.target.closest('button');
    if (!b) return;
    const m = Prefs.get('mascot');
    if (b.dataset.tab) tab = b.dataset.tab;
    else if (b.dataset.set) Prefs.set(b.dataset.set, /^\d+$/.test(b.dataset.value) ? Number(b.dataset.value) : b.dataset.value);
    else if (b.dataset.move) moveGroup(b.dataset.move, Number(b.dataset.dir));
    else if (b.dataset.animal) Prefs.set('mascot', { ...m, animal: b.dataset.animal });
    else if (b.dataset.color) Prefs.set('mascot', { ...m, color: b.dataset.color });
    else if (b.dataset.friend) {
      const friends = Prefs.get('friends');
      const next = friends.includes(b.dataset.friend) ? friends.filter((a) => a !== b.dataset.friend) : [...friends, b.dataset.friend];
      if (!next.length) { toast('Untick “Show animal friends” to hide them all ♡', 'error'); return; }
      Prefs.set('friends', next);
    } else if (b.id === 'bgReset') Prefs.set('bgColor', '');
    else if (b.id === 'expandAll') Prefs.set('collapsed', []);
    else if (b.id === 'clearFavs') Prefs.set('favorites', []);
    else if (b.id === 'resetLayout') ['view', 'cols', 'subcats', 'groupOrder', 'hiddenGroups', 'collapsed'].forEach((k) => Prefs.reset(k));
    else return;
    render();
  });
  dlg.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'subcats') Prefs.set('subcats', el.checked);
    else if (el.id === 'showFriends') Prefs.set('showFriends', el.checked);
    else if (el.dataset.show) {
      const hidden = Prefs.get('hiddenGroups');
      const next = el.checked ? hidden.filter((x) => x !== el.dataset.show) : [...hidden, el.dataset.show];
      if (next.length >= orderedGroups().length) { el.checked = true; toast('Keep at least one group ♡', 'error'); return; }
      Prefs.set('hiddenGroups', next);
    } else return;
    render();
  });
  // The colour picker updates live while dragging, without redrawing the dialog.
  dlg.addEventListener('input', (e) => {
    if (e.target.id !== 'bgColor') return;
    Prefs.set('bgColor', e.target.value);
    const reset = $('#bgReset', dlg);
    if (reset) reset.disabled = false;
  });
  dlg.addEventListener('close', () => dlg.remove());
  render();
  dlg.showModal();
}
