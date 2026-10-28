import { defaultConfig } from '../config';
import { validateSetup } from '../setup';
import type { FovType } from '../types';
import { finalsToCm360, type GameId } from './gameSens';
import type { PaSetup } from './state';

type Field = 'game' | 'dpi' | 'sens' | 'fov' | 'fovType' | 'padWidthCm';
type Input = Partial<Record<Field, unknown>>;
type Errors = Partial<Record<Field, string>>;

/** Play-Along setup. sens is the whole The Finals number, or cm/360 for other games. The pad measurement is required. */
export function validatePaSetup(input: Input): { ok: true; setup: PaSetup } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const game = input.game;
  if (game !== 'finals' && game !== 'other') errors.game = 'Pick a game.';
  const sens = typeof input.sens === 'string' && input.sens.trim() !== '' ? Number(input.sens) : typeof input.sens === 'number' ? input.sens : NaN;
  const dpiN = Number(input.dpi);
  let cm360 = NaN;
  if (game === 'finals') {
    if (!Number.isInteger(sens) || sens < 1) errors.sens = 'The Finals sens must be a whole number of 1 or more.';
    else if (Number.isInteger(dpiN) && dpiN > 0) cm360 = finalsToCm360(sens, dpiN);
  } else if (game === 'other') {
    cm360 = sens;
  }
  // DPI, cm/360 range, FOV and pad width follow the Standard setup rules; the pad is required here.
  const base = validateSetup({ dpi: input.dpi, cm360: Number.isFinite(cm360) ? cm360 : input.sens, inGameSens: null,
    fov: input.fov, fovType: input.fovType, mode: 'default', padWidthCm: input.padWidthCm });
  if (!base.ok) {
    if (base.errors.dpi) errors.dpi = base.errors.dpi;
    if (base.errors.cm360 && !errors.sens) {
      const r = defaultConfig.setup.cm360;
      errors.sens = game === 'finals' ? 'That sens is outside the range the test supports.' : `cm/360 must be a number from ${r.min} to ${r.max}.`;
    }
    if (base.errors.fov) errors.fov = base.errors.fov;
    if (base.errors.fovType) errors.fovType = base.errors.fovType;
    if (base.errors.padWidthCm) errors.padWidthCm = base.errors.padWidthCm;
  }
  const pad = input.padWidthCm;
  if (!errors.padWidthCm && (pad === null || pad === undefined || pad === '')) errors.padWidthCm = 'Measure your play area first.';
  if (Object.keys(errors).length > 0 || !base.ok) return { ok: false, errors };
  const s = base.setup;
  return { ok: true, setup: { game: game as GameId, dpi: s.dpi, defaultCm360: s.cm360, padWidthCm: s.padWidthCm!, fov: s.fov, fovType: s.fovType as FovType } };
}
