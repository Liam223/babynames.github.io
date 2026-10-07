// Loads the name data and provides the shared grouping key.
// nameKey must match scripts/build-names.py: accents stripped, lowercased.
export const nameKey = (s) =>
  s.replace(/’/g, "'").normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const cache = {};

export function loadSex(sex) {
  if (!cache[sex]) {
    cache[sex] = fetch(`./data/${sex}.json`)
      .then((r) => { if (!r.ok) throw new Error(`Could not load ${sex} names (${r.status})`); return r.json(); })
      .then((d) => {
        const list = d.names.map((t) => ({
          sex, name: t[0], count: t[1], rank: t[2], irish: !!t[3], variants: t[4] || [], key: nameKey(t[0]),
        }));
        return { version: d.version, sources: d.sources, list, byKey: new Map(list.map((n) => [n.key, n])) };
      })
      .catch((e) => { delete cache[sex]; throw e; });
  }
  return cache[sex];
}

export const SEXES = ['boys', 'girls'];
export const sexesFor = (choice) => (choice === 'both' ? SEXES : [choice]);
