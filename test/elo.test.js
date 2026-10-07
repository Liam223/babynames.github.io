import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, expectedScore, startRating, kFor, applyResult, pairKey, pickPair } from '../js/elo.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);

test('expected score is 50% for equal ratings and ~91% for a 400 point lead', () => {
  close(expectedScore(1500, 1500), 0.5);
  close(expectedScore(1900, 1500), 10 / 11);
  close(expectedScore(1500, 1900), 1 / 11);
});

test('loved names start ahead of liked names', () => {
  assert.equal(startRating('love'), CONFIG.startLove);
  assert.equal(startRating('like'), CONFIG.startLike);
  assert.ok(startRating('love') > startRating('like'));
});

test('K drops once a name has enough comparisons', () => {
  assert.equal(kFor(0), CONFIG.kEarly);
  assert.equal(kFor(CONFIG.lateAfter - 1), CONFIG.kEarly);
  assert.equal(kFor(CONFIG.lateAfter), CONFIG.kLate);
});

test('an even match moves each rating by half of K and counts a comparison', () => {
  const win = { r: 1500, n: 0 }; const lose = { r: 1500, n: 0 };
  applyResult(win, lose);
  close(win.r, 1500 + CONFIG.kEarly / 2);
  close(lose.r, 1500 - CONFIG.kEarly / 2);
  assert.deepEqual([win.n, lose.n], [1, 1]);
});

test('an upset moves ratings more than an expected win', () => {
  const upsetWin = { r: 1400, n: 0 }; const upsetLose = { r: 1600, n: 0 };
  const sureWin = { r: 1600, n: 0 }; const sureLose = { r: 1400, n: 0 };
  applyResult(upsetWin, upsetLose);
  applyResult(sureWin, sureLose);
  assert.ok(upsetWin.r - 1400 > sureWin.r - 1600);
});

test('a favourite beating an underdog gains and loses the same small amount', () => {
  const fav = { r: 1700, n: 0 }; const dog = { r: 1500, n: 0 };
  applyResult(fav, dog);
  const gain = fav.r - 1700;
  close(1500 - dog.r, gain);
  assert.ok(gain < CONFIG.kEarly / 2);
});

test('rating is conserved when both names have the same K', () => {
  const a = { r: 1537, n: 3 }; const b = { r: 1488, n: 4 };
  applyResult(a, b);
  close(a.r + b.r, 1537 + 1488);
});

test('well-tested names change by the smaller K', () => {
  const win = { r: 1500, n: CONFIG.lateAfter }; const lose = { r: 1500, n: CONFIG.lateAfter };
  applyResult(win, lose);
  close(win.r, 1500 + CONFIG.kLate / 2);
});

test('pairKey does not depend on order', () => {
  assert.equal(pairKey({ id: 'a' }, { id: 'b' }), pairKey({ id: 'b' }, { id: 'a' }));
});

const makeItems = (n) => Array.from({ length: n }, (_, i) => ({ id: `boys:n${i}` }));
const entries = (items, fn = () => ({ r: 1500, n: 0 })) => {
  const m = new Map(items.map((it, i) => [it.id, fn(i)]));
  return (it) => m.get(it.id);
};

test('pickPair needs at least two names', () => {
  assert.equal(pickPair([], () => ({ r: 1500, n: 0 })), null);
  assert.equal(pickPair(makeItems(1), () => ({ r: 1500, n: 0 })), null);
});

test('pickPair returns two different names, and never repeats the last pair when another exists', () => {
  const items = makeItems(5);
  const entryOf = entries(items);
  let last = null;
  for (let i = 0; i < 300; i++) {
    const [a, b] = pickPair(items, entryOf, { last, compared: i });
    assert.notEqual(a.id, b.id);
    const key = pairKey(a, b);
    assert.notEqual(key, last);
    last = key;
  }
});

test('with only two names the same pair is allowed to repeat', () => {
  const items = makeItems(2);
  const pair = pickPair(items, entries(items), { last: pairKey(items[0], items[1]) });
  assert.equal(pair.length, 2);
});

test('pickPair always includes the least-compared name', () => {
  const items = makeItems(6);
  const entryOf = entries(items, (i) => ({ r: 1500, n: i === 3 ? 0 : 8 }));
  for (let i = 0; i < 200; i++) assert.ok(pickPair(items, entryOf).some((it) => it.id === 'boys:n3'));
});
