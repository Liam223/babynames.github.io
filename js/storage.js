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
    settings: { sex: 'both', irish: false, pop: 'all', letters: [], nickname: '', hintSeen: false, rankHintNext: 0 },
    decisions: { boys: {}, girls: {} },   // { nameKey: 'no' | 'like' | 'love' }
    elo: { boys: {}, girls: {} },         // { nameKey: { r: rating, n: comparisons } }
    queue: { seed: Math.floor(Math.random() * 2 ** 31), pos: 0 },
    priority: [],                          // "sex:key" names to show first (from share links)
    history: [],                           // [{ s, k, d, src }]
    compared: 0,
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
  // if ((raw.v || 1) < 2) { ...future migrations here... }
  s.v = STATE_VERSION;
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
  if (!st || typeof st !== 'object' || !st.decisions) throw new Error('This is not a Baby Name Swiper backup.');
  return migrate(st);
}
