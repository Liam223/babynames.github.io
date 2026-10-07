// Shared set-up for the browser tests: a repeatable saved state, and a few small actions.
export const STATE_KEY = 'bn:v1:state';

const girls = [['aoife', 1721], ['niamh', 1655], ['isla', 1610], ['freya', 1580], ['maeve', 1545], ['orla', 1520], ['willow', 1490], ['ava', 1460]];
const boys = [['oscar', 1690], ['finn', 1640], ['arthur', 1600], ['rory', 1570], ['theo', 1540], ['cillian', 1515], ['jack', 1480], ['noah', 1450]];

// Eight liked or loved names in each pool (so Compare is unlocked), with ratings, and a fixed deck order.
export function demoState(over = {}) {
  const state = {
    v: 1,
    settings: { sex: 'both', irish: false, pop: 'all', letters: [], nickname: '', hintSeen: true, rankHintNext: { boys: 999, girls: 999 }, lastPool: 'girls' },
    decisions: { boys: { kevin: 'no' }, girls: { mildred: 'no' } },
    elo: { boys: {}, girls: {} },
    queue: { seed: 12345, pos: 0 },
    priority: [],
    history: [],
    dataVersion: null,
    compared: 0,
    comparedBy: { boys: 5, girls: 5 },
  };
  girls.forEach(([k, r], i) => { state.decisions.girls[k] = i < 3 ? 'love' : 'like'; state.elo.girls[k] = { r, n: 8 - i }; });
  boys.forEach(([k, r], i) => { state.decisions.boys[k] = i < 3 ? 'love' : 'like'; state.elo.boys[k] = { r, n: 8 - i }; });
  return { ...state, ...over };
}

// Start the page with a saved state already in place (only if there isn't one yet, so reloads keep your changes).
// Pass `null` to start as a brand-new visitor.
export async function seed(page, state = demoState()) {
  await page.addInitScript(([key, value]) => {
    try { if (value && !localStorage.getItem(key)) localStorage.setItem(key, value); } catch { /* storage blocked */ }
  }, [STATE_KEY, state && JSON.stringify(state)]);
}

// Open the app and wait until the name lists have loaded.
export async function openApp(page, state) {
  if (state !== undefined) await seed(page, state);
  else await seed(page);
  await page.goto('/');
  await page.locator('#btn-start:not([disabled])').waitFor();
}

export const tab = (page, name) => page.locator(`.tab[data-go=${name}]`);

// The saved state as the app currently has it (flushes pending writes first by waiting past the save debounce).
export async function savedState(page) {
  await page.waitForTimeout(400);
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
}

// "12 seen · 5 liked · 2 loved" from the swipe screen.
export async function progress(page) {
  const text = await page.locator('#progress').innerText();
  const [seen, liked, loved] = text.match(/\d[\d,]*/g).map((s) => Number(s.replace(/,/g, '')));
  return { seen, liked, loved };
}
