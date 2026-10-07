// Pure number-crunching for the "Over the years" panel: no page access, so it can be tested on its own.
// A history entry is [firstYear, [count, count, ...]] (see scripts/build-history.py).

// Births by year for one country entry, as a Map of year -> count (years with fewer than 3 births are absent).
export const expandSeries = (h, i) => {
  const m = new Map();
  if (h[i]) h[i][1].forEach((c, j) => { if (c) m.set(h[i][0] + j, c); });
  return m;
};


export const average = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// Centred moving average (the window shrinks at the ends), to show the shape through year-to-year noise.
export function rolling(vals, w = 5) {
  const half = Math.floor(w / 2);
  return vals.map((_, i) => average(vals.slice(Math.max(0, i - half), Math.min(vals.length, i + half + 1))));
}

// Catmull-Rom spline through the points, as an SVG path.
export function smoothPath(p) {
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

export function sparkPoints(vals, w = 64, h = 18) {
  const max = Math.max(...vals);
  if (!max) return '';
  const step = vals.length > 1 ? w / (vals.length - 1) : 0;
  return vals.map((v, i) => `${(i * step).toFixed(1)},${(h - 1.5 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
}

// The headline facts for a series: peak, where it is now, which way it is heading, and a one-line summary.
export function storyOf(vals, years) {
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
