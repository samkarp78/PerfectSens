import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { finalsToCm360 } from '../../src/core/playalong/gameSens';
import { answerFeel, answerHourCheck, createPlayAlong, markBack, submitTest, type PaSetup, type PaState } from '../../src/core/playalong/state';
import { openHistory, recordFromPlayAlong } from '../../src/store/history';
import { openPlayAlongStore } from '../../src/store/playAlongStore';
import { fakeDone } from '../helpers/paSteps';

const DEFAULT = finalsToCm360(33, 800);
const setup: PaSetup = { game: 'finals', dpi: 800, defaultCm360: DEFAULT, padWidthCm: 60, fov: 103, fovType: 'horizontal' };

/** One test played, then "I'm done" at the hour check: a best-guess result. */
function bestGuessState(): PaState {
  let s = createPlayAlong(setup, 1, 0);
  s = submitTest(answerFeel(markBack(s, 55 * 60_000), 'right'), fakeDone(DEFAULT, 0), 60 * 60_000);
  return answerHourCheck(s, 'done', 60 * 60_000);
}

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

describe('playAlongStore', () => {
  it('save then load returns an equal state, including an Infinity se', async () => {
    const store = (await openPlayAlongStore())!;
    const s = bestGuessState();
    const withInf: PaState = { ...s, result: { ...s.result!, h2h: { decision: 'none', delta: 0, se: Infinity, look: 2 } } };
    await store.save(withInf);
    const back = await store.load();
    expect(back).toEqual(withInf);
    expect(back!.result!.h2h!.se).toBe(Infinity);
  });

  it('clear removes it', async () => {
    const store = (await openPlayAlongStore())!;
    await store.save(bestGuessState());
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});

describe('history v2', () => {
  it('opening v2 keeps sessions saved under v1', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('bsf', 1);
      req.onupgradeneeded = () => {
        const st = req.result.createObjectStore('sessions', { keyPath: 'id' });
        st.createIndex('createdAt', 'createdAt');
        req.result.createObjectStore('raw');
      };
      req.onsuccess = () => {
        const tx = req.result.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put({ id: 'old', createdAt: '2026-10-01T00:00:00.000Z', mode: 'full' });
        tx.oncomplete = () => { req.result.close(); resolve(); };
      };
      req.onerror = () => reject(req.error);
    });
    const h = (await openHistory())!;
    expect((await h.get('old'))?.id).toBe('old');
    expect(await openPlayAlongStore()).not.toBeNull();
  });

  it('recordFromPlayAlong maps bestGuess to none and keeps the range', () => {
    const s = bestGuessState();
    const rec = recordFromPlayAlong(s, new Date('2026-10-28T20:00:00Z'), 'pa1');
    expect(rec.mode).toBe('playalong');
    expect(rec.result.verdict).toBe('none');
    expect(rec.result.recommendedCm360).toBe(s.result!.recommendedCm360);
    expect(rec.result.range).toEqual(s.result!.rangeCm360);
    expect(rec.playAlong!.result.kind).toBe('bestGuess');
    expect(rec.setup.cm360).toBe(DEFAULT);
    expect(rec.setup.inGameSens).toBe(33);
  });
});

describe('recordFromPlayAlong keeps the search record', () => {
  it('keeps steering decisions, night start times and discarded tests', () => {
    const s = bestGuessState();
    const rec = recordFromPlayAlong({ ...s, discarded: [{ cm360: DEFAULT, night: 0, at: 5, phase: 'testing' }] }, new Date(), 'pa2');
    expect(rec.playAlong!.steerLog).toEqual(s.steerLog);
    expect(rec.playAlong!.nights).toEqual(s.nights);
    expect(rec.playAlong!.discarded).toHaveLength(1);
  });
});
