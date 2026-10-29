import { defaultConfig, type Config } from '../core/config';
import type { AbDecision } from '../core/ab';
import type { SessionResult } from '../core/result';
import type { SessionState } from '../core/session';
import type { Setup, StepResult } from '../core/types';
import { gameSensOf } from '../core/playalong/gameSens';
import type { DiscardedTest, PaResult, PaSetup, PaState, PaTest } from '../core/playalong/state';
import type { PairDecision } from '../core/playalong/steer';

export type RecordMode = 'full' | 'quickab' | 'playalong';
/** playAlong: the search's own setup, tests and result (Play-Along records only). */
export interface SessionRecord {
  id: string; createdAt: string; mode: RecordMode; setup: Setup; result: SessionResult;
  steps: StepResult[]; raw: SessionState['logs'] | null;
  playAlong?: { setup: PaSetup; tests: PaTest[]; result: PaResult; nights: { startedAt: number }[]; steerLog: PairDecision[];
    discarded: DiscardedTest[] };
}
export interface SessionSummary { id: string; createdAt: string; mode: RecordMode; setup: Setup; result: SessionResult }
export interface History {
  save(rec: SessionRecord): Promise<void>;
  /** Newest first. */
  list(): Promise<SessionSummary[]>;
  get(id: string): Promise<SessionRecord | null>;
}

const DB_NAME = 'bsf';
const DB_VERSION = 2;
const STORE = 'sessions';
const RAW_STORE = 'raw';
/** The saved, unfinished Play-Along search (added in DB version 2). */
export const PLAYALONG_STORE = 'playalong';
const BY_CREATED = 'createdAt';

const VERDICT_OF = { change: 'change', keep: 'keep', none: 'none', bestGuess: 'none' } as const;

/** A History record for a finished (or best-guess) Play-Along search; raw logs from every test are merged. */
export function recordFromPlayAlong(s: PaState, now: Date, id: string): SessionRecord {
  const r = s.result;
  if (!r) throw new Error('The search has no result yet');
  const { game, dpi, defaultCm360, fov, fovType, padWidthCm } = s.setup;
  const setup: Setup = { dpi, cm360: defaultCm360, inGameSens: gameSensOf(game, defaultCm360, dpi), fov, fovType, mode: 'default', padWidthCm };
  const ratio = defaultCm360 / r.recommendedCm360;
  const result: SessionResult = {
    verdict: VERDICT_OF[r.kind], currentCm360: defaultCm360, pickCm360: r.recommendedCm360, recommendedCm360: r.recommendedCm360,
    range: r.rangeCm360, multiplier: Math.round(ratio * 100) / 100, newInGameSens: r.recommendedGameSens, edge: null,
    lowConfidence: r.kind === 'bestGuess', abSkipped: r.h2h === null, ab: r.h2h, findings: r.findings,
  };
  const logs = Object.values(s.logs);
  const raw: SessionState['logs'] = {
    flick: logs.flatMap((l) => l.flick), switch: logs.flatMap((l) => l.switch),
    tracking: logs.flatMap((l) => l.tracking), trackSwitch: logs.flatMap((l) => l.trackSwitch),
  };
  return {
    id, createdAt: now.toISOString(), mode: 'playalong', setup, result, steps: s.tests.flatMap((t) => t.steps),
    raw,
    playAlong: { setup: s.setup, tests: s.tests, result: r, nights: s.nights, steerLog: s.steerLog, discarded: s.discarded ?? [] },
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

/** The app's IndexedDB (history, raw logs and the saved Play-Along search), or null where it can't be opened. */
export function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        if (e.oldVersion < 1) {
          const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex(BY_CREATED, 'createdAt');
          req.result.createObjectStore(RAW_STORE);
        }
        if (e.oldVersion < 2) req.result.createObjectStore(PLAYALONG_STORE);
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
