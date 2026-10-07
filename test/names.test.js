import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, sexesFor, SEXES, isPrimary, linkUnisex, trend, standout, shares } from '../js/names.js';

test('nameKey strips accents, curly apostrophes and case', () => {
  assert.equal(nameKey('Seán'), 'sean');
  assert.equal(nameKey('Niamh'), 'niamh');
  assert.equal(nameKey('O’Brien'), "o'brien");
  assert.equal(nameKey('Zoë'), 'zoe');
});

test('sexesFor expands "both"', () => {
  assert.deepEqual(sexesFor('both'), SEXES);
  assert.deepEqual(sexesFor('girls'), ['girls']);
});

const entry = (sex, name, count, extra = {}) => ({ sex, name, key: nameKey(name), count, rank: 1, alt: null, ...extra });

test('linkUnisex pairs names that appear in both lists', () => {
  const b = entry('boys', 'Alex', 100); const g = entry('girls', 'Alex', 40); const solo = entry('boys', 'Oscar', 90);
  const boys = { list: [b, solo], byKey: new Map([[b.key, b], [solo.key, solo]]) };
  const girls = { list: [g], byKey: new Map([[g.key, g]]) };
  linkUnisex(boys, girls);
  assert.equal(b.alt, g);
  assert.equal(g.alt, b);
  assert.equal(solo.alt, null);
});

test('isPrimary picks the more common sex, boys on a tie', () => {
  const b = entry('boys', 'Sam', 100); const g = entry('girls', 'Sam', 40);
  b.alt = g; g.alt = b;
  assert.equal(isPrimary(b), true);
  assert.equal(isPrimary(g), false);
  g.count = 100;
  assert.equal(isPrimary(b), true);
  assert.equal(isPrimary(g), false);
  assert.equal(isPrimary(entry('girls', 'Isla', 5)), true);     // no twin
});

const meta = { yearTotals: [1000, 1000, 1000, 1000, 1000], countries: ['England & Wales', 'Scotland', 'Northern Ireland', 'Republic of Ireland'] };
const withYears = (years) => ({ years, count: years.reduce((a, b) => a + b, 0) });

test('shares are per baby born that year', () => {
  assert.deepEqual(shares({ years: [10, 20, 0, 5, 1] }, meta), [0.01, 0.02, 0, 0.005, 0.001]);
});

test('trend is hidden for rare names and for classics with no recent years', () => {
  assert.equal(trend(withYears([1, 1, 1, 1, 1]), meta), null);         // fewer than 40 babies
  assert.equal(trend({ years: [], count: 500 }, meta), null);
});

test('trend: rising, falling, steady and new', () => {
  assert.equal(trend(withYears([50, 50, 60, 100, 100]), meta).label, 'Rising');
  assert.equal(trend(withYears([100, 100, 60, 50, 50]), meta).label, 'Falling');
  assert.equal(trend(withYears([80, 80, 80, 80, 80]), meta).label, 'Steady');
  assert.equal(trend(withYears([0, 0, 20, 30, 40]), meta).label, 'New');
});

test('standout needs a country that ranks the name at least twice as high, with enough babies', () => {
  const base = { rank: 400, countryRank: [420, 150, 0, 0], byCountry: [900, 60, 0, 0] };
  assert.deepEqual(standout(base, meta), { country: 'Scotland', rank: 150 });
  assert.equal(standout({ ...base, countryRank: [420, 250, 0, 0] }, meta), null);          // not twice as high
  assert.equal(standout({ ...base, byCountry: [900, 10, 0, 0] }, meta), null);             // too few babies there
  assert.equal(standout({ ...base, rank: 2000, countryRank: [2000, 400, 0, 0] }, meta), null);   // beyond the top 300
  assert.equal(standout({ rank: 5, countryRank: [], byCountry: [] }, meta), null);          // classic: no country ranks
});
