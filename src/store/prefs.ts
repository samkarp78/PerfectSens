/** Per-player display preferences, kept in this browser (not part of the measurement). */
export interface Prefs { sound: boolean; autoContinue: boolean }

const KEY = 'bsf.prefs';
export const DEFAULT_PREFS: Prefs = { sound: true, autoContinue: true };

export function loadPrefs(): Prefs {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    return { ...DEFAULT_PREFS, ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable: keep defaults */ }
}
