// The map: tiles, hover, click-to-select, theme and projection switching.
// Everything the rest of the app needs goes through the small API returned here.
import { Map as MapLibreMap, AttributionControl, NavigationControl, addProtocol, setWorkerUrl } from 'maplibre-gl';
// MapLibre 6 finds its worker relative to its own file at runtime, which a bundler cannot see;
// importing it with ?url makes Vite ship the file (hashed, cacheable) and gives us its address.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';
import { buildStyle, themedPaint, sky, labelFeatures, LABEL_LAYERS, PLACE_LAYERS } from './style.js';
import { ATTRIBUTION, GLYPHS_URL, INITIAL_CENTER, initialZoom, dataUrl, DATA_VERSION } from '../config.js';

const REGION = { source: 'regions', sourceLayer: 'regions' };
const COUNTRY = { source: 'countries', sourceLayer: 'countries' };
const PLACE = { source: 'places', sourceLayer: 'places' };
const CITY_LAYERS = ['city-dots', 'places-dots'];   // visited first: it wins when both are under the finger
const placeId = (cityId) => Number(String(cityId).replace(/^gn:/, ''));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let protocolAdded = false;

export function webglSupported() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export function createRegionMap({ container, tokens, projection, showPlaces = true, showLabels = true, onSelect, onCityClick, onHover, onError }) {
  if (!protocolAdded) {
    setWorkerUrl(new URL(workerUrl, location.href).href);
    // metadata:false - the attribution is shown once by our own AttributionControl text.
    addProtocol('pmtiles', new Protocol({ metadata: false }).tile);
    protocolAdded = true;
  }
  const urls = {
    regions: `pmtiles://${new URL(dataUrl(`regions.v${DATA_VERSION}.pmtiles`), location.href).href}`,
    countries: `pmtiles://${new URL(dataUrl(`countries.v${DATA_VERSION}.pmtiles`), location.href).href}`,
    places: `pmtiles://${new URL(dataUrl(`places.v${DATA_VERSION}.pmtiles`), location.href).href}`,
    water: `pmtiles://${new URL(dataUrl(`water.v${DATA_VERSION}.pmtiles`), location.href).href}`,
  };
  const map = new MapLibreMap({
    container,
    style: buildStyle({ tokens, regionsUrl: urls.regions, countriesUrl: urls.countries, placesUrl: urls.places,
                        waterUrl: urls.water, glyphs: GLYPHS_URL, projection, showPlaces, showLabels }),
    center: INITIAL_CENTER,
    zoom: initialZoom(container.clientWidth, container.clientHeight),
    minZoom: 0.5,
    maxZoom: 12,
    dragRotate: false,          // a calm, north-up map; rotation adds confusion without value here
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: false,
    localIdeographFontFamily: "'Noto Sans CJK SC', 'Hiragino Sans', 'Microsoft YaHei', sans-serif",
  });
  map.touchZoomRotate.disableRotation();
  const nav = new NavigationControl({ showCompass: false });
  map.addControl(nav, 'bottom-right');
  nav._container?.classList.add('zoom-control');
  map.addControl(new AttributionControl({ compact: false, customAttribution: ATTRIBUTION }), 'bottom-left');

  const canvas = map.getCanvas();
  canvas.setAttribute('aria-label', 'World map of regions. Arrow keys pan, plus and minus zoom.');
  container.dataset.state = 'loading';
  // Performance marks (visible in DevTools > Performance, and used by the e2e speed check).
  map.once('load', () => { container.dataset.state = 'loaded'; performance.mark('rt:map-loaded'); });
  map.once('idle', () => { container.dataset.state = 'ready'; performance.mark('rt:map-ready'); });

  // ---- hover ----
  let hovered = null;
  const setHover = (id) => {
    if (id === hovered) return;
    if (hovered != null) map.setFeatureState({ ...REGION, id: hovered }, { hover: false });
    hovered = id;
    if (id != null) map.setFeatureState({ ...REGION, id }, { hover: true });
  };
  map.on('mousemove', 'regions-fill', (e) => {
    const id = e.features?.[0]?.id ?? null;
    setHover(id);
    canvas.style.cursor = id != null ? 'pointer' : '';
    onHover?.(id, e.point);
  });
  map.on('mouseleave', 'regions-fill', () => {
    setHover(null);
    canvas.style.cursor = '';
    onHover?.(null);
  });

  // ---- selection ----
  let selected = null;
  function select(id) {
    if (selected != null) map.setFeatureState({ ...REGION, id: selected }, { selected: false });
    selected = id;
    if (id != null) map.setFeatureState({ ...REGION, id }, { selected: true });
  }
  // A city dot under the pointer (with a finger-sized margin) wins over the region around it.
  function cityAt(point) {
    const pad = 8;
    const box = [[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]];
    const layers = CITY_LAYERS.filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none');
    const hits = map.queryRenderedFeatures(box, { layers });
    if (!hits.length) return null;
    const dist = (f) => { const p = map.project(f.geometry.coordinates); return (p.x - point.x) ** 2 + (p.y - point.y) ** 2; };
    const best = hits.sort((a, b) => (a.layer.id === 'city-dots' ? -1 : 0) - (b.layer.id === 'city-dots' ? -1 : 0) || dist(a) - dist(b))[0];
    const p = best.properties;
    const [lon, lat] = best.geometry.coordinates;
    return { cityId: typeof p.id === 'string' && p.id.startsWith('gn:') ? p.id : `gn:${p.id}`, name: p.name,
             regionId: p.rid ?? p.regionId, lon, lat };
  }
  map.on('mousemove', (e) => { if (cityAt(e.point)) canvas.style.cursor = 'pointer'; });

  map.on('click', (e) => {
    const city = cityAt(e.point);
    if (city && onCityClick) { onCityClick(city); return; }
    const f = map.queryRenderedFeatures(e.point, { layers: ['regions-fill'] })[0];
    const id = f?.id ?? null;
    select(id);
    onSelect?.(id, e.lngLat);
  });

  // ---- errors: tell the app, which shows a polite message ----
  map.on('error', (e) => {
    // Cancelled requests are normal while the view moves; they are not failures.
    if (e.error?.name === 'AbortError' || /abort/i.test(e.error?.message ?? '')) return;
    const kind = e.sourceId ? 'tiles' : (e.error?.message?.includes('glyphs') ? 'labels' : 'map');
    onError?.({ kind, error: e.error });
  });

  // Visited regions/countries are feature-state (no re-styling). Calls made before the
  // style has loaded are remembered and applied on 'load'.
  const visitedState = new Map([[REGION, new Set()], [COUNTRY, new Set()], [PLACE, new Set()]]);
  // Our own "ready" flag: map.isStyleLoaded() is briefly false while tiles load (e.g. mid-flight),
  // which must not divert updates into a queue that is only drained once.
  let styleReady = false;
  let pending = null;
  function applyVisited(target, ids) {
    const prev = visitedState.get(target);
    const next = new Set(ids);
    for (const id of prev) if (!next.has(id)) map.setFeatureState({ ...target, id }, { visited: false });
    for (const id of next) if (!prev.has(id)) map.setFeatureState({ ...target, id }, { visited: true });
    visitedState.set(target, next);
  }
  function setVisited({ regions, countries, cities }) {
    if (!styleReady) { pending = { regions, countries, cities }; return; }
    applyVisited(REGION, regions);
    applyVisited(COUNTRY, countries);
    applyVisited(PLACE, cities.map((v) => placeId(v.cityId)));
    map.getSource('visited-cities')?.setData({
      type: 'FeatureCollection',
      features: cities.map((v) => ({ type: 'Feature', properties: { id: v.cityId, name: v.name, regionId: v.regionId },
                                     geometry: { type: 'Point', coordinates: [v.lon, v.lat] } })),
    });
  }
  map.once('load', () => { styleReady = true; if (pending) { const p = pending; pending = null; setVisited(p); } });

  return {
    map,
    select,
    setVisited,
    setProjection(type) { map.setProjection({ type }); },
    addControl(control, position = 'bottom-right') { map.addControl(control, position); },
    /** Map display switches: other cities' dots (your visited cities always stay) and all names. */
    setDisplay({ places, labels }) {
      const set = (l, on) => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none');
      for (const l of LABEL_LAYERS) set(l, labels);
      for (const l of PLACE_LAYERS) set(l, places && (l === 'places-dots' || labels));
    },
    /** Fly to a city: close enough to see its region, never zooming out if already closer. */
    flyTo({ lon, lat }) {
      const zoom = Math.max(map.getZoom(), 5.5);
      if (reducedMotion()) map.jumpTo({ center: [lon, lat], zoom });
      else map.flyTo({ center: [lon, lat], zoom, speed: 1.4, curve: 1.5, essential: false });
    },
    setTheme(t) {
      for (const [layer, props] of Object.entries(themedPaint(t))) {
        for (const [k, v] of Object.entries(props)) map.setPaintProperty(layer, k, v);
      }
      map.setSky(sky(t));
    },
    setLabels({ regions, countries }) {
      map.getSource('country-labels')?.setData(labelFeatures(countries));
      map.getSource('region-labels')?.setData(labelFeatures(regions));
    },
    /** Re-request map data after an error or when the connection comes back. */
    retry() {
      for (const id of ['regions', 'countries', 'places', 'water']) map.getSource(id)?.setUrl(urls[id]);
    },
  };
}
