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
    tab.dataset.lockMsg = `Like or love ${need} more ${lead === 'boys' ? 'boys’' : 'girls’'} name${need === 1 ? '' : 's'} to start comparing`;
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

export const ptitle = (iconName, cls, text) => `<p class="panel-title"><span class="p-ic ${cls}">${icon(iconName, 16)}</span>${text}</p>`;
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
