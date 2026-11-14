// Region/country metadata (names, label points). Loaded after the first map frame.
import { dataUrl, DATA_VERSION } from '../config.js';

async function getJson(url, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

export async function loadMeta() {
  const [regions, countries] = await Promise.all([
    getJson(dataUrl(`regions.v${DATA_VERSION}.json`)),
    getJson(dataUrl(`countries.v${DATA_VERSION}.json`)),
  ]);
  return { regions, countries };
}
