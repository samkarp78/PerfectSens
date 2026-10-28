import { createRng } from '../../src/core/rng';
import { runSimSession } from '../../src/core/sim/runSession';
import { defaultSimPlayer, type SimPlayer } from '../../src/core/sim/player';
import type { SessionResult } from '../../src/core/result';
import type { Setup } from '../../src/core/types';

export const CURRENT = 34.29;
export const setup: Setup = { dpi: 800, cm360: CURRENT, inGameSens: null, fov: 103, fovType: 'horizontal', mode: 'default' };

export const player = (over: Partial<SimPlayer> = {}): SimPlayer => defaultSimPlayer(CURRENT, over);

/** One full (no warmup) simulated session; returns its result. */
export function run(p: SimPlayer, seed: number, quickAbCm360: number | null = null): SessionResult {
  return runSimSession(setup, p, { seed, warmup: false, quickAbCm360 }).state.result!;
}

/** Deterministic uniform draws in [lo, hi). */
export function uniforms(seed: number, n: number, lo: number, hi: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => lo + (hi - lo) * rng.next());
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Prints one observed-rate line (the stats suite records its rates in the test output). */
export const report = (name: string, text: string): void => { console.log(`[stats] ${name}: ${text}`); };
