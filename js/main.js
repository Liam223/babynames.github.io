// Entry point: wires the screens together and loads the name data.
import { loadSex, SEXES, linkUnisex } from './names.js';
import { hydrateIcons } from './icons.js';
import { flush } from './storage.js';
import { $, state, data, ui, show, persist, toast } from './core.js';
import { initWelcome, renderWelcome } from './welcome.js';
import { initDeck, buildQueue } from './deck.js';
import { initList } from './list.js';
import { initRank, syncRankedSex } from './rank.js';
import { initInfo } from './info.js';
import { initSettings } from './settings.js';

function init() {
  hydrateIcons();
  initWelcome();
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g && g.getAttribute('aria-disabled') === 'true') { toast(g.dataset.lockMsg || 'Not available yet'); return; }
    if (g) {
      const t = g.dataset.go;
      if (t === 'list-ranked') { if (ui.screen === 'rank') syncRankedSex(); show('list', { tab: 'ranked' }); } else show(t);
    }
  });
  initDeck();
  initRank();
  initInfo();
  initList();
  initSettings();

  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  show('welcome');
  Promise.all(SEXES.map(loadSex)).then(([b, g]) => {
    linkUnisex(b, g);
    Object.assign(data, { boys: b, girls: g });
    if (state.dataVersion !== b.version) {      // new name data: rescan the deck from the start (decisions are keyed by name, so nothing is lost)
      state.queue.pos = 0; state.dataVersion = b.version; persist();
    }
    buildQueue();
    if (ui.screen === 'welcome') renderWelcome();
  }).catch((err) => { $('#remaining').textContent = 'Could not load the names: ' + err.message; });
}

init();
