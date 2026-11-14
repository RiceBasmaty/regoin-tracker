// Device storage for visits. IndexedDB when available; an in-memory fallback otherwise
// (e.g. some private-browsing modes), so the app still works and can say so.
// Schema v1: object store "visits" (key: cityId) and "meta" (key/value, e.g. dataVersion).
const DB_NAME = 'region-tracker';
const DB_VERSION = 1;

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB not available'));
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      // Future schema changes add `if (oldVersion < N)` steps here, never edit old ones.
      if (!db.objectStoreNames.contains('visits')) db.createObjectStore('visits', { keyPath: 'cityId' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('Storage is blocked by another open tab of an older version'));
  });
}

export async function openIndexedDbStorage() {
  const db = await openDb();
  const tx = (store, mode, fn) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('Storage transaction aborted (disk full?)'));
    });
  };
  // Ask the browser not to evict our data under storage pressure (best effort, silent).
  navigator.storage?.persist?.().catch(() => {});
  return {
    kind: 'indexeddb',
    getAll: () => tx('visits', 'readonly', (s) => s.getAll()),
    put: (visit) => tx('visits', 'readwrite', (s) => s.put(visit)),
    putMany: (visits) => tx('visits', 'readwrite', (s) => { for (const v of visits) s.put(v); }),
    delete: (cityId) => tx('visits', 'readwrite', (s) => s.delete(cityId)),
    getMeta: async (key) => req(db.transaction('meta').objectStore('meta').get(key)),
    setMeta: (key, value) => tx('meta', 'readwrite', (s) => s.put(value, key)),
  };
}

export function createMemoryStorage(initial = []) {
  const visits = new Map(initial.map((v) => [v.cityId, v]));
  const meta = new Map();
  return {
    kind: 'memory',
    getAll: async () => [...visits.values()],
    put: async (v) => { visits.set(v.cityId, v); },
    putMany: async (vs) => { for (const v of vs) visits.set(v.cityId, v); },
    delete: async (id) => { visits.delete(id); },
    getMeta: async (k) => meta.get(k),
    setMeta: async (k, v) => { meta.set(k, v); },
  };
}

export async function openStorage() {
  try { return await openIndexedDbStorage(); }
  catch (err) { console.warn('[storage] falling back to memory:', err); return createMemoryStorage(); }
}
