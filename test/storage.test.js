import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, migrate, parseImport, exportJSON, STATE_VERSION } from '../js/storage.js';

const sample = () => ({
  v: STATE_VERSION,
  settings: { sex: 'girls', irish: true, pop: 'top500', letters: ['A', 'M'], nickname: 'Baby', hintSeen: true, rankHintNext: { boys: 0, girls: 25 }, lastPool: 'girls' },
  decisions: { boys: { oscar: 'love', kevin: 'no' }, girls: { niamh: 'like', isla: 'love' } },
  elo: { boys: { oscar: { r: 1612.5, n: 4 } }, girls: { niamh: { r: 1488, n: 2 } } },
  queue: { seed: 12345, pos: 17 },
  priority: ['girls:aoife'],
  history: [{ s: 'girls', k: 'niamh', d: 'like', src: 'q', m: 0 }],
  dataVersion: '2026-10-2',
  compared: 0,
  comparedBy: { boys: 4, girls: 2 },
});

test('a valid saved state passes through unchanged', () => {
  assert.deepEqual(migrate(sample()), sample());
});

test('migrating twice changes nothing', () => {
  const once = migrate(sample());
  assert.deepEqual(migrate(once), once);
});

test('missing or empty input gives a fresh state', () => {
  for (const bad of [null, undefined, 'x', 5]) {
    const s = migrate(bad);
    assert.deepEqual(Object.keys(s.decisions), ['boys', 'girls']);
    assert.equal(s.v, STATE_VERSION);
  }
});

test('old saves with one shared comparison count move it to boys', () => {
  const old = sample();
  delete old.comparedBy;
  old.compared = 9;
  assert.deepEqual(migrate(old).comparedBy, { boys: 9, girls: 0 });
});

test('missing sections are filled in from the defaults', () => {
  const s = migrate({ decisions: { boys: { oscar: 'love' } } });
  assert.deepEqual(s.decisions, { boys: { oscar: 'love' }, girls: {} });
  assert.equal(s.settings.pop, 'all');
  assert.deepEqual(s.priority, []);
});

test('a backup file is sanitised: only expected values survive', () => {
  const s = migrate({
    decisions: { boys: { a: 'love', b: '<img src=x onerror=alert(1)>', c: 'x" onmouseover="y' }, girls: {} },
    elo: { boys: { a: { r: '1500', n: '<b>' }, b: { r: 1500, n: 3 }, c: { r: NaN, n: 1 }, d: { r: 1500, n: -1 } }, girls: {} },
    settings: { sex: '<x>', pop: 'zz', letters: ['A', '<', 'BB', 'A'], nickname: 5, lastPool: '__proto__', rankHintNext: 'x', irish: 'yes' },
    history: [{ s: '__proto__', k: 'a', d: 'love', src: 'q' }, { s: 'boys', k: 'a', d: 'love', src: 'q' }, { s: 'boys', k: 'a', d: 'nope', src: 'q' }, null],
    priority: ['boys:a', 3, 'x', 'girls:b'],
    queue: { seed: 'a', pos: -1 },
    comparedBy: { boys: '7', girls: 2 },
    dataVersion: 5,
  });
  assert.deepEqual(s.decisions.boys, { a: 'love' });
  assert.deepEqual(s.elo.boys, { b: { r: 1500, n: 3 } });
  assert.equal(s.settings.sex, 'both');
  assert.equal(s.settings.pop, 'all');
  assert.deepEqual(s.settings.letters, ['A']);
  assert.equal(s.settings.nickname, '');
  assert.equal(s.settings.lastPool, null);
  assert.equal(s.settings.rankHintNext, 0);
  assert.equal(s.settings.irish, false);
  assert.equal(s.history.length, 1);
  assert.deepEqual(s.priority, ['boys:a', 'girls:b']);
  assert.equal(s.queue.pos, 0);
  assert.ok(Number.isInteger(s.queue.seed));
  assert.deepEqual(s.comparedBy, { boys: 0, girls: 2 });
  assert.equal(s.dataVersion, null);
});

test('export then import round-trips', () => {
  assert.deepEqual(parseImport(exportJSON(sample())), sample());
});

test('import also accepts a bare state, and rejects things that are not a backup', () => {
  assert.deepEqual(parseImport(JSON.stringify(sample())), sample());
  assert.throws(() => parseImport('{"hello":1}'), /not a Nameblocks backup/);
  assert.throws(() => parseImport('not json'));
});

test('defaultState has a random-looking integer seed and empty choices', () => {
  const d = defaultState();
  assert.ok(Number.isInteger(d.queue.seed));
  assert.deepEqual(d.decisions, { boys: {}, girls: {} });
});
