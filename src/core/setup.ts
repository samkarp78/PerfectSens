import { defaultConfig } from './config';
import type { Setup } from './types';

type Input = Partial<Record<keyof Setup, unknown>>;
type Errors = Partial<Record<keyof Setup, string>>;

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function validateSetup(input: Input):
  { ok: true; setup: Setup } | { ok: false; errors: Errors } {
  const r = defaultConfig.setup;
  const errors: Errors = {};

  const dpi = toNumber(input.dpi);
  if (dpi === null || !Number.isInteger(dpi) || dpi < r.dpi.min || dpi > r.dpi.max)
    errors.dpi = `DPI must be a whole number from ${r.dpi.min} to ${r.dpi.max}.`;

  const cm360 = toNumber(input.cm360);
  if (cm360 === null || cm360 < r.cm360.min || cm360 > r.cm360.max)
    errors.cm360 = `cm/360 must be a number from ${r.cm360.min} to ${r.cm360.max}.`;

  let inGameSens: number | null = null;
  if (input.inGameSens !== null && input.inGameSens !== undefined && input.inGameSens !== '') {
    inGameSens = toNumber(input.inGameSens);
    if (inGameSens === null || inGameSens <= 0) errors.inGameSens = 'In-game sensitivity must be a number above 0, or left blank.';
  }

  const fovType = input.fovType;
  if (fovType !== 'horizontal' && fovType !== 'vertical') errors.fovType = 'FOV type must be horizontal or vertical.';

  const fov = toNumber(input.fov);
  if (fovType === 'horizontal' || fovType === 'vertical') {
    const range = r.fov[fovType];
    if (fov === null || fov < range.min || fov > range.max)
      errors.fov = `${fovType === 'horizontal' ? 'Horizontal' : 'Vertical'} FOV must be a number from ${range.min} to ${range.max}.`;
  } else if (fov === null) {
    errors.fov = 'FOV must be a number.';
  }

  const mode = input.mode;
  if (mode !== 'default' && mode !== 'thorough' && mode !== 'quick') errors.mode = 'Mode must be default, thorough or quick.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, setup: { dpi: dpi!, cm360: cm360!, inGameSens, fov: fov!, fovType: fovType as Setup['fovType'], mode: mode as Setup['mode'] } };
}
