import { defaultConfig, type Config } from '../core/config';
import type { AbDecision } from '../core/ab';
import type { SessionResult } from '../core/result';
import type { SessionState } from '../core/session';
import type { SteerDecision } from '../core/steer';
import type { Setup, StepResult } from '../core/types';

export interface SessionRecord {
  id: string; createdAt: string; mode: 'full' | 'quickab'; setup: Setup; result: SessionResult;
  steps: StepResult[]; steerLog: SteerDecision[]; abDecisions: AbDecision[]; raw: SessionState['logs'] | null;
}
export interface SessionSummary { id: string; createdAt: string; mode: 'full' | 'quickab'; setup: Setup; result: SessionResult }
export interface History {
  save(rec: SessionRecord): Promise<void>;
  /** Newest first. */
  list(): Promise<SessionSummary[]>;
  get(id: string): Promise<SessionRecord | null>;
}

const DB_NAME = 'bsf';
const DB_VERSION = 1;
const STORE = 'sessions';
const BY_CREATED = 'createdAt';

export function recordFromSession(s: SessionState, now: Date, id: string): SessionRecord {
  if (!s.result) throw new Error('Session has no result yet');
  return {
    id, createdAt: now.toISOString(), mode: s.mode, setup: s.setup, result: s.result,
    steps: s.steps, steerLog: s.steerLog, abDecisions: s.abDecisions, raw: s.logs,
  };
}

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex(BY_CREATED, 'createdAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function openHistory(cfg: Config = defaultConfig): Promise<History | null> {
  if (typeof globalThis.indexedDB === 'undefined') return null;
  const db = await openDb();
  if (!db) return null;
  return {
    async save(rec) {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(rec);
      // Newest first by createdAt; null `raw` on everything past the keep limit.
      const cursorReq = store.index(BY_CREATED).openCursor(null, 'prev');
      let seen = 0;
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur) return;
        seen += 1;
        if (seen > cfg.store.keepRawSessions && (cur.value as SessionRecord).raw !== null) {
          cur.update({ ...(cur.value as SessionRecord), raw: null });
        }
        cur.continue();
      };
      await done(tx);
    },
    async list() {
      const tx = db.transaction(STORE, 'readonly');
      const out: SessionSummary[] = [];
      const cursorReq = tx.objectStore(STORE).index(BY_CREATED).openCursor(null, 'prev');
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur) return;
        const { id, createdAt, mode, setup, result } = cur.value as SessionRecord;
        out.push({ id, createdAt, mode, setup, result });
        cur.continue();
      };
      await done(tx);
      return out;
    },
    async get(id) {
      const rec = await wrap(db.transaction(STORE, 'readonly').objectStore(STORE).get(id));
      return (rec as SessionRecord | undefined) ?? null;
    },
  };
}
