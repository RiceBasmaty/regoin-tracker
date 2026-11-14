import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/tokens.css';
import './styles/app.css';
import { readMapTokens } from './map/tokens.js';
import { createRegionMap, webglSupported } from './map/region-map.js';
import { createRegionCard } from './ui/region-card.js';
import { describeRegion } from './ui/region-model.js';
import { createNotices } from './ui/notices.js';
import { createProjectionToggle, savedProjection } from './ui/projection-toggle.js';
import { loadMeta } from './data/meta.js';

const $ = (sel) => document.querySelector(sel);
const notices = createNotices($('#notices'));
const state = { meta: null, visits: [], selected: null };

function fatal(text) {
  $('#map').dataset.state = 'error';
  $('#map').replaceChildren(Object.assign(document.createElement('p'), { className: 'map-fallback', textContent: text }));
}

if (!webglSupported()) {
  fatal('Your browser can’t show the map because WebGL is turned off or not supported. Try an up-to-date Chrome, Safari, Firefox or Edge.');
} else {
  start();
}

function start() {
  const card = createRegionCard($('#region-card'), { onClose: () => { rm.select(null); state.selected = null; card.hide(); } });
  const tooltip = $('#tooltip');
  const projection = savedProjection('globe');

  const rm = createRegionMap({
    container: $('#map'),
    tokens: readMapTokens(),
    projection,
    onSelect(id) {
      state.selected = id;
      if (id == null) return card.hide();
      card.show(describeRegion(id, { ...state.meta, visits: state.visits }));
    },
    onHover(id, point) {
      if (id == null || !state.meta) { tooltip.hidden = true; return; }
      const m = describeRegion(id, state.meta);
      tooltip.textContent = m.placeLine ? `${m.name} · ${m.placeLine}` : m.name;
      tooltip.style.transform = `translate(${point.x + 14}px, ${point.y + 14}px)`;
      tooltip.hidden = false;
    },
    onError({ kind, error }) {
      console.warn('[map]', kind, error);
      if (kind === 'labels') return; // a missing label font range is cosmetic
      if (!navigator.onLine) return showOffline();
      notices.show('tiles', {
        tone: 'danger',
        text: 'Some map data didn’t load.',
        action: { label: 'Try again', onClick: () => { notices.hide('tiles'); rm.retry(); } },
      });
    },
  });

  createProjectionToggle($('#projection-toggle'), { value: projection, onChange: (v) => rm.setProjection(v) });

  // Names and labels are not needed for the first frame: load them right after.
  const fetchMeta = () => loadMeta().then((meta) => {
    state.meta = meta;
    notices.hide('meta');
    rm.setLabels(meta);
    if (state.selected) card.update(describeRegion(state.selected, { ...meta, visits: state.visits }));
  }).catch((err) => {
    console.warn('[meta]', err);
    notices.show('meta', { tone: 'warning', text: 'Region names couldn’t load.', action: { label: 'Try again', onClick: fetchMeta } });
  });
  rm.map.once('load', fetchMeta);

  // Theme follows the device; repaint the map with the matching tokens.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => rm.setTheme(readMapTokens()));

  // Connection status.
  function showOffline() {
    notices.show('offline', { tone: 'warning', text: 'You’re offline. The map will finish loading when you’re back online.' });
  }
  addEventListener('offline', showOffline);
  addEventListener('online', () => {
    notices.hide('offline');
    notices.hide('tiles');
    rm.retry();
    if (!state.meta) fetchMeta();
  });
  if (!navigator.onLine) showOffline();

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && card.open) { rm.select(null); state.selected = null; card.hide(); }
  });

  // For troubleshooting from the browser console: regionTracker.map, regionTracker.state
  window.regionTracker = { map: rm.map, state };
}
