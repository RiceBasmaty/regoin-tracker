import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/tokens.css';
import './styles/app.css';
import { readMapTokens } from './map/tokens.js';
import { createRegionMap, webglSupported } from './map/region-map.js';
import { createRegionCard } from './ui/region-card.js';
import { describeRegion } from './ui/region-model.js';
import { createNotices } from './ui/notices.js';
import { createToast } from './ui/toast.js';
import { createSearchBox } from './ui/search-box.js';
import { createProjectionToggle, savedProjection } from './ui/projection-toggle.js';
import { loadMeta } from './data/meta.js';
import { openStorage } from './data/storage.js';
import { createVisitsStore } from './data/visits-store.js';
import { createSearchIndex } from './data/search-index.js';
import { deriveVisited } from '../../shared/visits.js';
import { dataUrl, DATA_VERSION } from './config.js';

const $ = (sel) => document.querySelector(sel);
const notices = createNotices($('#notices'));
const toast = createToast($('#toast'));
const state = { meta: null, selected: null, store: null };

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
  const visits = () => state.store?.visits ?? [];
  const cardModel = (id) => describeRegion(id, { ...state.meta, visits: visits() });
  const closeCard = () => { rm.select(null); state.selected = null; card.hide(); };
  const card = createRegionCard($('#region-card'), { onClose: closeCard });
  const tooltip = $('#tooltip');
  const projection = savedProjection('globe');

  const rm = createRegionMap({
    container: $('#map'),
    tokens: readMapTokens(),
    projection,
    onSelect(id) {
      state.selected = id;
      if (id == null) return card.hide();
      card.show(cardModel(id));
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
      if (notices.has('no-data')) return;
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

  // ---------- visited cities: the device store is the source of truth ----------
  const index = createSearchIndex();
  function renderVisits() {
    const { regions, countries } = deriveVisited(visits());
    rm.setVisited({ regions: [...regions.keys()], countries: [...countries.keys()], cities: visits() });
    if (state.selected) card.update(cardModel(state.selected));
    search.refresh();
  }

  async function addCity(s) {
    rm.flyTo(s);
    if (!state.store) return;
    try {
      const { added, visit } = await state.store.add(s);
      if (!added) { toast.show(`${s.name} is already on your list`); return; }
      toast.show(`Added ${visit.name}`, {
        label: 'Undo',
        onClick: async () => { await state.store.remove(visit.cityId); toast.show(`Removed ${visit.name}`); },
      });
    } catch (err) {
      console.warn('[store]', err);
      notices.show('save', { tone: 'danger', text: `${s.name} couldn’t be saved on this device. Is the storage full?` });
    }
  }

  const search = createSearchBox($('#search'), {
    index,
    isVisited: (cityId) => state.store?.has(cityId) ?? false,
    onPick: addCity,
  });

  // Opened after the first map frame: saved cities are drawn on top of an already visible map.
  const openStore = () => openStorage().then(async (storage) => {
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('region-tracker') : null;
    const store = createVisitsStore({ storage, dataVersion: DATA_VERSION, findCity: index.findCity, channel });
    state.store = store;
    store.subscribe(renderVisits);
    await store.init().catch((err) => console.warn('[store] re-check after data update failed; will retry next visit', err));
    renderVisits();
    if (storage.kind === 'memory') {
      notices.show('storage', { tone: 'warning', text: 'This browser isn’t saving your cities (private browsing?). They’ll be gone when you close the tab.' });
    }
  }).catch((err) => {
    console.warn('[store]', err);
    notices.show('storage', { tone: 'danger', text: 'Your saved cities couldn’t be opened. Try reloading the page.' });
  });
  rm.map.once('load', openStore);

  // ---------- names and labels: not needed for the first frame ----------
  const fetchMeta = () => loadMeta().then((meta) => {
    state.meta = meta;
    notices.hide('meta');
    rm.setLabels(meta);
    if (state.selected) card.update(cardModel(state.selected));
  }).catch((err) => {
    console.warn('[meta]', err);
    if (notices.has('no-data')) return;
    notices.show('meta', { tone: 'warning', text: 'Region names couldn’t load.', action: { label: 'Try again', onClick: fetchMeta } });
  });
  rm.map.once('load', fetchMeta);

  // Local development: if the data was never built, say exactly how to fix it.
  if (import.meta.env.DEV) {
    fetch(dataUrl('manifest.json'), { method: 'HEAD' }).then((res) => {
      if (res.ok) return;
      notices.hide('tiles');
      notices.hide('meta');
      notices.show('no-data', { tone: 'danger', text: 'Map data isn’t in this project folder yet. The terminal running “npm run dev” shows which folder it’s using. In that folder, run pipeline/run_all.sh (about 20 minutes, once), then reload.' });
    }).catch(() => {});
  }

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
    if (e.key === 'Escape' && card.open) closeCard();
  });

  // For troubleshooting from the browser console: regionTracker.map, regionTracker.state
  window.regionTracker = { map: rm.map, state };
}
