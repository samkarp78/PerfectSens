import type { Setup } from '../core/types';

const KEY = 'bsf.setup';

export function loadSetup(): Partial<Setup> | null {
  try {
    const raw = globalThis.localStorage.getItem(KEY);
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<Setup>) : null;
  } catch {
    return null;
  }
}

export function saveSetup(s: Setup): void {
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: setup just isn't remembered */
  }
}
