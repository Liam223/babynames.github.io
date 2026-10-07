// Loads the name data and provides the shared grouping key and stats helpers.
// nameKey must match scripts/build-names.py: accents stripped, lowercased.
export const nameKey = (s) =>
  s.replace(/’/g, "'").normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const SEXES = ['boys', 'girls'];
export const sexesFor = (choice) => (choice === 'both' ? SEXES : [choice]);

// Short labels for the four countries, in the order used by the data files.
export const COUNTRY_SHORT = ['E&W', 'SCO', 'NI', 'IRL'];

const cache = {};

export function loadSex(sex) {
  if (!cache[sex]) {
    cache[sex] = fetch(`./data/${sex}.json`)
      .then((r) => { if (!r.ok) throw new Error(`Could not load ${sex} names (${r.status})`); return r.json(); })
      .then((d) => {
        const list = d.names.map((t) => ({
          sex, name: t[0], count: t[1], rank: t[2], irish: !!t[3], variants: t[4] || [], key: nameKey(t[0]),
          years: t[5] || [], byCountry: t[6] || [], countryRank: t[7] || [],
          alt: null,       // the same name in the other sex's list (set by linkUnisex)
          // classic = historical-only name (not enough recent births): { peak: year, peakCount, full: births across all years }
          classic: t[8] ? { peak: t[8][0], peakCount: t[8][1], full: t[8][2] } : null,
        }));
        return {
          version: d.version, sources: d.sources, years: d.years || [], countries: d.countries || [],
          yearTotals: d.yearTotals || [], countrySizes: d.countrySizes || [], size: list.length,
          list, byKey: new Map(list.map((n) => [n.key, n])),
        };
      })
      .catch((e) => { delete cache[sex]; throw e; });
  }
  return cache[sex];
}

// Once both lists are loaded, link names that appear in both so they can be shown as one unisex card.
export function linkUnisex(boys, girls) {
  for (const b of boys.list) {
    const g = girls.byKey.get(b.key);
    if (g) { b.alt = g; g.alt = b; }
  }
}

// The entry that represents a name when boys and girls are merged: the more common sex (boys on a tie).
export const isPrimary = (n) => !n.alt || n.count > n.alt.count || (n.count === n.alt.count && n.sex === 'boys');

/* ---------- stats ---------- */

// Share of all babies of this sex given the name, per year (so falling birth numbers don't look like falling popularity).
export function shares(n, meta) {
  return n.years.map((c, i) => (meta.yearTotals[i] ? c / meta.yearTotals[i] : 0));
}

// { label: 'Rising'|'Falling'|'Steady'|'New', arrow, points: [0..1 scaled shares] } or null if too few babies to say.
export function trend(n, meta) {
  if (n.count < 40 || n.years.length < 5) return null;
  const sh = shares(n, meta);
  const early = (n.years[0] + n.years[1]) / ((meta.yearTotals[0] + meta.yearTotals[1]) || 1);
  const late = (n.years[3] + n.years[4]) / ((meta.yearTotals[3] + meta.yearTotals[4]) || 1);
  let label = 'Steady', arrow = '→';
  if (early === 0 && n.years[3] + n.years[4] >= 10) { label = 'New'; arrow = '✦'; }
  else if (late >= early * 1.25) { label = 'Rising'; arrow = '↗'; }
  else if (late <= early * 0.8) { label = 'Falling'; arrow = '↘'; }
  return { label, arrow, shares: sh };
}

// 'Especially popular in X' when one country ranks the name at least twice as high as the UK & Ireland overall.
// Plain ranks are compared (England & Wales is ~85% of births, so it only rarely stands out from the overall list).
export function standout(n, meta) {
  if (!n.countryRank.length) return null;
  let best = null;
  n.countryRank.forEach((r, i) => {
    if (!r || n.byCountry[i] < 20) return;
    if (!best || r < best.rank) best = { i, rank: r };
  });
  if (best && best.rank * 2 <= n.rank && best.rank <= 300) return { country: meta.countries[best.i], rank: best.rank };
  return null;
}
