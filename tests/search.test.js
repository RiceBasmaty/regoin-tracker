import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { normalize } from '../shared/normalize.js';
import { createSearch, rankShard, shardPrefixFor, shardFileName } from '../shared/search.js';
import { indexBuilt, readJson, loadShardFromDisk, allShards, SEARCH_DIR } from './helpers.js';

describe('normalize', () => {
  const cases = {
    'Île-de-France': 'ile de france', 'Göteborg': 'goteborg', 'GÖTEBORG': 'goteborg', 'Łódź': 'lodz',
    "N'Djamena": 'ndjamena', 'Saint-Étienne': 'saint etienne', 'Straße': 'strasse', 'İstanbul': 'istanbul',
    '  New   York ': 'new york', 'Москва': 'москва', 'São Paulo': 'sao paulo',
  };
  for (const [input, out] of Object.entries(cases)) test(`${input} -> ${out}`, () => assert.equal(normalize(input), out));
  test('non-strings are empty', () => assert.equal(normalize(undefined), ''));
});

describe('ranking (synthetic shard, no data needed)', () => {
  const manifest = { minChars: 2, split: [], maxSuggestions: 8, score: { exact: 20, weights: [1, 0.3, 0.1, 0.2] } };
  // cities: [id, name, regionIndex, cc, lat, lon, pop]
  const shard = {
    p: 'pa',
    r: [['FR-IDF', 'Île-de-France'], ['US-TX', 'Texas']],
    c: [[1, 'Paris', 0, 'FR', 48.85, 2.35, 2_000_000], [2, 'Paris', 1, 'US', 33.66, -95.55, 25_000],
        [3, 'Pamplona', 0, 'ES', 42.8, -1.6, 200_000], [4, 'Palo Alto', 1, 'US', 37.4, -122.1, 60_000]],
    k: [['palo alto', 3, 0], ['pamplona', 2, 0], ['pamplona', 2, 1, 'Pamplona'], ['paris', 0, 0], ['paris', 1, 0], ['paris', 1, 3]].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  };
  test('population decides between same-name cities', () => {
    const r = rankShard(shard, 'paris', manifest);
    assert.deepEqual(r.map((s) => s.label), ['Paris, Île-de-France, FR', 'Paris, Texas, US']);
  });
  test('a city appears once even if several of its names match', () => {
    const r = rankShard(shard, 'pa', manifest);
    assert.equal(new Set(r.map((s) => s.cityId)).size, r.length);
  });
  test('exact name beats a bigger city that only starts with the query', () => {
    const s2 = { ...shard, c: shard.c.map((c) => (c[0] === 3 ? [...c.slice(0, 6), 5_000_000] : c)) };
    // "paris" exact (2M x 20) still beats nothing else; check "pa" prefix order is pure population
    assert.equal(rankShard(s2, 'pa', manifest)[0].name, 'Pamplona');
    assert.equal(rankShard(s2, 'paris', manifest)[0].countryIso, 'FR');
  });
  test('suggestion has everything the app needs to save a visit', () => {
    const [s] = rankShard(shard, 'paris', manifest);
    assert.deepEqual(Object.keys(s).sort(), ['cityId', 'countryIso', 'label', 'lat', 'lon', 'matchedName', 'name', 'population', 'regionId', 'regionName'].sort());
    assert.equal(s.cityId, 'gn:1');
  });
  test('shard routing uses whole characters, not UTF-16 halves', () => {
    const m = { split: ['мо', 'sa', 'san'] };
    assert.equal(shardPrefixFor('москва', m), 'мос');
    assert.equal(shardPrefixFor('san', m), 'san');        // exactly a split prefix -> its head shard
    assert.equal(shardPrefixFor('sant', m), 'sant');
    assert.equal(shardFileName('pa'), 'pa.json');
    assert.equal(shardFileName('мо'), 'xd0bcd0be.json');
  });
});

describe('search over the built index', { skip: !indexBuilt && 'index not built - run pipeline/run_all.sh' }, () => {
  let search, manifest;
  before(async () => {
    manifest = await readJson(join(SEARCH_DIR, 'manifest.json'));
    ({ search } = createSearch({ manifest, loadShard: loadShardFromDisk }));
  });
  const top = async (q) => (await search(q))[0];

  test('nothing before the 2nd character', async () => {
    assert.deepEqual(await search('p'), []);
    assert.deepEqual(await search('P '), []);
    assert.ok((await search('pa')).length > 0);
  });
  test('2-character names are findable (東京 = Tokyo)', async () => {
    assert.equal((await top('東京')).regionId, 'JP-13');
  });
  test('territories without an ISO code are shown by name, not code', async () => {
    const gaza = (await search('gaza')).find((s) => s.countryIso === 'XG');
    assert.ok(gaza, 'a city in the Gaza Strip');
    assert.match(gaza.label, /Gaza Strip$/);
    assert.doesNotMatch(gaza.label, /XG/);
  });
  test('Paris, Île-de-France, FR comes before Paris, Texas, US', async () => {
    const labels = (await search('paris')).map((s) => s.label);
    assert.equal(labels[0], 'Paris, Île-de-France, FR');
    assert.ok(labels.indexOf('Paris, Texas, US') > 0);
  });
  test('same-name cities are distinguishable by region and country', async () => {
    const labels = (await search('paris')).map((s) => s.label);
    assert.equal(new Set(labels).size, labels.length);
  });
  test('accents and case are ignored', async () => {
    assert.equal((await top('goteborg')).regionId, 'SE-O');
    assert.equal((await top('GÖTEBORG')).cityId, (await top('goteborg')).cityId);
    assert.deepEqual(await search('île'), await search('ile'));
    assert.equal(normalize('Île-de-France').startsWith('ile'), true);
  });
  test('alternate and English names match (Moskva / Moscow / Москва)', async () => {
    for (const q of ['moskva', 'moscow', 'Москва']) assert.equal((await top(q)).regionId, 'RU-MOW', q);
    assert.equal((await top('moskva')).matchedName, 'Moskva');
  });
  test('the matched spelling is shown properly, and not at all for the main name', async () => {
    assert.equal((await top('goteborg')).matchedName, 'Göteborg');
    assert.equal((await top('paris')).matchedName, null);
  });
  test('the four reference cities', async () => {
    assert.equal((await top('paris')).regionId, 'FR-IDF');
    assert.equal((await top('stockholm')).regionId, 'SE-AB');
    assert.equal((await top('new york')).regionId, 'US-NY');
    assert.equal((await top('tokyo')).regionId, 'JP-13');
  });
  test('a later word matches ("york" finds New York City)', async () => {
    assert.ok((await search('york')).some((s) => s.name === 'New York City'));
  });
  test('unknown text gives no suggestions (and no error)', async () => {
    assert.deepEqual(await search('qqqxz'), []);
    assert.deepEqual(await search('!!!'), []);
  });
  test('at most maxSuggestions results', async () => {
    assert.ok((await search('san')).length <= manifest.maxSuggestions);
  });
  test('suggestions are fast once a shard is cached (< 100 ms budget)', async () => {
    await search('stockh');
    const t = performance.now();
    for (let i = 0; i < 100; i++) await search('stockho');
    assert.ok((performance.now() - t) / 100 < 5);
  });

  test('head shards give exactly the same top results as the full data', async () => {
    // For every split prefix P (3+ letters) we ship a reduced "head" shard. Rebuild the
    // full candidate list from all deeper shards and check the ranking is identical.
    const shards = await allShards();
    const heads = shards.filter((s) => manifest.split.includes(s.p) && Array.from(s.p).length >= manifest.minChars);
    assert.ok(heads.length > 50);
    for (const head of heads) {
      const merged = { r: [], c: [], k: [] };
      const cIdx = new Map(), rIdx = new Map(), seen = new Set();
      for (const s of shards) {
        if (!s.p.startsWith(head.p)) continue;
        for (const [key, ci, kind, sp] of s.k) {
          const c = s.c[ci];
          const dedupe = `${key}|${c[0]}|${kind}`;
          if (seen.has(dedupe)) continue;
          seen.add(dedupe);
          const [rid, rname] = s.r[c[2]];
          if (!rIdx.has(rid)) { rIdx.set(rid, merged.r.length); merged.r.push([rid, rname]); }
          if (!cIdx.has(c[0])) { cIdx.set(c[0], merged.c.length); merged.c.push([c[0], c[1], rIdx.get(rid), ...c.slice(3)]); }
          merged.k.push(sp ? [key, cIdx.get(c[0]), kind, sp] : [key, cIdx.get(c[0]), kind]);
        }
      }
      merged.k.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const ids = (s) => rankShard(s, head.p, manifest).map((x) => x.cityId);
      assert.deepEqual(ids(head), ids(merged), `head shard "${head.p}" differs`);
    }
  });
});
