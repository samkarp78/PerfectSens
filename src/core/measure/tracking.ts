import { trackingTargetAt } from '../blocks';
import type { Config } from '../config';
import { angleBetween } from '../geometry';
import type { Rng } from '../rng';
import type { Aim, TrackingBlockLog } from '../types';

export interface TrackingSummary { tot: number; logTotSe: number; leadLagDeg: number; n: number }

const MS_PER_S = 1000;
const RAD = Math.PI / 180;
const HALF = 0.5;

const sampleSd = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

/** Signed offset of `cross` from `tgt` along the target's velocity direction (flat plane, cos-pitch scaled), or null if too slow. */
function leadLagAt(log: TrackingBlockLog, rel: number, cross: Aim, cfg: Config): number | null {
  const halfStepMs = (MS_PER_S / cfg.tracking.gridHz) * HALF;
  const a = trackingTargetAt(log.spec, rel - halfStepMs, cfg);
  const b = trackingTargetAt(log.spec, rel + halfStepMs, cfg);
  const tgt = trackingTargetAt(log.spec, rel, cfg);
  const k = Math.cos(tgt.pitch * RAD);
  const vx = (b.yaw - a.yaw) * k, vy = b.pitch - a.pitch;
  const len = Math.hypot(vx, vy);
  if (len === 0 || len / (2 * halfStepMs / MS_PER_S) <= cfg.tracking.minSpeedForLeadLag) return null;
  return (((cross.yaw - tgt.yaw) * k) * vx + (cross.pitch - tgt.pitch) * vy) / len;
}

export function measureTracking(log: TrackingBlockLog, cfg: Config, rng: Rng): TrackingSummary {
  const stepMs = MS_PER_S / cfg.tracking.gridHz;
  const start = log.t0 + cfg.tracking.leadInMs;
  const startAim = trackingTargetAt(log.spec, 0, cfg);

  const onTarget: boolean[] = [];
  const lags: number[] = [];
  let idx = -1;
  for (let k = 0; ; k++) {
    const t = start + k * stepMs;
    if (t >= log.endT) break;
    while (idx + 1 < log.path.length && log.path[idx + 1]!.t <= t) idx++;
    const cross: Aim = idx >= 0 ? log.path[idx]! : startAim;
    const rel = t - log.t0;
    onTarget.push(angleBetween(cross, trackingTargetAt(log.spec, rel, cfg)) <= cfg.tracking.targetRadiusDeg);
    const lag = leadLagAt(log, rel, cross, cfg);
    if (lag !== null) lags.push(lag);
  }

  const n = onTarget.length;
  if (n === 0) return { tot: 0, logTotSe: 0, leadLagDeg: 0, n: 0 };
  const hits = onTarget.filter(Boolean).length;
  const tot = hits / n;

  const perChunk = Math.max(1, Math.round((cfg.score.trackingSegmentMs / MS_PER_S) * cfg.tracking.gridHz));
  const chunks: { hits: number; n: number }[] = [];
  for (let i = 0; i < n; i += perChunk) {
    const slice = onTarget.slice(i, i + perChunk);
    chunks.push({ hits: slice.filter(Boolean).length, n: slice.length });
  }
  const logs: number[] = [];
  for (let b = 0; b < cfg.score.bootstrapSamples; b++) {
    let h = 0, m = 0;
    for (let c = 0; c < chunks.length; c++) {
      const pick = chunks[rng.int(0, chunks.length - 1)]!;
      h += pick.hits; m += pick.n;
    }
    logs.push(Math.log(Math.max(h / m, cfg.score.minTot)));
  }

  return {
    tot, logTotSe: sampleSd(logs), n,
    leadLagDeg: lags.length > 0 ? lags.reduce((a, b) => a + b, 0) / lags.length : 0,
  };
}
