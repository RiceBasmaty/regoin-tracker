// Reads the --map-* design tokens from CSS so the map uses the same colours as the UI.
export const MAP_TOKENS = [
  'water', 'space', 'atmosphere', 'land', 'region-line', 'country-line',
  'hover-fill', 'hover-opacity', 'selected-fill', 'selected-opacity', 'selected-line',
  'visited-fill', 'visited-opacity', 'visited-country-line', 'visited-country-opacity',
  'city-dot', 'city-dot-stroke', 'place-dot', 'place-dot-stroke', 'place-label', 'visited-label',
  'label', 'label-strong', 'label-halo',
];

export function readMapTokens(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const out = {};
  for (const name of MAP_TOKENS) {
    const v = cs.getPropertyValue(`--map-${name}`).trim();
    if (!v) throw new Error(`Design token --map-${name} is missing (src/styles/tokens.css)`);
    out[name] = name.endsWith('opacity') ? Number(v) : v;
  }
  return out;
}
