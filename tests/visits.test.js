import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { addVisit, removeVisit, deriveVisited, stats, toVisit } from '../shared/visits.js';

const paris = toVisit({ cityId: 'gn:2988507', name: 'Paris', lat: 48.85, lon: 2.35, countryIso: 'FR', regionId: 'FR-IDF' }, '2026-11-14T00:00:00Z');
const versailles = toVisit({ cityId: 'gn:2970153', name: 'Versailles', lat: 48.8, lon: 2.13, countryIso: 'FR', regionId: 'FR-IDF' }, '2026-11-14T00:00:01Z');
const lyon = toVisit({ cityId: 'gn:2996944', name: 'Lyon', lat: 45.75, lon: 4.85, countryIso: 'FR', regionId: 'FR-ARA' }, '2026-11-14T00:00:02Z');
const stockholm = toVisit({ cityId: 'gn:2673730', name: 'Stockholm', lat: 59.33, lon: 18.07, countryIso: 'SE', regionId: 'SE-AB' }, '2026-11-14T00:00:03Z');

describe('visits', () => {
  test('stored shape is exactly the city record', () => {
    assert.deepEqual(Object.keys(paris).sort(), ['addedAt', 'cityId', 'countryIso', 'lat', 'lon', 'name', 'regionId']);
  });
  test('adding a city twice never creates a duplicate', () => {
    let { visits, added } = addVisit([], paris);
    assert.equal(added, true);
    const again = addVisit(visits, { ...paris, addedAt: 'later' });
    assert.equal(again.added, false);
    assert.equal(again.visits, visits); // same list object: nothing changed
    assert.equal(again.visits.length, 1);
  });
  test('regions and countries are derived from cities', () => {
    const { regions, countries } = deriveVisited([paris, versailles, lyon, stockholm]);
    assert.deepEqual([...regions.keys()].sort(), ['FR-ARA', 'FR-IDF', 'SE-AB']);
    assert.deepEqual(regions.get('FR-IDF').map((v) => v.name), ['Paris', 'Versailles']);
    assert.deepEqual([...countries.get('FR')].sort(), ['FR-ARA', 'FR-IDF']);
  });
  test('deleting one of two cities keeps the region visited; deleting the last un-highlights it', () => {
    let visits = [paris, versailles, lyon];
    visits = removeVisit(visits, paris.cityId);
    assert.ok(deriveVisited(visits).regions.has('FR-IDF'));
    visits = removeVisit(visits, versailles.cityId);
    assert.ok(!deriveVisited(visits).regions.has('FR-IDF'));
    assert.ok(deriveVisited(visits).countries.has('FR'));
    visits = removeVisit(visits, lyon.cityId);
    assert.equal(deriveVisited(visits).countries.size, 0);
  });
  test('stats: % of regions per country', () => {
    const meta = { FR: { name: 'France', regions: 13 }, SE: { name: 'Sweden', regions: 21 } };
    const s = stats([paris, versailles, lyon, stockholm], meta);
    assert.equal(s.cities, 4);
    assert.equal(s.regions, 3);
    assert.equal(s.countries, 2);
    assert.deepEqual(s.perCountry.map((c) => [c.countryIso, c.visitedRegions, c.totalRegions, c.percent]),
      [['FR', 2, 13, 15.4], ['SE', 1, 21, 4.8]]);
  });
});
