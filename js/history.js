// The "Over the years" panel on the details screen: per-country history, the story, and the chart.
// Births per year come from data/history/<sex>-<letter>.json (built by scripts/build-history.py).
import { icon } from './icons.js';
import { standout } from './names.js';
import { $, $$, data, fmt, esc, ptitle, babies } from './core.js';

// Births per year over each source's whole history, from data/history/<sex>-<letter>.json (built by scripts/build-history.py).
// One small file per letter, fetched when a details screen opens, so it never slows down the swipe deck.
const COVER_START = [1996, 1974, 1997, 1964];          // first year each country's records cover (same order as data.countries)
const COUNTRY_LABEL = ['England & Wales', 'Scotland', 'Northern Ireland', 'Republic of Ireland'];
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
  else if (!before && vals.slice(0, Math.max(0, n - 13)).some(v => v > 0)) trend = { label: 'Patchy', arrow: '~', cls: 'steady', caption: 'too few births to show a trend' };
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
        <div class="st pk"><span class="lab">Peak</span><b>${story.peakYear}</b><small>${babies(story.peak)}${first ? ' · first year on record' : ''}</small></div>
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
      recent = c ? `${r ? `#${fmt(r)} · ` : ''}${babies(c)}` : 'none';
    }
    const tag = v === soIdx ? `<span class="star" role="img" aria-label="Especially popular here" title="Especially popular here">${icon('star', 12)}</span>` : '';
    const cc = v === 'all' ? ALL_COLOUR : COUNTRY_COLOUR[v];
    return `<button type="button" class="crow${on ? ' on' : ''}" data-c="${v}" style="--cc:var(--${cc});--ccd:var(--${cc === 'yellow' ? 'yellow-d' : cc})" aria-pressed="${on}">
      <i class="dot"></i><span class="cn">${esc(label)}${tag}<small>${esc(sub)}</small></span>
      <svg class="sp" viewBox="0 0 64 18" aria-hidden="true"><polyline points="${sparkPoints(s.vals)}"></polyline></svg><span class="rc">${esc(recent)}</span>
      <span class="ct"><b>${fmt(total)}</b><small>${py ? `peak ${py}` : 'births'}</small></span></button>`;
  }).join('');

  const rare = n.classic ? `<p class="muted small">Rare today: ${n.count ? `${babies(n.count)} in ${meta.years[0]}–${String(END).slice(2)}` : `under 3 a year in ${meta.years[0]}–${String(END).slice(2)}`}.</p>` : '';
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

// `current()` says whether the details screen is still showing this name by the time the file arrives.
export function renderInfoHistory(n, current) {
  const slot = $('#info-history');
  if (!slot) return;
  slot.innerHTML = '<div class="panel"><p class="muted">Loading history…</p></div>';
  loadHistory(n.sex, n.key).then((h) => {
    const draw = () => {
      const target = $('#info-history');
      if (!current() || !target) return;      // user moved on
      const p = h ? historyPanel(n, h) : null;
      if (!p) {
        target.innerHTML = n.classic
          ? `<div class="panel">${ptitle('trend', 'orange', 'History')}<p class="muted">Peaked in ${n.classic.peak} with ${babies(n.classic.peakCount)}; ${fmt(n.classic.full)} births on record.</p></div>`
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
          read.textContent = `${p.years[i]} · ${v ? babies(v) : 'under 3'}`;
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

export function resetHistory() { infoHistC = 'auto'; }
