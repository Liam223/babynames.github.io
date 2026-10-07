// Renders docs/social-preview.png (1280x640, GitHub's social preview size) from the app's logo, font and screenshots.
// Usage: npm run social-preview   (run `npm run screenshots` first if the screenshots are out of date)
// Then upload it in the repository's Settings -> General -> Social preview.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const b64 = (p) => readFileSync(`${root}${p}`).toString('base64');
const logo = readFileSync(`${root}icons/logo.svg`, 'utf-8');
const shot = (name) => `data:image/jpeg;base64,${b64(`docs/screenshots/${name}.jpg`)}`;

const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: Fraunces; font-weight: 700; src: url(data:font/woff2;base64,${b64('fonts/fraunces-700-latin.woff2')}) format('woff2'); }
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 640px; overflow: hidden; background: #FAF6EE; font-family: system-ui, "Segoe UI", sans-serif; color: #2D2218; position: relative; }
  .text { position: absolute; left: 80px; top: 80px; width: 500px; height: 480px; display: flex; flex-direction: column; justify-content: center; }
  .logo svg { width: 96px; height: 96px; display: block; }
  h1 { font: 700 74px/1 Fraunces, Georgia, serif; margin: 26px 0 18px; letter-spacing: -1px; }
  p { font-size: 30px; line-height: 1.3; color: #6B5842; }
  .chips { display: flex; gap: 10px; margin-top: 28px; }
  .chips span { font-weight: 700; font-size: 20px; padding: 8px 16px; border-radius: 999px; border: 3px solid; background: #fff; }
  .c1 { border-color: #2F6DB5; } .c2 { border-color: #E8799F; } .c3 { border-color: #36834A; }
  .phone { position: absolute; width: 180px; height: 390px; border: 6px solid #2D2218; border-radius: 30px; overflow: hidden; background: #fff; box-shadow: 0 14px 28px rgba(40, 30, 15, .28); }
  .phone img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
  .p1 { left: 612px; top: 140px; transform: rotate(-3deg); }
  .p2 { left: 812px; top: 100px; z-index: 2; }
  .p3 { left: 1012px; top: 140px; transform: rotate(3deg); }
</style>
<div class="text">
  <div class="logo">${logo}</div>
  <h1>Nameblocks</h1>
  <p>Swipe through UK and Irish baby names, then rank your favourites head to head.</p>
  <div class="chips"><span class="c1">Free</span><span class="c2">Private</span><span class="c3">No sign-up</span></div>
</div>
<div class="phone p1"><img src="${shot('welcome')}"></div>
<div class="phone p2"><img src="${shot('swipe')}"></div>
<div class="phone p3"><img src="${shot('compare')}"></div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${root}docs/social-preview.png`, type: 'png' });
await browser.close();
console.log('saved docs/social-preview.png');
