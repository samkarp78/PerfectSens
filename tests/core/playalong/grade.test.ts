import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../../../src/core/config';
import type { TrialMetrics } from '../../../src/core/measure/flick';
import { aimItem, directionSignal, partGrade, testGrade, type PartGrades } from '../../../src/core/playalong/grade';

const trial = (o: Partial<TrialMetrics>): TrialMetrics => ({
  index: 0, cls: 'small', distance: 20, mtMs: 350, firstGain: 1, corrections: 0, endAlong: 0, endPerp: 0,
  hit: true, timedOut: false, scored: true, misses: 0, ...o,
});

describe('aimItem (one flick or switch)', () => {
  it('a clean flick beats the same flick with an overshoot and corrections', () => {
    const clean = aimItem(trial({}));
    const messy = aimItem(trial({ firstGain: 1.35, corrections: 2, mtMs: 520 }));
    expect(clean).toBeGreaterThan(messy);
  });

  it('overshoot and undershoot by the same ratio cost the same', () => {
    expect(aimItem(trial({ firstGain: 1.2 }))).toBeCloseTo(aimItem(trial({ firstGain: 1 / 1.2 })), 12);
  });

  it('measures big flicks against their own ideal (landing slightly short is normal)', () => {
    const ideal = defaultConfig.playAlong.direction.idealGain.big;
    expect(aimItem(trial({ cls: 'big', firstGain: ideal }))).toBeCloseTo(aimItem(trial({ cls: 'small', firstGain: 1 })), 12);
  });

  it('misclicks and a missing first move cost points', () => {
    expect(aimItem(trial({ misses: 1 }))).toBeLessThan(aimItem(trial({})));
    expect(aimItem(trial({ firstGain: null }))).toBeLessThan(aimItem(trial({ firstGain: 1.3 })));
  });
});

describe('partGrade', () => {
  it('is the item mean with SE = sd/√n', () => {
    const g = partGrade([1, 2, 3, 4]);
    expect(g.mean).toBe(2.5);
    expect(g.se).toBeCloseTo(Math.sqrt(5 / 3) / 2, 12);
    expect(g.n).toBe(4);
  });
});

describe('testGrade', () => {
  const parts = (d: number): PartGrades => ({
    flick: { mean: 1 + d, se: 0.04, n: 30 }, switch: { mean: 0.5 + d, se: 0.04, n: 30 },
    tracking: { mean: -0.4 + d, se: 0.04, n: 20 }, trackswitch: { mean: 0.2 + d, se: 0.04, n: 12 },
  });

  it('is the average part difference from the control, equal weights', () => {
    const g = testGrade(parts(0.1), parts(0));
    expect(g.logS).toBeCloseTo(0.1, 12);
    expect(g.se).toBeCloseTo(Math.sqrt(4 * 0.04 ** 2) / 4, 12);
  });

  it('is zero for the control against itself', () => {
    expect(testGrade(parts(0), parts(0)).logS).toBe(0);
  });
});

describe('directionSignal', () => {
  it('overshooting or running ahead points lower; undershooting or trailing points higher', () => {
    expect(directionSignal({ overshoot: 0.15, leadDeg: null, tsLeadDeg: null }).dir).toBe('lower');
    expect(directionSignal({ overshoot: null, leadDeg: 1.2, tsLeadDeg: 0.8 }).dir).toBe('lower');
    expect(directionSignal({ overshoot: -0.12, leadDeg: -0.9, tsLeadDeg: null }).dir).toBe('higher');
  });

  it('small or mixed signals stay neutral', () => {
    expect(directionSignal({ overshoot: 0.02, leadDeg: 0.1, tsLeadDeg: -0.1 }).dir).toBe('none');
    expect(directionSignal({ overshoot: 0.15, leadDeg: -1.5, tsLeadDeg: null }).dir).toBe('none');
    expect(directionSignal({ overshoot: null, leadDeg: null, tsLeadDeg: null }).dir).toBe('none');
  });
});
