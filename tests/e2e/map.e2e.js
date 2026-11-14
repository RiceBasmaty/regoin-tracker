// End-to-end check of the map shell in a real (headless) Chromium.
//   npm run test:e2e            builds the app, serves it with the pipeline data, runs all checks
// Screenshots are written to tests/e2e/screenshots/ (git-ignored) for a visual review.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');   // pre-installed browser; see README
const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const results = [];
async function check(name, fn) {
  const t = Date.now();
  try { await fn(); results.push(['PASS', name, Date.now() - t]); }
  catch (err) { results.push(['FAIL', name, Date.now() - t, err.message.split('\n')[0]]); }
}

await build({ logLevel: 'warn' });
const server = await preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(ctxOptions = {}, { init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...ctxOptions });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return { ctx, page };
}
const ready = (page) => page.waitForSelector('#map[data-state="ready"]', { timeout: 60_000 });
const metaLoaded = (page) => page.waitForFunction(() => window.regionTracker?.state.meta);
const pixelOf = (page, lngLat) => page.evaluate((ll) => {
  const p = window.regionTracker.map.project(ll);
  const r = document.querySelector('#map').getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y };
}, lngLat);
const PARIS = [2.35, 48.86];
const GERMANY = [10.4, 51.1];

// ---------- desktop, light ----------
{
  const { ctx, page } = await open({ colorScheme: 'light' });
  await check('globe renders without errors or notices', async () => {
    await page.goto(url);
    await ready(page);
    assert.equal(await page.$eval('#notices', (n) => n.children.length), 0);
    assert.deepEqual(page.errors, []);
    assert.equal(await page.evaluate(() => window.regionTracker.map.getProjection().type), 'globe');
    await page.screenshot({ path: `${SHOTS}desktop-globe-light.png` });
  });
  await check('attribution is visible (OSM, Overture, GeoNames)', async () => {
    const text = await page.$eval('.maplibregl-ctrl-attrib', (e) => e.innerText);
    for (const s of ['OpenStreetMap', 'Overture', 'GeoNames']) assert.ok(text.includes(s), s);
    assert.ok(await page.isVisible('.maplibregl-ctrl-attrib'));
  });
  await check('hover shows region name and country', async () => {
    await metaLoaded(page);
    const p = await pixelOf(page, GERMANY);
    await page.mouse.move(p.x, p.y);
    await page.waitForSelector('#tooltip:not([hidden])');
    assert.match(await page.textContent('#tooltip'), /· Germany$/);
  });
  await check('clicking Paris opens the card: Île-de-France, France, not visited', async () => {
    await page.evaluate(() => window.regionTracker.map.jumpTo({ center: [2.35, 48.86], zoom: 4 }));
    await page.waitForFunction(() => window.regionTracker.map.loaded());
    const p = await pixelOf(page, PARIS);
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector('#region-card:not([hidden])');
    const card = await page.textContent('#region-card');
    assert.match(card, /Île-de-France/);
    assert.match(card, /France/);
    assert.match(card, /Not visited yet/);
    assert.equal(await page.evaluate(() => window.regionTracker.state.selected), 'FR-IDF');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await page.screenshot({ path: `${SHOTS}desktop-card.png` });
  });
  await check('Esc closes the card and clears the selection', async () => {
    await page.keyboard.press('Escape');
    assert.ok(await page.isHidden('#region-card'));
    const st = await page.evaluate(() => window.regionTracker.map.getFeatureState({ source: 'regions', sourceLayer: 'regions', id: 'FR-IDF' }));
    assert.equal(st.selected, false);
  });
  await check('Map/Globe toggle switches projection and is remembered', async () => {
    await page.click('button[data-value="mercator"]');
    assert.equal(await page.evaluate(() => window.regionTracker.map.getProjection().type), 'mercator');
    assert.equal(await page.getAttribute('button[data-value="mercator"]', 'aria-pressed'), 'true');
    await page.reload();
    await ready(page);
    assert.equal(await page.evaluate(() => window.regionTracker.map.getProjection().type), 'mercator');
    await page.screenshot({ path: `${SHOTS}desktop-flat-light.png` });
  });
  await check('clicking the sea closes the card', async () => {
    await metaLoaded(page);
    const p = await pixelOf(page, PARIS);
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector('#region-card:not([hidden])');
    const sea = await pixelOf(page, [-35, 35]);  // mid-Atlantic
    await page.mouse.click(sea.x, sea.y);
    assert.ok(await page.isHidden('#region-card'));
  });
  await check('keyboard: skip link, Map/Globe toggle and the map are reachable with Tab', async () => {
    await page.reload();
    await ready(page);
    const seen = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      seen.push(await page.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName));
    }
    assert.deepEqual(seen.slice(0, 4), ['Skip to map', 'Map', 'Globe', 'World map of regions. Arrow keys pan, plus and minus zoom.'], seen.join(' | '));
  });
  await ctx.close();
}

// ---------- dark theme ----------
{
  const { ctx, page } = await open({ colorScheme: 'dark' });
  await check('dark theme follows the device', async () => {
    await page.goto(url);
    await ready(page);
    await metaLoaded(page);
    await page.waitForFunction(() => window.regionTracker.map.areTilesLoaded() && !window.regionTracker.map.isMoving());
    await page.waitForTimeout(500);
    const water = await page.evaluate(() => window.regionTracker.map.getPaintProperty('background', 'background-color'));
    assert.equal(water, '#0b131b');
    await page.screenshot({ path: `${SHOTS}desktop-globe-dark.png` });
  });
  await ctx.close();
}

// ---------- phone ----------
{
  const { ctx, page } = await open({ ...devices['Pixel 7'], colorScheme: 'light' });
  await check('phone: globe fits and the card is a bottom sheet', async () => {
    await page.goto(url);
    await ready(page);
    await page.screenshot({ path: `${SHOTS}phone-globe.png` });
    await metaLoaded(page);
    await page.evaluate(() => window.regionTracker.map.jumpTo({ center: [2.35, 48.86], zoom: 4 }));
    await page.waitForFunction(() => window.regionTracker.map.loaded());
    const p = await pixelOf(page, PARIS);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForSelector('#region-card:not([hidden])');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const box = await page.$eval('#region-card', (e) => e.getBoundingClientRect().toJSON());
    const vh = page.viewportSize().height;
    assert.ok(Math.abs(box.bottom - vh) < 2 && box.left === 0, JSON.stringify(box));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
    await page.screenshot({ path: `${SHOTS}phone-card.png` });
  });
  await ctx.close();
}

// ---------- errors ----------
{
  const { ctx, page } = await open();
  await check('map data fails to load -> polite message with "Try again"', async () => {
    await page.route('**/*.pmtiles', (r) => r.abort('failed'));
    await page.goto(url);
    await page.waitForSelector('.notice--danger', { timeout: 30_000 });
    assert.match(await page.textContent('.notice--danger'), /didn’t load/);
    await page.unroute('**/*.pmtiles');
    await page.click('.notice__action');
    await ready(page);
    await page.screenshot({ path: `${SHOTS}error-tiles.png` });
  });
  await ctx.close();
}
{
  const { ctx, page } = await open();
  await check('going offline shows a message; back online hides it', async () => {
    await page.goto(url);
    await ready(page);
    await ctx.setOffline(true);
    await page.waitForSelector('.notice--warning');
    assert.match(await page.textContent('.notice--warning'), /offline/);
    await ctx.setOffline(false);
    await page.waitForSelector('.notice--warning', { state: 'detached' });
  });
  await ctx.close();
}
{
  const noWebGL = () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) { return /webgl/.test(type) ? null : orig.call(this, type, ...a); };
  };
  const { ctx, page } = await open({}, { init: noWebGL });
  await check('no WebGL -> clear explanation instead of a blank page', async () => {
    await page.goto(url);
    await page.waitForSelector('.map-fallback');
    assert.match(await page.textContent('.map-fallback'), /WebGL/);
  });
  await ctx.close();
}

// ---------- speed: mid-range phone on 4G ----------
// Budget (CLAUDE.md): first map frame < 2 s on a mid-range phone on 4G. Our definition (DECISIONS D24):
// "typical 4G" = 9 Mbit/s down, 1.5 up, 60 ms latency, CPU 4x slower than this machine.
// The stricter Lighthouse "slow 4G" (1.6 Mbit/s, 150 ms) is measured and reported, not enforced.
const PROFILES = {
  'typical 4G': { latency: 60, down: 9e6, up: 1.5e6, budget: 2000, runs: 3 },
  'slow 4G (Lighthouse)': { latency: 150, down: 1.6e6, up: 750e3, budget: null, runs: 1 },
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const speed = {};
for (const [name, p] of Object.entries(PROFILES)) {
  await check(`first map frame, mid-range phone, ${name}${p.budget ? ` (median of ${p.runs} < ${p.budget} ms)` : ''}`, async () => {
    const runs = [];
    let kb = 0;
    for (let i = 0; i < p.runs; i++) {
      const { ctx, page } = await open({ ...devices['Moto G4'] });
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.latency, downloadThroughput: p.down / 8, uploadThroughput: p.up / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.goto(url);
      await ready(page);
      const r = await page.evaluate(() => ({
        firstFrame: Math.round(performance.getEntriesByName('rt:map-loaded')[0].startTime),
        kb: Math.round(performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
      }));
      runs.push(r.firstFrame);
      kb = r.kb;
      await ctx.close();
    }
    speed[name] = { firstFrame: median(runs), runs, kb };
    if (p.budget) assert.ok(speed[name].firstFrame < p.budget, `median ${speed[name].firstFrame} ms (runs ${runs.join(', ')})`);
  });
}

await browser.close();
await new Promise((r) => server.httpServer.close(r));

for (const [status, name, ms, err] of results) console.log(`${status === 'PASS' ? '✔' : '✘'} ${name} (${ms} ms)${err ? `\n    ${err}` : ''}`);
for (const [name, v] of Object.entries(speed)) console.log(`Speed, ${name}: first map frame ${v.firstFrame} ms (runs: ${v.runs.join(', ')} ms), ${v.kb} KB transferred`);
console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed · screenshots in tests/e2e/screenshots/`);
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
