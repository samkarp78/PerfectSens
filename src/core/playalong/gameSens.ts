import { defaultConfig, type Config } from '../config';

/** 'finals': The Finals, whole-number hip-fire sens; 'other': any game, set by cm/360. */
export type GameId = 'finals' | 'other';

/** Other games count as the same sens within this relative difference. */
const OTHER_SAME_TOL = 0.005;
/** Snapped Finals values are exact, so only rounding noise is allowed. */
const FINALS_SAME_TOL = 1e-9;

export function finalsToCm360(sens: number, dpi: number, cfg: Config = defaultConfig): number {
  return cfg.playAlong.finalsK / (sens * dpi);
}

export function cm360ToFinals(cm360: number, dpi: number, cfg: Config = defaultConfig): number {
  return cfg.playAlong.finalsK / (cm360 * dpi);
}

/** The cm/360 the game can actually be set to. Finals: whole numbers ≥ 1; 'slower' rounds the number down (higher
 *  cm/360), 'faster' rounds it up. Other games are not snapped. */
export function snapCm360(game: GameId, cm360: number, dpi: number, toward: 'nearest' | 'slower' | 'faster',
  cfg: Config = defaultConfig): number {
  if (game === 'other') return cm360;
  const raw = cm360ToFinals(cm360, dpi, cfg);
  const n = toward === 'slower' ? Math.floor(raw) : toward === 'faster' ? Math.ceil(raw) : Math.round(raw);
  return finalsToCm360(Math.max(1, n), dpi, cfg);
}

/** The whole Finals number for a cm/360, or null for other games. */
export function gameSensOf(game: GameId, cm360: number, dpi: number, cfg: Config = defaultConfig): number | null {
  return game === 'finals' ? Math.max(1, Math.round(cm360ToFinals(cm360, dpi, cfg))) : null;
}

/** Whether two (already snapped) cm/360 values are the same test sens. */
export function sameSens(game: GameId, a: number, b: number): boolean {
  return Math.abs(Math.log(a / b)) < (game === 'finals' ? FINALS_SAME_TOL : OTHER_SAME_TOL);
}
