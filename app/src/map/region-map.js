// The map: tiles, hover, click-to-select, theme and projection switching.
// Everything the rest of the app needs goes through the small API returned here.
import { Map as MapLibreMap, AttributionControl, NavigationControl, addProtocol, setWorkerUrl } from 'maplibre-gl';
// MapLibre 6 finds its worker relative to its own file at runtime, which a bundler cannot see;
// importing it with ?url makes Vite ship the file (hashed, cacheable) and gives us its address.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';
import { buildStyle, themedPaint, sky, labelFeatures } from './style.js';
import { ATTRIBUTION, GLYPHS_URL, INITIAL_CENTER, initialZoom, dataUrl, DATA_VERSION } from '../config.js';

const REGION = { source: 'regions', sourceLayer: 'regions' };
let protocolAdded = false;

export function webglSupported() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export function createRegionMap({ container, tokens, projection, onSelect, onHover, onError }) {
  if (!protocolAdded) {
    setWorkerUrl(new URL(workerUrl, location.href).href);
    // metadata:false - the attribution is shown once by our own AttributionControl text.
    addProtocol('pmtiles', new Protocol({ metadata: false }).tile);
    protocolAdded = true;
  }
  const urls = {
    regions: `pmtiles://${new URL(dataUrl(`regions.v${DATA_VERSION}.pmtiles`), location.href).href}`,
    countries: `pmtiles://${new URL(dataUrl(`countries.v${DATA_VERSION}.pmtiles`), location.href).href}`,
  };
  const map = new MapLibreMap({
    container,
    style: buildStyle({ tokens, regionsUrl: urls.regions, countriesUrl: urls.countries, glyphs: GLYPHS_URL, projection }),
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
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
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
  map.on('click', (e) => {
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

  // Visited regions (Phase 2 calls this with the derived region ids).
  let visited = new Set();
  function setVisited(ids) {
    const next = new Set(ids);
    for (const id of visited) if (!next.has(id)) map.setFeatureState({ ...REGION, id }, { visited: false });
    for (const id of next) if (!visited.has(id)) map.setFeatureState({ ...REGION, id }, { visited: true });
    visited = next;
  }

  return {
    map,
    select,
    setVisited,
    setProjection(type) { map.setProjection({ type }); },
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
      for (const id of ['regions', 'countries']) map.getSource(id)?.setUrl(urls[id]);
    },
  };
}
