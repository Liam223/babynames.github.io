import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligible, candidatesFor, rng, weightedOrder } from '../js/queue.js';
import { nameKey, linkUnisex } from '../js/names.js';

const mk = (sex, name, rank, extra = {}) => ({ sex, name, key: nameKey(name), rank, count: 1000 - rank, irish: false, classic: null, alt: null, variants: [], ...extra });
const filters = (over = {}) => ({ sex: 'both', irish: false, pop: 'all', letters: [], ...over });

test('eligible: Irish only', () => {
  assert.equal(eligible(mk('girls', 'Niamh', 10, { irish: true }), filters({ irish: true })), true);
  assert.equal(eligible(mk('girls', 'Isla', 10), filters({ irish: true })), false);
});

test('eligible: popularity bands', () => {
  const top = mk('boys', 'Noah', 3); const mid = mk('boys', 'Rory', 300); const rare = mk('boys', 'Zane', 900);
  const classic = mk('boys', 'Alfred', 5000, { classic: { peak: 1990 } });
  assert.deepEqual([top, mid, rare].map((n) => eligible(n, filters({ pop: 'top100' }))), [true, false, false]);
  assert.deepEqual([top, mid, rare].map((n) => eligible(n, filters({ pop: 'top500' }))), [true, true, false]);
  assert.deepEqual([top, mid, rare, classic].map((n) => eligible(n, filters({ pop: 'gems' }))), [false, false, true, false]);
  assert.deepEqual([top, classic].map((n) => eligible(n, filters({ pop: 'retro' }))), [false, true]);
  assert.equal(eligible(classic, filters({ pop: 'all' })), true);
});

test('eligible: starting letters', () => {
  const n = mk('girls', 'Isla', 10);
  assert.equal(eligible(n, filters({ letters: ['I', 'M'] })), true);
  assert.equal(eligible(n, filters({ letters: ['A'] })), false);
});

const build = () => {
  const alexB = mk('boys', 'Alex', 20); const alexG = mk('girls', 'Alex', 80, { count: 10 });
  alexB.count = 500;
  const boys = { list: [alexB, mk('boys', 'Oscar', 5)] };
  const girls = { list: [alexG, mk('girls', 'Isla', 2)] };
  const byKey = (m) => ({ ...m, byKey: new Map(m.list.map((n) => [n.key, n])) });
  const b = byKey(boys); const g = byKey(girls);
  linkUnisex(b, g);
  return { boys: b, girls: g };
};

test('candidatesFor lists a unisex name once when boys and girls are mixed', () => {
  const names = candidatesFor(build(), filters()).map((n) => n.name).sort();
  assert.deepEqual(names, ['Alex', 'Isla', 'Oscar']);
});

test('candidatesFor with one sex lists that sex only', () => {
  assert.deepEqual(candidatesFor(build(), filters({ sex: 'girls' })).map((n) => n.name).sort(), ['Alex', 'Isla']);
  assert.deepEqual(candidatesFor(build(), filters({ sex: 'boys' })).map((n) => n.name).sort(), ['Alex', 'Oscar']);
});

test('a unisex name passes if either sex passes the filters', () => {
  // Alex is rank 20 for boys and 80 for girls; with Top 100 either way it passes, with letters it must match the letter.
  assert.equal(candidatesFor(build(), filters({ pop: 'top100' })).some((n) => n.name === 'Alex'), true);
  const data = build();
  data.boys.list[0].rank = 900;           // boys' Alex no longer top 100, but the girls' one still is
  assert.equal(candidatesFor(data, filters({ pop: 'top100' })).some((n) => n.name === 'Alex'), true);
});

test('rng is repeatable and stays within 0..1', () => {
  const a = rng(42); const b = rng(42);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(rng(1)(), rng(2)());
});

test('weightedOrder is a repeatable shuffle that tends to put popular names first', () => {
  const names = Array.from({ length: 2000 }, (_, i) => mk('boys', `N${i}`, i + 1));
  const first = weightedOrder(names, 7);
  assert.deepEqual(first.map((n) => n.rank), weightedOrder(names, 7).map((n) => n.rank));
  assert.notDeepEqual(first.map((n) => n.rank), weightedOrder(names, 8).map((n) => n.rank));
  assert.equal(new Set(first.map((n) => n.rank)).size, 2000);            // nothing lost or duplicated
  const avg = (a) => a.reduce((x, y) => x + y.rank, 0) / a.length;
  assert.ok(avg(first.slice(0, 200)) < avg(first.slice(-200)) / 2);     // the front is much more popular than the back
  assert.ok(first.slice(0, 200).some((n) => n.rank > 500));             // but rarer names are mixed in
});
