// City search over the sharded index produced by pipeline/build_cities.py.
// No DOM, no network code: the caller passes `loadShard(fileName) -> Promise<object>`,
// so the same module runs in the browser, in a Web Worker, and in Node tests.
import { normalize } from './normalize.js';

/** File name of a shard prefix (mirrors shard_name() in build_cities.py). */
export function shardFileName(prefix) {
  if (/^[a-z0-9]+$/.test(prefix)) return `${prefix}.json`;
  const hex = Array.from(new TextEncoder().encode(prefix), (b) => b.toString(16).padStart(2, '0')).join('');
  return `x${hex}.json`;
}

/** Which shard answers query `q` (already normalised). Works on code points, not UTF-16 units. */
export function shardPrefixFor(q, manifest) {
  const chars = Array.from(q);
  const split = manifest._splitSet ?? (manifest._splitSet = new Set(manifest.split));
  let n = 2;
  while (chars.length > n && split.has(chars.slice(0, n).join(''))) n += 1;
  return chars.slice(0, n).join('');
}

function lowerBound(keys, q) {
  let lo = 0, hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid][0] < q) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Rank cities in one shard for query q. Pure function, exported for tests.
 * score = population x exact-match bonus x weight of the kind of name matched (constants from the manifest).
 */
export function rankShard(shard, q, manifest) {
  const { exact: EXACT, weights: WEIGHTS } = manifest.score;
  const best = new Map(); // cityIndex -> {score, key}
  // JS string comparison is by UTF-16 code unit; Python sorts by code point. They only
  // differ for characters outside the BMP, so for safety we scan linearly when q has any.
  const astral = /[\u{10000}-\u{10FFFF}]/u.test(q);
  const start = astral ? 0 : lowerBound(shard.k, q);
  for (let i = start; i < shard.k.length; i++) {
    const entry = shard.k[i];
    const key = entry[0];
    if (!key.startsWith(q)) { if (astral) continue; else break; }
    const [, ci, kind, spelling] = entry;
    const pop = Math.max(shard.c[ci][6], 1);
    const score = pop * (key === q ? EXACT : 1) * WEIGHTS[kind];
    const prev = best.get(ci);
    if (!prev || score > prev.score) best.set(ci, { score, spelling });
  }
  return [...best.entries()]
    .sort((a, b) => b[1].score - a[1].score || shard.c[a[0]][0] - shard.c[b[0]][0])
    .slice(0, manifest.maxSuggestions)
    .map(([ci, m]) => toSuggestion(shard, ci, m.spelling));
}

function toSuggestion(shard, ci, spelling) {
  const [id, name, ri, cc, lat, lon, population] = shard.c[ci];
  const [regionId, regionName] = shard.r[ri];
  // Territories without a real ISO code (XG, XK...) are shown by name, never by code.
  const countryLabel = shard.n?.[cc] ?? cc;
  const place = regionName === countryLabel ? regionName : `${regionName}, ${countryLabel}`;
  return {
    cityId: `gn:${id}`,
    name,
    regionId,
    regionName,
    countryIso: cc,
    lat,
    lon,
    population,
    label: `${name}, ${place}`,
    // The spelling the user matched, when it is not the main name (e.g. "Göteborg" for Gothenburg).
    matchedName: spelling && spelling !== name ? spelling : null,
  };
}

/**
 * createSearch({ manifest, loadShard }) -> { search(query) }
 * Shards are cached in memory (bounded), so repeated keystrokes in the same prefix are instant.
 */
export function createSearch({ manifest, loadShard, cacheSize = 64 }) {
  const cache = new Map(); // prefix -> Promise<shard|null>
  function getShard(prefix) {
    if (cache.has(prefix)) {
      const p = cache.get(prefix);
      cache.delete(prefix); cache.set(prefix, p); // LRU bump
      return p;
    }
    const p = loadShard(shardFileName(prefix)).catch((err) => {
      cache.delete(prefix);               // do not cache failures; let the next keystroke retry
      if (err && err.notFound) return null; // no city starts with these letters
      throw err;
    });
    cache.set(prefix, p);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
    return p;
  }
  return {
    async search(query) {
      const q = normalize(query);
      if (Array.from(q).length < manifest.minChars) return [];
      const shard = await getShard(shardPrefixFor(q, manifest));
      return shard ? rankShard(shard, q, manifest) : [];
    },
  };
}
