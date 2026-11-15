// Every indexed city of one region (largest first), loaded on demand when its card opens.
import { dataUrl } from '../config.js';

const cache = new Map();

export function loadRegionPlaces(rid) {
  if (!cache.has(rid)) {
    const p = fetch(dataUrl(`places/${encodeURIComponent(rid)}.json`))
      .then((res) => {
        if (res.status === 404) return [];          // a region with no indexed cities
        if (!res.ok) throw new Error(`${res.status} for places/${rid}.json`);
        return res.json().then((d) => d.c.map(([id, name, lat, lon, pop]) => ({
          cityId: `gn:${id}`, name, lat, lon, population: pop, regionId: rid,
        })));
      })
      .catch((err) => { cache.delete(rid); throw err; });   // don't cache failures
    cache.set(rid, p);
    if (cache.size > 50) cache.delete(cache.keys().next().value);
  }
  return cache.get(rid);
}
