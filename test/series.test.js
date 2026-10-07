import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandSeries, average, rolling, smoothPath, sparkPoints, storyOf } from '../js/series.js';

const years = (n, from = 2000) => Array.from({ length: n }, (_, i) => from + i);

test('expandSeries lays counts out by year and leaves out empty years', () => {
  const h = [0, [1990, [5, 0, 7]], 0, 0];
  assert.deepEqual([...expandSeries(h, 1)], [[1990, 5], [1992, 7]]);
  assert.equal(expandSeries(h, 0).size, 0);          // no births recorded
  assert.equal(expandSeries(h, 2).size, 0);
});

test('average of nothing is 0', () => {
  assert.equal(average([]), 0);
  assert.equal(average([2, 4]), 3);
});

test('rolling keeps a flat series flat and shrinks the window at the ends', () => {
  assert.deepEqual(rolling([4, 4, 4, 4, 4]), [4, 4, 4, 4, 4]);
  assert.deepEqual(rolling([0, 0, 9, 0, 0], 3), [0, 3, 3, 3, 0]);
  assert.equal(rolling([10]).length, 1);
});

test('smoothPath needs two points and starts with a move', () => {
  assert.equal(smoothPath([[0, 0]]), '');
  const d = smoothPath([[0, 0], [10, 5], [20, 0]]);
  assert.match(d, /^M0\.0,0\.0 C/);
  assert.equal(d.match(/C/g).length, 2);
});

test('sparkPoints is empty when there are no births, and scales to the maximum', () => {
  assert.equal(sparkPoints([0, 0, 0]), '');
  const pts = sparkPoints([0, 5, 10], 64, 18).split(' ');
  assert.equal(pts.length, 3);
  assert.equal(pts[2], '64.0,2.5');       // the peak sits at the top, just inside the margin
});

test('storyOf finds the peak, the latest value and how far down from the peak it is', () => {
  const s = storyOf([1, 4, 10, 6, 5], years(5));
  assert.equal(s.peak, 10);
  assert.equal(s.peakYear, 2002);
  assert.equal(s.last, 5);
  assert.equal(s.pct, 50);
  assert.equal(s.sentence, 'A 2000s favourite, now about 50% as common.');
});

test('storyOf sentences', () => {
  assert.equal(storyOf([1, 2, 9], years(3)).sentence, 'Most popular right now.');
  assert.equal(storyOf([2, 9, 8], years(3)).sentence, 'Still close to its peak in 2001.');
  assert.equal(storyOf([2, 9, 0], years(3)).sentence, 'A 2000s favourite that has become rare: now under 3 a year.');
  assert.equal(storyOf([2, 9, 0], years(3, 2015)).sentence, 'Peaked in 2016, now rare: under 3 a year.');
  assert.equal(storyOf([0, 0, 0], years(3)).sentence, '');
});

// 20 years; the "decade ago" window is the three years ending 10 years before the last (indexes 7, 8, 9).
const series = (early, recent) => {
  const v = Array(20).fill(0);
  [7, 8, 9].forEach((i) => { v[i] = early; });
  [17, 18, 19].forEach((i) => { v[i] = recent; });
  return v;
};

test('trend: rising, falling and steady compare now with a decade ago', () => {
  const up = storyOf(series(10, 20), years(20)).trend;
  assert.equal(up.label, 'Rising');
  assert.equal(up.caption, '100% more than a decade ago');
  const down = storyOf(series(20, 10), years(20)).trend;
  assert.equal(down.label, 'Falling');
  assert.equal(down.caption, '50% fewer than a decade ago');
  assert.equal(storyOf(series(10, 11), years(20)).trend.label, 'Steady');
});

test('trend: a name with no births at all has no trend', () => {
  assert.equal(storyOf(Array(20).fill(0), years(20)).trend.label, 'No trend');
});

test('trend: New only when there was nothing before the comparison window', () => {
  const v = Array(20).fill(0);
  [17, 18, 19].forEach((i) => { v[i] = 6; });
  assert.equal(storyOf(v, years(20)).trend.label, 'New');
});

test('trend: Patchy, not New, when earlier years had births that were just under the publishing threshold', () => {
  // The "Sam as a girl's name" case: births in the early years, nothing published a decade ago, a few recently.
  const v = Array(20).fill(0);
  v[2] = 12; v[4] = 5; v[18] = 3; v[19] = 4;
  const t = storyOf(v, years(20)).trend;
  assert.equal(t.label, 'Patchy');
  assert.equal(t.caption, 'too few births to show a trend');
});

test('trend: falling to nothing says so', () => {
  const t = storyOf(series(10, 0), years(20)).trend;
  assert.equal(t.label, 'Falling');
  assert.equal(t.caption, 'now under 3 a year');
});

test('short series compare the last three years with the first three', () => {
  assert.equal(storyOf([10, 10, 10, 10, 10, 20, 20, 20], years(8)).trend.label, 'Rising');
});
