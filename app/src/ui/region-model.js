// What the region card says. Pure function (no DOM), unit-tested in tests/region-model.test.js.
import { deriveVisited } from '../../../shared/visits.js';

/**
 * @param {string} rid region key (e.g. "FR-IDF")
 * @param {{regions?: object, countries?: object, visits?: object[]}} ctx metadata (may still be loading) + visits
 */
export function describeRegion(rid, { regions, countries, visits = [] } = {}) {
  const r = regions?.[rid];
  const cc = r?.cc ?? rid.split('-')[0];
  const c = countries?.[cc];
  const countryName = c?.name ?? cc;
  const name = r?.name ?? (rid === cc ? countryName : rid);
  const cities = (deriveVisited(visits).regions.get(rid) ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const n = cities.length;
  return {
    id: rid,
    name,
    localName: r?.local && r.local !== name ? r.local : null,
    // A whole-country region (Vatican City, Gibraltar...) would repeat its own name.
    placeLine: countryName === name ? null : countryName,
    countryIso: cc,
    isTerritory: c ? c.un === false : false,
    visited: n > 0,
    status: n === 0 ? 'Not visited yet' : `Visited · ${n} ${n === 1 ? 'city' : 'cities'}`,
    cities: cities.map((v) => ({ cityId: v.cityId, name: v.name })),
    loading: !r,
  };
}
