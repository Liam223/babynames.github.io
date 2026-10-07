import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openApp, tab } from './helpers.js';

// Automated accessibility checks (WCAG 2 A and AA) on each screen, in light and dark mode.
// These catch contrast, missing labels and bad structure; they don't replace trying it with a screen reader.
const scan = async (page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    ')}`);
  expect(summary, 'accessibility violations').toEqual([]);
};

const screens = {
  welcome: async () => {},
  swipe: async (page) => { await page.locator('#btn-continue').click(); await expect(page.locator('#stage .card:not(.peek)')).toBeVisible(); },
  compare: async (page) => { await tab(page, 'rank').click(); await expect(page.locator('#screen-rank .pick')).toHaveCount(2); },
  list: async (page) => { await tab(page, 'list').click(); await expect(page.locator('#list li').first()).toBeVisible(); },
  details: async (page) => {
    await tab(page, 'list').click();
    await page.locator('.tabs button[data-tab=love]').click();
    await page.locator('#list-search').fill('niamh');
    await page.locator('#list li .mini.info').click();
    await expect(page.locator('#info-history .hchart svg')).toBeVisible();
    await expect(page.locator('#info-extra')).toContainText('NEEV');
  },
  settings: async (page) => { await tab(page, 'settings').click(); await expect(page.locator('#screen-settings')).toBeVisible(); },
};

for (const scheme of ['light', 'dark']) {
  for (const [name, go] of Object.entries(screens)) {
    test(`${name} screen has no accessibility violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openApp(page);
      await go(page);
      await scan(page);
    });
  }
}
