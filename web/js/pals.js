'use strict';

/*
 * Animal friends living along the bottom of the window. Each one wanders to a spot and does
 * something there — sits, naps, drinks, eats, grooms, plays with yarn, stretches or chases a
 * butterfly — and one thing tends to lead to another (a big meal makes them sleepy, waking up
 * comes with a stretch, playing makes them thirsty). Click one to say hi.
 *
 * Plain script; needs prefs.js and cats.js. How many friends walk around is set in
 * Customize → Buddies ("walkers").
 */
(() => {
  /* ---------- Pixel props (same style as the animals) ---------- */
  const PROPS = {
    water: { size: 3, rows: ['.ooooooo.', 'owwwwwwwo', 'oBBBBBBBo', '.oBBBBBo.', '..ooooo..'] },
    food: { size: 3, rows: ['..k.k.k..', '.okkkkko.', 'oBBBBBBBo', '.oBBBBBo.', '..ooooo..'] },
    ball: { size: 2.5, rows: ['..rrr..', '.ryYyr.', 'ryYyYyr', 'rYyYyYr', 'ryYyYyr', '.ryYyr.', '..rrr.Y'] },
    butterfly: { size: 2, rows: ['bb...bb', 'bVbobVb', '.bbobb.', 'bVbobVb', 'bb...bb'] },
  };
  const PROP_COLORS = {
    o: '#7a3b52', w: '#8fd3ff', B: '#ff9cc2', k: '#b9773f',
    r: '#b8325f', y: '#ff8fb8', Y: '#ffd6e7', b: '#a78bfa', V: '#fde68a',
  };
  function propSVG(name) {
    const { size, rows } = PROPS[name];
    let out = '';
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== '.') out += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${PROP_COLORS[ch]}"/>`;
    }));
    const w = rows[0].length;
    return `<svg viewBox="0 0 ${w} ${rows.length}" width="${w * size}" height="${rows.length * size}" shape-rendering="crispEdges">${out}</svg>`;
  }

  /* ---------- What they do ---------- */
  // weight: how often it's picked; secs: how long; gaze: where the eyes look; next: what may follow.
  const ACTS = {
    sit: { weight: 4, secs: [3, 8] },
    nap: { weight: 2, secs: [14, 30], next: { stretch: 0.8 } },
    drink: { weight: 2, secs: [4, 8], prop: 'water', gaze: 'down' },
    eat: { weight: 2, secs: [5, 9], prop: 'food', gaze: 'down', next: { nap: 0.45, groom: 0.3 } },
    groom: { weight: 2, secs: [4, 8], fx: 'sparkle' },
    play: { weight: 2, secs: [5, 10], prop: 'ball', next: { drink: 0.4, sit: 0.3 } },
    stretch: { weight: 1, secs: [2.6, 2.6] },
    butterfly: { weight: 1, secs: [6, 11], prop: 'butterfly', gaze: 'up', next: { sit: 0.5 } },
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function pickAct(prev) {
    const follow = ACTS[prev]?.next;
    if (follow) {
      let r = Math.random();
      for (const [name, p] of Object.entries(follow)) { if ((r -= p) < 0) return name; }
    }
    const entries = Object.entries(ACTS).filter(([name]) => name !== prev && name !== 'stretch');
    let r = Math.random() * entries.reduce((s, [, a]) => s + a.weight, 0);
    for (const [name, a] of entries) { if ((r -= a.weight) < 0) return name; }
    return 'sit';
  }

  const W = 60; // width of a friend at pixel size 3

  class Pal {
    constructor(box, n, others) {
      this.others = others;
      this.el = document.createElement('div');
      this.el.className = 'pal';
      this.el.title = tr('Say hi ♡');
      this.el.innerHTML = `<div class="pal-flip"><span class="cat" data-cat="friend" data-n="${n}" data-size="3"></span><div class="pal-prop"></div></div><div class="pal-fx"></div>`;
      this.cat = this.el.querySelector('.cat');
      this.prop = this.el.querySelector('.pal-prop');
      this.fx = this.el.querySelector('.pal-fx');
      box.appendChild(this.el);
      this.x = this.freeSpot();
      this.place(this.x, 0);
      this.el.addEventListener('click', () => this.greet());
      this.timer = setTimeout(() => this.next('sit'), rand(300, 2500));
    }

    maxX() { return Math.max(0, window.innerWidth - W - 8); }

    /** A random spot that isn't right on top of another friend. */
    freeSpot() {
      for (let k = 0; k < 12; k++) {
        const x = rand(8, this.maxX());
        if (this.others.every((o) => o === this || Math.abs(o.x - x) > W * 1.4)) return x;
      }
      return rand(8, this.maxX());
    }

    place(x, secs) {
      this.el.style.transitionDuration = `${secs}s`;
      this.el.style.transform = `translateX(${Math.round(x)}px)`;
      this.x = x;
    }

    clear() {
      clearTimeout(this.timer);
      this.el.classList.remove('walking', 'running');
      this.cat.classList.remove('sleeping');
      delete this.el.dataset.act;
      delete this.el.dataset.gaze;
      this.prop.className = 'pal-prop';
      this.prop.innerHTML = '';
      this.fx.innerHTML = '';
      this.el.querySelector('.look')?.removeAttribute('transform');
    }

    /** Walk (or sometimes run) somewhere, then do `act` there. */
    next(act) {
      this.clear();
      if (reduced.matches) { this.el.dataset.act = 'sit'; return; }
      const target = this.freeSpot();
      const dist = Math.abs(target - this.x);
      if (dist < 30 || act === 'stretch') { this.doAct(act); return; }
      const run = Math.random() < 0.18;
      const speed = run ? rand(150, 220) : rand(38, 65); // px per second
      const secs = dist / speed;
      this.el.classList.add(run ? 'running' : 'walking');
      this.el.classList.toggle('left', target < this.x);
      this.place(target, secs);
      this.timer = setTimeout(() => { this.el.classList.remove('walking', 'running'); this.doAct(act); }, secs * 1000);
    }

    doAct(act) {
      const a = ACTS[act];
      this.act = act;
      this.el.dataset.act = act;
      if (a.gaze) {
        this.el.dataset.gaze = a.gaze;
        this.el.querySelector('.look')?.setAttribute('transform', a.gaze === 'up' ? 'translate(0 -0.45)' : 'translate(0 0.45)');
      }
      if (act === 'nap') {
        this.cat.classList.add('sleeping');
        this.fx.innerHTML = '<span class="zzz"><i>z</i><i>z</i><i>z</i></span>';
      }
      if (a.fx === 'sparkle') this.fx.innerHTML = '<span class="sparkle s1">✦</span><span class="sparkle s2">✧</span>';
      if (a.prop) {
        this.prop.className = `pal-prop ${a.prop}`;
        this.prop.innerHTML = propSVG(a.prop);
      }
      this.timer = setTimeout(() => {
        // Wandering off is not instant: most acts end with a short sit.
        const following = pickAct(act);
        if (act !== 'sit' && following !== 'stretch' && Math.random() < 0.35) {
          this.clear();
          this.el.dataset.act = 'sit';
          this.timer = setTimeout(() => this.next(following), rand(1200, 3000));
        } else {
          this.next(following);
        }
      }, rand(...a.secs) * 1000);
    }

    greet() {
      const wasNapping = this.act === 'nap';
      this.clear();
      this.el.classList.remove('walking', 'running');
      this.place(this.el.getBoundingClientRect().left, 0); // stop where it is
      this.el.dataset.act = wasNapping ? 'stretch' : 'happy';
      for (let k = 0; k < 4; k++) {
        const heart = document.createElement('span');
        heart.className = 'pal-heart';
        heart.innerHTML = heartSVG(2);
        heart.style.left = `${10 + k * 11}px`;
        heart.style.animationDelay = `${k * 0.15}s`;
        this.fx.appendChild(heart);
      }
      this.act = 'happy';
      this.timer = setTimeout(() => this.next(wasNapping ? 'sit' : pickAct('sit')), 2600);
    }

    destroy() {
      clearTimeout(this.timer);
      this.el.remove();
    }
  }

  let pals = [];
  function build() {
    pals.forEach((p) => p.destroy());
    pals = [];
    const box = document.getElementById('pals');
    if (!box || !Prefs.get('showFriends')) return;
    const count = Math.max(0, Math.min(3, Number(Prefs.get('walkers')) || 0));
    for (let i = 0; i < count; i++) pals.push(new Pal(box, 4 + i, pals));
  }

  Prefs.onChange((name) => { if (['walkers', 'showFriends', 'friends'].includes(name)) build(); });
  reduced.addEventListener?.('change', build);
  window.addEventListener('resize', () => pals.forEach((p) => { if (p.x > p.maxX()) p.place(p.maxX(), 0.4); }));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
