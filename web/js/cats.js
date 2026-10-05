'use strict';

/*
 * Tiny pixel-art animals drawn as SVG rectangles (no image files).
 * Any element with data-cat="…" gets an animal; data-size is the pixel size. data-cat can be
 *   a colour ("ginger" → ginger cat), "animal.colour" ("bunny.pink"), "main" (the mascot picked
 *   in settings) or "friend" (one of the chosen animal friends; data-n picks which one).
 * Their eyes follow the mouse (or your finger) around the page.
 *
 * Legend: o outline · f fur · p pink · d darker fur · m light fur (muzzle, cheeks)
 *         W eye white · e pupil / nose · w paws · t tail fur · T tail outline · u tail tip
 * Every sprite is 20×16 with the eyes in the same place, so the eye tracking works for all.
 */
const SPRITES = {
  cat: [
    '..o..........o......',
    '.opo........opo.....',
    '.oppo......oppo.....',
    '.offfoooooofffo.....',
    '.offffffffffffo.....',
    'offffffffffffffo....',
    'offWWWffffWWWffo....',
    'offWWWffffWWWffo....',
    'offpffffffffpffo....',
    'offffffppffffffo..T.',
    '.offffoffoffffo..TtT',
    '..offffffffffo...TtT',
    '.offffffffffffo.TtT.',
    '.offffffffffffoTtT..',
    '.offwwffffwwffotT...',
    '..oooooooooooooT....',
  ],
  bunny: [
    '..ooo......ooo......',
    '..opo......opo......',
    '..opo......opo......',
    '..opo......opo......',
    '.ofpfoooooofpfo.....',
    'offffffffffffffo....',
    'offWWWffffWWWffo....',
    'offWWWffffWWWffo....',
    'offpffffffffpffo....',
    'offffffppffffffo....',
    '.offffoffoffffo.....',
    '..offffffffffo......',
    '.offffffffffffoTT...',
    '.offffffffffffoTtT..',
    '.offwwffffwwffoTT...',
    '..ooooooooooooo.....',
  ],
  dog: [
    '....................',
    '....................',
    '...oooooooooo.......',
    '.ooffffffffffoo.....',
    'oddffffffffffddo....',
    'oddffffffffffddo....',
    'oddWWWffffWWWddo....',
    'oddWWWffffWWWddo....',
    'oddpffffffffpddo....',
    'oddffffeeffffddo..T.',
    '.oddffoffoffddo..TtT',
    '..offffffffffo...TtT',
    '.offffffffffffo.TtT.',
    '.offffffffffffoTtT..',
    '.offwwffffwwffotT...',
    '..oooooooooooooT....',
  ],
  fox: [
    '..o..........o......',
    '.odo........odo.....',
    '.oddo......oddo.....',
    '.offfoooooofffo.....',
    '.offffffffffffo.....',
    'offffffffffffffo....',
    'offWWWffffWWWffo....',
    'offWWWffffWWWffo....',
    'ommffffffffffmmo....',
    'ommmmmmeemmmmmmo..T.',
    '.ommmmommommmmo..TuT',
    '..offffffffffo...TuT',
    '.offffffffffffo.TtT.',
    '.offffffffffffoTtT..',
    '.offmmffffmmffotT...',
    '..oooooooooooooT....',
  ],
  bear: [
    '....................',
    '.ooo........ooo.....',
    'opppo......opppo....',
    'offfoooooooofffo....',
    'offffffffffffffo....',
    'offffffffffffffo....',
    'offWWWffffWWWffo....',
    'offWWWffffWWWffo....',
    'offpffffffffpffo....',
    'offfffmeemfffffo....',
    '.offffoffoffffo.....',
    '..offffffffffo......',
    '.offffffffffffo.....',
    '.offffffffffffoTT...',
    '.offwwffffwwffoTT...',
    '..ooooooooooooo.....',
  ],
  panda: [
    '....................',
    '.ooo........ooo.....',
    'odddo......odddo....',
    'odddoooooooodddo....',
    'offffffffffffffo....',
    'offffffffffffffo....',
    'offWWWffffWWWffo....',
    'offWWWffffWWWffo....',
    'offffffffffffffo....',
    'offffffeeffffffo....',
    '.offffoffoffffo.....',
    '..oddffffffddo......',
    '.odddffffffdddo.....',
    '.odddffffffdddoTT...',
    '.oddddffffddddoTT...',
    '..ooooooooooooo.....',
  ],
};

const ANIMALS = {
  cat: { name: 'Cat', color: 'cream' },
  bunny: { name: 'Bunny', color: 'white' },
  dog: { name: 'Puppy', color: 'brown' },
  fox: { name: 'Fox', color: 'ginger' },
  bear: { name: 'Bear', color: 'brown' },
  panda: { name: 'Panda', color: 'panda', fixed: true },
};

// Pupils (2×2 with a shine pixel), centred in each 3×2 eye white.
const PUPILS = [[3.5, 6], [10.5, 6]];

const HEART_SPRITE = [
  '.oo.oo.',
  'oppopwo',
  'opppppo',
  'opppppo',
  '.opppo.',
  '..opo..',
  '...o...',
];

const CAT_PALETTES = {
  cream: { name: 'Cream', o: '#6b3f4f', f: '#fff1e0', p: '#ff9cc2', d: '#e8c9a8', m: '#fffaf3', e: '#3a2230', w: '#ffffff', W: '#ffffff' },
  ginger: { name: 'Ginger', o: '#7a3b2a', f: '#ffb877', p: '#ff8fb8', d: '#c8642c', m: '#fff1e0', e: '#3a2230', w: '#ffffff', W: '#fffaf2' },
  gray: { name: 'Gray', o: '#4b4558', f: '#cfc8dc', p: '#ffa6c9', d: '#958ca8', m: '#f1edf7', e: '#2b2633', w: '#ffffff', W: '#ffffff' },
  black: { name: 'Black', o: '#1d1620', f: '#3d3342', p: '#ff8fb8', d: '#2a222e', m: '#6c5f72', e: '#1d1620', w: '#ffffff', W: '#d8f5a2' },
  brown: { name: 'Brown', o: '#4a2c1d', f: '#b98159', p: '#ff9cc2', d: '#7d4e30', m: '#ecd2b2', e: '#2a1810', w: '#ffffff', W: '#ffffff' },
  white: { name: 'Snow', o: '#857a8c', f: '#ffffff', p: '#ffb3d1', d: '#e3dce8', m: '#ffffff', e: '#3a2230', w: '#ffffff', W: '#e6f2ff' },
  pink: { name: 'Pink', o: '#9a3f68', f: '#ffc6dd', p: '#ff6fa5', d: '#ff9cc2', m: '#fff0f6', e: '#3a2230', w: '#ffffff', W: '#ffffff' },
  blue: { name: 'Blue', o: '#3a4a7a', f: '#bcd3ff', p: '#ffa6c9', d: '#86a6e8', m: '#eef4ff', e: '#22284a', w: '#ffffff', W: '#ffffff' },
  panda: { name: 'Panda', hidden: true, o: '#1d1620', f: '#ffffff', p: '#ffa6c9', d: '#2d2530', m: '#ffffff', e: '#ffffff', w: '#ffffff', W: '#2d2530' },
  heart: { o: '#b8325f', p: '#ff6fa5', w: '#ffd3e4' },
};
const FRIEND_COLORS = ['ginger', 'gray', 'black', 'white', 'brown', 'pink', 'blue', 'cream'];

let catSeq = 0;
const px = (x, y, fill, w = 1, h = 1) =>
  `<rect x="${x}" y="${y}" width="${w + 0.02}" height="${h + 0.02}" fill="${fill}"/>`;

/** "bunny.pink" → { animal: 'bunny', color: 'pink' }; a bare colour means a cat. */
function parseBuddy(spec) {
  const [a, c] = String(spec || 'cream').split('.');
  if (c !== undefined) return { animal: SPRITES[a] ? a : 'cat', color: c };
  if (SPRITES[a]) return { animal: a, color: ANIMALS[a].color };
  return { animal: 'cat', color: a };
}

/** Turn data-cat values like "main" or "friend" into "animal.colour" using the saved preferences. */
function resolveBuddy(value, n = 0) {
  if (value === 'main') {
    const m = Prefs.get('mascot');
    return `${m.animal}.${ANIMALS[m.animal]?.fixed ? ANIMALS[m.animal].color : m.color}`;
  }
  if (value === 'friend') {
    const friends = Prefs.get('friends').filter((a) => SPRITES[a]);
    const list = friends.length ? friends : ['cat'];
    const animal = list[n % list.length];
    const color = ANIMALS[animal].fixed ? ANIMALS[animal].color : FRIEND_COLORS[(n + Math.floor(n / list.length)) % FRIEND_COLORS.length];
    return `${animal}.${color}`;
  }
  return value;
}

function catSVG(spec = 'cream', size = 3) {
  const { animal, color } = parseBuddy(spec);
  const sprite = SPRITES[animal];
  const pal = CAT_PALETTES[color] || CAT_PALETTES.cream;
  const h = sprite.length;
  const w = sprite[0].length;
  let tail = '';
  let body = '';
  const TAIL = { t: 'f', T: 'o', u: 'm' };
  sprite.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      if (TAIL[ch]) tail += px(x, y, pal[TAIL[ch]]);
      else body += px(x, y, pal[ch]);
    });
  });
  // Pupils live in .look (moved by the eye tracker) inside .eyes (blink animation).
  const pupils = PUPILS.map(([x, y]) =>
    px(x, y, pal.e, 2, 2) + px(x + 1, y, pal.w, 1, 1)).join('');
  // Closed eyes: fur on top, a dark line below. Shown while blinking or sleeping.
  const lids = PUPILS.map(([x, y]) => px(x - 0.5, y, pal.W === pal.d ? pal.d : pal.f, 3, 1) + px(x - 0.5, y + 1, pal.o, 3, 1)).join('');
  // Keep the moving pupils inside the eye whites.
  const clipId = `cateye${++catSeq}`;
  const clip = PUPILS.map(([x, y]) => `<rect x="${x - 0.5}" y="${y}" width="3" height="2"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w * size}" height="${h * size}" shape-rendering="crispEdges" aria-hidden="true">` +
    `<defs><clipPath id="${clipId}">${clip}</clipPath></defs>` +
    `<g class="tail">${tail}</g><g class="body">${body}</g>` +
    `<g class="eyes" clip-path="url(#${clipId})"><g class="look">${pupils}</g></g><g class="lids">${lids}</g></svg>`;
}

function heartSVG(size = 3) {
  const pal = CAT_PALETTES.heart;
  let out = '';
  HEART_SPRITE.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') out += px(x, y, pal[ch]); }));
  return `<svg viewBox="0 0 7 7" width="${7 * size}" height="${7 * size}" shape-rendering="crispEdges" aria-hidden="true">${out}</svg>`;
}

function paintCats(root = document) {
  const friendsOn = Prefs.get('showFriends');
  root.querySelectorAll('[data-cat]:not([data-painted])').forEach((el) => {
    // Friends can be switched off; the mascot and explicit animals always show.
    const off = el.dataset.cat === 'friend' && !friendsOn;
    el.classList.toggle('buddy-off', off);
    el.innerHTML = off ? '' : catSVG(resolveBuddy(el.dataset.cat, Number(el.dataset.n) || 0), Number(el.dataset.size) || 3);
    el.dataset.painted = '1';
  });
  root.querySelectorAll('.float-heart:empty, [data-heart]:empty').forEach((el) => { el.innerHTML = heartSVG(Number(el.dataset.heart) || 3); });
}

/** Repaint the mascot and friends after the settings change. */
function repaintBuddies() {
  document.querySelectorAll('[data-cat="main"], [data-cat="friend"]').forEach((el) => el.removeAttribute('data-painted'));
  paintCats();
  // Tab icon = the mascot. As a standalone image it needs the SVG namespace, and the page's CSS
  // doesn't reach it, so leave out the closed-eye layer that is normally only shown when blinking.
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) {
    const svg = catSVG(resolveBuddy('main'), 1)
      .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
      .replace(/<g class="lids">.*?<\/g>/, '');
    icon.type = 'image/svg+xml';
    icon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}
Prefs.onChange((name) => { if (['mascot', 'friends', 'showFriends'].includes(name)) repaintBuddies(); });

/** A little burst of pixel hearts, e.g. after saving. */
function heartBurst(count = 14) {
  const box = document.getElementById('hearts');
  if (!box || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let k = 0; k < count; k++) {
    const h = document.createElement('span');
    h.className = 'burst-heart';
    h.innerHTML = heartSVG(2 + Math.floor(Math.random() * 3));
    h.style.left = `${10 + Math.random() * 80}%`;
    h.style.animationDelay = `${Math.random() * 0.6}s`;
    h.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
    box.appendChild(h);
    setTimeout(() => h.remove(), 3200);
  }
}

/* ---------- Eyes follow the pointer ---------- */
(() => {
  let mx = -1;
  let my = -1;
  let queued = false;
  const MAX_X = 0.5;   // in sprite pixels: pupils can move half a pixel inside the eye
  const MAX_Y = 0.45;

  function look() {
    queued = false;
    document.querySelectorAll('.cat svg').forEach((svg) => {
      const g = svg.querySelector('.look');
      if (!g) return;
      // Friends busy drinking, eating or watching a butterfly keep their eyes on it.
      const gaze = svg.closest('[data-gaze]')?.dataset.gaze;
      if (gaze) { g.setAttribute('transform', gaze === 'up' ? 'translate(0 -0.45)' : 'translate(0 0.45)'); return; }
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      // Eye centre in screen space: sprite coords (8, 7) of a 20×16 sprite.
      const cx = r.left + (8 / 20) * r.width;
      const cy = r.top + (7 / 16) * r.height;
      let dx = mx - cx;
      let dy = my - cy;
      const dist = Math.hypot(dx, dy) || 1;
      // Full deflection once the pointer is a little away from the cat.
      const k = Math.min(1, dist / (r.width * 1.5)) / dist;
      dx *= k; dy *= k;
      g.setAttribute('transform', `translate(${(dx * MAX_X).toFixed(2)} ${(dy * MAX_Y).toFixed(2)})`);
    });
  }

  const onMove = (e) => {
    mx = e.clientX;
    my = e.clientY;
    if (!queued) { queued = true; requestAnimationFrame(look); }
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onMove, { passive: true });
})();

repaintBuddies();
new MutationObserver(() => paintCats()).observe(document.documentElement, { childList: true, subtree: true });
