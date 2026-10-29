import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSimPlayer } from '../../src/core/sim/player';
import { runPlayAlongSim } from '../../src/core/sim/runPlayAlong';
import { openHistory, recordFromPlayAlong, type SessionRecord } from '../../src/store/history';
import { exportAll } from '../../src/store/export';
import type { FlickBlockLog } from '../../src/core/types';

const setup = { game: 'finals' as const, dpi: 800, defaultCm360: 34.29, padWidthCm: 60, fov: 103, fovType: 'horizontal' as const, quick: true };
let base: SessionRecord;

beforeAll(() => {
  const { state } = runPlayAlongSim(setup, defaultSimPlayer(34.29), 3);
  base = recordFromPlayAlong(state, new Date('2026-10-27T10:00:00Z'), 'base');
});

// A stand-in raw log is enough to tell raw from null (the simulator keeps no raw logs).
const make = (i: number): SessionRecord => ({
  ...base, steps: base.steps.slice(0, 1), raw: { flick: [{ t0: 0 } as unknown as FlickBlockLog], switch: [], tracking: [], trackSwitch: [] }, id: `s${i}`, createdAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
});

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

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

  it('stores raw in its own object store and keeps the session record light', async () => {
    const h = (await openHistory())!;
    await h.save(make(1));
    const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open('bsf'); r.onsuccess = () => res(r.result); });
    expect([...db.objectStoreNames].sort()).toEqual(['playalong', 'raw', 'sessions']);
    const read = (name: string, key: string) => new Promise<any>((res) => { const r = db.transaction(name).objectStore(name).get(key); r.onsuccess = () => res(r.result); });
    expect((await read('sessions', 's1')).raw).toBeNull();
    expect(await read('raw', 's1')).toBeTruthy();
    expect((await h.get('s1'))!.raw!.flick).toHaveLength(1);
    db.close();
  });

  it('prunes raw entries beyond 5 from the raw store', async () => {
    const h = (await openHistory())!;
    for (let i = 1; i <= 7; i++) await h.save(make(i));
    const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open('bsf'); r.onsuccess = () => res(r.result); });
    const keys = await new Promise<IDBValidKey[]>((res) => { const r = db.transaction('raw').objectStore('raw').getAllKeys(); r.onsuccess = () => res(r.result); });
    expect(keys.sort()).toEqual(['s3', 's4', 's5', 's6', 's7']);
    db.close();
  });

  it('still persists the session when saving raw fails', async () => {
    const h = (await openHistory())!;
    const bad = { ...make(1), raw: { flick: [() => 1], tracking: [] } } as unknown as SessionRecord;
    await h.save(bad);
    const got = await h.get('s1');
    expect(got).not.toBeNull();
    expect(got!.raw).toBeNull();
    expect((await h.list()).map((s) => s.id)).toEqual(['s1']);
  });

  it('rejects when even the save without raw fails', async () => {
    const h = (await openHistory())!;
    const bad = { ...make(1), setup: (() => 1) as unknown as SessionRecord['setup'] } as SessionRecord;
    await expect(h.save(bad)).rejects.toBeTruthy();
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

describe('exportAll', () => {
  it('puts every saved session, with its raw data, in one file', async () => {
    const h = (await openHistory())!;
    for (const i of [1, 2]) await h.save(make(i));
    const all = JSON.parse(await exportAll(h)) as SessionRecord[];
    expect(all.map((r) => r.id).sort()).toEqual(['s1', 's2']);
    expect(all[0]!.raw!.flick).toHaveLength(1);
  });
});
