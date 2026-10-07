// The welcome screen: the filters (sex, popularity, Irish, starting letters) and how many names are left.
import { SEXES, sexesFor } from './names.js';
import { $, $$, state, data, show, screens, persist, fmt, counts, h } from './core.js';
import { candidates, buildQueue, remainingCount } from './deck.js';

const POP_HELP = {
  gems: 'Modern names outside the top 500.',
  retro: 'Names that were popular in the past but are rare today. Ranked after all the modern names.',
};

const SEX_HELP = {
  boys: 'Names given to baby boys.',
  girls: 'Names given to baby girls.',
  both: 'Boys’ and girls’ names in one pile. A name used for both shows up once.',
};

export function renderWelcome() {
  const s = state.settings;
  $$('input[name=sex]').forEach((i) => { i.checked = i.value === s.sex; });
  $$('input[name=pop]').forEach((i) => { i.checked = i.value === s.pop; });
  $('#f-irish').checked = s.irish;
  $('#sex-help').textContent = SEX_HELP[s.sex];
  $('#pop-help').textContent = POP_HELP[s.pop] || '';
  $('#pop-help').hidden = !POP_HELP[s.pop];
  $$('.chip').forEach((b) => b.setAttribute('aria-pressed', String(s.letters.includes(b.textContent))));
  $('#letters-count').textContent = s.letters.length ? s.letters.join(' ') : 'Any';
  const c = counts(SEXES);
  const any = c.no + c.like + c.love > 0;
  $('#continue').hidden = !any;
  $('#adjust').hidden = !any;
  if (any) { $('#rs-seen').textContent = fmt(c.no + c.like + c.love); $('#rs-like').textContent = fmt(c.like); $('#rs-love').textContent = fmt(c.love); }
  updateRemaining();
}

function updateRemaining() {
  const ready = sexesFor(state.settings.sex).every((s) => data[s]) && SEXES.every((s) => data[s]);
  $('#btn-continue').disabled = !ready;
  if (!ready) { $('#remaining').textContent = 'Loading names…'; $('#btn-start').disabled = true; return; }
  const n = remainingCount();
  $('#remaining').textContent = n ? `${fmt(n)} names to go` : 'No unseen names match these filters. Try widening them.';
  $('#btn-start').disabled = n === 0 && state.priority.length === 0;
  $('#irish-count').textContent = `(${fmt(candidates({ ...state.settings, irish: true }).length)} names)`;
}

function setSetting(patch) {
  Object.assign(state.settings, patch);
  document.body.dataset.sex = state.settings.sex;
  state.queue.pos = 0;
  persist();
  if (!SEXES.every((s) => data[s])) { updateRemaining(); return; }
  buildQueue();
  renderWelcome();
}

function initLetters() {
  const box = $('#letters');
  for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    box.append(h('button', {
      type: 'button', class: 'chip', 'aria-pressed': 'false',
      onclick: () => {
        const set = new Set(state.settings.letters);
        set.has(L) ? set.delete(L) : set.add(L);
        setSetting({ letters: [...set].sort() });
      },
    }, L));
  }
  $('#letters-clear').addEventListener('click', () => setSetting({ letters: [] }));
}

export function initWelcome() {
  initLetters();
  $$('input[name=sex]').forEach((i) => i.addEventListener('change', () => setSetting({ sex: i.value })));
  $$('input[name=pop]').forEach((i) => i.addEventListener('change', () => setSetting({ pop: i.value })));
  $('#f-irish').addEventListener('change', (e) => setSetting({ irish: e.target.checked }));
  $('#btn-start').addEventListener('click', () => show('swipe'));
  $('#btn-continue').addEventListener('click', () => show('swipe'));
}

screens.welcome = { early: true, enter: renderWelcome };
