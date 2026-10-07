// Which names are eligible for the deck and in what order they are shown. Pure functions, no page access.
import { sexesFor, isPrimary } from './names.js';

// Does a name pass the welcome-screen filters (Irish only, popularity band, starting letters)?
export function eligible(n, s) {
  if (s.irish && !n.irish) return false;
  if (s.pop === 'top100' && n.rank > 100) return false;
  if (s.pop === 'top500' && n.rank > 500) return false;
  if (s.pop === 'gems' && (n.rank <= 500 || n.classic)) return false;   // gems are modern names; classics have their own filter
  if (s.pop === 'retro' && !n.classic) return false;
  if (s.letters.length && !s.letters.includes(n.key[0].toUpperCase())) return false;
  return true;
}

// All names matching the filters. When boys and girls are mixed, a name used for both appears once.
// `data` maps sex -> { list }.
export function candidatesFor(data, s) {
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

export function rng(seed) {                       // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted shuffle (Efraimidis-Spirakis): popular names tend to come first, rarer ones are mixed in.
// The same seed always gives the same order.
export function weightedOrder(names, seed) {
  const r = rng(seed);
  const items = names.map((n) => {
    const w = 1 / Math.pow(n.rank + 25, 0.65);
    return [Math.log(r() || 1e-9) / w, n];
  });
  items.sort((a, b) => b[0] - a[0]);
  return items.map((x) => x[1]);
}
