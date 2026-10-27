import type { Config } from './config';
import type { FlickSummary } from './measure/flick';
import type { TrackingSummary } from './measure/tracking';

export interface StepScore { logS: number; se: number }

export function stepScore(
  flick: FlickSummary, tracking: TrackingSummary, baseline: { tp: number; tot: number } | null, cfg: Config,
): StepScore {
  const w = cfg.score.flickWeight;
  const lnTp = Math.log(Math.max(flick.tp, cfg.score.minTp));
  const lnTot = Math.log(Math.max(tracking.tot, cfg.score.minTot));
  const bTp = baseline ? Math.log(Math.max(baseline.tp, cfg.score.minTp)) : 0;
  const bTot = baseline ? Math.log(Math.max(baseline.tot, cfg.score.minTot)) : 0;
  return {
    logS: w * (lnTp - bTp) + (1 - w) * (lnTot - bTot),
    se: Math.sqrt(w ** 2 * flick.logTpSe ** 2 + (1 - w) ** 2 * tracking.logTotSe ** 2),
  };
}
