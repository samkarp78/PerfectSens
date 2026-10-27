import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import type { FlickSummary } from '../../src/core/measure/flick';
import type { TrackingSummary } from '../../src/core/measure/tracking';
import { stepScore } from '../../src/core/score';

const flick = (tp: number, logTpSe = 0): FlickSummary => ({
  tp, logTpSe, smallGain: null, mediumGain: null, bigGain: null, corrections: 0, weDeg: 1, spreadRatio: 1, timeoutFraction: 0, n: 10,
});
const track = (tot: number, logTotSe = 0): TrackingSummary => ({ tot, logTotSe, leadLagDeg: 0, n: 100 });
const base = { tp: 4, tot: 0.5 };

describe('stepScore', () => {
  it('is zero when equal to the baseline', () => {
    expect(stepScore(flick(4), track(0.5), base, defaultConfig).logS).toBeCloseTo(0, 12);
  });
  it('weights a 10% TP gain by flickWeight', () => {
    expect(stepScore(flick(4.4), track(0.5), base, defaultConfig).logS).toBeCloseTo(0.6 * Math.log(1.1), 6);
  });
  it('combines standard errors in quadrature with weights', () => {
    expect(stepScore(flick(4, 0.05), track(0.5, 0.1), base, defaultConfig).se).toBeCloseTo(Math.sqrt(0.36 * 0.0025 + 0.16 * 0.01), 6);
  });
  it('uses raw logs when there is no baseline', () => {
    const r = stepScore(flick(4), track(0.5), null, defaultConfig);
    expect(r.logS).toBeCloseTo(0.6 * Math.log(4) + 0.4 * Math.log(0.5), 9);
  });
  it('floors tot and tp so logs stay finite', () => {
    const r = stepScore(flick(0), track(0), base, defaultConfig);
    expect(Number.isFinite(r.logS)).toBe(true);
    const r2 = stepScore(flick(0), track(0), null, defaultConfig);
    expect(Number.isFinite(r2.logS)).toBe(true);
  });
});
