import type { PaFields } from '../ui/Home';

/** The player's mouse settings, kept in this browser so they're filled in next time. */
const KEY = 'bsf.mouse';
export const DEFAULT_FIELDS: PaFields = { game: 'finals', dpi: '800', sens: '', fov: '103', fovType: 'horizontal', padWidthCm: '' };

export function loadFields(): PaFields {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? { ...DEFAULT_FIELDS, ...(v as Partial<PaFields>) } : { ...DEFAULT_FIELDS };
  } catch {
    return { ...DEFAULT_FIELDS };
  }
}

export function saveFields(f: PaFields): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(f)); } catch { /* storage unavailable: not remembered */ }
}
