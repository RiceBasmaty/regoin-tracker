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
  catch (err) { results.push(['FAIL', name, Date.now() - t, err.message.split('\n').filter(Boolean).slice(0, 6).join('\n    ')]); }
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
const ILE_DE_FRANCE = [[2.9, 48.6], [2.0, 48.45], [3.2, 48.75], [1.8, 49.05], [2.6, 48.35]];
// Click a region where no city dot is under the pointer (a dot opens the city popup instead).
async function clickRegion(page, candidates, { tap = false } = {}) {
  for (const ll of candidates) {
    const c = await page.evaluate((ll) => {
      const m = window.regionTracker.map; const q = m.project(ll); const r = document.querySelector('#map').getBoundingClientRect();
      return { x: r.left + q.x, y: r.top + q.y, hit: m.queryRenderedFeatures([[q.x - 10, q.y - 10], [q.x + 10, q.y + 10]], { layers: ['places-dots', 'city-dots'] }).length };
    }, ll);
    if (!c.hit) { if (tap) await page.touchscreen.tap(c.x, c.y); else await page.mouse.click(c.x, c.y); return; }
  }
  throw new Error('no spot without city dots found');
}
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
  await check('clicking Île-de-France opens the card: Île-de-France, France, not visited', async () => {
    await page.evaluate(() => window.regionTracker.map.jumpTo({ center: [2.35, 48.86], zoom: 6 }));
    await page.waitForFunction(() => window.regionTracker.map.loaded());
    await clickRegion(page, ILE_DE_FRANCE);
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
    await page.evaluate(() => window.regionTracker.map.jumpTo({ center: [-5, 46], zoom: 5 }));
    await page.waitForFunction(() => window.regionTracker.map.loaded());
    await clickRegion(page, ILE_DE_FRANCE);
    await page.waitForSelector('#region-card:not([hidden])');
    const sea = await pixelOf(page, [-9, 46]);   // Bay of Biscay
    await page.mouse.click(sea.x, sea.y);
    assert.ok(await page.isHidden('#region-card'));
  });
  await check('keyboard: skip link, search, Map/Globe toggle are reachable with Tab', async () => {
    await page.reload();
    await ready(page);
    const seen = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      seen.push(await page.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName));
    }
    assert.deepEqual(seen.slice(0, 4), ['Skip to map', 'INPUT', 'Map', 'Globe'], seen.join(' | '));
  });
  await ctx.close();
}

// ---------- Phase 2: add a city ----------
{
  const { ctx, page } = await open({ colorScheme: 'light' });
  const store = () => page.evaluate(() => window.regionTracker.state.store.visits.map((v) => `${v.name}|${v.regionId}`));
  const regionState = (id, source = 'regions') => page.evaluate(([i, s]) => window.regionTracker.map.getFeatureState({ source: s, sourceLayer: s, id: i }), [id, source]);
  const options = () => page.$$eval('.search__option', (els) => els.map((e) => e.innerText.replace(/\n/g, ' | ')));
  const typeQuery = async (q) => {
    await page.fill('#search-input', '');
    await page.type('#search-input', q, { delay: 30 });
    await page.waitForFunction((query) => document.querySelector('#search-results').dataset.query === query
      && !document.querySelector('#search-results').hidden, q);
  };
  await page.goto(url);
  await ready(page);
  await page.waitForFunction(() => window.regionTracker.state.store);

  await check('search: nothing at 1 character, suggestions from the 2nd', async () => {
    await page.fill('#search-input', '');
    await page.type('#search-input', 'p');
    await page.waitForTimeout(300);
    assert.ok(await page.isHidden('#search-results'));
    await page.type('#search-input', 'a');
    await page.waitForSelector('.search__option');
  });
  await check('search: "par" shows "Paris, Île-de-France, FR" first; suggestions < 100 ms', async () => {
    await typeQuery('par');
    assert.equal((await options())[0], 'Paris | Île-de-France, FR');
    const ms = await page.evaluate(() => performance.getEntriesByName('rt:suggest').map((m) => m.duration));
    const median = ms.sort((a, b) => a - b)[Math.floor(ms.length / 2)];
    assert.ok(median < 100, `median ${median.toFixed(1)} ms over ${ms.length} keystrokes`);
    await page.screenshot({ path: `${SHOTS}search-suggestions.png` });
  });
  await check('search: arrow keys move the highlight, Esc closes the list', async () => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    const dbg = await page.evaluate(() => ({ active: document.querySelector('#search-input').getAttribute('aria-activedescendant'),
      focus: document.activeElement?.id, hidden: document.querySelector('#search-results').hidden, query: document.querySelector('#search-results').dataset.query }));
    assert.equal(dbg.active, 'search-opt-0', JSON.stringify(dbg));
    await page.keyboard.press('Escape');
    assert.ok(await page.isHidden('#search-results'));
    assert.equal(await page.inputValue('#search-input'), 'par');
  });
  await check('picking Paris: saved, dot, region filled, country outlined, camera flies there, "Added Paris · Undo"', async () => {
    await typeQuery('par');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#toast:not([hidden])');
    assert.match(await page.textContent('#toast'), /Added Paris\s*Undo/);
    assert.deepEqual(await store(), ['Paris|FR-IDF']);
    assert.equal((await regionState('FR-IDF')).visited, true);
    assert.equal((await regionState('FR', 'countries')).visited, true);
    const dots = await page.evaluate(() => window.regionTracker.map.getSource('visited-cities')._data);
    assert.equal(dots.features?.length ?? dots.geojson?.features?.length, 1);
    await page.waitForFunction(() => !window.regionTracker.map.isMoving(), null, { timeout: 15_000 });
    const c = await page.evaluate(() => window.regionTracker.map.getCenter());
    assert.ok(Math.abs(c.lng - 2.35) < 0.5 && Math.abs(c.lat - 48.86) < 0.5, JSON.stringify(c));
    assert.equal(await page.inputValue('#search-input'), '', 'input cleared, ready for the next city');
    await page.screenshot({ path: `${SHOTS}added-paris.png` });
  });
  await check('adding Paris again does nothing except fly to it; the suggestion says "Visited"', async () => {
    await typeQuery('paris');
    assert.match((await options())[0], /Visited$/);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /already on your list/.test(document.querySelector('#toast').textContent));
    assert.deepEqual(await store(), ['Paris|FR-IDF']);
  });
  await check('Undo removes the city; its region and country un-highlight', async () => {
    await typeQuery('stockholm');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Added Stockholm/.test(document.querySelector('#toast').textContent));
    assert.equal((await regionState('SE-AB')).visited, true);
    await page.click('.toast__action');
    await page.waitForFunction(() => /Removed Stockholm/.test(document.querySelector('#toast').textContent));
    assert.deepEqual(await store(), ['Paris|FR-IDF']);
    assert.equal((await regionState('SE-AB')).visited, false);
    assert.equal((await regionState('SE', 'countries')).visited, false);
  });
  await check('region card lists the visited cities', async () => {
    await metaLoaded(page);
    await page.evaluate(() => window.regionTracker.map.jumpTo({ center: [2.6, 48.7], zoom: 6 }));
    await page.waitForFunction(() => window.regionTracker.map.loaded());
    await clickRegion(page, ILE_DE_FRANCE);
    await page.waitForSelector('#region-card:not([hidden])');
    const text = await page.textContent('#region-card');
    assert.match(text, /Visited · 1 city/);
    assert.match(text, /Paris/);
    await page.keyboard.press('Escape');
  });
  await check('your cities survive a reload', async () => {
    await page.reload();
    await ready(page);
    await page.waitForFunction(() => window.regionTracker.state.store?.visits.length === 1);
    assert.equal((await regionState('FR-IDF')).visited, true);
  });
  await check('a second open tab stays in sync', async () => {
    const other = await ctx.newPage();
    await other.goto(url);
    await other.waitForFunction(() => window.regionTracker?.state.store?.visits.length === 1);
    await typeQuery('goteborg');
    await page.keyboard.press('Enter');
    await other.waitForFunction(() => window.regionTracker.state.store.visits.some((v) => v.regionId === 'SE-O'), null, { timeout: 5000 });
    await other.close();
  });
  await check('territories are shown by name ("Gaza Strip", not "XG")', async () => {
    await typeQuery('gaza');
    const first = (await options())[0];
    assert.match(first, /Gaza Strip/);
    assert.doesNotMatch(first, /\bXG\b/);
    await page.keyboard.press('Escape');
  });
  await check('no matches -> polite message', async () => {
    await typeQuery('qqqxz');
    assert.match(await page.textContent('#search-results'), /No places found for “qqqxz”/);
  });
  await check('search while offline -> polite message, not a crash', async () => {
    await ctx.setOffline(true);
    await typeQuery('zuri');   // a shard not loaded yet
    assert.match(await page.textContent('#search-results'), /offline/);
    await ctx.setOffline(false);
  });
  await ctx.close();
}

// ---------- Phase 3: map-first adding, per-country regions ----------
{
  const { ctx, page } = await open({ colorScheme: 'light' });
  const visits = () => page.evaluate(() => window.regionTracker.state.store.visits.map((v) => `${v.name}|${v.regionId}`));
  const regionVisited = (id) => page.evaluate((i) => window.regionTracker.map.getFeatureState({ source: 'regions', sourceLayer: 'regions', id: i }).visited ?? false, id);
  const OXFORDSHIRE = 'GB-X383397';
  async function viewOxfordshire() {
    await page.evaluate(() => window.regionTracker.map.jumpTo({ center: [-1.3, 51.85], zoom: 7.5 }));
    await page.waitForFunction(() => window.regionTracker.map.loaded() && !window.regionTracker.map.isMoving());
    await page.waitForTimeout(300);
  }
  async function clickRegionAwayFromDots() {
    for (const ll of [[-1.55, 51.95], [-1.45, 51.9], [-1.2, 51.6], [-1.6, 51.7], [-1.0, 51.95]]) {
      const c = await page.evaluate((ll) => {
        const m = window.regionTracker.map; const q = m.project(ll); const r = document.querySelector('#map').getBoundingClientRect();
        return { x: r.left + q.x, y: r.top + q.y, hit: m.queryRenderedFeatures([[q.x - 10, q.y - 10], [q.x + 10, q.y + 10]], { layers: ['places-dots', 'city-dots'] }).length };
      }, ll);
      if (!c.hit) { await page.mouse.click(c.x, c.y); return; }
    }
    throw new Error('no empty spot found');
  }
  await page.goto(url);
  await ready(page);
  await page.waitForFunction(() => window.regionTracker.state.store && window.regionTracker.state.meta);

  await check('UK regions are counties: Oxford is in Oxfordshire', async () => {
    await viewOxfordshire();
    await clickRegionAwayFromDots();
    await page.waitForSelector('#region-card:not([hidden])');
    assert.match(await page.textContent('#region-card .card__title'), /^Oxfordshire$/);
    assert.match(await page.textContent('#region-card .card__eyebrow'), /United Kingdom/);
  });
  await check('region card: one-tap buttons for its largest cities; tapping adds the city', async () => {
    await page.waitForSelector('#region-card .chip');
    const chips = await page.$$eval('#region-card .chip', (e) => e.map((x) => x.textContent.replace('+', '')));
    assert.equal(chips[0], 'Oxford');
    await page.click('#region-card .chip');
    await page.waitForFunction(() => /Visited · 1 city/.test(document.querySelector('#region-card').textContent));
    assert.deepEqual(await visits(), [`Oxford|${OXFORDSHIRE}`]);
    assert.equal(await regionVisited(OXFORDSHIRE), true);
    const chipsAfter = await page.$$eval('#region-card .chip', (e) => e.map((x) => x.textContent.replace('+', '')));
    assert.ok(!chipsAfter.includes('Oxford'), 'a visited city is no longer offered');
  });
  await check('region card: search within the region', async () => {
    await page.fill('#region-card .card__search', 'bic');
    await page.waitForFunction(() => [...document.querySelectorAll('#region-card .card__results .chip')].some((c) => /Bicester/.test(c.textContent)));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Visited · 2 cities/.test(document.querySelector('#region-card').textContent));
    await page.fill('#region-card .card__search', 'zzzz');
    assert.match(await page.textContent('#region-card .card__results'), /No city called “zzzz” in Oxfordshire/);
  });
  await check('region card: ✕ removes a city; removing the last one un-highlights the region', async () => {
    await page.click('#region-card [aria-label="Remove Bicester"]');
    await page.waitForFunction(() => /Visited · 1 city/.test(document.querySelector('#region-card').textContent));
    await page.click('#region-card [aria-label="Remove Oxford"]');
    await page.waitForFunction(() => /Not visited yet/.test(document.querySelector('#region-card').textContent));
    assert.equal(await regionVisited(OXFORDSHIRE), false);
    await page.click('.toast__action');           // Undo
    await page.waitForFunction(() => window.regionTracker.state.store.visits.length === 1);
    assert.equal(await regionVisited(OXFORDSHIRE), true);
    await page.keyboard.press('Escape');
  });
  await check('tap a city on the map: popup with Add; then Visited + Remove', async () => {
    const p = await page.evaluate(() => {           // Bicester's dot, wherever the data puts it
      const m = window.regionTracker.map;
      const f = m.queryRenderedFeatures({ layers: ['places-dots'] }).find((x) => x.properties.name === 'Bicester');
      const q = m.project(f.geometry.coordinates); const r = document.querySelector('#map').getBoundingClientRect();
      return { x: r.left + q.x, y: r.top + q.y };
    });
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector('.city-popup');
    assert.match(await page.textContent('.city-popup'), /Bicester\s*Oxfordshire · United Kingdom/);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Add to my cities');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Visited/.test(document.querySelector('.city-popup')?.textContent ?? ''));
    assert.ok((await visits()).includes(`Bicester|${OXFORDSHIRE}`));
    await page.screenshot({ path: `${SHOTS}city-popup.png` });
    await page.click('.city-popup .button--quiet');            // Remove
    await page.waitForFunction(() => /Add to my cities/.test(document.querySelector('.city-popup')?.textContent ?? ''));
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.city-popup'), null);
  });
  await check('show/hide other cities: hides dots and names, keeps visited dots, remembered', async () => {
    const vis = (l) => page.evaluate((l) => window.regionTracker.map.getLayoutProperty(l, 'visibility') ?? 'visible', l);
    await page.click('.places-toggle__button');
    assert.equal(await vis('places-dots'), 'none');
    assert.equal(await vis('places-labels'), 'none');
    assert.equal(await vis('city-dots'), 'visible');
    assert.equal(await page.getAttribute('.places-toggle__button', 'aria-label'), 'Show other cities on the map');
    await page.reload();
    await ready(page);
    assert.equal(await vis('places-dots'), 'none');
    await page.click('.places-toggle__button');
    assert.equal(await vis('places-dots'), 'visible');
  });
  await check('cities saved under an older data version move to their new region (London: England -> Greater London)', async () => {
    await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('region-tracker', 1);
      open.onsuccess = () => {
        const tx = open.result.transaction(['visits', 'meta'], 'readwrite');
        tx.objectStore('visits').put({ cityId: 'gn:2643743', name: 'London', lat: 51.50853, lon: -0.12574, countryIso: 'GB', regionId: 'GB-ENG', addedAt: '2026-11-14T10:00:00.000Z' });
        tx.objectStore('meta').put('2026-10', 'dataVersion');
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      };
    }));
    await page.reload();
    await ready(page);
    await page.waitForFunction(() => window.regionTracker.state.store?.visits.find((v) => v.name === 'London')?.regionId === 'GB-XF82478', null, { timeout: 20_000 });
    assert.equal(await regionVisited('GB-XF82478'), true);
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
    await page.evaluate(() => window.regionTracker.map.jumpTo({ center: [2.35, 48.86], zoom: 6 }));
    await page.waitForFunction(() => window.regionTracker.map.loaded());
    await clickRegion(page, ILE_DE_FRANCE, { tap: true });
    await page.waitForSelector('#region-card:not([hidden])');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const box = await page.$eval('#region-card', (e) => e.getBoundingClientRect().toJSON());
    const vh = page.viewportSize().height;
    assert.ok(Math.abs(box.bottom - vh) < 2 && box.left === 0, JSON.stringify(box));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
    await page.screenshot({ path: `${SHOTS}phone-card.png` });
  });
  await check('phone: search and add a city', async () => {
    await page.keyboard.press('Escape');
    await page.tap('#search-input');
    await page.type('#search-input', 'tokyo', { delay: 30 });
    await page.waitForSelector('.search__option');
    await page.screenshot({ path: `${SHOTS}phone-search.png` });
    await page.tap('.search__option');
    await page.waitForFunction(() => /Added Tokyo/.test(document.querySelector('#toast').textContent));
    await page.waitForFunction(() => !window.regionTracker.map.isMoving(), null, { timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}phone-added.png` });
    // Nothing in the top bar may be cut off, and the toast must not cover the credits.
    const vw = page.viewportSize().width;
    for (const sel of ['.brand', '#search', '#projection-toggle']) {
      const r = await page.$eval(sel, (e) => e.getBoundingClientRect().toJSON());
      assert.ok(r.left >= 0 && r.right <= vw, `${sel} is cut off: ${JSON.stringify(r)}`);
    }
    const [t, a] = await Promise.all(['#toast', '.maplibregl-ctrl-attrib'].map((sel) => page.$eval(sel, (e) => e.getBoundingClientRect().toJSON())));
    assert.ok(t.bottom <= a.top, `toast overlaps credits: toast ${t.bottom}, credits ${a.top}`);
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

await browser.close();
await new Promise((r) => server.httpServer.close(r));

for (const [status, name, ms, err] of results) console.log(`${status === 'PASS' ? '✔' : '✘'} ${name} (${ms} ms)${err ? `\n    ${err}` : ''}`);
console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed · screenshots in tests/e2e/screenshots/`);
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
