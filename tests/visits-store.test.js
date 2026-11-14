import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createVisitsStore } from '../app/src/data/visits-store.js';
import { createMemoryStorage } from '../app/src/data/storage.js';
import { retagVisits } from '../shared/visits.js';

const paris = { cityId: 'gn:2988507', name: 'Paris', lat: 48.85, lon: 2.35, countryIso: 'FR', regionId: 'FR-IDF', label: 'x', population: 1 };
const lyon = { cityId: 'gn:2996944', name: 'Lyon', lat: 45.75, lon: 4.85, countryIso: 'FR', regionId: 'FR-ARA' };

describe('visits store', () => {
  test('add saves exactly the city record (data rule 1)', async () => {
    const storage = createMemoryStorage();
    const s = createVisitsStore({ storage, dataVersion: 'v1' });
    await s.init();
    const r = await s.add(paris);
    assert.equal(r.added, true);
    const saved = await storage.getAll();
    assert.deepEqual(Object.keys(saved[0]).sort(), ['addedAt', 'cityId', 'countryIso', 'lat', 'lon', 'name', 'regionId']);
  });
  test('adding an already saved city changes nothing', async () => {
    const storage = createMemoryStorage();
    const s = createVisitsStore({ storage, dataVersion: 'v1' });
    await s.init();
    await s.add(paris);
    const first = s.get(paris.cityId);
    const r = await s.add(paris);
    assert.equal(r.added, false);
    assert.equal(s.visits.length, 1);
    assert.equal(s.get(paris.cityId).addedAt, first.addedAt);
  });
  test('remove + restore (undo) round-trips exactly', async () => {
    const s = createVisitsStore({ storage: createMemoryStorage(), dataVersion: 'v1' });
    await s.init();
    await s.add(paris);
    const removed = await s.remove(paris.cityId);
    assert.equal(s.visits.length, 0);
    await s.restore(removed);
    assert.deepEqual(s.get(paris.cityId), removed);
  });
  test('survives a "reload" (new store over the same storage)', async () => {
    const storage = createMemoryStorage();
    const a = createVisitsStore({ storage, dataVersion: 'v1' });
    await a.init();
    await a.add(paris);
    await a.add(lyon);
    const b = createVisitsStore({ storage, dataVersion: 'v1' });
    await b.init();
    assert.deepEqual(b.visits.map((v) => v.name), ['Paris', 'Lyon']);
  });
  test('listeners hear adds and removes', async () => {
    const s = createVisitsStore({ storage: createMemoryStorage(), dataVersion: 'v1' });
    await s.init();
    const seen = [];
    s.subscribe((_, c) => seen.push(c.type));
    await s.add(paris);
    await s.remove(paris.cityId);
    assert.deepEqual(seen, ['add', 'remove']);
  });
  test('new data version re-tags saved cities whose region changed', async () => {
    const storage = createMemoryStorage([{ ...lyon, regionId: 'FR-OLD', addedAt: 't' }]);
    await storage.setMeta('dataVersion', 'v1');
    const findCity = async (id) => (id === lyon.cityId ? { regionId: 'FR-ARA', countryIso: 'FR' } : null);
    const s = createVisitsStore({ storage, dataVersion: 'v2', findCity });
    const r = await s.init();
    assert.deepEqual(r.changed, [{ cityId: lyon.cityId, from: 'FR-OLD', to: 'FR-ARA' }]);
    assert.equal(s.get(lyon.cityId).regionId, 'FR-ARA');
    assert.equal(await storage.getMeta('dataVersion'), 'v2');
  });
});

test('retag never drops a city missing from the new index', async () => {
  const r = await retagVisits([{ ...paris, addedAt: 't' }], async () => null);
  assert.equal(r.visits.length, 1);
  assert.deepEqual(r.missing, [paris.cityId]);
});
