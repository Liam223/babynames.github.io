// Elo rating and pair selection for the this-or-that round.
// Every tunable number lives in CONFIG so it is easy to adjust after testing on real lists.
export const CONFIG = {
  startLike: 1500,        // starting rating for a Liked name
  startLove: 1600,        // starting rating for a Loved name (a head start, not a guarantee)
  kEarly: 32,             // biggest rating change per vote for a name with few comparisons
  kLate: 16,              // smaller changes once a name is well tested
  lateAfter: 10,          // comparisons before a name switches from kEarly to kLate
  hintAfter: 20,          // comparisons before suggesting "check your top 10"
  topTestChance: 0.15,    // chance a round features one of the current top names
  topN: 3,                // how many top names count for that
  fewerWeight: 15,        // pairing score penalty per past comparison of the opponent
  jitter: 40,             // randomness added to pairing scores so rounds don't feel scripted
  seenPenalty: 250,       // discourages re-showing a pair already shown this session
};

export const expectedScore = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));
export const startRating = (decision) => (decision === 'love' ? CONFIG.startLove : CONFIG.startLike);
export const kFor = (comparisons) => (comparisons >= CONFIG.lateAfter ? CONFIG.kLate : CONFIG.kEarly);

// Update two { r, n } entries in place after `win` beats `lose`.
export function applyResult(win, lose) {
  const expectedWin = expectedScore(win.r, lose.r);
  const gain = kFor(win.n) * (1 - expectedWin);
  const loss = kFor(lose.n) * expectedWin;
  win.r += gain; lose.r -= loss;
  win.n += 1; lose.n += 1;
}

export const pairKey = (a, b) => [a.id, b.id].sort().join('|');

// Choose two items to compare. `items` have an `id`; `entryOf(item)` returns { r, n }.
// Prefers names with the fewest comparisons, pairs similar ratings, never repeats the previous pair
// (unless only one pair exists), and now and then features a top name.
export function pickPair(items, entryOf, { last = null, seen = new Set(), compared = 0 } = {}) {
  if (items.length < 2) return null;
  const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const fewest = Math.min(...items.map((i) => entryOf(i).n));
  let a;
  if (items.length >= 6 && compared >= 6 && Math.random() < CONFIG.topTestChance) {
    const top = [...items].sort((x, y) => entryOf(y).r - entryOf(x).r).slice(0, CONFIG.topN);
    a = rnd(top);
  } else {
    a = rnd(items.filter((i) => entryOf(i).n === fewest));
  }
  const ea = entryOf(a);
  const choose = (avoidLast) => {
    let best = null;
    for (const b of items) {
      if (b === a) continue;
      const key = pairKey(a, b);
      if (avoidLast && key === last) continue;
      const score = Math.abs(ea.r - entryOf(b).r) + CONFIG.fewerWeight * entryOf(b).n
        + Math.random() * CONFIG.jitter + (seen.has(key) ? CONFIG.seenPenalty : 0);
      if (!best || score < best.score) best = { b, score };
    }
    return best && best.b;
  };
  const b = choose(true) || choose(false);
  return Math.random() < 0.5 ? [a, b] : [b, a];
}
