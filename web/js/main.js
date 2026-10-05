import { $, esc, toast } from './core.js';
import { CATEGORIES, TOOLS, TOOL_BY_ID, orderedGroups } from './registry.js';
import { openSettings } from './settings.js';

const app = $('#app');
let unmount = null;
let onHome = false;
const lastFilter = { q: '', group: Prefs.get('filter') || '' };

const GREETINGS = [
  'Hi Maria! What are we making today? ♡',
  'Hello Maria ~ pick a tool, any tool ✿',
  'Welcome back, Maria! Your buddies missed you ♡',
];
const AUTHOR = 'aleksandargarkov0@gmail.com';

const favorites = () => Prefs.get('favorites').filter((id) => TOOL_BY_ID[id]);
function toggleFavorite(id) {
  const favs = favorites();
  const on = !favs.includes(id);
  Prefs.set('favorites', on ? [...favs, id] : favs.filter((x) => x !== id));
  toast(on ? `${TOOL_BY_ID[id].name} added to favourites ★` : `${TOOL_BY_ID[id].name} removed from favourites`);
}

function card(t, favs) {
  const fav = favs.includes(t.id);
  return `<div class="card-wrap" style="--c:${t.color}">
    <a class="card" href="#/${t.id}">
      <div class="card-ico">${t.icon}</div>
      <div class="card-text"><div class="card-title">${esc(t.name)}</div><div class="card-desc">${esc(t.desc)}</div></div>
      <span class="where" title="${t.nas ? 'Runs on your NAS — the file is sent to your own server' : 'Runs in your browser — the file never leaves this computer'}">${t.nas ? '☁' : '♡'}</span>
    </a>
    <button class="fav${fav ? ' on' : ''}" data-fav="${t.id}" title="${fav ? 'Remove from favourites' : 'Add to favourites'}" aria-pressed="${fav}">${fav ? '★' : '☆'}</button>
  </div>`;
}

const grid = (tools, favs) => `<div class="grid">${tools.map((t) => card(t, favs)).join('')}</div>`;

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
  document.title = "Maria's PDF Tools";
  app.innerHTML = `<div class="home">
    <section class="hero">
      <div class="hero-cat">
        <span class="float-heart h1"></span><span class="float-heart h2"></span><span class="float-heart h3"></span>
        <span class="cat" data-cat="main" data-size="6"></span>
      </div>
      <div>
        <h1>${esc(GREETINGS[new Date().getDate() % GREETINGS.length])}</h1>
        <p>${TOOLS.length} little PDF helpers, all in one place.</p>
        <p class="note">psst~ tap the ☆ on a tool to keep it at the top. Themes, layout and buddies are under 🎀 Customize ↗</p>
      </div>
    </section>
    <label class="search">
      <span aria-hidden="true">🔎</span>
      <input type="search" id="q" placeholder="Search tools… e.g. merge, word, sign, compress" autocomplete="off" value="${esc(lastFilter.q)}">
    </label>
    <div class="cat-chips" id="chips"></div>
    <p class="where-legend"><span><b>♡</b> stays in your browser</span><span><b>☁</b> runs on your NAS</span></p>
    <div id="cats"></div>
    <div class="nap">
      <span class="zzz"><i>z</i><i>z</i><i>z</i></span>
      <span class="cat sleeping" data-cat="friend" data-n="0" data-size="3"></span>
      <span class="cat" data-cat="friend" data-n="1" data-size="3"></span>
      <span class="cat flip" data-cat="friend" data-n="2" data-size="3"></span>
    </div>
    <footer class="made-by">Want a website like this one? <br> Just send me an email: <a href="mailto:${AUTHOR}">${AUTHOR}</a></footer>
  </div>`;
  applyLayout();

  const groups = () => orderedGroups().filter((g) => !g.hidden);

  const renderChips = () => {
    const favs = favorites();
    if (lastFilter.group === 'favorites' && !favs.length) lastFilter.group = '';
    if (lastFilter.group && lastFilter.group !== 'favorites' && !groups().some((g) => g.id === lastFilter.group)) lastFilter.group = '';
    const chip = (id, label, color) => `<button class="chip${lastFilter.group === id ? ' on' : ''}" data-group="${id}"${color ? ` style="--c:${color}"` : ''}>${label}</button>`;
    $('#chips').innerHTML = chip('', 'All tools', '')
      + (favs.length ? chip('favorites', `★ Favourites <span class="count">${favs.length}</span>`, 'hsl(43 68% 50%)') : '')
      + groups().map((g) => chip(g.id, `<span class="dot"></span>${g.icon} ${esc(g.name)}`, g.color)).join('');
  };

  const render = () => {
    renderChips();
    const favs = favorites();
    const collapsed = Prefs.get('collapsed');
    const subcats = Prefs.get('subcats');
    const q = lastFilter.q.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const match = (t) => !words.length || words.every((w) => `${t.name} ${t.desc} ${t.id}`.toLowerCase().includes(w));
    // While searching, show every match even in collapsed groups.
    const isOpen = (id) => !!words.length || !collapsed.includes(id);
    const section = (id, title, color, body) => `<section class="group${isOpen(id) ? '' : ' collapsed'}" style="--c:${color}">
        <h2 class="group-title"><button class="group-toggle" data-collapse="${id}" aria-expanded="${isOpen(id)}">${title}<span class="chev" aria-hidden="true">▾</span></button></h2>
        <div class="group-body">${body}</div></section>`;
    const parts = [];
    const favTools = favs.map((id) => TOOL_BY_ID[id]).filter(match);
    if (favTools.length && (!lastFilter.group || lastFilter.group === 'favorites')) {
      parts.push(section('favorites', '★ Your favourites', 'hsl(43 68% 50%)', grid(favTools, favs)));
    }
    if (lastFilter.group !== 'favorites') {
      for (const g of groups()) {
        if (lastFilter.group && lastFilter.group !== g.id) continue;
        const cats = CATEGORIES.filter(([, group]) => group === g.id)
          .map(([cid, , name, icon]) => ({ name, icon, tools: TOOLS.filter((t) => t.cat === cid && match(t)) }))
          .filter((c) => c.tools.length);
        if (!cats.length) continue;
        const body = subcats && cats.length > 1
          ? cats.map((c) => `<section class="category"><h3>${c.icon} ${esc(c.name)}</h3>${grid(c.tools, favs)}</section>`).join('')
          : grid(cats.flatMap((c) => c.tools), favs);
        parts.push(section(g.id, `${g.icon} ${esc(g.name)}`, g.color, body));
      }
    }
    $('#cats').innerHTML = parts.join('') || `<div class="empty-search"><span class="cat" data-cat="main" data-size="5"></span><p>No tool called “${esc(q)}”… yet ♡</p></div>`;
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
    lastFilter.group = b.dataset.group;
    Prefs.set('filter', lastFilter.group === 'favorites' ? '' : lastFilter.group);
    render();
  });
  $('#cats').addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { toggleFavorite(fav.dataset.fav); render(); return; }
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
  if (['subcats', 'groupOrder', 'hiddenGroups', 'favorites', 'collapsed'].includes(name)) home.render?.();
});

$('#settingsBtn').addEventListener('click', openSettings);

/* ---------- Routing ---------- */

async function openTool(tool) {
  onHome = false;
  document.title = `${tool.name} — Maria's PDF Tools`;
  $('#crumbs').textContent = `› ${tool.name}`;
  $('#homeLink').hidden = false;
  document.body.classList.toggle('fullscreen-tool', tool.module === 'crop');
  app.innerHTML = '<div class="tool"><div class="nap"><span class="cat bounce" data-cat="main" data-size="4"></span></div></div>';
  try {
    const mod = await import(`./tools/${tool.module}.js`);
    if (location.hash.slice(2).split('?')[0] !== tool.id) return; // navigated away while loading
    app.replaceChildren();
    unmount = (await mod.mount(app, tool)) || null;
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="tool"><div class="result"><span class="cat" data-cat="main" data-size="5"></span><h2>Oops, this tool tripped over its tail</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/">Back to all tools</a></div></div>`;
  }
}

async function route() {
  if (typeof unmount === 'function') {
    try { unmount(); } catch (e) { console.error(e); }
  }
  unmount = null;
  window.scrollTo(0, 0);
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  const tool = TOOL_BY_ID[id];
  if (!id || !tool) {
    if (id) toast('That tool does not exist ♡', 'error');
    home();
  } else {
    await openTool(tool);
  }
}

window.addEventListener('hashchange', route);
// Don't let files dropped outside a drop zone replace the app.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
route();
