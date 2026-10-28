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
const RAW_STORE = 'raw';
const BY_CREATED = 'createdAt';

export function recordFromSession(s: SessionState, now: Date, id: string): SessionRecord {
  if (!s.result) throw new Error('Session has no result yet');
  if (s.mode === 'fixed') throw new Error('A Play-Along test block is saved with its search, not on its own');
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
        req.result.createObjectStore(RAW_STORE);
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

  const attempt = async (rec: SessionRecord, withRaw: boolean): Promise<void> => {
    const tx = db.transaction([STORE, RAW_STORE], 'readwrite');
    const finished = done(tx);
    finished.catch(() => undefined);
    try {
      const sessions = tx.objectStore(STORE);
      const raw = tx.objectStore(RAW_STORE);
      sessions.put({ ...rec, raw: null });
      if (withRaw && rec.raw !== null) raw.put(rec.raw, rec.id);
      // Newest first by createdAt; drop raw for everything past the keep limit.
      const cursorReq = sessions.index(BY_CREATED).openCursor(null, 'prev');
      let seen = 0;
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur) return;
        seen += 1;
        if (seen > cfg.store.keepRawSessions) raw.delete((cur.value as SessionRecord).id);
        cur.continue();
      };
    } catch (e) {
      try { tx.abort(); } catch { /* already finished */ }
      throw e;
    }
    await finished;
  };

  return {
    async save(rec) {
      try {
        await attempt(rec, true);
      } catch {
        await attempt(rec, false);
      }
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
      const tx = db.transaction([STORE, RAW_STORE], 'readonly');
      const [rec, raw] = await Promise.all([wrap(tx.objectStore(STORE).get(id)), wrap(tx.objectStore(RAW_STORE).get(id))]);
      if (!rec) return null;
      return { ...(rec as SessionRecord), raw: (raw as SessionRecord['raw'] | undefined) ?? null };
    },
  };
}
