// My list: Ranked / Loved / Liked / Eliminated tabs, with search, a boys/girls filter and sorting.
import { SEXES, nameKey } from './names.js';
import { icon } from './icons.js';
import { $, $$, state, data, screens, persist, announce, fmt, statLine, poolSize, totalCompared, h, possessive, sexWord, irishOf, setDecision } from './core.js';
import { rankedRows, rankedSex, sexOk, setRankedSex } from './rank.js';
import { infoButton } from './info.js';

let listTab = 'love';
let listSort = 'rank';
let listLimit = 100;
let listQuery = '';
let listSex = 'both';          // My list filter: both | boys | girls

// The name (with a ☘️ for Irish names) and a smaller line under it, shared by both kinds of row.
const nameBlock = (n, alt, sub, ...extra) => h('span', { class: 'nm' }, h('span', {}, n.name + (irishOf(n, alt) ? ' ☘️' : '')), h('small', {}, sub), ...extra);

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
    ul.append(h('li', { class: 'none' }, listQuery.trim() ? `No names match “${listQuery.trim()}” here.`
      : listTab === 'ranked' ? `Nothing ranked for ${rankedSex()} yet. Like or love a few ${possessive(rankedSex())} names, then compare them.`
      : listSex !== 'both' ? `No ${listSex} here yet.`
      : listTab === 'ranked' ? 'Nothing to rank yet. Like or love some names first.'
      : listTab === 'no' ? 'Nothing eliminated yet.' : 'Nothing here yet. Go and swipe!'));
  }
  for (const row of rows.slice(0, listLimit)) {
    if (listTab === 'ranked') { ul.append(rankedRowEl(row)); continue; }
    const { n, alt } = row;
    const li = h('li', {}, nameBlock(n, alt, alt
      ? `Unisex · #${fmt(n.rank)} boys, #${fmt(alt.rank)} girls`
      : `${sexWord(n.sex)} · ${statLine(n)}`), infoButton(n));
    const act = (iconName, cls, to, aria, text = '') => li.append(h('button', {
      class: 'mini ' + cls,
      'aria-label': `${aria} ${n.name}`,
      html: icon(iconName, 18) + (text ? `<span>${text}</span>` : ''),
      onclick: () => {
        setDecision(n, to, !!alt);
        persist(); announce(`${n.name} moved`); renderList();
      },
    }));
    if (listTab === 'no') act('undo', 'restore', 'like', 'Restore', 'Restore');
    if (listTab === 'like') act('star', 'love', 'love', 'Love');
    if (listTab === 'love') act('heart', 'like', 'like', 'Move to liked:');
    if (listTab !== 'no') act('x', 'no', 'no', 'Eliminate');
    ul.append(li);
  }
  $('#list-more').hidden = rows.length <= listLimit;
}

// A row on the Ranked tab: position, rating bar, score.
function rankedRowEl({ n, alt, e, d, pos, pct }) {
  const who = alt ? 'Unisex' : sexWord(n.sex);
  const compared = e.n ? `${e.n} comparison${e.n === 1 ? '' : 's'}` : 'not compared yet';
  const bar = h('span', { class: 'bar', role: 'img', 'aria-label': `Rating ${Math.round(e.r)}` }, h('span', { class: 'fill ' + d, style: { width: pct + '%' } }));
  return h('li', { class: 'ranked' + (pos <= 3 ? ' top' + pos : '') },
    h('span', { class: 'pos' }, pos),
    nameBlock(n, alt, `${who} · ${d === 'love' ? 'Loved' : 'Liked'} · ${compared}`, bar),
    h('span', { class: 'score' }, fmt(Math.round(e.r))),
    infoButton(n),
    h('button', {
      type: 'button', class: 'mini no', 'aria-label': `Eliminate ${n.name}`, html: icon('x', 18),
      onclick: () => {
        setDecision(n, 'no');       // only this sex's pool; a unisex name can still be wanted in the other
        persist(); announce(`${n.name} eliminated`); renderList();
      },
    }));
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
