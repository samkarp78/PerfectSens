import type { Config } from './config';
import type { Arm } from './types';

export interface AbBlock { arm: Arm; logS: number; se: number }
export interface AbDecision { decision: 'change' | 'keep' | 'none' | 'continue'; delta: number; se: number; look: 1 | 2 }

/** Change needs both rounds: look 1 returns keep, none or continue (a would-be change continues), and look 2 says change
 *  only if look 1's delta (look1Delta) was positive too. */
export function decideAB(blocks: AbBlock[], look: 1 | 2, cfg: Config, look1Delta: number | null = null): AbDecision {
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
  if (delta > m && delta > zse) decision = look === 2 && look1Delta !== null && look1Delta > 0 ? 'change' : look === 1 ? 'continue' : 'none';
  else if (delta < 0 && -delta > zse) decision = 'keep';
  else if (delta + zse < m) decision = 'none';
  else decision = look === 1 ? 'continue' : 'none';
  return { decision, delta, se, look };
}
