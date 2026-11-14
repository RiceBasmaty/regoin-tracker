// Visited cities are the only stored truth. Everything else (visited regions,
// countries, percentages) is derived here, on demand, by pure functions.
// No storage or DOM code: Phase 2 wraps these with IndexedDB and the map.

/** The stored shape of a visit (see CLAUDE.md data rule 1). */
export function toVisit(suggestion, addedAt = new Date().toISOString()) {
  const { cityId, name, lat, lon, countryIso, regionId } = suggestion;
  return { cityId, name, lat, lon, countryIso, regionId, addedAt };
}

/** Add a city. Already saved -> list unchanged, `added: false` (the UI just flies to it). */
export function addVisit(visits, visit) {
  if (visits.some((v) => v.cityId === visit.cityId)) return { visits, added: false };
  return { visits: [...visits, visit], added: true };
}

export function removeVisit(visits, cityId) {
  return visits.filter((v) => v.cityId !== cityId);
}

/**
 * Derive visited regions and countries from cities.
 * regions:   Map regionId  -> visits in it
 * countries: Map countryIso -> Set of visited regionIds
 */
export function deriveVisited(visits) {
  const regions = new Map();
  const countries = new Map();
  for (const v of visits) {
    if (!regions.has(v.regionId)) regions.set(v.regionId, []);
    regions.get(v.regionId).push(v);
    if (!countries.has(v.countryIso)) countries.set(v.countryIso, new Set());
    countries.get(v.countryIso).add(v.regionId);
  }
  return { regions, countries };
}

/**
 * Progress per country: visited regions / all regions in that country.
 * countriesMeta = contents of countries.v<VERSION>.json ({CC: {name, regions: <count>, ...}}).
 */
export function stats(visits, countriesMeta) {
  const { regions, countries } = deriveVisited(visits);
  const perCountry = [...countries.entries()]
    .map(([cc, rids]) => {
      const total = countriesMeta[cc]?.regions ?? rids.size;
      return { countryIso: cc, name: countriesMeta[cc]?.name ?? cc, visitedRegions: rids.size, totalRegions: total,
               percent: total ? Math.round((rids.size / total) * 1000) / 10 : 0 };
    })
    .sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));
  return { cities: visits.length, regions: regions.size, countries: countries.size, perCountry };
}
