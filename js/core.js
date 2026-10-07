// Shared state, small helpers and screen switching. Every screen module imports from here.
import { load, save, requestPersistence } from './storage.js';
import { SEXES, sexesFor } from './names.js';
import { icon } from './icons.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const state = load();     // the saved state; replaced in place (see replaceState) so every module sees the same object
export const data = {};          // sex -> { list, byKey, yearTotals, ... }, filled once the name files load
export const ui = { screen: 'welcome', infoFrom: 'swipe' };   // current screen, and the screen the details view returns to
export const screens = {};       // name -> { enter(opts), early? }, registered by each screen module

// Swap in a whole new state (import, reset) without breaking other modules' references to it.
export function replaceState(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, next);
}

export const persist = () => { save(state); updateTabs(); };
export const announce = (msg) => { $('#live').textContent = ''; setTimeout(() => { $('#live').textContent = msg; }, 20); };
export const fmt = (n) => n.toLocaleString('en-GB');
// One-line popularity description used in lists and the compare screen.
export const statLine = (n) => (n.classic ? `${n.classic.peak <= 2005 ? 'Classic' : 'Past favourite'} · peaked ${n.classic.peak}` : `#${fmt(n.rank)} · ${fmt(n.count)} babies`);
export const merged = () => state.settings.sex === 'both';   // boys and girls mixed: names used for both appear once

// A name's decision. When boys and girls are mixed, a name used for both counts as one decision.
export const decisionOf = (n) =>
  state.decisions[n.sex][n.key] || (merged() && n.alt ? state.decisions[n.alt.sex][n.alt.key] : undefined);

// A name's own decision and rating (for its own sex only, ignoring its unisex twin).
export const ownDecision = (n) => state.decisions[n.sex][n.key];
export const ratingOf = (n) => state.elo[n.sex][n.key];

// Record a decision. With `both`, the name's unisex twin gets the same decision.
export function setDecision(n, d, both = false) {
  state.decisions[n.sex][n.key] = d;
  if (both && n.alt) state.decisions[n.alt.sex][n.alt.key] = d;
}
export function clearDecision(sex, key) { delete state.decisions[sex][key]; }

// Decision counts. A name decided the same way in both sexes counts once.
export function counts(sexes = sexesFor(state.settings.sex)) {
  const c = { no: 0, like: 0, love: 0 };
  for (const sex of sexes) {
    for (const [key, d] of Object.entries(state.decisions[sex])) {
      if (sex === 'girls' && sexes.includes('boys') && state.decisions.boys[key] === d) continue;
      c[d]++;
    }
  }
  return c;
}
export const summary = (c) => `${fmt(c.no + c.like + c.love)} seen · ${fmt(c.like)} liked · ${fmt(c.love)} loved`;

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  announce(msg);
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ---------- tab bar ---------- */
const COMPARE_MIN = 4;     // liked or loved names needed before comparing makes sense

// The Compare tab is locked (greyed, with an 'N more' badge) until there are enough names.
export function updateTabs() {
  const sizes = { boys: poolSize('boys'), girls: poolSize('girls') };
  const lead = sizes.girls > sizes.boys ? 'girls' : 'boys';        // the pool closest to being ready
  const need = COMPARE_MIN - sizes[lead];
  const tab = $('.t-compare');
  if (!tab) return;
  const locked = need > 0;
  tab.classList.toggle('locked', locked);
  if (locked) {
    tab.setAttribute('aria-disabled', 'true');
    tab.dataset.lockMsg = `Like or love ${need} more ${possessive(lead)} name${need === 1 ? '' : 's'} to start comparing`;
  } else {
    tab.removeAttribute('aria-disabled');
    delete tab.dataset.lockMsg;
  }
  const badge = $('#compare-badge');
  badge.hidden = !locked;
  badge.textContent = locked ? `${need} more` : '';
}

export const comparedIn = (pool) => (state.comparedBy && state.comparedBy[pool]) || 0;
export const totalCompared = () => comparedIn('boys') + comparedIn('girls');
export const poolSize = (pool) => Object.values(state.decisions[pool]).filter((d) => d === 'like' || d === 'love').length;

// Small wording helpers shared by the screens.
export const possessive = (sex) => (sex === 'boys' ? 'boys’' : 'girls’');
export const sexWord = (sex) => (sex === 'boys' ? 'Boy' : 'Girl');
export const babyWord = (k) => (k === 1 ? 'baby' : 'babies');
export const babies = (k) => `${fmt(k)} ${babyWord(k)}`;
// Irish if the name (or its twin, when one is passed or attached) is tagged Irish.
export const irishOf = (n, alt = n.alt) => !!(n.irish || (alt && alt.irish));

// Build an element: h('li', { class: 'x', 'aria-label': '…', onclick: fn }, 'text', childElement, …).
// Strings and numbers become text nodes (never HTML). `html` is for trusted markup only (icons).
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'html') el.innerHTML = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(typeof kid === 'object' ? kid : String(kid));
  return el;
}

export const ptitle = (iconName, cls, text) => `<p class="panel-title"><span class="p-ic ${cls}">${icon(iconName, 16)}</span>${text}</p>`;
// Escaping rule for HTML built from strings: anything that isn't a literal in this code (data files, saved state,
// imported backups) goes through esc(), or is set with textContent / setAttribute instead of innerHTML.
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let persistAsked = false;
// Once you've actually used the app, ask the browser to protect the saved data (once per visit).
export function askPersistence() {
  if (persistAsked) return;
  persistAsked = true;
  requestPersistence().then(() => { if (ui.screen === 'settings' && screens.settings) screens.settings.note(); });
}

/* ---------- screens ---------- */
// Each screen module registers { enter(opts), early } in `screens`. `early` screens render before the tab bar updates.
export function show(name, opts = {}) {
  if ((name === 'swipe' || name === 'rank') && !SEXES.every((x) => data[x])) return;   // names still loading
  ui.screen = name;
  for (const s of $$('.screen')) s.hidden = s.id !== 'screen-' + name;
  document.body.dataset.sex = name === 'swipe' || name === 'welcome' ? state.settings.sex : 'both';
  const target = screens[name];
  if (target && target.early) target.enter(opts);
  const navName = name === 'info' ? ui.infoFrom : name;       // the info screen keeps the tab you came from highlighted
  for (const b of $$('.tab')) { if (b.dataset.go === navName) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  updateTabs();
  if (target && !target.early) target.enter(opts);
  if (!(name === 'list' && opts.keep)) scrollTo(0, 0);
}
