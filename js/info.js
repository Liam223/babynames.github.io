// The details screen for one name: popularity, history, spellings, and origin/meaning/pronunciation.
import { icon } from './icons.js';
import { $, $$, state, data, ui, show, screens, fmt, esc, ptitle } from './core.js';
import { renderInfoHistory, resetHistory } from './history.js';

let infoName = null;           // the name entry shown on the info screen
let infoSex = null;            // which sex's figures (for unisex names)

export function infoButton(n) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mini info';
  b.innerHTML = icon('info', 18);
  b.setAttribute('aria-label', `About ${n.name}`);
  b.addEventListener('click', () => openInfo(n));
  return b;
}

export function openInfo(n) {
  if (!n) return;
  infoName = n;
  infoSex = n.sex;
  resetHistory();
  if (ui.screen !== 'info') ui.infoFrom = ui.screen;
  show('info');
}

function leaveInfo() {
  const to = ui.infoFrom === 'info' || !ui.infoFrom ? 'swipe' : ui.infoFrom;
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
  $$('input[name=infosex]').forEach((i) => i.addEventListener('change', () => { infoSex = i.value; resetHistory(); renderInfo(); }));
  renderInfoExtra(n);
  renderInfoHistory(n, () => ui.screen === 'info' && infoEntry() === n);
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
    if (ui.screen !== 'info' || infoEntry() !== n || !$('#info-extra')) return;      // user moved on
    const it = infoData && infoData.items[n.key];
    $('#info-extra').innerHTML = it && Object.keys(it).length
      ? aboutPanel(n, it)
      : `<div class="panel">${ptitle('info', 'pink', 'About this name')}<p class="muted">No origin, meaning or pronunciation found for this name yet. Names outside the most popular ones and the Irish-language names are only partly covered.</p></div>`;
  };
  if (infoData) { fill(); return; }
  slot.innerHTML = '<div class="panel"><p class="muted">Loading more about this name…</p></div>';
  loadInfoData().then((d) => {
    if (d) fill();
    else if (ui.screen === 'info' && $('#info-extra')) $('#info-extra').innerHTML = '<div class="panel"><p class="muted">Couldn’t load the extra details. Check your connection and try again.</p></div>';
  });
}

export function initInfo() {
  $('#info-back').addEventListener('click', leaveInfo);
  document.addEventListener('keydown', (e) => {
    if (ui.screen === 'info' && e.key === 'Escape') leaveInfo();
  });
}

screens.info = { enter: renderInfo };
