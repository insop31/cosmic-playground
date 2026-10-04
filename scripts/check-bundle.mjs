// Fails the build check if the first-load script grows past the budget (gzip).
// The first load is the entry chunk plus every chunk it imports statically.
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BUDGET_KB = 300;
const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="\/?([^"]+\.js)"/g)].map((m) => m[1]);
if (scripts.length === 0) throw new Error('No scripts found in dist/index.html');

let total = 0;
for (const file of new Set(scripts)) {
  const size = gzipSync(readFileSync(join(dist, file))).length / 1024;
  total += size;
  console.log(`${file.padEnd(40)} ${size.toFixed(1)} KB gzip`);
}
const lazy = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js') && !scripts.some((s) => s.endsWith(f)));
console.log(`First-load script: ${total.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB). Loaded later: ${lazy.join(', ')}`);
if (total > BUDGET_KB) {
  console.error(`First-load script is over budget by ${(total - BUDGET_KB).toFixed(1)} KB.`);
  process.exit(1);
}
