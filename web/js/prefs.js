'use strict';

/*
 * Preferences remembered in this browser (favourite tools, mascot, animal friends, …).
 * Plain script so cats.js can use it before the modules load. Storage can be blocked
 * (private windows, strict settings); everything still works then, it just isn't remembered.
 */
const Prefs = (() => {
  const KEY = 'mariapdf.prefs';
  const DEFAULTS = {
    favorites: [],
    mascot: { animal: 'cat', color: 'cream' },
    friends: ['cat', 'bunny', 'dog', 'fox', 'bear', 'panda'],
    showFriends: true,
    walkers: 1,
    // look
    theme: 'pink',
    mode: 'auto',
    background: 'plain',
    bgColor: '',
    // home page layout
    view: 'cards',
    cols: 'auto',
    subcats: true,
    groupOrder: [],
    hiddenGroups: [],
    collapsed: [],
  };
  let data = {};
  try { data = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { data = {}; }
  const listeners = new Set();

  return {
    get(name) {
      const v = data[name];
      return v === undefined ? structuredClone(DEFAULTS[name]) : v;
    },
    set(name, value) {
      data[name] = value;
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* not remembered, still applied */ }
      listeners.forEach((fn) => fn(name, value));
    },
    reset(name) {
      delete data[name];
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ }
      listeners.forEach((fn) => fn(name, this.get(name)));
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
