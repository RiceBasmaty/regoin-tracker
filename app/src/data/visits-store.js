// The visited-cities store: the single source of truth on this device.
// Regions/countries are derived from it (shared/visits.js), never stored.
import { addVisit, removeVisit, toVisit, retagVisits } from '../../../shared/visits.js';

/**
 * @param {object} p
 * @param {object} p.storage   from openStorage() / createMemoryStorage()
 * @param {string} p.dataVersion  current map-data version, e.g. "2026-10"
 * @param {(cityId, name) => Promise<object|null>} [p.findCity]  for re-tagging after a data update
 * @param {BroadcastChannel|null} [p.channel]  keeps other open tabs in sync
 */
export function createVisitsStore({ storage, dataVersion, findCity, channel = null }) {
  let visits = [];
  const listeners = new Set();
  const emit = (change) => { for (const fn of listeners) fn(visits, change); };
  const sorted = (vs) => vs.slice().sort((a, b) => a.addedAt.localeCompare(b.addedAt));

  async function reload(change = { type: 'sync' }) {
    visits = sorted(await storage.getAll());
    emit(change);
  }

  channel?.addEventListener('message', (e) => { if (e.data?.type === 'visits-changed') reload({ type: 'sync' }); });
  const notifyOtherTabs = () => channel?.postMessage({ type: 'visits-changed' });

  return {
    get visits() { return visits; },
    storageKind: storage.kind,

    async init() {
      await reload({ type: 'init' });
      const stored = await storage.getMeta('dataVersion');
      if (stored !== dataVersion && visits.length && findCity) {
        // New boundary data: re-check every saved city's region (never deletes anything).
        const r = await retagVisits(visits, findCity);
        if (r.changed.length) await storage.putMany(r.visits.filter((v) => r.changed.some((c) => c.cityId === v.cityId)));
        await storage.setMeta('dataVersion', dataVersion);
        if (r.changed.length) { await reload({ type: 'retag', changed: r.changed }); notifyOtherTabs(); }
        return r;
      }
      if (stored !== dataVersion) await storage.setMeta('dataVersion', dataVersion);
      return null;
    },

    has: (cityId) => visits.some((v) => v.cityId === cityId),
    get: (cityId) => visits.find((v) => v.cityId === cityId) ?? null,

    /** Add a city from a search suggestion. Already saved -> nothing changes, added=false. */
    async add(suggestion) {
      const visit = toVisit(suggestion);
      const r = addVisit(visits, visit);
      if (!r.added) return { added: false, visit: this.get(visit.cityId) };
      await storage.put(visit);
      visits = sorted(r.visits);
      emit({ type: 'add', visit });
      notifyOtherTabs();
      return { added: true, visit };
    },

    async remove(cityId) {
      const visit = this.get(cityId);
      if (!visit) return null;
      await storage.delete(cityId);
      visits = removeVisit(visits, cityId);
      emit({ type: 'remove', visit });
      notifyOtherTabs();
      return visit;
    },

    /** Put back a removed visit exactly as it was (undo). */
    async restore(visit) {
      if (this.has(visit.cityId)) return;
      await storage.put(visit);
      visits = sorted([...visits, visit]);
      emit({ type: 'add', visit, restored: true });
      notifyOtherTabs();
    },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
