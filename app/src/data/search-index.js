// Connects the shared search module to the published shards (fetched on demand, cached).
import { createSearch, createCityLookup } from '../../../shared/search.js';
import { dataUrl } from '../config.js';

async function fetchJson(url, { retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url).catch((err) => { if (attempt >= retries) throw err; return null; });
    if (res) {
      if (res.status === 404) { const e = new Error(`Not found: ${url}`); e.notFound = true; throw e; }
      if (res.ok) return res.json();
      if (attempt >= retries) throw new Error(`${res.status} for ${url}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

export function createSearchIndex() {
  let manifestPromise = null;
  const manifest = () => {
    manifestPromise ??= fetchJson(dataUrl('search/manifest.json'), { retries: 2 }).catch((e) => { manifestPromise = null; throw e; });
    return manifestPromise;
  };
  const loadShard = (file) => fetchJson(dataUrl(`search/${file}`));
  let searcher = null;
  let finder = null;
  return {
    /** Start loading the manifest early (e.g. when the search box gets focus). */
    warm: () => manifest().catch(() => {}),
    async search(query) {
      searcher ??= createSearch({ manifest: await manifest(), loadShard });
      return searcher.search(query);
    },
    async findCity(cityId, name) {
      finder ??= createCityLookup({ manifest: await manifest(), loadShard });
      return finder(cityId, name);
    },
    async minChars() { return (await manifest()).minChars; },
  };
}
