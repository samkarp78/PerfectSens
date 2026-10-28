import type { FlickSummary } from '../../src/core/measure/flick';
import type { SwitchSummary } from '../../src/core/measure/switch';
import type { TrackingSummary } from '../../src/core/measure/tracking';
import type { TrackSwitchSummary } from '../../src/core/measure/trackSwitch';
import type { TrackingDetail } from '../../src/core/measure/trackingDetail';

/** Neutral part summaries for tests; override only the fields a test is about. */
export const flickSummary = (o: Partial<FlickSummary> = {}): FlickSummary => ({
  tp: 4, logTpSe: 0.05, smallGain: 1, mediumGain: 1, bigGain: 1, corrections: 0.5, weDeg: 1, spreadRatio: 0.5,
  timeoutFraction: 0, n: 30, clickBias: 0, classN: { small: 10, medium: 10, big: 10 }, ...o,
});
export const switchSummary = (o: Partial<SwitchSummary> = {}): SwitchSummary => ({
  ...flickSummary({ tp: 3, n: 18, classN: { small: 6, medium: 6, big: 6 } }),
  kills: 20, clicks: 20, accuracy: 1, misclickRate: 0, misclickAlong: null, ...o,
});
export const trackingDetail = (o: Partial<TrackingDetail> = {}): TrackingDetail => ({
  errMean: 1, errRms: 1, errMedian: 1, alongRms: 0.5, perpMean: 0, perpRms: 0.5, speedRatio: 1,
  turnReactionMs: 200, turnOvershootDeg: 1, turnSettleMs: 300, jitterDegPerSec: 5, losses: 0, reacquireMs: null,
  totSlow: 0.5, totFast: 0.5, yawErrRms: 1, pitchErrRms: 1, totFirstHalf: 0.5, totSecondHalf: 0.5,
  heldFraction: 1, releasesOnTarget: 0, ...o,
});
/** speedRatio is a shortcut for detail.speedRatio. */
export const trackingSummary = ({ speedRatio, ...o }: Partial<TrackingSummary> & { speedRatio?: number | null } = {}): TrackingSummary => ({
  tot: 0.5, logTotSe: 0.05, leadLagDeg: 0, n: 1,
  detail: trackingDetail(speedRatio === undefined ? {} : { speedRatio }), ...o,
});
export const trackSwitchSummary = (o: Partial<TrackSwitchSummary> = {}): TrackSwitchSummary => ({
  dmg: 0.6, logDmgSe: 0.05, kills: 10, acquireMs: 300, acquireGain: 1, killMs: 750, losses: 2, reacquireMs: 150,
  leadLagDeg: 0, heldFraction: 1, n: 1500, ...o,
});
