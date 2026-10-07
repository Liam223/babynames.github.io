// Checks on the generated data files the app loads. Run after rebuilding the data (see README).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { nameKey } from '../js/names.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf-8'));
const sets = { boys: load('data/boys.json'), girls: load('data/girls.json') };

for (const [sex, d] of Object.entries(sets)) {
  test(`${sex}: every entry has the expected shape`, () => {
    assert.ok(d.names.length > 1000);
    for (const t of d.names) {
      assert.ok(t.length === 8 || t.length === 6, `${t[0]}: ${t.length} fields`);          // modern or classic
      assert.equal(typeof t[0], 'string');
      assert.ok(Number.isInteger(t[1]) && t[1] >= 0, `${t[0]} count`);
      assert.ok(Number.isInteger(t[2]) && t[2] >= 1, `${t[0]} rank`);
      assert.ok(Array.isArray(t[4]), `${t[0]} variants`);
      if (t.length === 8) {
        assert.equal(t[5].length, d.years.length, `${t[0]} per-year length`);
        assert.equal(t[6].length, 4);
        assert.equal(t[7].length, 4);
      } else {
        assert.equal(t[5].length, 3, `${t[0]} classic peak info`);
      }
    }
  });

  test(`${sex}: names are unique once accents and case are ignored`, () => {
    const seen = new Set();
    for (const t of d.names) {
      const k = nameKey(t[0]);
      assert.ok(!seen.has(k), `duplicate ${k}`);
      seen.add(k);
    }
  });

  test(`${sex}: ranks never go backwards (the list is in rank order)`, () => {
    let prev = 0;
    for (const t of d.names.filter((x) => x.length === 8)) {
      assert.ok(t[2] >= prev, `${t[0]} rank ${t[2]} after ${prev}`);
      prev = t[2];
    }
  });
}

test('both files describe the same data version, years and countries', () => {
  assert.equal(sets.boys.version, sets.girls.version);
  assert.deepEqual(sets.boys.years, sets.girls.years);
  assert.equal(sets.boys.countries.length, 4);
  assert.equal(typeof sets.boys.version, 'string');
});

test('every name has a history entry in its letter file', () => {
  const dir = new URL('../data/history/', import.meta.url);
  assert.ok(existsSync(dir));
  const files = new Set(readdirSync(dir));
  for (const [sex, d] of Object.entries(sets)) {
    const missing = [];
    const byShard = {};
    for (const t of d.names) {
      const k = nameKey(t[0]);
      const shard = /^[a-z]/.test(k) ? k[0] : '_';
      (byShard[shard] ||= []).push(k);
    }
    for (const [shard, keys] of Object.entries(byShard)) {
      const file = `${sex}-${shard}.json`;
      assert.ok(files.has(file), `missing ${file}`);
      const h = JSON.parse(readFileSync(new URL(file, dir), 'utf-8'));
      assert.equal(h.version, d.version, `${file} version`);
      for (const k of keys) if (!h.names[k]) missing.push(k);
    }
    assert.deepEqual(missing.slice(0, 5), [], `${sex}: ${missing.length} names without history`);
  }
});

test('info.json only describes names that exist', () => {
  const info = load('data/info.json');
  const keys = new Set([...sets.boys.names, ...sets.girls.names].map((t) => nameKey(t[0])));
  const stray = Object.keys(info.items).filter((k) => !keys.has(k));
  assert.deepEqual(stray.slice(0, 5), []);
});
