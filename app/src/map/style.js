// Builds the MapLibre style. Pure function: no DOM, no network, so it is unit-tested.
// Colours come only from design tokens (readMapTokens); nothing is hard-coded here.

export const FONT = ['Noto Sans Regular'];

/** Region fill: selected > hover > visited > nothing. All via feature-state (no re-styling per click). */
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

/** Paint properties that depend on tokens, keyed by layer id (re-applied on theme change). */
export function themedPaint(t) {
  return {
    background: { 'background-color': t.water },
    'countries-fill': { 'fill-color': t.land },
    'regions-fill': { 'fill-color': regionFillColor(t), 'fill-opacity': regionFillOpacity(t) },
    'regions-line': { 'line-color': t['region-line'] },
    'countries-line': { 'line-color': t['country-line'] },
    'regions-selected-line': { 'line-color': t['selected-line'] },
    'countries-visited-line': { 'line-color': t['visited-country-line'],
      'line-opacity': ['case', ['boolean', ['feature-state', 'visited'], false], t['visited-country-opacity'], 0] },
    'city-dots': { 'circle-color': t['city-dot'], 'circle-stroke-color': t['city-dot-stroke'] },
    'places-dots': { 'circle-color': t['place-dot'], 'circle-stroke-color': t['place-dot-stroke'] },
    'places-labels': { 'text-color': t['place-label'], 'text-halo-color': t['label-halo'] },
    'visited-labels': { 'text-color': t['visited-label'], 'text-halo-color': t['label-halo'] },
    'country-labels': { 'text-color': t['label-strong'], 'text-halo-color': t['label-halo'] },
    'region-labels': { 'text-color': t.label, 'text-halo-color': t['label-halo'] },
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

/**
 * @param {object} p
 * @param {object} p.tokens   result of readMapTokens()
 * @param {string} p.regionsUrl  pmtiles:// URL
 * @param {string} p.countriesUrl pmtiles:// URL
 * @param {string} p.glyphs   glyphs URL template
 * @param {'globe'|'mercator'} p.projection
 */
export function buildStyle({ tokens: t, regionsUrl, countriesUrl, placesUrl, glyphs, projection = 'globe', showPlaces = true }) {
  const placesVisibility = showPlaces ? 'visible' : 'none';
  const paint = themedPaint(t);
  const emptyLabels = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  return {
    version: 8,
    projection: { type: projection },
    sky: sky(t),
    glyphs,
    sources: {
      regions: { type: 'vector', url: regionsUrl, promoteId: 'id' },
      countries: { type: 'vector', url: countriesUrl, promoteId: 'id' },
      // All indexed cities; each appears from a zoom level set by its population (build_places.py).
      places: { type: 'vector', url: placesUrl, promoteId: 'id' },
      // Filled from countries/regions JSON after the first frame (labels are not needed to start).
      'country-labels': emptyLabels,
      'region-labels': emptyLabels,
      'visited-cities': emptyLabels,   // the user's cities (dots), set from the visits store
    },
    layers: [
      { id: 'background', type: 'background', paint: paint.background },
      { id: 'countries-fill', type: 'fill', source: 'countries', 'source-layer': 'countries', paint: paint['countries-fill'] },
      { id: 'regions-fill', type: 'fill', source: 'regions', 'source-layer': 'regions', paint: paint['regions-fill'] },
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
        layout: { visibility: placesVisibility },
        paint: { ...paint['places-dots'], 'circle-stroke-width': 1,
                 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.2, 5, 2.8, 10, 3.8],
                 // a visited city is drawn by the city-dots layer instead
                 'circle-opacity': ['case', ['boolean', ['feature-state', 'visited'], false], 0, 1],
                 'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'visited'], false], 0, 1],
                 'circle-pitch-alignment': 'map' },
      },
      {
        id: 'city-dots', type: 'circle', source: 'visited-cities',
        paint: { ...paint['city-dots'], 'circle-stroke-width': 1.5,
                 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.5, 5, 4, 10, 6],
                 'circle-pitch-alignment': 'map' },
      },
      {
        id: 'places-labels', type: 'symbol', source: 'places', 'source-layer': 'places', minzoom: 5,
        layout: { visibility: placesVisibility, 'text-field': ['get', 'name'], 'text-font': FONT,
                  'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10.5, 10, 12.5], 'text-anchor': 'top',
                  'text-offset': [0, 0.45], 'text-max-width': 8, 'text-optional': true,
                  'symbol-sort-key': ['-', 0, ['get', 'pop']] },
        // a visited city's name is drawn by visited-labels (feature-state cannot be used in filters)
        paint: { ...paint['places-labels'], 'text-halo-width': 1.2,
                 'text-opacity': ['case', ['boolean', ['feature-state', 'visited'], false], 0, 1] },
      },
      {
        id: 'visited-labels', type: 'symbol', source: 'visited-cities', minzoom: 5,
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11.5, 10, 13.5],
                  'text-anchor': 'top', 'text-offset': [0, 0.55], 'text-max-width': 8, 'symbol-sort-key': 0 },
        paint: { ...paint['visited-labels'], 'text-halo-width': 1.6 },
      },
      {
        id: 'region-labels', type: 'symbol', source: 'region-labels', minzoom: 4.5,
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11, 'text-max-width': 8,
                  'symbol-sort-key': ['-', 0, ['get', 'size']], 'text-padding': 4 },
        paint: { ...paint['region-labels'], 'text-halo-width': 1.2 },
      },
      {
        id: 'country-labels', type: 'symbol', source: 'country-labels', maxzoom: 6,
        // Big countries first; small ones appear as you zoom in (size = land area in km²).
        filter: ['step', ['zoom'], ['>=', ['get', 'size'], 400000], 2, ['>=', ['get', 'size'], 40000], 3, ['>=', ['get', 'size'], 4000], 4, true],
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-max-width': 7,
                  'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 4, 13],
                  'symbol-sort-key': ['-', 0, ['get', 'size']], 'text-padding': 6, 'text-letter-spacing': 0.02 },
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
