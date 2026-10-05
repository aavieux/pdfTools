import { $, esc, h, optionsForm, toast, toolHeader } from '../core.js';

const WORDS = ('kitten whisker purr velvet blossom cupcake marshmallow sunny meadow ribbon sparkle cozy pillow teacup honey petal bubble cherry ' +
  'lavender moonbeam pebble sugar muffin daisy clover breeze cocoa sprinkle lantern biscuit peach plum mango kiwi tulip violet rosie paws ' +
  'mittens snuggle cuddle fluffy pastry waffle pancake candle garden willow rainbow comet galaxy planet ocean coral seashell pearl lilac ' +
  'jasmine maple acorn hazel walnut caramel toffee vanilla cinnamon ginger nutmeg pudding cookie gelato sorbet melody harmony ballet ' +
  'canvas crayon pastel doodle sketch poem story fable riddle puzzle castle tower bridge island harbor valley canyon forest glacier ' +
  'aurora horizon twilight sunrise dewdrop raindrop snowflake frost ember spark flame feather sparrow robin finch swallow dove owl ' +
  'panda koala otter bunny hedgehog fawn pony lamb duckling puppy hamster ferret squirrel chipmunk beaver badger raccoon').split(' ');

function rand(n) {
  const a = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / n) * n;
  do crypto.getRandomValues(a); while (a[0] >= limit);
  return a[0] % n;
}

function generate(v) {
  if (v.mode === 'phrase') {
    const words = Array.from({ length: v.words }, () => WORDS[rand(WORDS.length)]);
    const w = v.caps ? words.map((x) => x[0].toUpperCase() + x.slice(1)) : words;
    const out = w.join(v.sep);
    return { pw: v.num ? `${out}${v.sep}${rand(100)}` : out, bits: v.words * Math.log2(WORDS.length) + (v.num ? Math.log2(100) : 0) };
  }
  let sets = [];
  if (v.lower) sets.push('abcdefghijklmnopqrstuvwxyz');
  if (v.upper) sets.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  if (v.digits) sets.push('0123456789');
  if (v.symbols) sets.push('!@#$%^&*()-_=+[]{};:,.?/~');
  if (v.noAmbig) sets = sets.map((s) => s.replace(/[Il1O0o]/g, ''));
  if (!sets.length) throw new Error('Choose at least one kind of character ♡');
  const all = sets.join('');
  const chars = sets.map((s) => s[rand(s.length)]); // at least one of each kind
  while (chars.length < v.length) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = rand(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return { pw: chars.join('').slice(0, v.length), bits: v.length * Math.log2(all.length) };
}

export function mount(root, tool) {
  root.innerHTML = `<div class="tool">${toolHeader(tool)}<div class="cols">
      <div class="panel-box stack">
        <div class="pw-out" id="pw"></div>
        <div class="meter"><div id="bar"></div></div><div class="muted small" id="str"></div>
        <div class="row" style="justify-content:center"><button class="btn primary big" id="copy">📋 Copy</button><button class="btn big" id="again">🎲 New one</button></div>
        <h3 style="margin:8px 0 0;color:var(--accent)">More ideas</h3><div id="more" class="stack" style="gap:6px"></div>
      </div>
      <div class="panel-box stack sticky-side" id="opts"><h3 style="margin:0;color:var(--accent)">♡ Options</h3></div>
    </div><p class="note center">Passwords are made with your browser's secure random generator and never leave this page ✿</p></div>`;
  const form = optionsForm([
    { name: 'mode', label: 'Kind', type: 'radio', value: 'chars', options: [['chars', 'Random characters'], ['phrase', 'Cute passphrase']] },
    { name: 'length', label: 'Length', type: 'range', value: 18, min: 6, max: 64, show: (v) => v.mode === 'chars' },
    { name: 'lower', label: 'Lowercase (abc)', type: 'checkbox', value: true, show: (v) => v.mode === 'chars' },
    { name: 'upper', label: 'Uppercase (ABC)', type: 'checkbox', value: true, show: (v) => v.mode === 'chars' },
    { name: 'digits', label: 'Numbers (123)', type: 'checkbox', value: true, show: (v) => v.mode === 'chars' },
    { name: 'symbols', label: 'Symbols (!@#)', type: 'checkbox', value: true, show: (v) => v.mode === 'chars' },
    { name: 'noAmbig', label: 'Avoid look-alikes (I l 1 O 0)', type: 'checkbox', value: true, show: (v) => v.mode === 'chars' },
    { name: 'words', label: 'Words', type: 'range', value: 5, min: 3, max: 10, show: (v) => v.mode === 'phrase' },
    { name: 'sep', label: 'Separator', type: 'select', value: '-', options: [['-', 'dash -'], ['.', 'dot .'], ['_', 'underscore _'], [' ', 'space']], show: (v) => v.mode === 'phrase' },
    { name: 'caps', label: 'Capitalize words', type: 'checkbox', value: true, show: (v) => v.mode === 'phrase' },
    { name: 'num', label: 'Add a number', type: 'checkbox', value: true, show: (v) => v.mode === 'phrase' },
  ], () => make());
  $('#opts', root).appendChild(form.el);
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = h('<textarea style="position:fixed;opacity:0"></textarea>'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast('Copied ♡');
  };
  let current = '';
  function make() {
    try {
      const v = form.values();
      const { pw, bits } = generate(v);
      current = pw;
      $('#pw', root).textContent = pw;
      const pct = Math.min(100, (bits / 128) * 100);
      $('#bar', root).style.width = `${pct}%`;
      $('#bar', root).style.background = bits < 50 ? 'var(--danger)' : bits < 80 ? '#f59e0b' : 'var(--ok)';
      $('#str', root).textContent = `${Math.round(bits)} bits of entropy · ${bits < 50 ? 'weak 🙀' : bits < 80 ? 'okay' : bits < 110 ? 'strong 💪' : 'super strong 🦁'}`;
      $('#more', root).replaceChildren(...Array.from({ length: 5 }, () => {
        const p = generate(v).pw;
        const b = h(`<button class="btn ghost" style="font-family:ui-monospace,monospace;justify-content:flex-start;word-break:break-all;white-space:normal">${esc(p)}</button>`);
        b.onclick = () => copy(p);
        return b;
      }));
    } catch (e) { $('#pw', root).textContent = e.message; }
  }
  $('#copy', root).onclick = () => copy(current);
  $('#again', root).onclick = make;
  make();
}
