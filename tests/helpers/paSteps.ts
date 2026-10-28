import type { TrialMetrics } from '../../src/core/measure/flick';
import type { SessionState } from '../../src/core/session';
import type { StepResult } from '../../src/core/types';
import { flickSummary, switchSummary, trackingSummary, trackSwitchSummary } from './summaries';

const ITEMS = 20;

/**
 * A finished fixed-mode test block whose Play-Along grade comes out at `grade` (relative to a block made with 0) with
 * standard error about `se`. Only the flicks vary: 20 small flicks with times spread around e^(−4·grade) s, since the
 * test grade averages four parts. gains.small sets every flick's first-move gain (1 = lands on target). Test-only: the
 * cast fills just the fields Play-Along reads (steps, logs, result).
 */
export function fakeDone(cm360: number, grade: number, se = 0.02, rounds = 2, gains: { small?: number } = {}): SessionState {
  const spread = se * 4 * Math.sqrt(ITEMS - 1);
  const trials: TrialMetrics[] = Array.from({ length: ITEMS }, (_, i) => ({
    index: i, cls: 'small', distance: 15, mtMs: 1000 * Math.exp(-(4 * grade + (i % 2 ? spread : -spread))),
    firstGain: gains.small ?? 1, corrections: 0, endAlong: 0, endPerp: 0, hit: true, timedOut: false, scored: true, misses: 0,
  }));
  const steps: StepResult[] = Array.from({ length: rounds }, (_, i) => ({
    order: i, stage: 'baseline', arm: null, cm360, trials: i === 0 ? trials : [], flick: flickSummary(), switch: switchSummary(),
    tracking: trackingSummary({ logTotSe: 0 }), trackSwitch: trackSwitchSummary({ leadLagDeg: null }), score: { logS: grade, se },
  }));
  return { steps, logs: { flick: [], switch: [], tracking: [], trackSwitch: [] }, result: {}, mode: 'fixed' } as unknown as SessionState;
}
