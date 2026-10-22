'use strict';

/*
 * Interface language: English or Bulgarian.
 * The English text is the key: tr('Merge PDF') gives the Bulgarian text from I18N_BG (i18n-bg.js)
 * when Bulgarian is chosen, and the English text otherwise (also when a translation is missing).
 * Placeholders like {n} or {name} are filled from `vars`.
 *
 * Plain script loaded in <head> after prefs.js, so cats.js, pals.js and every module can use it.
 * Changing the language reloads the page (the open tool stays open), so nothing is half-translated.
 */
const LANGS = { en: 'English', bg: 'Български' };

const LANG = (() => {
  const saved = Prefs.get('lang');
  if (LANGS[saved]) return saved;
  return /^bg\b/i.test(navigator.language || '') ? 'bg' : 'en';
})();
document.documentElement.lang = LANG;

const _missing = new Set();
function _fill(s, vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : s;
}

/** Translate an English UI text. */
function tr(s, vars) {
  if (LANG === 'en' || s === '' || s == null) return _fill(String(s ?? ''), vars);
  const out = I18N_BG[s];
  // (Text that is already Bulgarian, e.g. translated twice, or has no words, like "A4", is fine as it is.)
  if (out === undefined && !_missing.has(s) && /[a-z]{2}/i.test(s) && !/[Ѐ-ӿ]/.test(s)) { _missing.add(s); console.debug('[i18n] missing bg:', s); }
  return _fill(out ?? s, vars);
}

/** Translate a word that means different things in different places: trc('signature', 'Type') looks up "signature|Type". */
function trc(ctx, s, vars) {
  const out = LANG === 'en' ? undefined : I18N_BG[`${ctx}|${s}`];
  return out === undefined ? tr(s, vars) : _fill(out, vars);
}

/** Singular or plural, then translate: trn(3, '{n} page', '{n} pages'). */
function trn(n, one, many, vars) {
  return tr(n === 1 ? one : many, { n, ...vars });
}

/**
 * Translate a message that may contain changing parts (server errors, browser errors):
 * exact match first, then the patterns in I18N_BG_PATTERNS.
 */
function trMsg(msg) {
  const s = String(msg ?? '');
  if (LANG === 'en' || !s) return s;
  if (I18N_BG[s] !== undefined) return I18N_BG[s];
  for (const [re, out] of I18N_BG_PATTERNS) {
    const m = re.exec(s);
    if (m) return typeof out === 'function' ? out(...m) : s.replace(re, out);
  }
  return s;
}

/** Number with the local decimal separator (1.5 → "1,5" in Bulgarian). */
function fmtNum(n, digits) {
  const opts = digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  return Number(n).toLocaleString(LANG === 'bg' ? 'bg-BG' : 'en-US', { useGrouping: false, ...opts });
}

function setLang(lang) {
  if (!LANGS[lang] || lang === LANG) return;
  Prefs.set('lang', lang);
  location.reload();
}

/** Translate static markup: data-i18n (text), data-i18n-title, data-i18n-placeholder, data-i18n-aria. */
function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = tr(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = tr(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = tr(el.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', tr(el.dataset.i18nAria)); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => applyI18n()); else applyI18n();
