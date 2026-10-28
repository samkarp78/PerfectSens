import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSimPlayer } from '../../src/core/sim/player';
import { runSimSession } from '../../src/core/sim/runSession';
import type { Setup } from '../../src/core/types';
import { openHistory, recordFromSession, type SessionRecord } from '../../src/store/history';

const setup: Setup = { dpi: 800, cm360: 34.29, inGameSens: null, fov: 103, fovType: 'horizontal', mode: 'default' };
let base: SessionRecord;

beforeAll(() => {
  const { state } = runSimSession(setup, defaultSimPlayer(34.29), { seed: 3, warmup: false, quickAbCm360: null });
  base = recordFromSession(state, new Date('2026-10-27T10:00:00Z'), 'base');
});

// Full raw logs make fake-indexeddb's structured clone slow; a small slice is enough to tell raw from null.
const make = (i: number): SessionRecord => ({
  ...base, steps: base.steps.slice(0, 1), raw: { flick: base.raw!.flick.slice(0, 1), tracking: [] }, id: `s${i}`, createdAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
});

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

describe('recordFromSession', () => {
  it('builds a record and throws without a result', () => {
    const { state } = runSimSession(setup, defaultSimPlayer(34.29), { seed: 3, warmup: false, quickAbCm360: null });
    const r = recordFromSession(state, new Date('2026-10-27T10:00:00Z'), 'x');
    expect(r.createdAt).toBe('2026-10-27T10:00:00.000Z');
    expect(r.raw).toEqual(state.logs);
    expect(() => recordFromSession({ ...state, result: null }, new Date(), 'y')).toThrow();
  });
});

describe('history', () => {
  it('lists newest first without raw or steps', async () => {
    const h = (await openHistory())!;
    for (const i of [1, 3, 2]) await h.save(make(i));
    const list = await h.list();
    expect(list.map((s) => s.id)).toEqual(['s3', 's2', 's1']);
    for (const s of list) {
      expect(Object.keys(s).sort()).toEqual(['createdAt', 'id', 'mode', 'result', 'setup']);
    }
  });

  it('keeps raw only on the 5 newest of 7', async () => {
    const h = (await openHistory())!;
    for (let i = 1; i <= 7; i++) await h.save(make(i));
    const got = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => h.get(`s${i}`)));
    expect(got.map((r) => r!.raw !== null)).toEqual([false, false, true, true, true, true, true]);
    expect(await h.get('nope')).toBeNull();
  });

  it('resolves null without indexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(openHistory()).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it('resolves null when open throws or errors', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('blocked'); } });
    await expect(openHistory()).resolves.toBeNull();
    vi.unstubAllGlobals();
  });
});
