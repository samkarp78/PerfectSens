import type { Config } from './config';
import type { Rng } from './rng';
import type { Arm } from './types';

export interface AbBlock { arm: Arm; logS: number; se: number }
export interface AbDecision { decision: 'change' | 'keep' | 'none' | 'continue'; delta: number; se: number; look: 1 | 2 }

const COIN_HALF = 0.5;

const swap = (a: Arm): Arm => (a === 'P' ? 'C' : 'P');

/** Arms in one ABBA / BAAB round. */
export const AB_ROUND_LENGTH = 4;

export function abSequence(rng: Rng): Arm[] {
  return rng.next() < COIN_HALF ? ['P', 'C', 'C', 'P'] : ['C', 'P', 'P', 'C'];
}

export function extendSequence(first: Arm[]): Arm[] {
  return first.map(swap);
}

export function decideAB(blocks: AbBlock[], look: 1 | 2, cfg: Config): AbDecision {
  const p = blocks.filter((b) => b.arm === 'P');
  const c = blocks.filter((b) => b.arm === 'C');
  if (p.length === 0 || c.length === 0) {
    return { decision: look === 1 ? 'continue' : 'none', delta: 0, se: Infinity, look };
  }
  const mean = (bs: AbBlock[]): number => bs.reduce((a, b) => a + b.logS, 0) / bs.length;
  const varOfMean = (bs: AbBlock[]): number => bs.reduce((a, b) => a + b.se ** 2, 0) / bs.length ** 2;
  const delta = mean(p) - mean(c);
  const se = Math.sqrt(varOfMean(p) + varOfMean(c));
  const m = Math.log(1 + cfg.ab.minEffect);
  const zse = cfg.ab.z * se;
  let decision: AbDecision['decision'];
  if (delta > m && delta > zse) decision = 'change';
  else if (delta < 0 && -delta > zse) decision = 'keep';
  else if (delta + zse < m) decision = 'none';
  else decision = look === 1 ? 'continue' : 'none';
  return { decision, delta, se, look };
}
