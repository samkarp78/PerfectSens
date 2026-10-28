import type { PaState } from '../core/playalong/state';
import { openDb, PLAYALONG_STORE } from './history';

/** The one saved Play-Along search, kept between tests and nights. IndexedDB's structured clone keeps Infinity as is. */
export interface PlayAlongStore {
  load(): Promise<PaState | null>;
  save(s: PaState): Promise<void>;
  clear(): Promise<void>;
}

const KEY = 'current';

const request = <T>(db: IDBDatabase, mode: IDBTransactionMode, op: (st: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(PLAYALONG_STORE, mode);
    const req = op(tx.objectStore(PLAYALONG_STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export async function openPlayAlongStore(): Promise<PlayAlongStore | null> {
  if (typeof globalThis.indexedDB === 'undefined') return null;
  const db = await openDb();
  if (!db) return null;
  return {
    async load() { return ((await request(db, 'readonly', (st) => st.get(KEY))) as PaState | undefined) ?? null; },
    async save(s) { await request(db, 'readwrite', (st) => st.put(s, KEY)); },
    async clear() { await request(db, 'readwrite', (st) => st.delete(KEY)); },
  };
}
