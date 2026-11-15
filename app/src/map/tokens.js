// Reads the --map-* design tokens from CSS so the map uses the same colours, fonts and text
// sizes as the UI (src/styles/tokens.css is the only place they are defined).
export const MAP_TOKENS = [
  'water', 'space', 'atmosphere', 'land', 'region-line', 'country-line',
  'hover-fill', 'hover-opacity', 'selected-fill', 'selected-opacity', 'selected-line',
  'visited-fill', 'visited-opacity', 'visited-country-line', 'visited-country-opacity',
  'city-dot', 'city-dot-stroke', 'place-dot', 'place-dot-stroke', 'place-label', 'visited-label',
  'label', 'label-strong', 'label-halo', 'label-city', 'label-region', 'river', 'water-label',
  'font-regular', 'font-medium', 'font-bold',
  'text-country', 'text-region', 'text-capital', 'text-big', 'text-medium', 'text-town', 'text-village', 'text-water',
];

export function readMapTokens(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const out = {};
  for (const name of MAP_TOKENS) {
    const v = cs.getPropertyValue(`--map-${name}`).trim().replace(/^["']|["']$/g, '');
    if (!v) throw new Error(`Design token --map-${name} is missing (src/styles/tokens.css)`);
    out[name] = name.endsWith('opacity') || name.startsWith('text-') ? Number(v) : v;
  }
  return out;
}
