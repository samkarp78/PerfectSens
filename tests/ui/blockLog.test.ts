import { describe, expect, it } from 'vitest';
import type { StepResult } from '../../src/core/types';
import { stepCells } from '../../src/ui/BlockLog';
import { flickSummary, switchSummary, trackingSummary, trackSwitchSummary } from '../helpers/summaries';

const step = (o: Partial<StepResult> = {}): StepResult => ({
  order: 0, stage: 'baseline', arm: null, cm360: 34.6, trials: [], flick: flickSummary(), switch: switchSummary({ accuracy: 0.9 }),
  tracking: trackingSummary({ tot: 0.71 }), trackSwitch: trackSwitchSummary({ dmg: 0.55 }), score: { logS: 0, se: 0.05 }, ...o,
});

describe('BlockLog cells', () => {
  it('shows switching accuracy and tracking-switching damage', () => {
    const c = stepCells(step());
    expect(c.switchAcc).toBe('90%');
    expect(c.dmg).toBe('0.55');
    expect(c.tot).toBe('0.71');
  });
  it('Results renders an old step without trackSwitch', () => {
    const old = { ...step(), trackSwitch: undefined, switch: undefined, tracking: { tot: 0.6, logTotSe: 0.1, leadLagDeg: 0, n: 1 } } as unknown as StepResult;
    const c = stepCells(old);
    expect(c.dmg).toBe('');
    expect(c.switchTp).toBe('');
    expect(c.switchAcc).toBe('');
    expect(c.tot).toBe('0.6');
  });
});
