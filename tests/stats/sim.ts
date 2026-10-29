import { createRng } from '../../src/core/rng';

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
