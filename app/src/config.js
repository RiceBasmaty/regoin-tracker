// Where the versioned data lives. Dev: served from dist/data by vite.config.js.
// Production (Phase 4): the R2/CDN URL, set at build time with VITE_DATA_BASE_URL.
import versions from '../../data/data-version.json' with { type: 'json' };

export const DATA_VERSION = versions.dataVersion;   // set in data/data-version.json
export const DATA_BASE_URL = (import.meta.env?.VITE_DATA_BASE_URL ?? '/data').replace(/\/$/, '') + `/v${DATA_VERSION}`;
// Built by hand: new URL() would percent-encode the {fontstack}/{range} placeholders MapLibre needs.
export const GLYPHS_URL = `${new URL('.', document.baseURI).href}fonts/{fontstack}/{range}.pbf`;

export const dataUrl = (file) => `${DATA_BASE_URL}/${file}`;

export const ATTRIBUTION = [
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
  '<a href="https://overturemaps.org" target="_blank" rel="noopener">© Overture Maps Foundation</a> (ODbL)',
  '<a href="https://www.geonames.org" target="_blank" rel="noopener">City data © GeoNames</a> (CC BY 4.0)',
].join(' · ');

export const INITIAL_CENTER = [12, 30];

/** Zoom at which the globe fills ~85% of the smaller screen side (globe radius = 512·2^z / 2π px). */
export function initialZoom(width, height) {
  const radius = 0.42 * Math.min(width, height);
  return Math.max(0.5, Math.min(3, Math.log2((radius * 2 * Math.PI) / 512)));
}
