// Retakes the README screenshots from a repeatable demo state, then refreshes the ?v= cache-busting
// tags in README.md (a short hash of each image, so a tag only changes when its picture does).
// Usage: npm run screenshots        (needs Python for the dev server, and `npx playwright install chromium` once)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demoState, STATE_KEY } from '../e2e/helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = (name) => `${root}docs/screenshots/${name}.jpg`;
const PORT = 4174;
const base = `http://127.0.0.1:${PORT}`;

const server = spawn('python', ['scripts/serve.py', String(PORT)], { cwd: root, stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('The dev server did not start');
}

// A page with the demo state, a fixed "random" sequence (so the compare pair is always the same), and Aoife first in the deck.
async function open(browser, { dark = false, desktop = false } = {}) {
  const context = await browser.newContext(desktop
    ? { viewport: { width: 800, height: 800 }, colorScheme: dark ? 'dark' : 'light' }
    : { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const state = demoState({ priority: ['girls:aoife'] });
  delete state.decisions.girls.aoife;                      // so she is still to be decided
  delete state.elo.girls.aoife;
  await context.addInitScript(([key, value]) => {
    let s = 1;
    Math.random = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    localStorage.setItem(key, value);
  }, [STATE_KEY, JSON.stringify(state)]);
  const page = await context.newPage();
  await page.goto(base);
  await page.locator('#btn-start:not([disabled])').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

const shot = async (page, name) => {
  await page.waitForTimeout(500);                         // let any animation settle
  await page.screenshot({ path: out(name), type: 'jpeg', quality: 85 });
  console.log('saved', name);
};

const toSwipe = async (page) => {
  await page.locator('#btn-continue').click();
  await page.locator('#stage .card:not(.peek) .name', { hasText: 'Aoife' }).waitFor();
};

try {
  await waitForServer();
  const browser = await chromium.launch();

  let { context, page } = await open(browser);
  await shot(page, 'welcome');
  await toSwipe(page);
  await shot(page, 'swipe');
  await page.locator('.tab[data-go=rank]').click();
  await page.locator('#screen-rank .pick').first().waitFor();
  await shot(page, 'compare');
  await page.locator('.tab[data-go=list]').click();
  await page.locator('#list li.ranked').first().waitFor();
  await shot(page, 'ranked');
  await context.close();

  ({ context, page } = await open(browser, { dark: true }));
  await toSwipe(page);
  await shot(page, 'swipe-dark');
  await context.close();

  ({ context, page } = await open(browser, { desktop: true }));
  await toSwipe(page);
  await shot(page, 'desktop');
  await context.close();
  await browser.close();

  // Refresh the cache-busting tag on every screenshot link in the README.
  const readmePath = `${root}README.md`;
  let readme = readFileSync(readmePath, 'utf-8');
  let changed = 0;
  readme = readme.replace(/(docs\/screenshots\/([\w-]+)\.jpg)(\?v=\w+)?/g, (all, path, name) => {
    const hash = createHash('sha1').update(readFileSync(out(name))).digest('hex').slice(0, 8);
    const next = `${path}?v=${hash}`;
    if (next !== all) changed++;
    return next;
  });
  writeFileSync(readmePath, readme);
  console.log(`README: ${changed} image tag${changed === 1 ? '' : 's'} updated`);
} finally {
  stop();
}
