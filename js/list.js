// My list: Ranked / Loved / Liked / Eliminated tabs, with search, a boys/girls filter and sorting.
import { SEXES, nameKey } from './names.js';
import { icon } from './icons.js';
import { $, $$, state, data, screens, persist, announce, fmt, statLine, poolSize, totalCompared } from './core.js';
import { rankedRows, rankedSex, sexOk, setRankedSex } from './rank.js';
import { infoButton } from './info.js';

let listTab = 'love';
let listSort = 'rank';
let listLimit = 100;
let listQuery = '';
let listSex = 'both';          // My list filter: both | boys | girls

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

// A row on the Ranked tab: position, rating bar, score.
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

// Coming back from the info screen keeps your tab, search and filters; arriving fresh resets them.
function enterList(opts) {
  if (!opts.keep) {
    listQuery = ''; $('#list-search').value = ''; listLimit = 100;
    const has = (t) => (t === 'ranked' ? totalCompared() > 0 && poolSize(rankedSex()) >= 2 : rowsFor(t).length > 0);
    listTab = opts.tab || ['ranked', 'love', 'like', 'no'].find(has) || 'love';
  }
  renderList();
}

export function initList() {
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => { listTab = b.dataset.tab; listLimit = 100; renderList(); }));
  $('#sort-toggle').addEventListener('click', () => { listSort = listSort === 'az' ? 'rank' : 'az'; renderList(); });
  $('#list-search').addEventListener('input', (e) => { listQuery = e.target.value; listLimit = 100; renderList(); });
  $$('input[name=listsex]').forEach((i) => i.addEventListener('change', () => { if (listTab === 'ranked') setRankedSex(i.value); else listSex = i.value; listLimit = 100; renderList(); }));
  $('#list-more').addEventListener('click', () => { listLimit += 200; renderList(); });
}

screens.list = { enter: enterList };
