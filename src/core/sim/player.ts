import { defaultConfig } from '../config';

export interface SimPlayer {
  optimalCm360: number; currentCm360: number; curvature: number; familiarityBonus: number;
  adaptationRate: number; gainExponent: number; motorNoise: number; driftPerBlock: number;
}
/** form: a night-to-night performance multiplier (Play-Along sim); absent means 1. */
export interface SimState { adaptedCm360: number; blocksDone: number; form?: number }

export function defaultSimPlayer(currentCm360: number, overrides: Partial<SimPlayer> = {}): SimPlayer {
  const d = defaultConfig.sim.player;
  return {
    optimalCm360: currentCm360 * d.optimalRatio, currentCm360, curvature: d.curvature, familiarityBonus: d.familiarityBonus,
    adaptationRate: d.adaptationRate, gainExponent: d.gainExponent, motorNoise: d.motorNoise, driftPerBlock: d.driftPerBlock,
    ...overrides,
  };
}

/** Performance multiplier: log-quadratic peak at the optimum × familiarity at the current sens × slow drift over blocks
 *  × night form. */
export function performance(player: SimPlayer, cm360: number, state: SimState): number {
  const peak = Math.exp(-player.curvature * (Math.log(cm360) - Math.log(player.optimalCm360)) ** 2);
  const familiar = Math.abs(Math.log(cm360 / player.currentCm360)) < defaultConfig.sim.player.familiarityTolLn ? 1 + player.familiarityBonus : 1;
  return peak * familiar * (1 + player.driftPerBlock * state.blocksDone) * (state.form ?? 1);
}

/** First-move gain the player produces at `testCm360` while adapted to `adaptedCm360`. */
export function moveGain(player: SimPlayer, adaptedCm360: number, testCm360: number): number {
  return (adaptedCm360 / testCm360) ** player.gainExponent;
}

/** One adaptation step: ln adapted moves toward ln test by the adaptation rate. */
export function adaptToward(player: SimPlayer, adaptedCm360: number, testCm360: number): number {
  const la = Math.log(adaptedCm360);
  return Math.exp(la + player.adaptationRate * (Math.log(testCm360) - la));
}
