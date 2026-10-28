import type { FlickSummary } from '../../src/core/measure/flick';
import type { SwitchSummary } from '../../src/core/measure/switch';
import type { TrackingSummary } from '../../src/core/measure/tracking';

/** Neutral part summaries for tests; override only the fields a test is about. */
export const flickSummary = (o: Partial<FlickSummary> = {}): FlickSummary => ({
  tp: 4, logTpSe: 0.05, smallGain: 1, mediumGain: 1, bigGain: 1, corrections: 0.5, weDeg: 1, spreadRatio: 0.5,
  timeoutFraction: 0, n: 30, clickBias: 0, classN: { small: 10, medium: 10, big: 10 }, ...o,
});
export const switchSummary = (o: Partial<SwitchSummary> = {}): SwitchSummary => ({
  ...flickSummary({ tp: 3, n: 18, classN: { small: 6, medium: 6, big: 6 } }),
  kills: 20, clicks: 20, accuracy: 1, misclickRate: 0, misclickAlong: null, ...o,
});
export const trackingSummary = (o: Partial<TrackingSummary> = {}): TrackingSummary => ({
  tot: 0.5, logTotSe: 0.05, leadLagDeg: 0, n: 1, ...o,
});
