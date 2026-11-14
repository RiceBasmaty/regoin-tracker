// Speed report: first map frame on an emulated mid-range phone (`npm run perf`).
// Budget (CLAUDE.md): < 2 s on 4G. Reported, not enforced, until Phase 4 (DECISIONS D31):
// "4x slower CPU" is relative to the machine running the test, and headless Chromium draws
// with software graphics, so results move with the build machine's load.
import { createRequire } from 'node:module';
import { build, preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const RUNS = Number(process.env.RUNS ?? 5);
const PROFILES = {
  'typical 4G (9 Mbit/s, 60 ms)': { latency: 60, down: 9e6, up: 1.5e6, budget: 2000 },
  'slow 4G, Lighthouse (1.6 Mbit/s, 150 ms)': { latency: 150, down: 1.6e6, up: 750e3, budget: null },
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

await build({ logLevel: 'warn' });
const server = await preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let over = false;
for (const [name, p] of Object.entries(PROFILES)) {
  const runs = [];
  let kb = 0;
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext({ ...devices['Moto G4'] });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.latency, downloadThroughput: p.down / 8, uploadThroughput: p.up / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(url);
    await page.waitForSelector('#map[data-state="ready"]', { timeout: 90_000 });
    const r = await page.evaluate(() => ({
      t: Math.round(performance.getEntriesByName('rt:map-loaded')[0].startTime),
      kb: Math.round(performance.getEntriesByType('resource').reduce((s, x) => s + (x.transferSize || 0), 0) / 1024),
    }));
    runs.push(r.t); kb = r.kb;
    await ctx.close();
  }
  const m = median(runs);
  const verdict = p.budget == null ? 'info' : m < p.budget ? '✔ within budget' : `⚠ over the ${p.budget} ms budget`;
  if (p.budget != null && m >= p.budget) over = true;
  console.log(`${name}: first map frame median ${m} ms (runs ${runs.join(', ')}), ${kb} KB · ${verdict}`);
}
await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(process.env.PERF_STRICT && over ? 1 : 0);
