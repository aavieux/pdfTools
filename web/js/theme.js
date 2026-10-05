'use strict';

/*
 * Colour themes, light/dark mode and page backgrounds, from the saved preferences.
 * Plain script loaded in <head> so the page never flashes in the wrong colours.
 *
 * A theme is a hue + saturation + accent lightness; its light and dark colours are derived from
 * that. Themes are kept soft (low saturation, lightly tinted backgrounds); `classic` keeps the
 * stronger original formula (Ink).
 */
const THEMES = {
  pink: { name: 'Strawberry milk', h: 336, s: 55, l: 60 },
  lavender: { name: 'Lavender', h: 268, s: 40, l: 60 },
  sky: { name: 'Sky', h: 205, s: 45, l: 50 },
  mint: { name: 'Mint', h: 158, s: 32, l: 42 },
  peach: { name: 'Peach', h: 18, s: 58, l: 60 },
  lemon: { name: 'Lemon', h: 44, s: 65, l: 52, dark: true },
  cocoa: { name: 'Cocoa', h: 24, s: 24, l: 48 },
  ink: { name: 'Ink', h: 230, s: 12, l: 40, classic: true },
};
for (const t of Object.values(THEMES)) t.swatch = `hsl(${t.h} ${t.s}% ${t.l}%)`;

const BACKGROUNDS = {
  plain: { name: 'Plain' },
  gradient: { name: 'Soft glow' },
  dots: { name: 'Dots', size: 22, svg: '<circle cx="11" cy="11" r="2.2"/>' },
  grid: { name: 'Paper', size: 24, svg: '<path d="M0 .5H24M.5 0V24" stroke="#000" fill="none"/>' },
  stripes: { name: 'Stripes', size: 28, svg: '<path d="M-7 7 7-7M0 28 28 0M21 35 35 21" stroke="#000" stroke-width="5"/>' },
  hearts: { name: 'Hearts', size: 46, svg: '<path d="M23 31s-9-5.6-9-11.2c0-2.6 2-4.6 4.5-4.6 1.9 0 3.6 1.1 4.5 2.8.9-1.7 2.6-2.8 4.5-2.8 2.5 0 4.5 2 4.5 4.6 0 5.6-9 11.2-9 11.2z"/>' },
  paws: { name: 'Paws', size: 52, svg: '<g transform="rotate(-18 26 26)"><ellipse cx="26" cy="31" rx="6.5" ry="5.5"/><circle cx="18.5" cy="23.5" r="2.6"/><circle cx="23.5" cy="19.5" r="2.6"/><circle cx="29.5" cy="19.5" r="2.6"/><circle cx="34" cy="23.5" r="2.6"/></g>' },
  stars: { name: 'Stars', size: 50, svg: '<path d="M25 13l2.9 7.6 8.1.4-6.3 5.1 2.1 7.9L25 29.5 18.2 34l2.1-7.9-6.3-5.1 8.1-.4z"/><circle cx="8" cy="42" r="1.6"/><circle cx="43" cy="8" r="1.3"/>' },
};

function themeCSS(t) {
  if (!t || t.h === undefined) return '';
  const { h, s, l } = t;
  const hsl = (sat, light, a = 1) => `hsl(${h} ${sat}% ${light}% / ${a})`;
  const k = t.classic ? 1 : 0.55; // how strongly backgrounds and borders are tinted
  const soft = t.classic ? Math.min(100, s + 15) : Math.round(s * 0.85);
  const darkSat = t.classic ? Math.min(100, s + 10) : s;
  const light = `
    --bg: ${hsl(100 * k, 98.2)}; --surface: #ffffff; --surface-2: ${hsl(90 * k, 96)}; --border: ${hsl(60 * k, 87)};
    --text: ${hsl(35, 20)}; --muted: ${hsl(22, 46)};
    --accent: ${hsl(s, l)}; --accent-hover: ${hsl(s, l - 8)}; --accent-soft: ${hsl(soft, 91)};
    --accent-text: ${t.dark ? hsl(40, 14) : '#ffffff'}; --viewer: ${hsl(70 * k, 93)};
    --mask: ${hsl(40, 22, 0.45)}; color-scheme: light;`;
  const dark = `
    --bg: ${hsl(22 * k, 9)}; --surface: ${hsl(22 * k, 13)}; --surface-2: ${hsl(24 * k, 17)}; --border: ${hsl(24 * k, 27)};
    --text: ${hsl(80 * k, 94)}; --muted: ${hsl(35, 72)};
    --accent: ${hsl(darkSat, Math.max(l, 62) + 6)}; --accent-hover: ${hsl(darkSat, Math.max(l, 62) + 13)};
    --accent-soft: ${hsl(32 * k, 25)}; --accent-text: ${hsl(40, 10)}; --viewer: ${hsl(25 * k, 6)};
    --mask: ${hsl(30, 4, 0.62)}; color-scheme: dark;`;
  return `:root { ${light} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark} } }
:root[data-theme="dark"] { ${dark} }`;
}

function backgroundCSS(key, color) {
  const bg = BACKGROUNDS[key] || BACKGROUNDS.plain;
  let css = color ? `:root:root:root { --bg: ${color}; --viewer: color-mix(in srgb, ${color} 85%, #808080); }\n` : '';
  if (key === 'gradient') {
    css += `body { background: radial-gradient(1200px 700px at 10% -10%, var(--accent-soft), transparent 60%),
      radial-gradient(900px 600px at 110% 30%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%) var(--bg) fixed; }`;
  } else if (bg.svg) {
    const url = patternMask(key);
    css += `body::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
      background: color-mix(in srgb, var(--accent) 13%, transparent);
      -webkit-mask: ${url} repeat; mask: ${url} repeat; }`;
  }
  return css;
}

function applyTheme() {
  const root = document.documentElement;
  const mode = Prefs.get('mode');
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
  else delete root.dataset.theme;
  let style = document.getElementById('themeStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'themeStyle';
    document.head.appendChild(style); // after app.css, so it wins
  }
  style.textContent = themeCSS(THEMES[Prefs.get('theme')]) + '\n' + backgroundCSS(Prefs.get('background'), Prefs.get('bgColor'));
}

applyTheme();
Prefs.onChange((name) => { if (['theme', 'mode', 'background', 'bgColor'].includes(name)) applyTheme(); });

/** CSS mask for a background's pattern (used by the page and the preview tiles), or ''. */
function patternMask(key) {
  const bg = BACKGROUNDS[key];
  if (!bg?.svg) return '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bg.size}" height="${bg.size}" viewBox="0 0 ${bg.size} ${bg.size}">${bg.svg}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
