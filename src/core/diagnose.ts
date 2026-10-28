import type { Config } from './config';
import type { FlickSummary } from './measure/flick';
import type { SwitchSummary } from './measure/switch';
import type { TrackingSummary } from './measure/tracking';

export type FindingId = 'spread' | 'corrections' | 'smallOvershoot' | 'bigShort' | 'trackingWeaker' | 'flickingWeaker'
  | 'switchMisclicks' | 'verticalTracking' | 'slowTurns';
export interface Finding { id: FindingId; label: string; value: number; threshold: number; severity: number }

const LABELS: Record<FindingId, string> = {
  spread: 'Landing spread — train precision on small static targets.',
  corrections: 'Micro-corrections — train first flicks that land without adjusting.',
  smallOvershoot: 'Small flicks overshoot — train short-range control.',
  bigShort: 'Big flicks fall short — train committing fully to long flicks.',
  trackingWeaker: 'Tracking is behind your flicking — train tracking.',
  flickingWeaker: 'Flicking is behind your tracking — train flicking.',
  switchMisclicks: 'Switching misclicks — train clicking only when on target.',
  verticalTracking: 'Vertical tracking is weaker than horizontal — train vertical tracking.',
  slowTurns: 'Slow reaction when targets change direction — train reacting to direction changes.',
};

const ONE = 1;

const avg = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const avgGain = (xs: (number | null)[]): number | null => avg(xs.filter((x): x is number => x !== null));
const make = (id: FindingId, value: number, threshold: number, severity: number): Finding => ({
  id, label: LABELS[id], value, threshold, severity: Math.max(0, severity),
});

export function diagnose(flick: FlickSummary[], tracking: TrackingSummary[], cfg: Config, sw: SwitchSummary[] = []): Finding[] {
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

  // Tracking detail (absent on summaries saved before revision 3). Per-axis figures only ever give training advice.
  const details = tracking.map((t) => t.detail).filter((x) => x !== undefined);
  const yaw = avgGain(details.map((x) => x.yawErrRms)), pitch = avgGain(details.map((x) => x.pitchErrRms));
  if (yaw !== null && pitch !== null && yaw > 0 && pitch / yaw > d.verticalRatioMax) {
    out.push(make('verticalTracking', pitch / yaw, d.verticalRatioMax, pitch / yaw / d.verticalRatioMax - ONE));
  }
  const react = avgGain(details.map((x) => x.turnReactionMs));
  if (react !== null && react > d.turnReactionMaxMs) out.push(make('slowTurns', react, d.turnReactionMaxMs, react / d.turnReactionMaxMs - ONE));

  if (sw.length > 0) {
    const acc = avg(sw.map((x) => x.accuracy))!;
    if (acc < d.minSwitchAccuracy) {
      const along = avgGain(sw.map((x) => x.misclickAlong));
      const f = make('switchMisclicks', acc, d.minSwitchAccuracy, d.minSwitchAccuracy / acc - ONE);
      const dir = along === null ? '' : along >= 0 ? ' (misses mostly overshoot)' : ' (misses mostly undershoot)';
      out.push({ ...f, label: f.label.replace(/.$/, `${dir}.`) });
    }
  }

  return out.sort((a, b) => b.severity - a.severity);
}
