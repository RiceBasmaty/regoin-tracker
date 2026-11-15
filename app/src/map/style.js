// Builds the MapLibre style. Pure function: no DOM, no network, so it is unit-tested.
// Colours, fonts and text sizes come only from design tokens (readMapTokens); nothing is hard-coded.
//
// Text hierarchy (D43), by size and weight only. Symbol layers later in the list win label
// collisions, so the order below IS the priority order: country > visited cities > capitals and
// big cities > lakes (orientation) > regions > medium cities, towns, villages > rivers.

const CAPITAL = 1, BIG = 2, MEDIUM = 3, TOWN = 4;   // VILLAGE = 5 (build_places.py)

/** Layers that show text; the "Names" switch hides all of them. */
export const LABEL_LAYERS = ['river-labels', 'places-labels-minor', 'region-labels', 'water-labels',
  'places-labels-major', 'visited-labels', 'country-labels'];
/** Layers of other (not visited) cities; the "City dots" switch hides them. */
export const PLACE_LAYERS = ['places-dots', 'places-labels-minor', 'places-labels-major'];

const font = (t, weight) => [t[`font-${weight}`]];
const byTier = (cap, big, med, town, village) => ['match', ['get', 'tier'], CAPITAL, cap, BIG, big, MEDIUM, med, TOWN, town, village];
const grow = (base, from, to, factor = 1.18) => ['interpolate', ['linear'], ['zoom'], from, base, to, base * factor];

function regionFillColor(t) {
  return ['case',
    ['boolean', ['feature-state', 'selected'], false], t['selected-fill'],
    ['boolean', ['feature-state', 'hover'], false], t['hover-fill'],
    t['visited-fill']];
}
function regionFillOpacity(t) {
  return ['case',
    ['boolean', ['feature-state', 'selected'], false], t['selected-opacity'],
    ['boolean', ['feature-state', 'hover'], false], t['hover-opacity'],
    ['boolean', ['feature-state', 'visited'], false], t['visited-opacity'],
    0];
}
const placeColor = (t) => byTier(t['label-city'], t['label-city'], t['label-city'], t['place-label'], t['place-label']);

/** Paint properties that depend on tokens, keyed by layer id (re-applied on theme change). */
export function themedPaint(t) {
  return {
    background: { 'background-color': t.water },
    'countries-fill': { 'fill-color': t.land },
    'regions-fill': { 'fill-color': regionFillColor(t), 'fill-opacity': regionFillOpacity(t) },
    lakes: { 'fill-color': t.water },
    rivers: { 'line-color': t.river },
    'regions-line': { 'line-color': t['region-line'] },
    'countries-line': { 'line-color': t['country-line'] },
    'regions-selected-line': { 'line-color': t['selected-line'] },
    'countries-visited-line': { 'line-color': t['visited-country-line'],
      'line-opacity': ['case', ['boolean', ['feature-state', 'visited'], false], t['visited-country-opacity'], 0] },
    'places-dots': {
      'circle-color': ['match', ['get', 'tier'], CAPITAL, t.land, t['place-dot']],
      'circle-stroke-color': ['match', ['get', 'tier'], CAPITAL, t['label-strong'], t['place-dot-stroke']],
    },
    'city-dots': { 'circle-color': t['city-dot'], 'circle-stroke-color': t['city-dot-stroke'] },
    'river-labels': { 'text-color': t['water-label'], 'text-halo-color': t.land },
    'water-labels': { 'text-color': t['water-label'], 'text-halo-color': t.water },
    'places-labels-minor': { 'text-color': placeColor(t), 'text-halo-color': t['label-halo'] },
    'region-labels': { 'text-color': t['label-region'], 'text-halo-color': t['label-halo'] },
    'places-labels-major': { 'text-color': placeColor(t), 'text-halo-color': t['label-halo'] },
    'visited-labels': { 'text-color': t['visited-label'], 'text-halo-color': t['label-halo'] },
    'country-labels': { 'text-color': t['label-strong'], 'text-halo-color': t['label-halo'] },
  };
}

export function sky(t) {
  return {
    'sky-color': t.space,
    'horizon-color': t.atmosphere,
    'fog-color': t.atmosphere,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 4, 0.5, 6, 0],
  };
}

function placeLabels(t, id, filter, paint, visibility) {
  return {
    id, type: 'symbol', source: 'places', 'source-layer': 'places', filter,
    layout: {
      visibility,
      'text-field': ['get', 'name'],
      'text-font': byTier(['literal', font(t, 'bold')], ['literal', font(t, 'medium')], ['literal', font(t, 'regular')],
                          ['literal', font(t, 'regular')], ['literal', font(t, 'regular')]),
      'text-size': ['interpolate', ['linear'], ['zoom'],
        3, byTier(t['text-capital'] * 0.9, t['text-big'] * 0.9, t['text-medium'] * 0.9, t['text-town'] * 0.95, t['text-village']),
        10, byTier(t['text-capital'] * 1.15, t['text-big'] * 1.15, t['text-medium'] * 1.1, t['text-town'] * 1.05, t['text-village'] * 1.05)],
      'text-anchor': 'top', 'text-offset': [0, 0.5], 'text-max-width': 8, 'text-optional': true,
      'symbol-sort-key': ['+', ['*', ['get', 'tier'], 100000000], ['-', 0, ['get', 'pop']]],
      'text-padding': 3,
    },
    paint: { ...paint[id], 'text-halo-width': 1.3,
             // a visited city's name is drawn by visited-labels (feature-state cannot be used in filters)
             'text-opacity': ['case', ['boolean', ['feature-state', 'visited'], false], 0, 1] },
  };
}

/**
 * @param {object} p
 * @param {object} p.tokens  result of readMapTokens()
 * @param {string} p.regionsUrl, p.countriesUrl, p.placesUrl, p.waterUrl  pmtiles:// URLs
 * @param {string} p.glyphs   glyphs URL template
 * @param {'globe'|'mercator'} p.projection
 * @param {boolean} p.showPlaces  other cities' dots and names
 * @param {boolean} p.showLabels  all names
 */
export function buildStyle({ tokens: t, regionsUrl, countriesUrl, placesUrl, waterUrl, glyphs, projection = 'globe',
                             showPlaces = true, showLabels = true }) {
  const paint = themedPaint(t);
  const emptyLabels = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  const labels = showLabels ? 'visible' : 'none';
  const placeLabelsVisibility = showLabels && showPlaces ? 'visible' : 'none';
  return {
    version: 8,
    projection: { type: projection },
    sky: sky(t),
    glyphs,
    sources: {
      regions: { type: 'vector', url: regionsUrl, promoteId: 'id' },
      countries: { type: 'vector', url: countriesUrl, promoteId: 'id' },
      // All indexed cities; each appears from a zoom level set by its tier and population (build_places.py).
      places: { type: 'vector', url: placesUrl, promoteId: 'id' },
      // Lakes, major rivers and lake names (Natural Earth, build_water.py).
      water: { type: 'vector', url: waterUrl },
      // Filled from countries/regions JSON after the first frame (labels are not needed to start).
      'country-labels': emptyLabels,
      'region-labels': emptyLabels,
      'visited-cities': emptyLabels,   // the user's cities (dots), set from the visits store
    },
    layers: [
      { id: 'background', type: 'background', paint: paint.background },
      { id: 'countries-fill', type: 'fill', source: 'countries', 'source-layer': 'countries', paint: paint['countries-fill'] },
      { id: 'regions-fill', type: 'fill', source: 'regions', 'source-layer': 'regions', paint: paint['regions-fill'] },
      { id: 'lakes', type: 'fill', source: 'water', 'source-layer': 'lakes', paint: paint.lakes },
      {
        id: 'rivers', type: 'line', source: 'water', 'source-layer': 'rivers',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { ...paint.rivers, 'line-width': ['interpolate', ['linear'], ['zoom'],
          2, ['match', ['get', 'rank'], [0, 1, 2], 0.9, 0.5], 6, ['match', ['get', 'rank'], [0, 1, 2], 1.8, 1.1], 10, 2.4] },
      },
      {
        id: 'regions-line', type: 'line', source: 'regions', 'source-layer': 'regions',
        paint: { ...paint['regions-line'], 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.3, 4, 0.7, 8, 1.2],
                 'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 3, 1] },
      },
      {
        id: 'countries-line', type: 'line', source: 'countries', 'source-layer': 'countries',
        layout: { 'line-join': 'round' },
        paint: { ...paint['countries-line'], 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 4, 1, 8, 1.8] },
      },
      {
        id: 'regions-selected-line', type: 'line', source: 'regions', 'source-layer': 'regions',
        layout: { 'line-join': 'round' },
        paint: { ...paint['regions-selected-line'], 'line-width': 2,
                 'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0] },
      },
      {
        id: 'countries-visited-line', type: 'line', source: 'countries', 'source-layer': 'countries',
        layout: { 'line-join': 'round' },
        paint: { ...paint['countries-visited-line'], 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.2, 4, 2, 8, 2.6] },
      },
      {
        id: 'places-dots', type: 'circle', source: 'places', 'source-layer': 'places',
        layout: { visibility: showPlaces ? 'visible' : 'none', 'circle-sort-key': ['-', 0, ['get', 'tier']] },
        paint: { ...paint['places-dots'],
                 'circle-radius': ['interpolate', ['linear'], ['zoom'],
                   1, byTier(3, 2.4, 2, 1.6, 1.4), 10, byTier(5, 4.2, 3.6, 3, 2.6)],
                 'circle-stroke-width': byTier(1.6, 1, 1, 1, 1),
                 // a visited city is drawn by the city-dots layer instead
                 'circle-opacity': ['case', ['boolean', ['feature-state', 'visited'], false], 0, 1],
                 'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'visited'], false], 0, 1],
                 'circle-pitch-alignment': 'map' },
      },
      {
        id: 'city-dots', type: 'circle', source: 'visited-cities',
        paint: { ...paint['city-dots'], 'circle-stroke-width': 1.5,
                 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.8, 5, 4, 10, 6],
                 'circle-pitch-alignment': 'map' },
      },
      // ---- text, lowest priority first ----
      {
        id: 'river-labels', type: 'symbol', source: 'water', 'source-layer': 'rivers', minzoom: 6,
        layout: { visibility: labels, 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': font(t, 'regular'),
                  'text-size': t['text-water'] * 0.95, 'text-letter-spacing': 0.05, 'symbol-spacing': 400 },
        paint: { ...paint['river-labels'], 'text-halo-width': 1.2 },
      },
      placeLabels(t, 'places-labels-minor', ['>=', ['get', 'tier'], MEDIUM], paint, placeLabelsVisibility),
      {
        id: 'region-labels', type: 'symbol', source: 'region-labels', minzoom: 4.5,
        layout: { visibility: labels, 'text-field': ['get', 'name'], 'text-font': font(t, 'regular'),
                  'text-size': grow(t['text-region'], 4.5, 9, 1.2), 'text-max-width': 8, 'text-letter-spacing': 0.06,
                  'symbol-sort-key': ['-', 0, ['get', 'size']], 'text-padding': 6 },
        paint: { ...paint['region-labels'], 'text-halo-width': 1.4 },
      },
      {
        id: 'water-labels', type: 'symbol', source: 'water', 'source-layer': 'water_labels',
        layout: { visibility: labels, 'text-field': ['get', 'name'], 'text-font': font(t, 'regular'),
                  'text-size': grow(t['text-water'], 4, 9), 'text-max-width': 7, 'text-letter-spacing': 0.04,
                  'symbol-sort-key': ['-', 0, ['get', 'area']] },
        paint: { ...paint['water-labels'], 'text-halo-width': 1 },
      },
      placeLabels(t, 'places-labels-major', ['<=', ['get', 'tier'], BIG], paint, placeLabelsVisibility),
      {
        id: 'visited-labels', type: 'symbol', source: 'visited-cities', minzoom: 5,
        layout: { visibility: labels, 'text-field': ['get', 'name'], 'text-font': font(t, 'medium'),
                  'text-size': grow(t['text-big'], 5, 10), 'text-anchor': 'top', 'text-offset': [0, 0.6], 'text-max-width': 8 },
        paint: { ...paint['visited-labels'], 'text-halo-width': 1.6 },
      },
      {
        id: 'country-labels', type: 'symbol', source: 'country-labels', maxzoom: 6,
        // Big countries first; small ones appear as you zoom in (size = land area in km²).
        filter: ['step', ['zoom'], ['>=', ['get', 'size'], 400000], 2, ['>=', ['get', 'size'], 40000], 3, ['>=', ['get', 'size'], 4000], 4, true],
        layout: { visibility: labels, 'text-field': ['get', 'name'], 'text-font': font(t, 'bold'), 'text-max-width': 7,
                  'text-size': ['interpolate', ['linear'], ['zoom'], 1, t['text-country'] * 0.75, 5, t['text-country'] * 1.15],
                  'symbol-sort-key': ['-', 0, ['get', 'size']], 'text-padding': 6 },
        paint: { ...paint['country-labels'], 'text-halo-width': 1.4,
                 'text-opacity': ['interpolate', ['linear'], ['zoom'], 4.5, 1, 6, 0] },
      },
    ],
  };
}

/** Label points from the metadata JSON; size = land area in km² (bigger places win label collisions). */
export function labelFeatures(meta) {
  const features = [];
  for (const [id, m] of Object.entries(meta)) {
    const size = m.area ?? 0;
    features.push({ type: 'Feature', properties: { id, name: m.name, size },
                    geometry: { type: 'Point', coordinates: m.label } });
  }
  return { type: 'FeatureCollection', features };
}
