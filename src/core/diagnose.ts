import type { Config } from './config';
import type { FlickSummary } from './measure/flick';
import type { TrackingSummary } from './measure/tracking';

export type FindingId = 'spread' | 'corrections' | 'smallOvershoot' | 'bigShort' | 'trackingWeaker' | 'flickingWeaker';
export interface Finding { id: FindingId; label: string; value: number; threshold: number; severity: number }

const LABELS: Record<FindingId, string> = {
  spread: 'Landing spread — train precision on small static targets.',
  corrections: 'Micro-corrections — train first flicks that land without adjusting.',
  smallOvershoot: 'Small flicks overshoot — train short-range control.',
  bigShort: 'Big flicks fall short — train committing fully to long flicks.',
  trackingWeaker: 'Tracking is behind your flicking — train tracking.',
  flickingWeaker: 'Flicking is behind your tracking — train flicking.',
};

const ONE = 1;

const avg = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const avgGain = (xs: (number | null)[]): number | null => avg(xs.filter((x): x is number => x !== null));
const make = (id: FindingId, value: number, threshold: number, severity: number): Finding => ({
  id, label: LABELS[id], value, threshold, severity: Math.max(0, severity),
});

export function diagnose(flick: FlickSummary[], tracking: TrackingSummary[], cfg: Config): Finding[] {
  const d = cfg.diagnose;
  const out: Finding[] = [];

  if (flick.length > 0) {
    const spread = avg(flick.map((f) => f.spreadRatio))!;
    if (spread > d.spreadRatioMax) out.push(make('spread', spread, d.spreadRatioMax, spread / d.spreadRatioMax - ONE));
    const corr = avg(flick.map((f) => f.corrections))!;
    if (corr > d.correctionsMax) out.push(make('corrections', corr, d.correctionsMax, corr / d.correctionsMax - ONE));
    const small = avgGain(flick.map((f) => f.smallGain));
    if (small !== null && small > d.smallGainMax) out.push(make('smallOvershoot', small, d.smallGainMax, small / d.smallGainMax - ONE));
    const big = avgGain(flick.map((f) => f.bigGain));
    if (big !== null && big < d.bigGainMin) out.push(make('bigShort', big, d.bigGainMin, d.bigGainMin / big - ONE));
  }

  if (flick.length > 0 && tracking.length > 0) {
    const tp = avg(flick.map((f) => f.tp))!;
    const tot = avg(tracking.map((t) => t.tot))!;
    const rel = tot / d.refTot / (tp / d.refTp);
    const lo = ONE - d.imbalance;
    const hi = ONE + d.imbalance;
    if (rel < lo) out.push(make('trackingWeaker', rel, lo, lo / rel - ONE));
    else if (rel > hi) out.push(make('flickingWeaker', rel, hi, rel / hi - ONE));
  }

  return out.sort((a, b) => b.severity - a.severity);
}
