// The swipe deck: which names are eligible, the shuffled queue, the name card, and swiping.
import { HISTORY_CAP } from './storage.js';
import { trend, standout, COUNTRY_SHORT } from './names.js';
import { candidatesFor, weightedOrder } from './queue.js';
import { icon } from './icons.js';
import { attachSwipe } from './swipe.js';
import { $, ui, state, data, screens, persist, announce, fmt, esc, babies, irishOf, merged, decisionOf, setDecision, clearDecision, counts, summary, reduced, askPersistence } from './core.js';
import { openInfo } from './info.js';

let queue = [];           // ordered name objects for the current filters
let current = null;       // { name, src }
let swiper = null;

/* ---------- filtering & ordering ---------- */
export const candidates = (s = state.settings) => candidatesFor(data, s);

export function buildQueue() {
  queue = weightedOrder(candidates(), state.queue.seed);
}

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

export const remainingCount = () => candidates().filter((n) => !decisionOf(n)).length;

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
  const irish = irishOf(n, both ? n.alt : null);
  const total = n.count + (both ? n.alt.count : 0);
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
    const label = esc(meta.countries[i]);
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
    ? `Peaked in ${cl.peak} · ${babies(cl.peakCount)} that year`
    : `${babies(total)}, ${years}`;
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
  setDecision(name, dir, both);
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
  clearDecision(h.s, h.k);
  const n = data[h.s].byKey.get(h.k);
  if (h.m && n && n.alt) clearDecision(n.alt.sex, n.alt.key);
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

export function initDeck() {
  $('#coach-ok').addEventListener('click', () => { state.settings.hintSeen = true; persist(); $('#coach').hidden = true; });
  const act = (dir) => () => { if (current && swiper) swiper.fling(dir); };
  $('#btn-no').addEventListener('click', act('no'));
  $('#btn-like').addEventListener('click', act('like'));
  $('#btn-love').addEventListener('click', act('love'));
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-info').addEventListener('click', () => { if (current) openInfo(current.name); });
  document.addEventListener('keydown', (e) => {
    if (ui.screen !== 'swipe' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const map = { ArrowLeft: 'no', ArrowRight: 'like', ArrowUp: 'love' };
    if (map[e.key]) { e.preventDefault(); act(map[e.key])(); }
    else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); }
    else if ((e.key === 'i' || e.key === 'I') && current) { e.preventDefault(); openInfo(current.name); }
  });
}

screens.swipe = { early: true, enter: renderSwipe };
