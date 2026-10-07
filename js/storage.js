// localStorage wrapper. Every read and write is wrapped in try/catch so the app
// still runs (without saving) if storage is blocked.
const KEY = 'bn:v1:state';
export const STATE_VERSION = 1;
export const HISTORY_CAP = 200;

let memory = null;   // fallback when storage is unavailable
export let storageOk = true;

export function defaultState() {
  return {
    v: STATE_VERSION,
    settings: { sex: 'both', irish: false, pop: 'all', letters: [], nickname: '', hintSeen: false, rankHintNext: { boys: 0, girls: 0 }, lastPool: null },
    decisions: { boys: {}, girls: {} },   // { nameKey: 'no' | 'like' | 'love' }
    elo: { boys: {}, girls: {} },         // { nameKey: { r: rating, n: comparisons } }
    queue: { seed: Math.floor(Math.random() * 2 ** 31), pos: 0 },
    priority: [],                          // "sex:key" names to show first (from share links)
    history: [],                           // [{ s, k, d, src }]
    dataVersion: null,                     // version of the name data this state last saw (deck position resets when it changes)
    compared: 0,                           // legacy total (kept so old saves load)
    comparedBy: { boys: 0, girls: 0 },     // comparisons made in each pool
  };
}

// Bring saved or imported data up to the current shape. Add a step per version bump.
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return defaultState();
  const d = defaultState();
  const s = { ...d, ...raw };
  s.settings = { ...d.settings, ...(raw.settings || {}) };
  s.decisions = { boys: {}, girls: {}, ...(raw.decisions || {}) };
  s.elo = { boys: {}, girls: {}, ...(raw.elo || {}) };
  s.queue = { ...d.queue, ...(raw.queue || {}) };
  if (!Array.isArray(s.priority)) s.priority = [];
  if (!Array.isArray(s.history)) s.history = [];
  s.comparedBy = { boys: 0, girls: 0, ...(raw.comparedBy || {}) };
  if (!raw.comparedBy && raw.compared) s.comparedBy.boys = raw.compared;   // old saves had one shared count
  // if ((raw.v || 1) < 2) { ...future migrations here... }
  s.v = STATE_VERSION;
  return sanitize(s);
}

const SEXES = ['boys', 'girls'];
const DECISIONS = ['no', 'like', 'love'];
const POPS = ['all', 'top500', 'top100', 'gems', 'retro'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;

// A backup file is untrusted input. Keep only values of the expected shape and drop the rest, so a damaged or
// hand-edited file can't put anything unexpected on the page. Valid saves pass through unchanged.
function sanitize(s) {
  const d = defaultState();
  const st = s.settings;
  if (!['both', ...SEXES].includes(st.sex)) st.sex = d.settings.sex;
  if (!POPS.includes(st.pop)) st.pop = d.settings.pop;
  st.irish = st.irish === true;
  st.letters = Array.isArray(st.letters) ? [...new Set(st.letters.filter((l) => typeof l === 'string' && /^[A-Z]$/.test(l)))] : [];
  st.nickname = typeof st.nickname === 'string' ? st.nickname.slice(0, 100) : '';
  if (st.lastPool !== null && !SEXES.includes(st.lastPool)) st.lastPool = null;
  const hint = (v) => (isNum(v) && v >= 0 ? v : 0);
  st.rankHintNext = st.rankHintNext && typeof st.rankHintNext === 'object'
    ? { boys: hint(st.rankHintNext.boys), girls: hint(st.rankHintNext.girls) }
    : hint(st.rankHintNext);
  for (const sex of SEXES) {
    const dec = {};
    for (const [k, v] of Object.entries(s.decisions[sex] || {})) if (DECISIONS.includes(v)) dec[k] = v;
    s.decisions[sex] = dec;
    const elo = {};
    for (const [k, e] of Object.entries(s.elo[sex] || {})) if (e && isNum(e.r) && isCount(e.n)) elo[k] = { r: e.r, n: e.n };
    s.elo[sex] = elo;
    if (!isCount(s.comparedBy[sex])) s.comparedBy[sex] = 0;
  }
  if (!isCount(s.queue.seed)) s.queue.seed = d.queue.seed;
  if (!isCount(s.queue.pos)) s.queue.pos = 0;
  s.priority = s.priority.filter((p) => typeof p === 'string' && /^(boys|girls):/.test(p));
  s.history = s.history.filter((h) => h && SEXES.includes(h.s) && typeof h.k === 'string' && DECISIONS.includes(h.d) && (h.src === 'p' || h.src === 'q'));
  if (s.dataVersion !== null && typeof s.dataVersion !== 'string') s.dataVersion = null;
  if (!isCount(s.compared)) s.compared = 0;
  return s;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch { storageOk = false; }
  return memory ? migrate(memory) : defaultState();
}

let timer = null;
let pending = null;
function write() {
  if (!pending) return;
  const s = pending; pending = null; memory = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); storageOk = true; } catch { storageOk = false; }
}
export function save(state) {
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(write, 250);
}
export function flush() { clearTimeout(timer); write(); }

// Ask the browser to treat this site's storage as persistent, so it isn't cleared when space is low.
// Returns true (protected), false (best effort only), or null (not supported / blocked).
export async function requestPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

export async function persistenceStatus() {
  try {
    if (!navigator.storage || !navigator.storage.persisted) return null;
    return await navigator.storage.persisted();
  } catch { return null; }
}

export function exportJSON(state) {
  return JSON.stringify({ app: 'babynames', exportedAt: new Date().toISOString(), state }, null, 1);
}

export function parseImport(text) {
  const obj = JSON.parse(text);
  const st = obj && obj.app === 'babynames' ? obj.state : obj;
  if (!st || typeof st !== 'object' || !st.decisions) throw new Error('This is not a Nameblocks backup.');
  return migrate(st);
}
