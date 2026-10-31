import { $, Handoff, esc, toast, withBusy } from './core.js';
import { CATEGORIES, TOOLS, TOOL_BY_ID, orderedGroups } from './registry.js';
import { openSettings } from './settings.js';
import { openToolPicker } from './handoff.js';

const app = $('#app');
let unmount = null;
let mounted = null; // the tool on screen, once its mount() went through
let onHome = false;

/*
 * A tool left through “↪ Other tool” isn't thrown away: it is parked, still alive, so
 * “↩ Back to …” in the top bar (or opening that tool again) brings it back with its edits.
 */
const MAX_PARKED = 3;
const parked = [];
const lastFilter = { q: '', group: Prefs.get('filter') || '', showHidden: false };

const GREETINGS = [
  'Hi Maria! What are we making today? ♡',
  'Hello Maria ~ pick a tool, any tool ✿',
  'Welcome back, Maria! Your buddies missed you ♡',
].map((g) => tr(g));
const APP_NAME = tr("Maria's PDF Tools");
const AUTHOR = 'aleksandargarkov0@gmail.com';

const favorites = () => Prefs.get('favorites').filter((id) => TOOL_BY_ID[id]);
function toggleFavorite(id) {
  const favs = favorites();
  const on = !favs.includes(id);
  Prefs.set('favorites', on ? [...favs, id] : favs.filter((x) => x !== id));
  toast(tr(on ? '{name} added to favourites ★' : '{name} removed from favourites', { name: TOOL_BY_ID[id].name }));
}

const hiddenTools = () => Prefs.get('hiddenTools').filter((id) => TOOL_BY_ID[id]);
function toggleHidden(id) {
  const hidden = hiddenTools();
  const on = !hidden.includes(id);
  Prefs.set('hiddenTools', on ? [...hidden, id] : hidden.filter((x) => x !== id));
  toast(tr(on ? '{name} is hidden — “🙈 Hidden” shows it again' : '{name} is back ♡', { name: TOOL_BY_ID[id].name }));
}

const EYE = '<svg class="icon-svg" viewBox="0 0 24 24" width="15" height="15"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg class="icon-svg" viewBox="0 0 24 24" width="15" height="15"><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.1M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/></svg>';

function card(t, favs, hidden = []) {
  const fav = favs.includes(t.id);
  const off = hidden.includes(t.id);
  return `<div class="card-wrap${off ? ' is-hidden' : ''}" style="--c:${t.color}">
    <a class="card" href="#/${t.id}">
      <div class="card-ico">${t.icon}</div>
      <div class="card-text"><div class="card-title">${esc(t.name)}</div><div class="card-desc">${esc(t.desc)}</div></div>
      <span class="where" title="${tr(t.nas ? 'Runs on your NAS — the file is sent to your own server' : 'Runs in your browser — the file never leaves this computer')}">${t.nas ? '☁' : '♡'}</span>
    </a>
    <button class="fav${fav ? ' on' : ''}" data-fav="${t.id}" title="${tr(fav ? 'Remove from favourites' : 'Add to favourites')}" aria-pressed="${fav}">${fav ? '★' : '☆'}</button>
    <button class="hide-tool" data-hide="${t.id}" title="${tr(off ? 'Show this tool again' : 'Hide this tool')}" aria-pressed="${off}">${off ? EYE : EYE_OFF}</button>
  </div>`;
}

const grid = (tools, favs, hidden) => `<div class="grid">${tools.map((t) => card(t, favs, hidden)).join('')}</div>`;

/** Layout preferences → attributes on the home page (card style, columns). */
function applyLayout() {
  const home = $('.home');
  if (!home) return;
  home.dataset.view = Prefs.get('view');
  const cols = Prefs.get('cols');
  if (cols === 'auto') { delete home.dataset.cols; home.style.removeProperty('--cols'); } else { home.dataset.cols = cols; home.style.setProperty('--cols', cols); }
}

function home() {
  onHome = true;
  document.body.classList.remove('fullscreen-tool');
  $('#crumbs').textContent = '';
  $('#homeLink').hidden = true;
  document.title = APP_NAME;
  app.innerHTML = `<div class="home">
    <section class="hero">
      <div class="hero-cat">
        <span class="float-heart h1"></span><span class="float-heart h2"></span><span class="float-heart h3"></span>
        <span class="cat" data-cat="main" data-size="6"></span>
      </div>
      <div>
        <h1>${esc(GREETINGS[new Date().getDate() % GREETINGS.length])}</h1>
        <p>${tr('{n} little PDF helpers, all in one place.', { n: TOOLS.length })}</p>
        <p class="note">${tr('psst~ tap the ☆ on a tool to keep it at the top. Themes, layout and buddies are under 🎀 Customize ↗')}</p>
      </div>
    </section>
    <label class="search">
      <span aria-hidden="true">🔎</span>
      <input type="search" id="q" placeholder="${esc(tr('Search tools… e.g. merge, word, sign, compress'))}" autocomplete="off" value="${esc(lastFilter.q)}">
    </label>
    <div class="cat-chips" id="chips"></div>
    <p class="where-legend"><span><b>♡</b> ${tr('stays in your browser')}</span><span><b>☁</b> ${tr('runs on your NAS')}</span></p>
    <div id="cats"></div>
    <div class="nap">
      <span class="zzz"><i>z</i><i>z</i><i>z</i></span>
      <span class="cat sleeping" data-cat="friend" data-n="0" data-size="3"></span>
      <span class="cat" data-cat="friend" data-n="1" data-size="3"></span>
      <span class="cat flip" data-cat="friend" data-n="2" data-size="3"></span>
    </div>
    <footer class="made-by">${tr('Want a website like this one?')} <br> ${tr('Just send me an email:')} <a href="mailto:${AUTHOR}">${AUTHOR}</a></footer>
  </div>`;
  applyLayout();

  const groups = () => orderedGroups().filter((g) => !g.hidden);

  const renderChips = () => {
    const favs = favorites();
    const nHidden = hiddenTools().length;
    if (!nHidden) lastFilter.showHidden = false;
    if (lastFilter.group === 'favorites' && !favs.length) lastFilter.group = '';
    if (lastFilter.group && lastFilter.group !== 'favorites' && !groups().some((g) => g.id === lastFilter.group)) lastFilter.group = '';
    const chip = (id, label, color) => `<button class="chip${lastFilter.group === id ? ' on' : ''}" data-group="${id}"${color ? ` style="--c:${color}"` : ''}>${label}</button>`;
    $('#chips').innerHTML = chip('', tr('All tools'), '')
      + (favs.length ? chip('favorites', `${tr('★ Favourites')} <span class="count">${favs.length}</span>`, 'hsl(43 68% 50%)') : '')
      + groups().map((g) => chip(g.id, `<span class="dot"></span>${g.icon} ${esc(g.name)}`, g.color)).join('')
      + (nHidden ? `<button class="chip hidden-chip${lastFilter.showHidden ? ' on' : ''}" data-show-hidden aria-pressed="${lastFilter.showHidden}" title="${esc(tr(lastFilter.showHidden ? 'Put the hidden tools away again' : 'Show the tools you hid'))}">🙈 ${tr('Hidden')} <span class="count">${nHidden}</span></button>` : '');
  };

  const render = () => {
    renderChips();
    const favs = favorites();
    const collapsed = Prefs.get('collapsed');
    const subcats = Prefs.get('subcats');
    const q = lastFilter.q.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const hidden = hiddenTools();
    // Hidden tools stay away unless “🙈 Hidden” is on, or a search may find them (Customize → Layout).
    const showHidden = lastFilter.showHidden || (!!words.length && Prefs.get('searchHidden'));
    const match = (t) => (showHidden || !hidden.includes(t.id)) && (!words.length || words.every((w) => t.words.includes(w)));
    // While searching, show every match even in collapsed groups.
    const isOpen = (id) => !!words.length || !collapsed.includes(id);
    const section = (id, title, color, body) => `<section class="group${isOpen(id) ? '' : ' collapsed'}" style="--c:${color}">
        <h2 class="group-title"><button class="group-toggle" data-collapse="${id}" aria-expanded="${isOpen(id)}">${title}<span class="chev" aria-hidden="true">▾</span></button></h2>
        <div class="group-body">${body}</div></section>`;
    const parts = [];
    const favTools = favs.map((id) => TOOL_BY_ID[id]).filter(match);
    if (favTools.length && (!lastFilter.group || lastFilter.group === 'favorites')) {
      parts.push(section('favorites', tr('★ Your favourites'), 'hsl(43 68% 50%)', grid(favTools, favs, hidden)));
    }
    if (lastFilter.group !== 'favorites') {
      for (const g of groups()) {
        if (lastFilter.group && lastFilter.group !== g.id) continue;
        const cats = CATEGORIES.filter(([, group]) => group === g.id)
          .map(([cid, , name, icon]) => ({ name, icon, tools: TOOLS.filter((t) => t.cat === cid && match(t)) }))
          .filter((c) => c.tools.length);
        if (!cats.length) continue;
        const body = subcats && cats.length > 1
          ? cats.map((c) => `<section class="category"><h3>${c.icon} ${esc(c.name)}</h3>${grid(c.tools, favs, hidden)}</section>`).join('')
          : grid(cats.flatMap((c) => c.tools), favs, hidden);
        parts.push(section(g.id, `${g.icon} ${esc(g.name)}`, g.color, body));
      }
    }
    const hiddenHits = words.length && !showHidden ? hidden.filter((id) => words.every((w) => TOOL_BY_ID[id].words.includes(w))).length : 0;
    const more = hiddenHits ? `<p class="muted small hidden-hint">${trn(hiddenHits, '{n} hidden tool matches too —', '{n} hidden tools match too —')} <button class="link" data-show-hidden>${tr('show them')}</button></p>` : '';
    $('#cats').innerHTML = (parts.join('') || `<div class="empty-search"><span class="cat" data-cat="main" data-size="5"></span><p>${tr('No tool called “{q}”… yet ♡', { q: esc(q) })}</p></div>`) + more;
  };

  $('#q').addEventListener('input', (e) => { lastFilter.q = e.target.value; render(); });
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = $('#cats .card');
      if (first) location.hash = first.getAttribute('href');
    }
  });
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    if (b.hasAttribute('data-show-hidden')) { lastFilter.showHidden = !lastFilter.showHidden; render(); return; }
    lastFilter.group = b.dataset.group;
    Prefs.set('filter', lastFilter.group === 'favorites' ? '' : lastFilter.group);
    render();
  });
  $('#cats').addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { toggleFavorite(fav.dataset.fav); render(); return; }
    const hide = e.target.closest('[data-hide]');
    if (hide) { toggleHidden(hide.dataset.hide); render(); return; }
    if (e.target.closest('[data-show-hidden]')) { lastFilter.showHidden = true; render(); return; }
    const tog = e.target.closest('[data-collapse]');
    if (tog) {
      const id = tog.dataset.collapse;
      const collapsed = Prefs.get('collapsed');
      Prefs.set('collapsed', collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]);
      render();
    }
  });
  home.render = render;
  render();
  if (lastFilter.q) $('#q').focus();
}

// Re-draw the home page when its layout settings change in the Customize dialog.
Prefs.onChange((name) => {
  if (!onHome) return;
  if (name === 'view' || name === 'cols') applyLayout();
  if (['subcats', 'groupOrder', 'hiddenGroups', 'favorites', 'collapsed', 'hiddenTools', 'searchHidden'].includes(name)) home.render?.();
});

$('#settingsBtn').addEventListener('click', openSettings);

// ↪ Other tool: open the file this tool is working on (with its edits, if the tool can build them) elsewhere.
Handoff.onChange(() => { $('#nextBtn').hidden = onHome || !Handoff.current.length; });
$('#nextBtn').addEventListener('click', async () => {
  const files = Handoff.live ? await withBusy('Getting your file ready…', Handoff.live) : Handoff.current;
  if (files?.length) openToolPicker(files, { save: Handoff.live ? false : null });
});

// ↩ Back to …: the most recently parked tool.
function updateBackBtn() {
  const last = parked.at(-1);
  $('#backBtn').hidden = !last;
  if (!last) return;
  $('#backBtn').title = tr('Back to {name} — {file}', { name: last.tool.name, file: last.current[0]?.name || '…' });
  $('#backBtn').innerHTML = `↩<span class="hide-sm"> ${esc(tr('Back to {name}', { name: last.tool.name }))}</span>`;
}
$('#backBtn').addEventListener('click', () => {
  const last = parked.at(-1);
  if (!last) return;
  if (location.hash === `#/${last.tool.id}`) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = `#/${last.tool.id}`;
});

// EN | БГ switch in the top bar: shows both languages, the current one highlighted.
$('#langBtn').innerHTML = Object.keys(LANGS).map((l) => `<span class="${l === LANG ? 'on' : ''}" lang="${l}">${l === 'bg' ? 'БГ' : 'EN'}</span>`).join('');
$('#langBtn').setAttribute('aria-label', tr('Switch language'));
$('#langBtn').addEventListener('click', () => setLang(LANG === 'bg' ? 'en' : 'bg'));

/* ---------- Routing ---------- */

function showTool(tool) {
  onHome = false;
  document.title = `${tool.name} — ${APP_NAME}`;
  $('#crumbs').textContent = `› ${tool.name}`;
  $('#homeLink').hidden = false;
  document.body.classList.toggle('fullscreen-tool', tool.module === 'crop');
}

async function openTool(tool) {
  showTool(tool);
  app.innerHTML = '<div class="tool"><div class="nap"><span class="cat bounce" data-cat="main" data-size="4"></span></div></div>';
  try {
    const mod = await import(`./tools/${tool.module}.js`);
    if (location.hash.slice(2).split('?')[0] !== tool.id) return; // navigated away while loading
    app.replaceChildren();
    unmount = (await mod.mount(app, tool)) || null;
    mounted = tool;
    Handoff.take(); // a tool without a drop zone leaves them; don't let the next tool pick them up
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="tool"><div class="result"><span class="cat" data-cat="main" data-size="5"></span><h2>${tr('Oops, this tool tripped over its tail')}</h2><p class="muted">${esc(trMsg(e.message))}</p><a class="btn" href="#/">${tr('Back to all tools')}</a></div></div>`;
  }
}

function closeTool(fn) {
  if (typeof fn !== 'function') return;
  try { fn(); } catch (e) { console.error(e); }
}

/** Take the tool on screen off the page without closing it. */
function park() {
  parked.push({ tool: mounted, unmount, nodes: [...app.childNodes], current: Handoff.current, live: Handoff.live, scroll: window.scrollY });
  app.replaceChildren();
  while (parked.length > MAX_PARKED) closeTool(parked.shift().unmount);
}

/** Put a parked tool back on the page, as it was. */
function resume(entry) {
  parked.splice(parked.indexOf(entry), 1);
  showTool(entry.tool);
  app.replaceChildren(...entry.nodes);
  unmount = entry.unmount;
  mounted = entry.tool;
  Handoff.note(entry.current);
  Handoff.live = entry.live;
  window.scrollTo(0, entry.scroll);
  toast(tr('Back in {name}, where you left off ♡', { name: entry.tool.name }));
}

async function route() {
  // Files handed on are for the tool being opened now; the top bar button starts empty again.
  const handed = Handoff.take();
  if (handed && mounted) park(); else closeTool(unmount);
  unmount = null;
  mounted = null;
  window.scrollTo(0, 0);
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  const tool = TOOL_BY_ID[id];
  Handoff.reset();
  if (tool) Handoff.send(handed);
  const waiting = !handed && parked.findLast((p) => p.tool.id === id);
  if (!id || !tool) {
    if (id) toast('That tool does not exist ♡', 'error');
    home();
  } else if (waiting) {
    resume(waiting);
  } else {
    await openTool(tool);
  }
  updateBackBtn();
}

window.addEventListener('hashchange', route);
// Don't let files dropped outside a drop zone replace the app.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
route();
