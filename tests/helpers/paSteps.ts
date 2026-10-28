import type { SessionState } from '../../src/core/session';
import type { StepResult } from '../../src/core/types';
import { flickSummary, switchSummary, trackingSummary, trackSwitchSummary } from './summaries';

/** A finished fixed-mode test block with the given score, as Play-Along's submitTest reads it. Test-only: the cast fills
 *  just the fields submitTest uses (steps, logs, result). gains: first-move gains for flicks and switches (1 = none). */
export function fakeDone(cm360: number, logS: number, se = 0.03, rounds = 3, gains: { small?: number; big?: number } = {}): SessionState {
  const g = { ...(gains.small === undefined ? {} : { smallGain: gains.small }), ...(gains.big === undefined ? {} : { bigGain: gains.big }) };
  const steps: StepResult[] = Array.from({ length: rounds }, (_, i) => ({
    order: i, stage: 'baseline', arm: null, cm360, trials: [], flick: flickSummary(g), switch: switchSummary(g),
    tracking: trackingSummary(), trackSwitch: trackSwitchSummary(), score: { logS, se },
  }));
  return { steps, logs: { flick: [], switch: [], tracking: [], trackSwitch: [] }, result: {}, mode: 'fixed' } as unknown as SessionState;
}
