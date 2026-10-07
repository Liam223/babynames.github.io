import { load, save, flush, defaultState, exportJSON, parseImport, HISTORY_CAP, storageOk } from './storage.js';
import { loadSex, sexesFor, SEXES } from './names.js';
import { attachSwipe } from './swipe.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let state = load();
let data = {};            // sex -> { list, byKey }
let queue = [];           // ordered name objects for the current filters
let current = null;       // { name, src }
let swiper = null;
let screen = 'welcome';
let listTab = 'love';
let listLimit = 100;

const persist = () => save(state);
const announce = (msg) => { $('#live').textContent = ''; setTimeout(() => { $('#live').textContent = msg; }, 20); };
const fmt = (n) => n.toLocaleString('en-GB');

/* ---------- filtering & ordering ---------- */
function eligible(n, s) {
  if (s.irish && !n.irish) return false;
  if (s.pop === 'top100' && n.rank > 100) return false;
  if (s.pop === 'top500' && n.rank > 500) return false;
  if (s.pop === 'gems' && n.rank <= 500) return false;
  if (s.letters.length && !s.letters.includes(n.key[0].toUpperCase())) return false;
  return true;
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
  const s = state.settings;
  const r = rng(state.queue.seed);
  const items = [];
  for (const sex of sexesFor(s.sex)) {
    for (const n of data[sex].list) {
      if (!eligible(n, s)) continue;
      const w = 1 / Math.pow(n.rank + 25, 0.65);
      items.push([Math.log(r() || 1e-9) / w, n]);
    }
  }
  items.sort((a, b) => b[0] - a[0]);
  queue = items.map((x) => x[1]);
}

const decisionOf = (n) => state.decisions[n.sex][n.key];

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

function remainingCount() {
  const s = state.settings;
  let n = 0;
  for (const sex of sexesFor(s.sex)) for (const x of data[sex].list) if (eligible(x, s) && !state.decisions[sex][x.key]) n++;
  return n;
}

function counts(sexes = sexesFor(state.settings.sex)) {
  const c = { no: 0, like: 0, love: 0 };
  for (const sex of sexes) for (const d of Object.values(state.decisions[sex])) c[d]++;
  return c;
}
const summary = (c) => `${fmt(c.no + c.like + c.love)} seen · ${fmt(c.like)} liked · ${fmt(c.love)} loved`;

/* ---------- screens ---------- */
function show(name) {
  screen = name;
  for (const s of $$('.screen')) s.hidden = s.id !== 'screen-' + name;
  document.body.dataset.sex = name === 'swipe' || name === 'welcome' ? state.settings.sex : 'both';
  if (name === 'welcome') renderWelcome();
  if (name === 'swipe') renderSwipe();
  if (name === 'list') { listLimit = 100; listTab = ['love', 'like', 'no'].find((t) => listRows(t).length) || 'love'; renderList(); }
  if (name === 'settings') renderSettings();
  scrollTo(0, 0);
}

function renderWelcome() {
  const s = state.settings;
  $$('input[name=sex]').forEach((i) => { i.checked = i.value === s.sex; });
  $$('input[name=pop]').forEach((i) => { i.checked = i.value === s.pop; });
  $('#f-irish').checked = s.irish;
  $$('.chip').forEach((b) => b.setAttribute('aria-pressed', String(s.letters.includes(b.textContent))));
  $('#letters-count').textContent = s.letters.length ? `(${s.letters.join(' ')})` : '';
  const c = counts(SEXES);
  const any = c.no + c.like + c.love > 0;
  $('#continue').hidden = !any;
  if (any) $('#continue-summary').textContent = summary(c);
  updateRemaining();
}

function updateRemaining() {
  const ready = sexesFor(state.settings.sex).every((s) => data[s]);
  $('#btn-continue').disabled = !ready;
  if (!ready) { $('#remaining').textContent = 'Loading names…'; $('#btn-start').disabled = true; return; }
  const n = remainingCount();
  $('#remaining').textContent = n ? `${fmt(n)} names to go` : 'No unseen names match these filters. Try widening them.';
  $('#btn-start').disabled = n === 0 && state.priority.length === 0;
}

function cardEl(n) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.sex = n.sex;
  const hint = n.rank <= 1000 ? `#${fmt(n.rank)} in UK & Ireland` : n.rank <= 3000 ? `Uncommon · #${fmt(n.rank)}` : 'Rare';
  el.setAttribute('aria-label', `${n.name}, ${n.sex === 'boys' ? 'boys' : 'girls'} name. ${hint}.${n.irish ? ' Irish name.' : ''}`);
  el.innerHTML = `
    <div class="stamp like" aria-hidden="true">LIKE</div>
    <div class="stamp nope" aria-hidden="true">NOPE</div>
    <div class="stamp love" aria-hidden="true">LOVE</div>
    <div class="sexchip" aria-hidden="true"></div>
    <h2 class="name"></h2>
    ${n.irish ? '<div class="badge" role="img" aria-label="Irish name">☘️</div>' : ''}
    <p class="hint"></p>
    <p class="variants"></p>`;
  $('.sexchip', el).textContent = n.sex === 'boys' ? 'Boys' : 'Girls';
  const nm = $('.name', el);
  nm.textContent = n.name;
  if (n.name.length > 9) nm.classList.add('long');
  $('.hint', el).textContent = hint;
  $('.variants', el).textContent = n.variants.length ? `also: ${n.variants.slice(0, 3).join(', ')}` : '';
  return el;
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
  $('#btn-rank').disabled = c.like + c.love < 4;
  $('#btn-rank').title = c.like + c.love < 4 ? 'Like or love at least 4 names first' : '';
  for (const id of ['no', 'like', 'love']) $('#btn-' + id).disabled = !current;
  if (!current) {
    stage.innerHTML = `<div class="empty"><h2>That's the lot!</h2><p class="muted">You've seen every name that matches your filters.</p>
      <button class="btn primary" data-go="list">See my list</button> <button class="btn" data-go="welcome">Change filters</button></div>`;
    return;
  }
  document.body.dataset.sex = state.settings.sex;
  const el = cardEl(current.name);
  stage.append(el);
  swiper = attachSwipe(el, decide);
}

function decide(dir) {
  if (!current) return;
  const { name, src } = current;
  const d = dir;
  state.decisions[name.sex][name.key] = d;
  state.history.push({ s: name.sex, k: name.key, d, src });
  if (state.history.length > HISTORY_CAP) state.history.splice(0, state.history.length - HISTORY_CAP);
  announce(`${name.name}: ${d === 'no' ? 'no thanks' : d === 'like' ? 'liked' : 'loved'}`);
  if (d === 'love') burst();
  renderSwipe();
}

function undo() {
  const h = state.history.pop();
  if (!h) return;
  delete state.decisions[h.s][h.k];
  const n = data[h.s].byKey.get(h.k);
  if (h.src === 'p') { const p = `${h.s}:${h.k}`; if (!state.priority.includes(p)) state.priority.unshift(p); }
  else { const i = queue.indexOf(n); if (i >= 0) state.queue.pos = Math.min(state.queue.pos, i); }
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
function listRows(tab) {
  const rows = [];
  for (const sex of SEXES) {
    for (const [key, d] of Object.entries(state.decisions[sex])) {
      if (d === tab) { const n = data[sex].byKey.get(key); if (n) rows.push(n); }
    }
  }
  rows.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return rows;
}

function renderList() {
  document.body.dataset.sex = 'both';
  const ul = $('#list');
  ul.textContent = '';
  for (const b of $$('.tabs button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === listTab));
    $('.n', b).textContent = `(${fmt(listRows(b.dataset.tab).length)})`;
  }
  const rows = listRows(listTab);
  if (!rows.length) {
    ul.innerHTML = `<li class="none">${listTab === 'no' ? 'Nothing eliminated yet.' : 'Nothing here yet. Go and swipe!'}</li>`;
  }
  for (const n of rows.slice(0, listLimit)) {
    const li = document.createElement('li');
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = n.name + (n.irish ? ' ☘️' : '');
    const small = document.createElement('small');
    small.textContent = n.sex === 'boys' ? 'boy' : 'girl';
    nm.append(small);
    li.append(nm);
    const act = (label, to, aria) => {
      const b = document.createElement('button');
      b.className = 'mini'; b.textContent = label; b.setAttribute('aria-label', `${aria} ${n.name}`);
      b.addEventListener('click', () => { state.decisions[n.sex][n.key] = to; persist(); announce(`${n.name} moved`); renderList(); });
      li.append(b);
    };
    if (listTab === 'no') act('Restore', 'like', 'Restore');
    if (listTab === 'like') act('★', 'love', 'Love');
    if (listTab === 'love') act('♥', 'like', 'Move to liked:');
    if (listTab !== 'no') act('✕', 'no', 'Eliminate');
    ul.append(li);
  }
  $('#list-more').hidden = rows.length <= listLimit;
}

/* ---------- settings ---------- */
function renderSettings() {
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
  Promise.all(sexesFor(state.settings.sex).map(loadSex)).then((r) => {
    sexesFor(state.settings.sex).forEach((s, i) => { data[s] = r[i]; });
    buildQueue(); updateRemaining();
  });
  updateRemaining();
}

function initLetters() {
  const box = $('#letters');
  for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = L; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      const set = new Set(state.settings.letters);
      set.has(L) ? set.delete(L) : set.add(L);
      state.settings.letters = [...set].sort();
      b.setAttribute('aria-pressed', String(set.has(L)));
      $('#letters-count').textContent = set.size ? `(${state.settings.letters.join(' ')})` : '';
      setSetting({});
    });
    box.append(b);
  }
  $('#letters-clear').addEventListener('click', () => { setSetting({ letters: [] }); renderWelcome(); });
}

function init() {
  initLetters();
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) show(g.dataset.go);
  });
  $$('input[name=sex]').forEach((i) => i.addEventListener('change', () => setSetting({ sex: i.value })));
  $$('input[name=pop]').forEach((i) => i.addEventListener('change', () => setSetting({ pop: i.value })));
  $('#f-irish').addEventListener('change', (e) => setSetting({ irish: e.target.checked }));
  $('#btn-start').addEventListener('click', () => show('swipe'));
  $('#btn-continue').addEventListener('click', () => show('swipe'));

  const act = (dir) => () => { if (current && swiper) swiper.fling(dir); };
  $('#btn-no').addEventListener('click', act('no'));
  $('#btn-like').addEventListener('click', act('like'));
  $('#btn-love').addEventListener('click', act('love'));
  $('#btn-undo').addEventListener('click', undo);
  document.addEventListener('keydown', (e) => {
    if (screen !== 'swipe' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const map = { ArrowLeft: 'no', ArrowRight: 'like', ArrowUp: 'love' };
    if (map[e.key]) { e.preventDefault(); act(map[e.key])(); }
    else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); }
  });

  $$('.tabs button').forEach((b) => b.addEventListener('click', () => { listTab = b.dataset.tab; listLimit = 100; renderList(); }));
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
    data = { boys: b, girls: g };
    buildQueue();
    if (screen === 'welcome') renderWelcome();
  }).catch((err) => { $('#remaining').textContent = 'Could not load the names: ' + err.message; });
}

init();
