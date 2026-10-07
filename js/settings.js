// Settings: nickname, backup export/import, and resets.
import { flush, defaultState, exportJSON, parseImport, storageOk, persistenceStatus } from './storage.js';
import { sexesFor } from './names.js';
import { $, state, show, screens, persist, replaceState } from './core.js';
import { buildQueue } from './deck.js';

export async function renderStorageNote() {
  const p = await persistenceStatus();
  $('#storage-note').textContent = p === true
    ? 'Your browser has marked this data as protected, so it won’t be cleared automatically.'
    : 'Your browser may clear this data if space runs low or after a long time unused. Export a backup now and then.';
}

function renderSettings() {
  renderStorageNote();
  document.body.dataset.sex = 'both';
  $('#nickname').value = state.settings.nickname || '';
  $('#storage-warn').hidden = storageOk;
  $('#settings-msg').textContent = '';
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function resetSelection() {
  const label = state.settings.sex === 'both' ? 'boys and girls' : state.settings.sex;
  if (!confirm(`Reset all your choices for ${label}? This can't be undone (export a backup first if unsure).`)) return;
  for (const sex of sexesFor(state.settings.sex)) { state.decisions[sex] = {}; state.elo[sex] = {}; }
  state.history = []; state.priority = []; state.queue.pos = 0; state.compared = 0;
  for (const sex of sexesFor(state.settings.sex)) state.comparedBy[sex] = 0;
  persist(); flush(); $('#settings-msg').textContent = 'Reset done.';
}

function resetAll() {
  if (!confirm("Reset everything, including settings? This can't be undone (export a backup first if unsure).")) return;
  replaceState(defaultState()); persist(); flush(); buildQueue(); show('welcome');
}

export function initSettings() {
  $('#nickname').addEventListener('input', (e) => { state.settings.nickname = e.target.value.trim(); persist(); });
  $('#btn-export').addEventListener('click', () => {
    download(`baby-names-backup-${new Date().toISOString().slice(0, 10)}.json`, exportJSON(state));
    $('#settings-msg').textContent = 'Backup downloaded.';
  });
  $('#file-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      replaceState(parseImport(await f.text()));
      persist(); flush(); buildQueue();
      $('#settings-msg').textContent = 'Backup restored.';
    } catch (err) { $('#settings-msg').textContent = 'Import failed: ' + err.message; }
  });
  $('#btn-reset-sex').addEventListener('click', resetSelection);
  $('#btn-reset-all').addEventListener('click', resetAll);
}

screens.settings = { enter: renderSettings, note: renderStorageNote };
