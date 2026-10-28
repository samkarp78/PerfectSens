import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordBests } from '../../src/store/bests';

afterEach(() => { vi.unstubAllGlobals(); });
const stats = (points: number, bestStreak: number) => ({ points, streak: 0, bestStreak, hits: 10, shots: 12 });

describe('personal bests', () => {
  it('flags new bests and keeps the higher values', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    expect(recordBests(stats(5000, 8))).toEqual({ points: 5000, bestStreak: 8, newPoints: true, newStreak: true });
    expect(recordBests(stats(4000, 12))).toEqual({ points: 5000, bestStreak: 12, newPoints: false, newStreak: true });
    expect(recordBests(stats(4000, 3))).toEqual({ points: 5000, bestStreak: 12, newPoints: false, newStreak: false });
  });
  it('still answers when storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } });
    expect(recordBests(stats(100, 2))).toEqual({ points: 100, bestStreak: 2, newPoints: true, newStreak: true });
  });
});
