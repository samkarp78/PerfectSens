import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import type { FlickSummary } from '../../src/core/measure/flick';
import type { SwitchSummary } from '../../src/core/measure/switch';
import type { TrackingSummary } from '../../src/core/measure/tracking';
import { stepScore } from '../../src/core/score';
import { flickSummary, switchSummary } from '../helpers/summaries';

const flick = (tp: number, logTpSe = 0): FlickSummary => flickSummary({ tp, logTpSe });
const sw = (tp: number, logTpSe = 0): SwitchSummary => switchSummary({ tp, logTpSe });
const track = (tot: number, logTotSe = 0): TrackingSummary => ({ tot, logTotSe, leadLagDeg: 0, n: 100 });
const base = { tp: 4, switchTp: 3, tot: 0.5 };
const W = defaultConfig.score.weights;

describe('stepScore', () => {
  it('is zero when equal to the baseline', () => {
    expect(stepScore(flick(4), sw(3), track(0.5), base, defaultConfig).logS).toBeCloseTo(0, 12);
  });
  it('weights each part by its configured weight', () => {
    expect(stepScore(flick(4.4), sw(3), track(0.5), base, defaultConfig).logS).toBeCloseTo(W.flick * Math.log(1.1), 6);
    expect(stepScore(flick(4), sw(3.3), track(0.5), base, defaultConfig).logS).toBeCloseTo(W.switch * Math.log(1.1), 6);
    expect(stepScore(flick(4), sw(3), track(0.55), base, defaultConfig).logS).toBeCloseTo(W.tracking * Math.log(1.1), 6);
  });
  it('combines standard errors in quadrature with weights', () => {
    const se = stepScore(flick(4, 0.05), sw(3, 0.08), track(0.5, 0.1), base, defaultConfig).se;
    expect(se).toBeCloseTo(Math.sqrt((W.flick * 0.05) ** 2 + (W.switch * 0.08) ** 2 + (W.tracking * 0.1) ** 2), 6);
  });
  it('uses raw logs when there is no baseline', () => {
    const r = stepScore(flick(4), sw(3), track(0.5), null, defaultConfig);
    expect(r.logS).toBeCloseTo(W.flick * Math.log(4) + W.switch * Math.log(3) + W.tracking * Math.log(0.5), 9);
  });
  it('floors tot and tp so logs stay finite', () => {
    expect(Number.isFinite(stepScore(flick(0), sw(0), track(0), base, defaultConfig).logS)).toBe(true);
    expect(Number.isFinite(stepScore(flick(0), sw(0), track(0), null, defaultConfig).logS)).toBe(true);
  });
});
