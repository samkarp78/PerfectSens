export type Rng = {
  next(): number;
  normal(): number;
  int(lo: number, hi: number): number;
  shuffle<T>(a: readonly T[]): T[];
  fork(label: number | string): Rng;
};

function hashLabel(label: number | string): number {
  const s = String(label);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const normal = (): number => {
    // Box-Muller; 1 - next() is in (0, 1] so log is finite
    const u = 1 - next();
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));

  const shuffle = <T>(a: readonly T[]): T[] => {
    const out = [...a];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };

  const fork = (label: number | string): Rng => {
    const mixed = Math.imul(state ^ hashLabel(label), 0x9e3779b1) >>> 0;
    return createRng(mixed);
  };

  return { next, normal, int, shuffle, fork };
}
