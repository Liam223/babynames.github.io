import { test, expect } from '@playwright/test';
import { openApp, demoState, seed, tab, progress, savedState } from './helpers.js';

// Every test fails if the page throws or logs a console error.
let problems = [];
test.beforeEach(({ page }) => {
  problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
});
test.afterEach(() => { expect(problems).toEqual([]); });

test('a new visitor sees the welcome screen and can start swiping', async ({ page }) => {
  await openApp(page, null);
  await expect(page).toHaveTitle('Nameblocks');
  await expect(page.getByRole('heading', { name: 'Find the name.' })).toBeVisible();
  await expect(page.locator('#continue')).toBeHidden();                 // nothing to resume yet
  await page.locator('#btn-start').click();
  await expect(page.locator('#stage .card:not(.peek) .name')).toBeVisible();
  await expect(page.locator('#progress')).toHaveText('0 seen · 0 liked · 0 loved');
});

test('like, love and no move the counters, and undo takes the last choice back', async ({ page }) => {
  await openApp(page, null);
  await page.locator('#btn-start').click();
  await page.locator('#btn-like').click();
  await expect.poll(() => progress(page)).toEqual({ seen: 1, liked: 1, loved: 0 });
  await page.locator('#btn-love').click();
  await expect.poll(() => progress(page)).toEqual({ seen: 2, liked: 1, loved: 1 });
  await page.locator('#btn-no').click();
  await expect.poll(() => progress(page)).toEqual({ seen: 3, liked: 1, loved: 1 });
  await page.locator('#btn-undo').click();
  await expect.poll(() => progress(page)).toEqual({ seen: 2, liked: 1, loved: 1 });
});

test('keyboard shortcuts: right likes, up loves, left says no, Z undoes', async ({ page }) => {
  await openApp(page, null);
  await page.locator('#btn-start').click();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => progress(page)).toEqual({ seen: 1, liked: 1, loved: 0 });
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => progress(page)).toEqual({ seen: 2, liked: 1, loved: 1 });
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => progress(page)).toEqual({ seen: 3, liked: 1, loved: 1 });
  await page.keyboard.press('z');
  await expect.poll(() => progress(page)).toEqual({ seen: 2, liked: 1, loved: 1 });
});

test('dragging the card sideways decides it, and a short drag springs back', async ({ page }) => {
  await openApp(page, null);
  await page.locator('#btn-start').click();
  const card = page.locator('#stage .card:not(.peek)');
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  const y = box.y + box.height / 2;
  const drag = async (dx) => {
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + (dx * i) / 8, y);
    await page.mouse.up();
  };
  await drag(30);                                                       // too short: nothing happens
  await page.waitForTimeout(400);
  expect(await progress(page)).toEqual({ seen: 0, liked: 0, loved: 0 });
  await drag(220);                                                      // a proper swipe right = like
  await expect.poll(() => progress(page)).toEqual({ seen: 1, liked: 1, loved: 0 });
});

test('tapping the card opens its details, and Back returns to the deck', async ({ page }) => {
  await openApp(page, null);
  await page.locator('#btn-start').click();
  const name = await page.locator('#stage .card:not(.peek) .name').innerText();
  await page.locator('#stage .card:not(.peek)').click();
  await expect(page.locator('#screen-info')).toBeVisible();
  await expect(page.locator('#info-title')).toHaveText(name);
  await page.locator('#info-back').click();
  await expect(page.locator('#screen-swipe')).toBeVisible();
});

test('Compare is locked until there are enough liked names, then unlocks', async ({ page }) => {
  await openApp(page, null);
  await expect(tab(page, 'rank')).toHaveAttribute('aria-disabled', 'true');
  await tab(page, 'rank').click({ force: true });                                        // aria-disabled, but still tappable
  await expect(page.locator('#toast')).toContainText('to start comparing');             // tapping the locked tab says why
  await page.locator('#btn-start').click();
  // Comparing needs four liked names in one pool (boys or girls), so keep liking until it unlocks.
  for (let i = 0; i < 20 && (await tab(page, 'rank').getAttribute('aria-disabled')) === 'true'; i++) {
    await page.locator('#btn-like').click();
    await expect.poll(async () => (await progress(page)).seen).toBe(i + 1);
  }
  await expect(tab(page, 'rank')).not.toHaveAttribute('aria-disabled', 'true');
  await tab(page, 'rank').click();
  await expect(page.locator('#screen-rank')).toBeVisible();
});

test('compare: choosing, undoing and switching between boys and girls', async ({ page }) => {
  await openApp(page);
  await tab(page, 'rank').click();
  await expect(page.locator('#rank-progress')).toContainText('5 comparisons');       // the demo state has 5 girls' comparisons
  await expect(page.locator('#screen-rank .pick')).toHaveCount(2);
  await page.locator('#screen-rank .pick').first().click();
  await expect(page.locator('#rank-progress')).toContainText('6 comparisons');
  await page.locator('#rank-undo').click();
  await expect(page.locator('#rank-progress')).toContainText('5 comparisons');
  await page.locator('label:has(input[name=pool][value=boys])').click();
  await expect(page.locator('#rank-progress')).toContainText('boys’ names');
  await page.locator('#rank-skip').click();
  await expect(page.locator('#screen-rank .pick')).toHaveCount(2);
});

test('my list: tabs, search, moving a name between tabs, and the ranked order', async ({ page }) => {
  await openApp(page);
  await tab(page, 'list').click();
  await expect(page.locator('.tabs button[data-tab=ranked]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#list li.ranked').first()).toContainText('Aoife');       // the demo opens on girls; the highest rated is first
  await page.locator('.tabs button[data-tab=like]').click();
  await page.locator('#list-search').fill('freya');
  await expect(page.locator('#list li')).toHaveCount(1);
  await page.locator('#list li .mini.love').click();                                   // move Freya from Liked to Loved
  await expect(page.locator('#list li:not(.none)')).toHaveCount(0);
  await page.locator('.tabs button[data-tab=love]').click();
  await expect(page.locator('#list li')).toHaveCount(1);
  await expect(page.locator('#list li')).toContainText('Freya');
  await page.locator('#list-search').fill('zzzz');
  await expect(page.locator('#list li.none')).toContainText('No names match');
});

test('my list: the boys / girls filter narrows the list', async ({ page }) => {
  await openApp(page);
  await tab(page, 'list').click();
  await page.locator('.tabs button[data-tab=love]').click();
  const all = await page.locator('#list li').count();
  await page.locator('label:has(input[name=listsex][value=girls])').click();
  const girlsOnly = await page.locator('#list li').count();
  expect(girlsOnly).toBeGreaterThan(0);
  expect(girlsOnly).toBeLessThan(all);
  await expect(page.locator('#list li', { hasText: 'Oscar' })).toHaveCount(0);
});

test('details: popularity, a history chart and your choice for a name in the list', async ({ page }) => {
  await openApp(page);
  await tab(page, 'list').click();
  await page.locator('.tabs button[data-tab=love]').click();
  await page.locator('#list-search').fill('niamh');
  await page.locator('#list li .mini.info').click();
  await expect(page.locator('#info-title')).toHaveText('Niamh');
  await expect(page.locator('#screen-info .ichip.choice')).toContainText('Loved');
  await expect(page.locator('#screen-info .ichip.irish')).toBeVisible();
  await expect(page.locator('#info-history .hchart svg')).toBeVisible();              // history loaded
  await expect(page.locator('#info-history .story')).not.toBeEmpty();
  await expect(page.locator('#info-extra')).toContainText('NEEV');                    // pronunciation loaded
  await page.locator('#info-history .crow').nth(1).click();                           // pick a country
  await expect(page.locator('#info-history .crow.on')).toHaveCount(1);
  await page.locator('#info-back').click();
  await expect(page.locator('#list-search')).toHaveValue('niamh');                    // list state is kept
});

test('a unisex name on the details screen can be switched between boys and girls figures', async ({ page }) => {
  await openApp(page);
  await tab(page, 'list').click();
  await page.locator('.tabs button[data-tab=like]').click();
  await page.locator('#list-search').fill('willow');
  await page.locator('#list li .mini.info').click();
  await expect(page.locator('#screen-info .info-sex')).toBeVisible();
  await expect(page.locator('#screen-info .istats')).toContainText('girls’ names');
  await page.locator('label:has(input[name=infosex][value=boys])').click();
  await expect(page.locator('#screen-info .istats')).toContainText('boys’ names');
});

test('choices survive a reload', async ({ page }) => {
  await openApp(page, null);
  await page.locator('#btn-start').click();
  await page.locator('#btn-love').click();
  await expect.poll(() => progress(page)).toMatchObject({ seen: 1 });                  // the choice lands once the card has flown off
  await page.locator('#btn-like').click();
  await expect.poll(() => progress(page)).toMatchObject({ seen: 2 });
  await page.reload();
  await expect(page.locator('#continue')).toBeVisible();
  await expect(page.locator('#rs-seen')).toHaveText('2');
  await expect(page.locator('#rs-love')).toHaveText('1');
});

test('welcome filters change how many names are left', async ({ page }) => {
  await openApp(page, null);
  const count = async () => Number((await page.locator('#remaining').innerText()).replace(/\D/g, ''));
  const all = await count();
  await page.locator('label:has(input[name=sex][value=girls])').click();
  const girls = await count();
  expect(girls).toBeLessThan(all);
  await page.locator('label:has(input[name=pop][value=top100])').click();
  await expect.poll(count).toBeLessThanOrEqual(100);
  await page.locator('#f-irish').check({ force: true });
  await expect.poll(count).toBeLessThan(100);
});

test('settings: export a backup, import it, and reset', async ({ page }) => {
  await openApp(page);
  await tab(page, 'settings').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-export').click()]);
  const text = await (await import('node:fs/promises')).readFile(await download.path(), 'utf-8');
  const backup = JSON.parse(text);
  expect(backup.app).toBe('babynames');
  expect(Object.keys(backup.state.decisions.girls)).toContain('niamh');

  page.on('dialog', (d) => d.accept());
  await page.locator('#btn-reset-all').click();
  await expect(page.locator('#continue')).toBeHidden();                                // back to a blank welcome screen

  await tab(page, 'settings').click();
  await page.locator('#file-import').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('#settings-msg')).toHaveText('Backup restored.');
  const state = await savedState(page);
  expect(state.decisions.girls.niamh).toBe('love');
});

test('importing something that is not a backup shows an error and changes nothing', async ({ page }) => {
  await openApp(page);
  await tab(page, 'settings').click();
  await page.locator('#file-import').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.locator('#settings-msg')).toContainText('Import failed');
  expect((await savedState(page)).decisions.girls.niamh).toBe('love');
});
