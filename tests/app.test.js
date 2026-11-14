// Unit tests for the map shell's pure modules (no browser needed).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStyle, themedPaint, labelFeatures } from '../app/src/map/style.js';
import { describeRegion } from '../app/src/ui/region-model.js';

const tokens = new Proxy({}, { get: (_, k) => (String(k).endsWith('opacity') ? 0.5 : `#token-${String(k)}`) });

describe('map style', () => {
  const style = buildStyle({ tokens, regionsUrl: 'pmtiles://r', countriesUrl: 'pmtiles://c', glyphs: '/fonts/{fontstack}/{range}.pbf', projection: 'globe' });
  test('every layer uses a source that exists', () => {
    for (const l of style.layers) if (l.source) assert.ok(style.sources[l.source], l.id);
  });
  test('regions are keyed by their id property (feature-state needs it)', () => {
    assert.equal(style.sources.regions.promoteId, 'id');
  });
  test('themed paint covers only real layers, so a theme switch cannot fail', () => {
    const ids = new Set(style.layers.map((l) => l.id));
    for (const id of Object.keys(themedPaint(tokens))) assert.ok(ids.has(id), id);
  });
  test('no colour is hard-coded in the style (all from design tokens)', () => {
    const src = readFileSync(new URL('../app/src/map/style.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
  test('glyph URL keeps its placeholders', () => {
    assert.match(style.glyphs, /\{fontstack\}.*\{range\}/);
  });
  test('labels: one point per place, sized by land area', () => {
    const fc = labelFeatures({ FR: { name: 'France', area: 549239, label: [2, 46], bbox: [0, 0, 1, 1] } });
    assert.deepEqual(fc.features[0].properties, { id: 'FR', name: 'France', size: 549239 });
    assert.deepEqual(fc.features[0].geometry.coordinates, [2, 46]);
  });
});

describe('region card wording', () => {
  const regions = {
    'FR-IDF': { name: 'Île-de-France', cc: 'FR' },
    'SE-AB': { name: 'Stockholm County', local: 'Stockholms län', cc: 'SE' },
    VA: { name: 'Vatican City', cc: 'VA' },
    'PR-X1': { name: 'San Juan', cc: 'PR' },
  };
  const countries = { FR: { name: 'France', un: true }, SE: { name: 'Sweden', un: true }, VA: { name: 'Vatican City', un: false }, PR: { name: 'Puerto Rico', un: false } };
  const v = (cityId, name, regionId, countryIso) => ({ cityId, name, regionId, countryIso, lat: 0, lon: 0, addedAt: 't' });

  test('not visited', () => {
    const m = describeRegion('FR-IDF', { regions, countries });
    assert.equal(m.name, 'Île-de-France');
    assert.equal(m.placeLine, 'France');
    assert.equal(m.status, 'Not visited yet');
    assert.equal(m.visited, false);
    assert.equal(m.isTerritory, false);
  });
  test('visited: count and alphabetical city list', () => {
    const visits = [v('gn:2', 'Versailles', 'FR-IDF', 'FR'), v('gn:1', 'Paris', 'FR-IDF', 'FR'), v('gn:3', 'Lyon', 'FR-ARA', 'FR')];
    const m = describeRegion('FR-IDF', { regions, countries, visits });
    assert.equal(m.status, 'Visited · 2 cities');
    assert.deepEqual(m.cities.map((c) => c.name), ['Paris', 'Versailles']);
    assert.equal(describeRegion('FR-IDF', { regions, countries, visits: visits.slice(1, 2) }).status, 'Visited · 1 city');
  });
  test('local name shown only when it differs', () => {
    assert.equal(describeRegion('SE-AB', { regions, countries }).localName, 'Stockholms län');
    assert.equal(describeRegion('FR-IDF', { regions, countries }).localName, null);
  });
  test('whole-country region does not repeat its name; territories are tagged', () => {
    const va = describeRegion('VA', { regions, countries });
    assert.equal(va.placeLine, null);
    assert.equal(va.isTerritory, true);
    assert.equal(describeRegion('PR-X1', { regions, countries }).isTerritory, true);
  });
  test('works before names have loaded (falls back to codes, never crashes)', () => {
    const m = describeRegion('FR-IDF', {});
    assert.equal(m.name, 'FR-IDF');
    assert.equal(m.loading, true);
  });
});
