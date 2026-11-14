// Prints suggestions for a few queries against the built index: `npm run demo:search -- paris ile`
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSearch } from '../shared/search.js';

const dir = new URL('../dist/data/v2026-10/search/', import.meta.url).pathname;
const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
const loadShard = async (f) => {
  try { return JSON.parse(await readFile(join(dir, f), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') { e.notFound = true; } throw e; }
};
const { search } = createSearch({ manifest, loadShard });
const queries = process.argv.slice(2).length ? process.argv.slice(2) : ['paris', 'ile', 'goteborg', 'moskva', 'new y'];
for (const q of queries) {
  const t = performance.now();
  const res = await search(q);
  const ms = (performance.now() - t).toFixed(1);
  console.log(`\n"${q}"  (${res.length} suggestions, ${ms} ms incl. file read)`);
  for (const s of res) console.log(`  ${s.label}${s.matchedName ? `   [matched "${s.matchedName}"]` : ''}   ${s.regionId}  pop ${s.population.toLocaleString('en')}`);
}
