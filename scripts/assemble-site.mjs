// Copies just the files the app needs into _site/ (what gets published to GitHub Pages), then checks that every
// file the page, stylesheet and scripts refer to is in there. Used by the deploy job; also runnable locally.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, '_site');
const PUBLISH = ['index.html', 'css', 'js', 'data', 'fonts', 'icons'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const item of PUBLISH) cpSync(join(root, item), join(out, item), { recursive: true });

// Every local reference must resolve inside _site. Data fetched at run time lives in data/, which is copied whole.
const read = (file) => readFileSync(join(out, file), 'utf-8');
const missing = [];
const check = (from, ref) => {
  const target = normalize(join(dirname(from), ref.split(/[?#]/)[0]));
  if (!existsSync(join(out, target))) missing.push(`${from} -> ${ref}`);
  return target;
};

const html = read('index.html');
for (const [, ref] of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) check('index.html', ref);

const css = read('css/styles.css');
for (const [, ref] of css.matchAll(/url\("?(?!data:|%23|#)([^")]+)"?\)/g)) check('css/styles.css', ref);   // not data: images or their #fragment refs

const seen = new Set();
const walk = (file) => {
  if (seen.has(file) || !existsSync(join(out, file))) return;      // a missing file is already reported by check()
  seen.add(file);
  for (const [, ref] of read(file).matchAll(/from '(\.[^']+)'/g)) walk(check(file, ref));
};
walk('js/main.js');

if (missing.length) {
  console.error(`Missing from the published site:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`_site ready: ${PUBLISH.join(', ')} (${seen.size} scripts checked)`);
