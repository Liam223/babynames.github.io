import { load, save, flush, defaultState, exportJSON, parseImport, HISTORY_CAP, storageOk, requestPersistence, persistenceStatus } from './storage.js';
import { loadSex, sexesFor, SEXES, linkUnisex, isPrimary, trend, standout, nameKey, COUNTRY_SHORT } from './names.js';
import { icon, hydrateIcons } from './icons.js';
import { CONFIG, startRating, applyResult, pickPair, pairKey } from './elo.js';
import { attachSwipe } from './swipe.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let state = load();
let data = {};            // sex -> { list, byKey, yearTotals, ... }
let queue = [];           // ordered name objects for the current filters
let current = null;       // { name, src }
let swiper = null;
let screen = 'welcome';
let listTab = 'love';
let listSort = 'rank';
let listLimit = 100;
let listQuery = '';
let listSex = 'both';          // My list filter: both | boys | girls

const persist = () => { save(state); updateTabs(); };
const announce = (msg) => { $('#live').textContent = ''; setTimeout(() => { $('#live').textContent = msg; }, 20); };
const fmt = (n) => n.toLocaleString('en-GB');
// One-line popularity description used in lists and the compare screen.
const statLine = (n) => (n.classic ? `${n.classic.peak <= 2005 ? 'Classic' : 'Past favourite'} · peaked ${n.classic.peak}` : `#${fmt(n.rank)} · ${fmt(n.count)} babies`);
const merged = () => state.settings.sex === 'both';   // boys and girls mixed: names used for both appear once

/* ---------- filtering & ordering ---------- */
function eligible(n, s) {
  if (s.irish && !n.irish) return false;
  if (s.pop === 'top100' && n.rank > 100) return false;
  if (s.pop === 'top500' && n.rank > 500) return false;
  if (s.pop === 'gems' && (n.rank <= 500 || n.classic)) return false;   // gems are modern names; classics have their own filter
  if (s.pop === 'retro' && !n.classic) return false;
  if (s.letters.length && !s.letters.includes(n.key[0].toUpperCase())) return false;
  return true;
}

// All names matching the filters. When boys and girls are mixed, a name used for both appears once.
function candidates(s = state.settings) {
  const sexes = sexesFor(s.sex);
  const both = sexes.length === 2;
  const out = [];
  for (const sex of sexes) {
    for (const n of data[sex].list) {
      if (both && !isPrimary(n)) continue;
      if (eligible(n, s) || (both && n.alt && eligible(n.alt, s))) out.push(n);
    }
  }
  return out;
}

function rng(seed) {                       // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted shuffle (Efraimidis-Spirakis): popular names tend to come first, rarer ones are mixed in.
function buildQueue() {
  const r = rng(state.queue.seed);
  const items = candidates().map((n) => {
    const w = 1 / Math.pow(n.rank + 25, 0.65);
    return [Math.log(r() || 1e-9) / w, n];
  });
  items.sort((a, b) => b[0] - a[0]);
  queue = items.map((x) => x[1]);
}

const decisionOf = (n) =>
  state.decisions[n.sex][n.key] || (merged() && n.alt ? state.decisions[n.alt.sex][n.alt.key] : undefined);

function nextCard() {
  state.priority = state.priority.filter((p) => {
    const [sex, key] = p.split(':');
    const n = data[sex] && data[sex].byKey.get(key);
    return n && !decisionOf(n);
  });
  for (const p of state.priority) {
    const [sex, key] = p.split(':');
    return { name: data[sex].byKey.get(key), src: 'p' };
  }
  for (let i = state.queue.pos; i < queue.length; i++) {
    if (!decisionOf(queue[i])) { state.queue.pos = i; return { name: queue[i], src: 'q' }; }
  }
  state.queue.pos = queue.length;
  return null;
}

const remainingCount = () => candidates().filter((n) => !decisionOf(n)).length;

// Decision counts. A name decided the same way in both sexes counts once.
function counts(sexes = sexesFor(state.settings.sex)) {
  const c = { no: 0, like: 0, love: 0 };
  for (const sex of sexes) {
    for (const [key, d] of Object.entries(state.decisions[sex])) {
      if (sex === 'girls' && sexes.includes('boys') && state.decisions.boys[key] === d) continue;
      c[d]++;
    }
  }
  return c;
}
const summary = (c) => `${fmt(c.no + c.like + c.love)} seen · ${fmt(c.like)} liked · ${fmt(c.love)} loved`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  announce(msg);
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ---------- tab bar ---------- */
const COMPARE_MIN = 4;     // liked or loved names needed before comparing makes sense

// The Compare tab is locked (greyed, with an 'N more' badge) until there are enough names.
function updateTabs() {
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

/* ---------- screens ---------- */
function show(name, opts = {}) {
  if ((name === 'swipe' || name === 'rank') && !SEXES.every((x) => data[x])) return;   // names still loading
  screen = name;
  for (const s of $$('.screen')) s.hidden = s.id !== 'screen-' + name;
  document.body.dataset.sex = name === 'swipe' || name === 'welcome' ? state.settings.sex : 'both';
  if (name === 'welcome') renderWelcome();
  if (name === 'swipe') renderSwipe();
  for (const b of $$('.tab')) { if (b.dataset.go === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  updateTabs();
  if (name === 'rank') {
    const p = defaultPool();
    if (p !== rankPool) { rankPool = p; rankUndo = []; rankLast = null; }
    renderRank();
  }
  if (name === 'list') {
    listQuery = ''; $('#list-search').value = ''; listLimit = 100;
    const has = (t) => (t === 'ranked' ? totalCompared() > 0 && poolSize(rankedSex()) >= 2 : rowsFor(t).length > 0);
    listTab = opts.tab || ['ranked', 'love', 'like', 'no'].find(has) || 'love';
    renderList();
  }
  if (name === 'settings') renderSettings();
  scrollTo(0, 0);
}

const POP_HELP = {
  gems: 'Modern names outside the top 500.',
  retro: 'Names that were popular in the past but are rare today. Ranked after all the modern names.',
};

const SEX_HELP = {
  boys: 'Names given to baby boys.',
  girls: 'Names given to baby girls.',
  both: 'Boys’ and girls’ names in one pile. A name used for both shows up once.',
};

function renderWelcome() {
  const s = state.settings;
  $$('input[name=sex]').forEach((i) => { i.checked = i.value === s.sex; });
  $$('input[name=pop]').forEach((i) => { i.checked = i.value === s.pop; });
  $('#f-irish').checked = s.irish;
  $('#sex-help').textContent = SEX_HELP[s.sex];
  $('#pop-help').textContent = POP_HELP[s.pop] || '';
  $('#pop-help').hidden = !POP_HELP[s.pop];
  $$('.chip').forEach((b) => b.setAttribute('aria-pressed', String(s.letters.includes(b.textContent))));
  $('#letters-count').textContent = s.letters.length ? s.letters.join(' ') : 'Any';
  const c = counts(SEXES);
  const any = c.no + c.like + c.love > 0;
  $('#continue').hidden = !any;
  $('#adjust').hidden = !any;
  if (any) { $('#rs-seen').textContent = fmt(c.no + c.like + c.love); $('#rs-like').textContent = fmt(c.like); $('#rs-love').textContent = fmt(c.love); }
  updateRemaining();
}

function updateRemaining() {
  const ready = sexesFor(state.settings.sex).every((s) => data[s]) && SEXES.every((s) => data[s]);
  $('#btn-continue').disabled = !ready;
  if (!ready) { $('#remaining').textContent = 'Loading names…'; $('#btn-start').disabled = true; return; }
  const n = remainingCount();
  $('#remaining').textContent = n ? `${fmt(n)} names to go` : 'No unseen names match these filters. Try widening them.';
  $('#btn-start').disabled = n === 0 && state.priority.length === 0;
  $('#irish-count').textContent = `(${fmt(candidates({ ...state.settings, irish: true }).length)} names)`;
}

/* ---------- name card ---------- */
// Sparkline relative to the name's own average, so a steady name looks flat and only real change shows.
const trendSvg = (sh) => {
  const mean = sh.reduce((a, b) => a + b, 0) / sh.length || 1;
  const pts = sh.map((v, i) => {
    const r = Math.max(0.5, Math.min(1.5, v / mean));     // 0.5x..1.5x of average
    return `${(i * 14).toFixed(1)},${(14 - (r - 0.5) * 12).toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark" viewBox="0 0 56 16" width="56" height="16" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
};

function cardEl(n) {
  const both = merged() && n.alt;
  const meta = data[n.sex];
  const irish = n.irish || (both && n.alt.irish);
  const babies = n.count + (both ? n.alt.count : 0);
  const sexWord = (x) => (x.sex === 'boys' ? 'Boys' : 'Girls');
  const cl = n.classic;
  const old = cl && cl.peak <= 2005;      // peaked long ago = a classic; peaked more recently = a past favourite
  const rankText = cl ? (old ? 'A classic name' : 'A past favourite') : both
    ? `${sexWord(n)} #${fmt(n.rank)} · ${sexWord(n.alt)} #${fmt(n.alt.rank)}`
    : n.rank <= 1000 ? `#${fmt(n.rank)} in UK & Ireland` : n.rank <= 3000 ? `Uncommon · #${fmt(n.rank)}` : 'Rare';
  const tr = trend(n, meta);
  const so = standout(n, meta);
  const years = meta.years.length ? `${meta.years[0]}–${String(meta.years[meta.years.length - 1]).slice(2)}` : '';

  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.sex = both ? 'both' : n.sex;
  const tiles = n.countryRank.map((r, i) => {
    const label = meta.countries[i];
    const txt = r && r <= 9999 ? `#${fmt(r)}` : '–';
    return `<li class="${r ? '' : 'none'}" aria-label="${label}: ${r ? 'ranked ' + fmt(r) : 'not listed'}" title="${label}"><b aria-hidden="true">${COUNTRY_SHORT[i]}</b><span aria-hidden="true">${txt}</span></li>`;
  }).join('');
  el.setAttribute('aria-label', `${n.name}. ${rankText}.${irish ? ' Irish name.' : ''}`);
  el.innerHTML = `
    <div class="stamp like" aria-hidden="true">LIKE</div>
    <div class="stamp nope" aria-hidden="true">NOPE</div>
    <div class="stamp love" aria-hidden="true">LOVE</div>
    <div class="glow" aria-hidden="true"></div>
    <div class="sexchip" aria-hidden="true"></div>
    <h2 class="name"></h2>
    ${irish ? '<div class="badge" role="img" aria-label="Irish name">☘️</div>' : ''}
    <p class="hint"></p>
    <p class="babies"></p>
    ${so || cl ? '<p class="standout"></p>' : ''}
    ${tiles ? `<ul class="countries" aria-label="Rank in each country">${tiles}</ul>` : ''}
    <p class="variants"></p>`;
  $('.sexchip', el).textContent = both ? 'Unisex' : sexWord(n);
  const nm = $('.name', el);
  nm.textContent = n.name;
  if (n.name.length > 9) nm.classList.add('long');
  $('.hint', el).textContent = rankText;
  const b = $('.babies', el);
  b.textContent = cl
    ? `Peaked in ${cl.peak} · ${fmt(cl.peakCount)} ${cl.peakCount === 1 ? 'baby' : 'babies'} that year`
    : `${fmt(babies)} ${babies === 1 ? 'baby' : 'babies'}, ${years}`;
  if (tr) {
    const t = document.createElement('span');
    t.className = 'trend ' + tr.label.toLowerCase();
    t.innerHTML = `<span aria-hidden="true">${tr.arrow}</span> ${tr.label} ${trendSvg(tr.shares)}`;
    b.append(' ', t);
  }
  if (so) $('.standout', el).textContent = `Especially popular in ${so.country}`;
  else if (cl) $('.standout', el).textContent = old ? 'Classic · rare today' : 'Rare today';
  $('.variants', el).textContent = n.variants.length ? `also: ${n.variants.slice(0, 3).join(', ')}` : '';
  return el;
}

/* ---------- swipe ---------- */
// The undecided name that will come after `cur`, so it can be shown peeking out underneath.
function peekAfter(cur) {
  if (!cur) return null;
  for (const p of state.priority) {
    const [sex, key] = p.split(':');
    const n = data[sex] && data[sex].byKey.get(key);
    if (n && n !== cur.name && !decisionOf(n)) return n;
  }
  for (let i = state.queue.pos + (cur.src === 'q' ? 1 : 0); i < queue.length; i++) {
    if (queue[i] !== cur.name && !decisionOf(queue[i])) return queue[i];
  }
  return null;
}

function renderSwipe() {
  const stage = $('#stage');
  stage.textContent = '';
  swiper = null;
  current = nextCard();
  persist();
  const c = counts();
  $('#progress').textContent = summary(c);
  $('#btn-undo').disabled = state.history.length === 0;
  $('#coach').hidden = !!state.settings.hintSeen;
  for (const id of ['no', 'like', 'love']) $('#btn-' + id).disabled = !current;
  if (!current) {
    stage.innerHTML = `<div class="empty"><h2>That's the lot!</h2><p class="muted">You've seen every name that matches your filters.</p>
      <button class="btn primary" data-go="list">See my list</button> <button class="btn" data-go="welcome">Change filters</button></div>`;
    return;
  }
  document.body.dataset.sex = state.settings.sex;
  const next = peekAfter(current);
  if (next) {
    const back = cardEl(next);
    back.classList.add('peek');
    back.setAttribute('aria-hidden', 'true');
    back.inert = true;
    stage.append(back);
  }
  const el = cardEl(current.name);
  stage.append(el);
  swiper = attachSwipe(el, decide);
}

function decide(dir) {
  if (!current) return;
  const { name, src } = current;
  const both = merged() && name.alt;
  state.decisions[name.sex][name.key] = dir;
  if (both) state.decisions[name.alt.sex][name.alt.key] = dir;
  state.history.push({ s: name.sex, k: name.key, d: dir, src, m: both ? 1 : 0 });
  if (state.history.length > HISTORY_CAP) state.history.splice(0, state.history.length - HISTORY_CAP);
  state.settings.hintSeen = true;
  askPersistence();
  announce(`${name.name}: ${dir === 'no' ? 'no thanks' : dir === 'like' ? 'liked' : 'loved'}`);
  if (dir === 'love') burst();
  renderSwipe();
}

function undo() {
  const h = state.history.pop();
  if (!h) return;
  delete state.decisions[h.s][h.k];
  const n = data[h.s].byKey.get(h.k);
  if (h.m && n && n.alt) delete state.decisions[n.alt.sex][n.alt.key];
  if (h.src === 'p') { const p = `${h.s}:${h.k}`; if (!state.priority.includes(p)) state.priority.unshift(p); }
  else { const i = queue.indexOf(n); state.queue.pos = i >= 0 ? Math.min(state.queue.pos, i) : 0; }
  announce(`Undid ${n ? n.name : 'last choice'}`);
  renderSwipe();
}

function burst() {
  if (reduced()) return;
  const r = $('.stage').getBoundingClientRect();
  const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('span');
    p.className = 'burst';
    p.textContent = ['★', '✨', '♥', '🎉'][i % 4];
    p.style.left = x0 + 'px'; p.style.top = y0 + 'px';
    document.body.append(p);
    const a = Math.random() * Math.PI * 2, dist = 90 + Math.random() * 120;
    p.animate([{ transform: 'translate(0,0) scale(.6)', opacity: 1 },
      { transform: `translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist - 40}px) scale(1.2) rotate(${Math.random() * 360}deg)`, opacity: 0 }],
      { duration: 800 + Math.random() * 300, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => p.remove();
  }
}

/* ---------- list ---------- */
// Rows for a tab. A name decided the same way for boys and girls is one row (with `alt` set).
function rowsFor(tab) {
  const rows = [];
  for (const sex of SEXES) {
    for (const [key, d] of Object.entries(state.decisions[sex])) {
      if (d !== tab) continue;
      const n = data[sex] && data[sex].byKey.get(key);
      if (!n) continue;
      if (sex === 'girls' && n.alt && state.decisions.boys[key] === tab) continue;   // already listed as unisex
      const alt = sex === 'boys' && n.alt && state.decisions.girls[key] === tab ? n.alt : null;
      rows.push({ n, alt });
    }
  }
  return rows;
}

// Rows for a tab, with the search applied (and the sort, except for Ranked, which is always by rating).
function listRows(tab) {
  const q = nameKey(listQuery.trim());
  const keep = (n) => !q || nameKey(n.name).includes(q) || n.variants.some((v) => nameKey(v).includes(q));
  if (tab === 'ranked') return rankedRows(rankedSex()).filter((r) => keep(r.n));
  const rows = rowsFor(tab).filter((r) => sexOk(r, listSex) && keep(r.n));
  if (listSort === 'az') rows.sort((a, b) => a.n.name.localeCompare(b.n.name, 'en'));
  else rows.sort((a, b) => a.n.rank - b.n.rank || a.n.name.localeCompare(b.n.name, 'en'));
  return rows;
}

function renderList() {
  document.body.dataset.sex = 'both';
  const ul = $('#list');
  ul.textContent = '';
  for (const b of $$('.tabs button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === listTab));
    $('.n', b).textContent = fmt(listRows(b.dataset.tab).length);
  }
  // Ranked shows one sex at a time (ratings aren't comparable across sexes), so "Both" is unavailable there.
  const onRanked = listTab === 'ranked';
  $$('input[name=listsex]').forEach((i) => { i.checked = i.value === (onRanked ? rankedSex() : listSex); i.disabled = onRanked && i.value === 'both'; });
  // Always in the row (so the pills never resize); on Ranked the order is fixed, so it just says so.
  const sortBtn = $('#sort-toggle');
  sortBtn.disabled = listTab === 'ranked';
  $('.lbl', sortBtn).textContent = listTab === 'ranked' ? 'Rating' : listSort === 'az' ? 'A–Z' : 'Popular';
  const rows = listRows(listTab);
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = listQuery.trim() ? `No names match “${listQuery.trim()}” here.`
      : listTab === 'ranked' ? `Nothing ranked for ${rankedSex()} yet. Like or love a few ${rankedSex() === 'boys' ? 'boys’' : 'girls’'} names, then compare them.`
      : listSex !== 'both' ? `No ${listSex} here yet.`
      : listTab === 'ranked' ? 'Nothing to rank yet. Like or love some names first.'
      : listTab === 'no' ? 'Nothing eliminated yet.' : 'Nothing here yet. Go and swipe!';
    ul.append(li);
  }
  for (const row of rows.slice(0, listLimit)) {
    if (listTab === 'ranked') { ul.append(rankedRowEl(row)); continue; }
    const { n, alt } = row;
    const li = document.createElement('li');
    const nm = document.createElement('span');
    nm.className = 'nm';
    const title = document.createElement('span');
    title.textContent = n.name + (n.irish || (alt && alt.irish) ? ' ☘️' : '');
    const small = document.createElement('small');
    small.textContent = alt
      ? `Unisex · #${fmt(n.rank)} boys, #${fmt(alt.rank)} girls`
      : `${n.sex === 'boys' ? 'Boy' : 'Girl'} · ${statLine(n)}`;
    nm.append(title, small);
    li.append(nm);
    const act = (iconName, cls, to, aria, text = '') => {
      const b = document.createElement('button');
      b.className = 'mini ' + cls;
      b.innerHTML = icon(iconName, 18) + (text ? `<span>${text}</span>` : '');
      b.setAttribute('aria-label', `${aria} ${n.name}`);
      b.addEventListener('click', () => {
        state.decisions[n.sex][n.key] = to;
        if (alt) state.decisions[alt.sex][alt.key] = to;
        persist(); announce(`${n.name} moved`); renderList();
      });
      li.append(b);
    };
    if (listTab === 'no') act('undo', 'restore', 'like', 'Restore', 'Restore');
    if (listTab === 'like') act('star', 'love', 'love', 'Love');
    if (listTab === 'love') act('heart', 'like', 'like', 'Move to liked:');
    if (listTab !== 'no') act('x', 'no', 'no', 'Eliminate');
    ul.append(li);
  }
  $('#list-more').hidden = rows.length <= listLimit;
}

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

const comparedIn = (pool) => (state.comparedBy && state.comparedBy[pool]) || 0;
const totalCompared = () => comparedIn('boys') + comparedIn('girls');
const poolSize = (pool) => Object.values(state.decisions[pool]).filter((d) => d === 'like' || d === 'love').length;

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
const rankedSex = () => rankedSexSel || defaultPool();

function eloEntry(it) {
  const store = state.elo[it.pool];
  if (!store[it.n.key]) store[it.n.key] = { r: startRating(it.d), n: 0 };
  return store[it.n.key];
}

// Used by the Boys / Girls filter on My list (a name decided the same way for both sexes is one row).
const sexOk = (row, sex) => sex === 'both' || !!row.alt || row.n.sex === sex;

// Ranked list for one pool: by rating, with a position and a bar width relative to that pool.
function rankedRows(pool) {
  const items = rankItems(pool).map((it) => ({ ...it, alt: it.n.alt, e: eloEntry(it) }));
  items.sort((a, b) => b.e.r - a.e.r || a.n.name.localeCompare(b.n.name, 'en'));
  const hi = items.length ? items[0].e.r : 0;
  const lo = items.length ? items[items.length - 1].e.r : 0;
  items.forEach((it, i) => { it.pos = i + 1; it.pct = hi === lo ? 100 : 12 + (88 * (it.e.r - lo)) / (hi - lo); });
  return items;
}

function rankedRowEl({ n, alt, e, d, pos, pct, pool }) {
  const li = document.createElement('li');
  li.className = 'ranked' + (pos <= 3 ? ' top' + pos : '');
  const badge = document.createElement('span');
  badge.className = 'pos';
  badge.textContent = pos;
  const nm = document.createElement('span');
  nm.className = 'nm';
  const title = document.createElement('span');
  title.textContent = n.name + (n.irish || (alt && alt.irish) ? ' ☘️' : '');
  const small = document.createElement('small');
  const who = alt ? 'Unisex' : n.sex === 'boys' ? 'Boy' : 'Girl';
  small.textContent = `${who} · ${d === 'love' ? 'Loved' : 'Liked'} · ${e.n ? `${e.n} comparison${e.n === 1 ? '' : 's'}` : 'not compared yet'}`;
  const bar = document.createElement('span');
  bar.className = 'bar';
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `Rating ${Math.round(e.r)}`);
  const fill = document.createElement('span');
  fill.className = 'fill ' + d;
  fill.style.width = pct + '%';
  bar.append(fill);
  nm.append(title, small, bar);
  const score = document.createElement('span');
  score.className = 'score';
  score.textContent = fmt(Math.round(e.r));
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'mini no';
  rm.innerHTML = icon('x', 18);
  rm.setAttribute('aria-label', `Eliminate ${n.name}`);
  rm.addEventListener('click', () => {
    state.decisions[pool][n.key] = 'no';       // only this sex's pool; a unisex name can still be wanted in the other
    persist(); announce(`${n.name} eliminated`); renderList();
  });
  li.append(badge, nm, score, rm);
  return li;
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
  setTimeout(() => { rankBusy = false; if (screen === 'rank') renderRank(); }, reduced() ? 0 : 280);
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

/* ---------- settings ---------- */
let persistAsked = false;
// Once you've actually used the app, ask the browser to protect the saved data (once per visit).
function askPersistence() {
  if (persistAsked) return;
  persistAsked = true;
  requestPersistence().then(() => { if (screen === 'settings') renderStorageNote(); });
}

async function renderStorageNote() {
  const p = await persistenceStatus();
  $('#storage-note').textContent = p === true
    ? 'Your browser has marked this data as protected, so it won’t be cleared automatically.'
    : 'Your browser may clear this data if space runs low or after a long time unused. Export a backup now and then.';
}

function renderSettings() {
  renderStorageNote();
  document.body.dataset.sex = 'both';
  $('#nickname').value = state.settings.nickname || '';
  $('#storage-warn').hidden = storageOk;
  $('#settings-msg').textContent = '';
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function resetSelection() {
  const label = state.settings.sex === 'both' ? 'boys and girls' : state.settings.sex;
  if (!confirm(`Reset all your choices for ${label}? This can't be undone (export a backup first if unsure).`)) return;
  for (const sex of sexesFor(state.settings.sex)) { state.decisions[sex] = {}; state.elo[sex] = {}; }
  state.history = []; state.priority = []; state.queue.pos = 0; state.compared = 0;
  for (const sex of sexesFor(state.settings.sex)) state.comparedBy[sex] = 0;
  persist(); flush(); $('#settings-msg').textContent = 'Reset done.';
}

function resetAll() {
  if (!confirm("Reset everything, including settings? This can't be undone (export a backup first if unsure).")) return;
  state = defaultState(); persist(); flush(); buildQueue(); show('welcome');
}

/* ---------- wiring ---------- */
function setSetting(patch) {
  Object.assign(state.settings, patch);
  document.body.dataset.sex = state.settings.sex;
  state.queue.pos = 0;
  persist();
  if (!SEXES.every((s) => data[s])) { updateRemaining(); return; }
  buildQueue();
  renderWelcome();
}

function initLetters() {
  const box = $('#letters');
  for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = L; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      const set = new Set(state.settings.letters);
      set.has(L) ? set.delete(L) : set.add(L);
      setSetting({ letters: [...set].sort() });
    });
    box.append(b);
  }
  $('#letters-clear').addEventListener('click', () => setSetting({ letters: [] }));
}

function init() {
  hydrateIcons();
  initLetters();
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g && g.getAttribute('aria-disabled') === 'true') { toast(g.dataset.lockMsg || 'Not available yet'); return; }
    if (g) { const t = g.dataset.go; if (t === 'list-ranked') { if (screen === 'rank' && rankPool) rankedSexSel = rankPool; show('list', { tab: 'ranked' }); } else show(t); }
  });
  $$('input[name=sex]').forEach((i) => i.addEventListener('change', () => setSetting({ sex: i.value })));
  $$('input[name=pop]').forEach((i) => i.addEventListener('change', () => setSetting({ pop: i.value })));
  $('#f-irish').addEventListener('change', (e) => setSetting({ irish: e.target.checked }));
  $('#btn-start').addEventListener('click', () => show('swipe'));
  $('#btn-continue').addEventListener('click', () => show('swipe'));
  $('#coach-ok').addEventListener('click', () => { state.settings.hintSeen = true; persist(); $('#coach').hidden = true; });

  const act = (dir) => () => { if (current && swiper) swiper.fling(dir); };
  $('#btn-no').addEventListener('click', act('no'));
  $('#btn-like').addEventListener('click', act('like'));
  $('#btn-love').addEventListener('click', act('love'));
  $('#btn-undo').addEventListener('click', undo);
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
    if (screen !== 'rank' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); choose(0); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); choose(1); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); skipRank(); }
    else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undoRank(); }
  });
  document.addEventListener('keydown', (e) => {
    if (screen !== 'swipe' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const map = { ArrowLeft: 'no', ArrowRight: 'like', ArrowUp: 'love' };
    if (map[e.key]) { e.preventDefault(); act(map[e.key])(); }
    else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); }
  });

  $$('.tabs button').forEach((b) => b.addEventListener('click', () => { listTab = b.dataset.tab; listLimit = 100; renderList(); }));
  $('#sort-toggle').addEventListener('click', () => { listSort = listSort === 'az' ? 'rank' : 'az'; renderList(); });
  $('#list-search').addEventListener('input', (e) => { listQuery = e.target.value; listLimit = 100; renderList(); });
  $$('input[name=listsex]').forEach((i) => i.addEventListener('change', () => { if (listTab === 'ranked') rankedSexSel = i.value; else listSex = i.value; listLimit = 100; renderList(); }));
  $('#list-more').addEventListener('click', () => { listLimit += 200; renderList(); });

  $('#nickname').addEventListener('input', (e) => { state.settings.nickname = e.target.value.trim(); persist(); });
  $('#btn-export').addEventListener('click', () => {
    download(`baby-names-backup-${new Date().toISOString().slice(0, 10)}.json`, exportJSON(state));
    $('#settings-msg').textContent = 'Backup downloaded.';
  });
  $('#file-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      state = parseImport(await f.text());
      persist(); flush(); buildQueue();
      $('#settings-msg').textContent = 'Backup restored.';
    } catch (err) { $('#settings-msg').textContent = 'Import failed: ' + err.message; }
  });
  $('#btn-reset-sex').addEventListener('click', resetSelection);
  $('#btn-reset-all').addEventListener('click', resetAll);

  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  show('welcome');
  Promise.all(SEXES.map(loadSex)).then(([b, g]) => {
    linkUnisex(b, g);
    data = { boys: b, girls: g };
    if (state.dataVersion !== b.version) {      // new name data: rescan the deck from the start (decisions are keyed by name, so nothing is lost)
      state.queue.pos = 0; state.dataVersion = b.version; persist();
    }
    buildQueue();
    if (screen === 'welcome') renderWelcome();
  }).catch((err) => { $('#remaining').textContent = 'Could not load the names: ' + err.message; });
}

init();
