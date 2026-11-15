// What the region card says. Pure function (no DOM), unit-tested in tests/region-model.test.js.
import { deriveVisited } from '../../../shared/visits.js';
import { normalize } from '../../../shared/normalize.js';

export const QUICK_ADD = 8;

/**
 * Cities of a region (from places/<rid>.json, largest first) matching a typed query.
 * Matches the start of the name or of any word in it, ignoring accents and case.
 */
export function filterPlaces(places, query, limit = QUICK_ADD) {
  const q = normalize(query);
  if (!q) return [];
  const out = [];
  for (const p of places) {
    const n = normalize(p.name);
    if (n.startsWith(q) || n.includes(` ${q}`)) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * @param {string} rid region key (e.g. "FR-IDF")
 * @param {{regions?: object, countries?: object, visits?: object[]}} ctx metadata (may still be loading) + visits
 */
export function describeRegion(rid, { regions, countries, visits = [], places = null } = {}) {
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
    // Largest cities of the region not yet visited: one-tap "add" buttons (null while loading).
    quickAdd: places ? places.filter((p) => !cities.some((v) => v.cityId === p.cityId)).slice(0, QUICK_ADD) : null,
    places,
    loading: !r,
  };
}
