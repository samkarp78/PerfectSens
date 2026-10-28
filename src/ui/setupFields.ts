import { defaultConfig } from '../core/config';

/** Shown when the DPI changes after the play area was measured (the measurement used the old DPI). */
export const RECALIBRATE_TEXT = 'DPI changed — re-calibrate your play area.';

/** A whole-number DPI in the accepted range: calibration converts counts to cm with it. */
export function dpiValid(text: string): boolean {
  const n = Number(text);
  const { min, max } = defaultConfig.setup.dpi;
  return text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max;
}

/** Editing the DPI clears a measured play area, which was converted with the old DPI. */
export function dpiEdit<F extends { dpi: string; padWidthCm: string }>(f: F, dpi: string): { fields: F; note: string | null } {
  if (dpi === f.dpi) return { fields: f, note: null };
  const had = f.padWidthCm !== '';
  return { fields: { ...f, dpi, padWidthCm: '' }, note: had ? RECALIBRATE_TEXT : null };
}
