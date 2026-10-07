// Compare ("This or that?"): head-to-head votes inside one sex's pool, plus the ranked list rows built from the ratings.
import { CONFIG, startRating, applyResult, pickPair, pairKey } from './elo.js';
import { icon } from './icons.js';
import { $, $$, state, data, ui, screens, persist, announce, fmt, statLine, reduced, poolSize, comparedIn } from './core.js';

/* ---------- ranking (this-or-that) ---------- */
// Comparing happens inside one sex's pool at a time: boys' names, or girls' names. A unisex name is in both
// pools (decisions are stored per sex) and has a separate rating in each, so ratings are never compared across pools.
let rankPool = null;              // 'boys' | 'girls'
let rankPair = null;              // [item, item] currently on screen
let rankLast = null;              // key of the previous pair (never repeated straight away)
const rankSeen = new Set();       // pairs already shown this session
let rankUndo = [];                // votes that can be undone (this session, this pool)
let rankBusy = false;
let rankedSexSel = null;          // Ranked tab: chosen sex (null = automatic)

// Liked or loved names in one pool.
function rankItems(pool) {
  const out = [];
  for (const [key, d] of Object.entries(state.decisions[pool])) {
    if (d !== 'like' && d !== 'love') continue;
    const n = data[pool] && data[pool].byKey.get(key);
    if (n) out.push({ id: `${pool}:${key}`, pool, n, d });
  }
  return out;
}

// Which pool to show first: the one last used (if it can be compared), otherwise the one with more names.
function defaultPool() {
  const last = state.settings.lastPool;
  if (last && poolSize(last) >= 2) return last;
  return poolSize('girls') > poolSize('boys') ? 'girls' : 'boys';
}
export const rankedSex = () => rankedSexSel || defaultPool();

function eloEntry(it) {
  const store = state.elo[it.pool];
  if (!store[it.n.key]) store[it.n.key] = { r: startRating(it.d), n: 0 };
  return store[it.n.key];
}

// Used by the Boys / Girls filter on My list (a name decided the same way for both sexes is one row).
export const sexOk = (row, sex) => sex === 'both' || !!row.alt || row.n.sex === sex;

// Ranked list for one pool: by rating, with a position and a bar width relative to that pool.
export function rankedRows(pool) {
  const items = rankItems(pool).map((it) => ({ ...it, alt: it.n.alt, e: eloEntry(it) }));
  items.sort((a, b) => b.e.r - a.e.r || a.n.name.localeCompare(b.n.name, 'en'));
  const hi = items.length ? items[0].e.r : 0;
  const lo = items.length ? items[items.length - 1].e.r : 0;
  items.forEach((it, i) => { it.pos = i + 1; it.pct = hi === lo ? 100 : 12 + (88 * (it.e.r - lo)) / (hi - lo); });
  return items;
}


// The "check your top 10" tip returns after another hintAfter comparisons in the same pool once dismissed.
function hintNext(pool) {
  const v = state.settings.rankHintNext;
  return v && typeof v === 'object' ? v[pool] || 0 : v || 0;
}

function renderRank(pair = null) {
  document.body.dataset.sex = 'both';
  const pool = rankPool;
  const items = rankItems(pool);
  const stage = $('#rank-stage');
  stage.textContent = '';
  for (const p of ['boys', 'girls']) {
    const radio = $(`input[name=pool][value=${p}]`);
    radio.checked = p === pool;
    radio.disabled = p !== pool && poolSize(p) < 2;
    $(`#pool-n-${p}`).textContent = poolSize(p);
  }
  const noun = pool === 'boys' ? 'boys’' : 'girls’';
  const done = comparedIn(pool);
  $('#rank-progress').textContent = `${fmt(done)} comparison${done === 1 ? '' : 's'} · ${fmt(items.length)} ${noun} names in the running`;
  $('#rank-hint').hidden = done < Math.max(CONFIG.hintAfter, hintNext(pool));
  $('#rank-undo').disabled = rankUndo.length === 0;
  $('#rank-skip').disabled = items.length < 2;
  if (items.length < 2) {
    rankPair = null;
    stage.innerHTML = `<div class="empty"><h2>Not enough names yet</h2><p class="muted">Like or love at least two ${noun} names, then come back to compare them.</p>
      <button class="btn primary" data-go="swipe">Back to swiping</button></div>`;
    return;
  }
  rankPair = pair && pair.every((p) => items.some((i) => i.id === p.id)) ? pair
    : pickPair(items, eloEntry, { last: rankLast, seen: rankSeen, compared: done });
  rankPair.forEach((it, side) => {
    const opt = document.createElement('div');
    opt.className = 'opt';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'pick ' + it.d;
    pick.setAttribute('aria-label', `I prefer ${it.n.name}`);
    const irish = it.n.irish || (it.n.alt && it.n.alt.irish);
    const rank = `${it.n.alt ? 'Unisex · ' : ''}${statLine(it.n)}`;
    pick.innerHTML = `<span class="tag">${icon(it.d === 'love' ? 'star' : 'heart', 15)}${it.d === 'love' ? 'Loved' : 'Liked'}</span>
      <span class="pn"></span>${irish ? '<span class="badge" role="img" aria-label="Irish name">☘️</span>' : ''}<span class="pi"></span>`;
    $('.pn', pick).textContent = it.n.name;
    $('.pn', pick).style.setProperty('--len', String(Math.max(6, it.n.name.length)));
    $('.pi', pick).textContent = rank;
    pick.addEventListener('click', () => choose(side));
    opt.append(pick);
    stage.append(opt);
    if (side === 0) { const or = document.createElement('div'); or.className = 'or'; or.setAttribute('aria-hidden', 'true'); or.textContent = 'or'; stage.append(or); }
  });
}

function setRankPool(pool) {
  rankPool = pool;
  state.settings.lastPool = pool;
  rankUndo = []; rankLast = null;
  persist();
  renderRank();
}

function choose(side) {
  if (!rankPair || rankBusy) return;
  const [w, l] = side === 0 ? rankPair : [rankPair[1], rankPair[0]];
  const ew = eloEntry(w), el = eloEntry(l);
  rankUndo.push({ w, l, ew: { ...ew }, el: { ...el }, last: rankLast });
  if (rankUndo.length > 50) rankUndo.shift();
  applyResult(ew, el);
  state.comparedBy[rankPool] = comparedIn(rankPool) + 1;
  state.settings.lastPool = rankPool;
  const key = pairKey(w, l);
  rankLast = key; rankSeen.add(key);
  persist();
  announce(`${w.n.name} over ${l.n.name}`);
  const picked = $$('#rank-stage .pick')[side];
  if (picked) picked.classList.add('won');
  rankBusy = true;
  setTimeout(() => { rankBusy = false; if (ui.screen === 'rank') renderRank(); }, reduced() ? 0 : 280);
}

function skipRank() {
  if (!rankPair || rankBusy) return;
  const key = pairKey(rankPair[0], rankPair[1]);
  rankSeen.add(key); rankLast = key;
  renderRank();
}

function undoRank() {
  const u = rankUndo.pop();
  if (!u) return;
  Object.assign(eloEntry(u.w), u.ew);
  Object.assign(eloEntry(u.l), u.el);
  state.comparedBy[rankPool] = Math.max(0, comparedIn(rankPool) - 1);
  rankLast = u.last;
  persist(); announce('Undid last comparison');
  renderRank([u.w, u.l]);
}

// Showing the Ranked tab straight from Compare: start on the pool you were comparing.
export function syncRankedSex() { if (rankPool) rankedSexSel = rankPool; }
export function setRankedSex(pool) { rankedSexSel = pool; }

function enterRank() {
  const p = defaultPool();
  if (p !== rankPool) { rankPool = p; rankUndo = []; rankLast = null; }
  renderRank();
}

export function initRank() {
  $('#rank-skip').addEventListener('click', skipRank);
  $$('input[name=pool]').forEach((i) => i.addEventListener('change', () => setRankPool(i.value)));
  $('#rank-hint-x').addEventListener('click', () => {
    const cur = state.settings.rankHintNext;
    const next = cur && typeof cur === 'object' ? { ...cur } : { boys: cur || 0, girls: cur || 0 };
    next[rankPool] = comparedIn(rankPool) + CONFIG.hintAfter;   // show again after another 20 comparisons here
    state.settings.rankHintNext = next;
    persist(); $('#rank-hint').hidden = true;
  });
  $('#rank-undo').addEventListener('click', undoRank);
  document.addEventListener('keydown', (e) => {
    if (ui.screen !== 'rank' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); choose(0); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); choose(1); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); skipRank(); }
    else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undoRank(); }
  });
}

screens.rank = { enter: enterRank };
