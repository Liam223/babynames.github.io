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
let infoName = null;           // the name entry shown on the info screen
let infoSex = null;            // which sex's figures (for unisex names)
let infoFrom = 'swipe';        // screen to return to
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
  const navName = name === 'info' ? infoFrom : name;       // the info screen keeps the tab you came from highlighted
  for (const b of $$('.tab')) { if (b.dataset.go === navName) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  updateTabs();
  if (name === 'rank') {
    const p = defaultPool();
    if (p !== rankPool) { rankPool = p; rankUndo = []; rankLast = null; }
    renderRank();
  }
  if (name === 'list') {
    if (!opts.keep) {                    // coming back from the info screen keeps your tab, search and filters
      listQuery = ''; $('#list-search').value = ''; listLimit = 100;
      const has = (t) => (t === 'ranked' ? totalCompared() > 0 && poolSize(rankedSex()) >= 2 : rowsFor(t).length > 0);
      listTab = opts.tab || ['ranked', 'love', 'like', 'no'].find(has) || 'love';
    }
    renderList();
  }
  if (name === 'info') renderInfo();
  if (name === 'settings') renderSettings();
  if (!(name === 'list' && opts.keep)) scrollTo(0, 0);
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
    <div class="cardinfo" aria-hidden="true">${icon('info', 22)}</div>
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
  $('#btn-info').disabled = !current;
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
  swiper = attachSwipe(el, decide, () => { if (current) openInfo(current.name); });
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
    li.append(infoButton(n));
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
  li.append(badge, nm, score, infoButton(n), rm);
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

/* ---------- name information ---------- */
const ptitle = (iconName, cls, text) => `<p class="panel-title"><span class="p-ic ${cls}">${icon(iconName, 16)}</span>${text}</p>`;
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function infoButton(n) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mini info';
  b.innerHTML = icon('info', 18);
  b.setAttribute('aria-label', `About ${n.name}`);
  b.addEventListener('click', () => openInfo(n));
  return b;
}

function openInfo(n) {
  if (!n) return;
  infoName = n;
  infoSex = n.sex;
  infoHistC = 'auto';
  if (screen !== 'info') infoFrom = screen;
  show('info');
}

function leaveInfo() {
  const to = infoFrom === 'info' || !infoFrom ? 'swipe' : infoFrom;
  show(to, to === 'list' ? { keep: true } : {});
}

// The entry for the sex being shown (a unisex name has one entry per sex).
function infoEntry() {
  const b = infoName;
  if (infoSex === b.sex) return b;
  return b.alt && b.alt.sex === infoSex ? b.alt : b;
}

function renderInfo() {
  document.body.dataset.sex = 'both';
  if (!infoName) { show('swipe'); return; }
  const base = infoName;
  const n = infoEntry();
  const meta = data[n.sex];
  const noun = n.sex === 'boys' ? 'boys’' : 'girls’';
  const babiesWord = (k) => (k === 1 ? 'baby' : 'babies');
  const irish = n.irish || (n.alt && n.alt.irish);
  const cl = n.classic;
  const yrs = meta.years;
  const span = yrs.length ? `${yrs[0]}–${String(yrs[yrs.length - 1]).slice(2)}` : '';
  $('#info-title').textContent = n.name;
  const out = [];

  // chips
  const chips = [];
  chips.push(base.alt ? '<span class="ichip both">Unisex</span>' : `<span class="ichip ${n.sex}">${n.sex === 'boys' ? 'Boys’ name' : 'Girls’ name'}</span>`);
  if (irish) chips.push('<span class="ichip irish">☘️ Irish name</span>');
  if (cl) chips.push(`<span class="ichip">${cl.peak <= 2005 ? 'Classic' : 'Past favourite'}</span>`);
  // your choice and rating sit with the other tags, on the right (nothing is shown until you've decided)
  const dec = state.decisions[n.sex][n.key];
  const rating = state.elo[n.sex][n.key];
  if (dec) {
    const ic = { love: 'star', like: 'heart', no: 'x' }[dec];
    const word = { love: 'Loved', like: 'Liked', no: 'Eliminated' }[dec];
    const rate = rating && rating.n ? `<span class="rate" title="Rating after ${rating.n} comparison${rating.n === 1 ? '' : 's'}">${fmt(Math.round(rating.r))}</span>` : '';
    chips.push(`<span class="ichip choice ${dec}">${icon(ic, 14)}${word}${rate}</span>`);
  }
  out.push(`<div class="ichips">${chips.join('')}</div>`);

  // unisex: split and switch
  if (base.alt) {
    const be = base.sex === 'boys' ? base : base.alt;
    const ge = base.sex === 'girls' ? base : base.alt;
    const total = be.count + ge.count;
    if (total > 0) {
      const pb = Math.round((100 * be.count) / total);
      out.push(`<div class="panel"><p class="panel-title">Boys and girls</p>
        <div class="split" role="img" aria-label="${pb}% boys, ${100 - pb}% girls"><i class="b" style="width:${pb}%"></i><i class="g" style="width:${100 - pb}%"></i></div>
        <p class="muted small">${pb}% boys · ${100 - pb}% girls (${esc(span)}). Boys #${fmt(be.rank)}, girls #${fmt(ge.rank)} in their lists.</p></div>`);
    }
    out.push(`<div class="seg info-sex" role="radiogroup" aria-label="Show figures for">
      <label><input type="radio" name="infosex" value="boys"${n.sex === 'boys' ? ' checked' : ''}><span>As a boy’s name</span></label>
      <label><input type="radio" name="infosex" value="girls"${n.sex === 'girls' ? ' checked' : ''}><span>As a girl’s name</span></label></div>`);
  }

  // headline numbers
  const sexTotal = (meta.yearTotals || []).reduce((a, b) => a + b, 0);
  if (cl) {
    // classics: the "Over the years" panel below carries the history
  } else {
    const oneIn = n.count && sexTotal ? Math.round(sexTotal / n.count) : 0;
    out.push(`<div class="panel">${ptitle('award', 'yellow', 'Popularity')}
      <div class="istats">
        <div><b>#${fmt(n.rank)}</b><span>${esc(noun)} names, UK &amp; Ireland</span></div>
        <div><b>${fmt(n.count)}</b><span>${babiesWord(n.count)}, ${esc(span)}</span></div>
        <div><b>${oneIn ? `1 in ${fmt(oneIn)}` : '–'}</b><span>of all ${esc(noun)} births</span></div>
      </div>
      <p class="muted small">Rank and babies are for ${esc(span)} (five years combined), all four countries together.</p></div>`);

  }

  out.push('<div id="info-history"></div>');

  // spellings
  if (n.variants.length) {
    out.push(`<div class="panel"><p class="panel-title">Other spellings</p>
      <p class="ichips">${n.variants.map((v) => `<span class="ichip">${esc(v)}</span>`).join('')}</p>
      <p class="muted small">Spellings that differ only by accents or capitals are grouped with this card.</p></div>`);
  }

  out.push('<div id="info-extra"></div>');
  out.push('<p class="muted small center">Counts: ONS, National Records of Scotland, NISRA and CSO. Contains public sector information licensed under the Open Government Licence v3.0.</p>');
  $('#info-body').innerHTML = out.join('');
  $$('input[name=infosex]').forEach((i) => i.addEventListener('change', () => { infoSex = i.value; infoHistC = 'auto'; renderInfo(); }));
  renderInfoExtra(n);
  renderInfoHistory(n);
}

// Births per year over each source's whole history, from data/history/<sex>-<letter>.json (built by scripts/build-history.py).
// One small file per letter, fetched when a details screen opens, so it never slows down the swipe deck.
const COVER_START = [1996, 1974, 1997, 1964];          // first year each country's records cover (same order as data.countries)
const COUNTRY_LABEL = ['England & Wales', 'Scotland', 'Northern Ireland', 'Republic of Ireland'];
const COUNTRY_PILL = ['E&W', 'Scotland', 'N. Ireland', 'Ireland'];
const histCache = new Map();
let infoHistC = 'auto';                                 // 'auto' (pick a sensible default), 'all', or a country index

function loadHistory(sex, key) {
  const shard = /^[a-z]/.test(key) ? key[0] : '_';
  const id = `${sex}-${shard}`;
  if (!histCache.has(id)) {
    histCache.set(id, fetch(`./data/history/${id}.json`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(() => { histCache.delete(id); return null; }));
  }
  return histCache.get(id).then((d) => (d && d.names[key]) || null);
}

const expandSeries = (h, i) => {
  const m = new Map();
  if (h[i]) h[i][1].forEach((c, j) => { if (c) m.set(h[i][0] + j, c); });
  return m;
};

const ALL_COLOUR = 'orange';
const COUNTRY_COLOUR = ['red', 'blue', 'yellow', 'green'];       // E&W, Scotland, N. Ireland, Ireland

const average = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// Centred moving average (the window shrinks at the ends), to show the shape through year-to-year noise.
function rolling(vals, w = 5) {
  const half = Math.floor(w / 2);
  return vals.map((_, i) => average(vals.slice(Math.max(0, i - half), Math.min(vals.length, i + half + 1))));
}

// Catmull-Rom spline through the points, as an SVG path.
function smoothPath(p) {
  if (p.length < 2) return '';
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function sparkPoints(vals, w = 64, h = 18) {
  const max = Math.max(...vals);
  if (!max) return '';
  const step = vals.length > 1 ? w / (vals.length - 1) : 0;
  return vals.map((v, i) => `${(i * step).toFixed(1)},${(h - 1.5 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
}

// The headline facts for a series: peak, where it is now, which way it is heading, and a one-line summary.
function storyOf(vals, years) {
  const n = vals.length;
  const peak = Math.max(...vals);
  const peakYear = peak ? years[vals.indexOf(peak)] : 0;
  const last = vals[n - 1];
  const pct = peak ? Math.round((100 * last) / peak) : 0;
  const recent = average(vals.slice(-3));
  const before = n >= 13 ? average(vals.slice(n - 13, n - 10)) : average(vals.slice(0, 3));
  let trend;
  if (!before && !recent) trend = { label: 'No trend', arrow: '–', cls: 'steady', caption: 'too few births' };
  else if (!before) trend = { label: 'New', arrow: '✦', cls: 'rising', caption: 'not listed a decade ago' };
  else {
    const ratio = recent / before;
    const change = Math.round((ratio - 1) * 100);
    if (ratio >= 1.25) trend = { label: 'Rising', arrow: '↗', cls: 'rising', caption: `${change}% more than a decade ago` };
    else if (ratio <= 0.8) trend = { label: 'Falling', arrow: '↘', cls: 'falling', caption: recent ? `${Math.abs(change)}% fewer than a decade ago` : 'now under 3 a year' };
    else trend = { label: 'Steady', arrow: '→', cls: 'steady', caption: 'about the same as a decade ago' };
  }
  const dec = Math.floor(peakYear / 10) * 10;
  let sentence = '';
  if (peak) {
    if (last === peak) sentence = 'Most popular right now.';
    else if (pct >= 70) sentence = `Still close to its peak in ${peakYear}.`;
    else if (!last) sentence = peakYear < 2010 ? `A ${dec}s favourite that has become rare: now under 3 a year.` : `Peaked in ${peakYear}, now rare: under 3 a year.`;
    else sentence = `${peakYear < 2010 ? `A ${dec}s favourite` : `Peaked in ${peakYear}`}, now about ${pct}% as common.`;
  }
  return { peak, peakYear, last, pct, trend, sentence };
}

function chartBlock(years, vals, story, END) {
  const n = years.length;
  const { peak, peakYear } = story;
  const dense = vals.filter((v) => v > 0).length >= 8;          // sparse names: bars only (a smoothed line would imply a trend)
  const H = 100, U = 6;
  const hOf = (v) => (v ? Math.max(2, (v / peak) * (H - 6)) : 0);
  const bars = vals.map((v, i) => `<rect x="${i * U + 0.5}" y="${H - hOf(v)}" width="${U - 1}" height="${hOf(v)}" rx="1"></rect>`).join('');
  const line = dense
    ? `<path class="avg" d="${smoothPath(rolling(vals).map((v, i) => [i * U + U / 2, H - (v / peak) * (H - 6)]))}" vector-effect="non-scaling-stroke"></path>`
    : '';
  const xPct = (i) => (((i + 0.5) / n) * 100).toFixed(2);
  const yPct = (v) => ((hOf(v) / H) * 100).toFixed(2);
  const pi = vals.indexOf(peak);
  const markers = `<i class="mk pk" style="left:${xPct(pi)}%;bottom:${yPct(peak)}%"></i>`
    + (pi !== n - 1 ? `<i class="mk now" style="left:${xPct(n - 1)}%;bottom:${yPct(vals[n - 1])}%"></i>` : '');
  let ticks = '';
  for (let i = 0; i < n; i++) {                                 // decade ticks, skipping any too close to the end labels
    const pct = ((i + 0.5) / n) * 100;
    if (years[i] % 10 === 0 && pct >= 14 && pct <= 86) ticks += `<span style="left:${pct.toFixed(2)}%">${years[i]}</span>`;
  }
  return `<div class="hread" aria-hidden="true">Peak ${peakYear} · ${fmt(peak)}</div>
    <div class="hchart"><svg viewBox="0 0 ${n * U} ${H}" preserveAspectRatio="none" aria-hidden="true">${bars}${line}</svg>${markers}<i class="hguide" hidden></i></div>
    <div class="haxis2"><span class="e0">${years[0]}</span>${ticks}<span class="e1">${END}</span></div>`;
}

function historyPanel(n, h) {
  const meta = data[n.sex];
  const END = meta.years[meta.years.length - 1];
  const have = [0, 1, 2, 3].filter((i) => h[i]);
  if (!have.length) return null;
  const maps = [0, 1, 2, 3].map((i) => expandSeries(h, i));
  // Default: all four combined for modern names; for classics, the country where the name had the most births
  // (the combined view only starts in 1997, so it would miss an older peak).
  const totals = maps.map((m) => { let t = 0; for (const c of m.values()) t += c; return t; });
  let sel = infoHistC;
  if (sel === 'auto') sel = n.classic ? String(totals.indexOf(Math.max(...totals))) : 'all';
  const mode = sel !== 'all' && h[+sel] ? +sel : 'all';

  const seriesFor = (m) => {                                    // m: 'all' or a country index
    const from = m === 'all' ? 1997 : COVER_START[m];           // 1997 is the first year all four countries' records overlap
    const years = [], vals = [];
    for (let y = from; y <= END; y++) {
      years.push(y);
      vals.push(m === 'all' ? have.reduce((t, i) => t + (maps[i].get(y) || 0), 0) : maps[m].get(y) || 0);
    }
    return { years, vals };
  };
  const { years, vals } = seriesFor(mode);
  const story = storyOf(vals, years);
  const colour = mode === 'all' ? ALL_COLOUR : COUNTRY_COLOUR[mode];
  const where = mode === 'all' ? 'All four countries combined' : COUNTRY_LABEL[mode];
  const first = years[0] === story.peakYear && story.peak && mode !== 'all';

  const nowCls = story.pct >= 60 ? 'good' : story.pct >= 25 ? 'mid' : 'low';
  const tiles = story.peak
    ? `<div class="story-tiles">
        <div class="st pk"><span class="lab">Peak</span><b>${story.peakYear}</b><small>${fmt(story.peak)} ${story.peak === 1 ? 'baby' : 'babies'}${first ? ' · first year on record' : ''}</small></div>
        <div class="st ${nowCls}"><span class="lab">Now</span><b>${story.last === story.peak ? 'At peak' : story.last ? `${story.pct}%` : '<3'}</b><small>${story.last === story.peak ? `highest ever, ${END}` : story.last ? `of the peak (${END})` : `babies in ${END}`}</small></div>
        <div class="st ${story.trend.cls}"><span class="lab">Trend</span><b>${story.trend.arrow} ${esc(story.trend.label)}</b><small>${esc(story.trend.caption)}</small></div>
      </div>`
    : '';

  const spanTxt = `${meta.years[0]}–${String(END).slice(2)}`;
  const so = n.classic ? null : standout(n, meta);
  const soIdx = so ? meta.countries.indexOf(so.country) : -1;
  const rowsHtml = [['all', null], ...have.map((i) => [i, i])].map(([v, i]) => {
    const s = seriesFor(v);
    const total = s.vals.reduce((a, b) => a + b, 0);
    const pk = Math.max(...s.vals);
    const py = pk ? s.years[s.vals.indexOf(pk)] : 0;
    const on = v === mode;
    const label = v === 'all' ? 'All four combined' : COUNTRY_LABEL[v];
    const sub = v === 'all' ? `${s.years[0]}–${END}` : `since ${COVER_START[v]}`;
    // 2021-25 figures (modern names only): rank within that country's own list, and babies born there
    let recent = '';
    if (!n.classic && n.countryRank.length) {
      const r = v === 'all' ? n.rank : n.countryRank[v];
      const c = v === 'all' ? n.count : n.byCountry[v];
      recent = c ? `${r ? `#${fmt(r)} · ` : ''}${fmt(c)} ${c === 1 ? 'baby' : 'babies'}` : 'none';
    }
    const tag = v === soIdx ? `<span class="star" role="img" aria-label="Especially popular here" title="Especially popular here">${icon('star', 12)}</span>` : '';
    const cc = v === 'all' ? ALL_COLOUR : COUNTRY_COLOUR[v];
    return `<button type="button" class="crow${on ? ' on' : ''}" data-c="${v}" style="--cc:var(--${cc});--ccd:var(--${cc === 'yellow' ? 'yellow-d' : cc})" aria-pressed="${on}">
      <i class="dot"></i><span class="cn">${esc(label)}${tag}<small>${esc(sub)}</small></span>
      <svg class="sp" viewBox="0 0 64 18" aria-hidden="true"><polyline points="${sparkPoints(s.vals)}"></polyline></svg><span class="rc">${esc(recent)}</span>
      <span class="ct"><b>${fmt(total)}</b><small>${py ? `peak ${py}` : 'births'}</small></span></button>`;
  }).join('');

  const rare = n.classic ? `<p class="muted small">Rare today: ${n.count ? `${fmt(n.count)} ${n.count === 1 ? 'baby' : 'babies'} in ${meta.years[0]}–${String(END).slice(2)}` : `under 3 a year in ${meta.years[0]}–${String(END).slice(2)}`}.</p>` : '';
  const body = story.peak
    ? `${story.sentence ? `<p class="story">${esc(story.sentence)}</p>` : ''}${tiles}
       <p class="scope" style="--cc:var(--${colour})"><i class="dot"></i>${esc(where)}</p>${chartBlock(years, vals, story, END)}`
    : `<p class="muted">No years with 3 or more births in ${esc(where)}.</p>`;
  return {
    html: `<div class="panel" style="--cc:var(--${colour});--ccd:var(--${colour === 'yellow' ? 'yellow-d' : colour})">${ptitle('trend', 'orange', 'Over the years')}${body}
      <p class="panel-title sub">Where it was popular</p>
      ${n.classic ? '' : `<p class="muted small">Rank (within each country’s own list) and babies are for ${esc(spanTxt)}. Totals and peaks cover each country’s whole history.${soIdx >= 0 ? ' A gold star marks where the name ranks far higher than it does overall.' : ''}</p>`}
      <div class="crows">${rowsHtml}</div>${rare}
      <details class="note"><summary>How to read this</summary>
        <p>Bars are births per year; the line is a 5-year rolling average. Names given to fewer than 3 babies in a year aren’t published, so those years show as gaps and the totals are minimums. “All four combined” starts in 1997, the first year every country’s records overlap; each country’s own chart goes back as far as its records do (Republic of Ireland 1964, Scotland 1974, England &amp; Wales 1996, Northern Ireland 1997). Drag along the chart to read a year.</p></details></div>`,
    years, vals,
  };
}

function renderInfoHistory(n) {
  const slot = $('#info-history');
  if (!slot) return;
  slot.innerHTML = '<div class="panel"><p class="muted">Loading history…</p></div>';
  loadHistory(n.sex, n.key).then((h) => {
    const draw = () => {
      const target = $('#info-history');
      if (screen !== 'info' || infoEntry() !== n || !target) return;      // user moved on
      const p = h ? historyPanel(n, h) : null;
      if (!p) {
        target.innerHTML = n.classic
          ? `<div class="panel">${ptitle('trend', 'orange', 'History')}<p class="muted">Peaked in ${n.classic.peak} with ${fmt(n.classic.peakCount)} ${n.classic.peakCount === 1 ? 'baby' : 'babies'}; ${fmt(n.classic.full)} births on record.</p></div>`
          : '';
        return;
      }
      target.innerHTML = p.html;
      $$('.crow', target).forEach((b) => b.addEventListener('click', () => { infoHistC = b.dataset.c; draw(); }));
      const chart = $('.hchart', target);
      if (chart) {                                                  // drag (or hover) along the chart to read a year
        const read = $('.hread', target), guide = $('.hguide', target), def = read.textContent, len = p.years.length;
        const move = (e) => {
          const r = chart.getBoundingClientRect();
          const i = Math.max(0, Math.min(len - 1, Math.floor(((e.clientX - r.left) / r.width) * len)));
          const v = p.vals[i];
          read.textContent = `${p.years[i]} · ${v ? `${fmt(v)} ${v === 1 ? 'baby' : 'babies'}` : 'under 3'}`;
          guide.style.left = `${(((i + 0.5) / len) * 100).toFixed(2)}%`;
          guide.hidden = false;
        };
        const reset = () => { read.textContent = def; guide.hidden = true; };
        chart.addEventListener('pointerdown', move);
        chart.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) move(e); });
        for (const ev of ['pointerleave', 'pointerup', 'pointercancel']) chart.addEventListener(ev, reset);
      }
    };
    draw();
  });
}

// Origin, meaning and pronunciation come from data/info.json (built from Wiktionary and Wikipedia).
// It is loaded only when you first open a details screen, so the swipe deck stays fast.
let infoData = null;
let infoLoading = null;

function loadInfoData() {
  if (!infoLoading) {
    infoLoading = fetch('./data/info.json')
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((d) => { infoData = d; return d; })
      .catch(() => { infoLoading = null; return null; });       // try again next time (offline, etc.)
  }
  return infoLoading;
}

function aboutPanel(n, it) {
  const rows = [];
  const say = it.r && it.r.length ? { text: it.r.join(' or '), note: 'From Wikipedia' } : it.s ? { text: it.s, note: 'Approximate · unverified' } : null;
  if (say) {
    rows.push(`<div class="say"><span class="irow-label">Say it</span><b>${esc(say.text)}</b><span class="ichip">${esc(say.note)}</span></div>`);
  }
  if (it.i && it.i.length) {
    rows.push(`<p class="irow"><span class="irow-label">IPA</span>${it.i.map(([ipa, label]) => `<span class="ipa">${esc(ipa)} <small>${esc(label)}</small></span>`).join('')}</p>`);
  }
  if (say && (n.irish || (n.alt && n.alt.irish))) {
    rows.push('<p class="muted small">Irish names are pronounced differently in different regions, so treat this as a guide.</p>');
  }
  if (it.o) rows.push(`<p class="irow"><span class="irow-label">Origin</span>${esc(it.o)}</p>`);
  if (it.e) rows.push(`<p class="irow"><span class="irow-label">Etymology</span>${esc(it.e)}</p>`);
  if (it.a) rows.push(`<p class="irow about"><span class="irow-label">About</span>${esc(it.a)}</p>`);
  const links = [];
  if (it.t) links.push(`<a href="https://en.wiktionary.org/wiki/${encodeURIComponent(it.t)}" target="_blank" rel="noopener">Wiktionary</a>`);
  if (it.w) links.push(`<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(it.w.replace(/ /g, '_'))}" target="_blank" rel="noopener">Wikipedia</a>`);
  const credit = links.length
    ? `<p class="muted small">Read more: ${links.join(' · ')}. Text from Wiktionary and Wikipedia, licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.</p>`
    : '';
  return `<div class="panel">${ptitle('info', 'pink', 'About this name')}${rows.join('')}${credit}</div>`;
}

function renderInfoExtra(n) {
  const slot = $('#info-extra');
  if (!slot) return;
  const fill = () => {
    if (screen !== 'info' || infoEntry() !== n || !$('#info-extra')) return;      // user moved on
    const it = infoData && infoData.items[n.key];
    $('#info-extra').innerHTML = it && Object.keys(it).length
      ? aboutPanel(n, it)
      : `<div class="panel">${ptitle('info', 'pink', 'About this name')}<p class="muted">No origin, meaning or pronunciation found for this name yet. Names outside the most popular ones and the Irish-language names are only partly covered.</p></div>`;
  };
  if (infoData) { fill(); return; }
  slot.innerHTML = '<div class="panel"><p class="muted">Loading more about this name…</p></div>';
  loadInfoData().then((d) => {
    if (d) fill();
    else if (screen === 'info' && $('#info-extra')) $('#info-extra').innerHTML = '<div class="panel"><p class="muted">Couldn’t load the extra details. Check your connection and try again.</p></div>';
  });
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
  $('#info-back').addEventListener('click', leaveInfo);
  $('#btn-info').addEventListener('click', () => { if (current) openInfo(current.name); });
  document.addEventListener('keydown', (e) => {
    if (screen === 'info' && e.key === 'Escape') leaveInfo();
  });
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
    else if ((e.key === 'i' || e.key === 'I') && current) { e.preventDefault(); openInfo(current.name); }
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
