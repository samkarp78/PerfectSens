import type { Config } from './config';
import type { FlickSummary } from './measure/flick';
import type { SwitchSummary } from './measure/switch';
import type { TrackingSummary } from './measure/tracking';

export interface StepScore { logS: number; se: number }
export interface ScoreBaseline { tp: number; switchTp: number; tot: number }

/** log S = Σ weight · ln(part / baseline part) over flicks, switching and tracking (raw logs without a baseline). */
export function stepScore(
  flick: FlickSummary, sw: SwitchSummary, tracking: TrackingSummary, baseline: ScoreBaseline | null, cfg: Config,
): StepScore {
  const w = cfg.score.weights;
  const lnTp = (x: number) => Math.log(Math.max(x, cfg.score.minTp));
  const lnTot = (x: number) => Math.log(Math.max(x, cfg.score.minTot));
  const f = lnTp(flick.tp) - (baseline ? lnTp(baseline.tp) : 0);
  const s = lnTp(sw.tp) - (baseline ? lnTp(baseline.switchTp) : 0);
  const t = lnTot(tracking.tot) - (baseline ? lnTot(baseline.tot) : 0);
  return {
    logS: w.flick * f + w.switch * s + w.tracking * t,
    se: Math.sqrt((w.flick * flick.logTpSe) ** 2 + (w.switch * sw.logTpSe) ** 2 + (w.tracking * tracking.logTotSe) ** 2),
  };
}
