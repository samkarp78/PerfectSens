import { trackingTargetAt, trackingTurns, trackingVelocityAt } from '../blocks';
import type { Config } from '../config';
import { angleBetween } from '../geometry';
import type { Aim, TrackingBlockLog } from '../types';

const MS_PER_S = 1000;
const RAD = Math.PI / 180;
const HALF = 0.5;

/** One point of the scored tracking grid: time, the crosshair at that time, and whether the button was held. */
export interface GridSample { t: number; rel: number; cross: Aim; held: boolean }

/** The scored window (after the lead-in) on the tracking grid; logs without `holds` count as held throughout. */
export function walkGrid(log: TrackingBlockLog, cfg: Config): GridSample[] {
  return walkPath(log, log.t0 + cfg.tracking.leadInMs, MS_PER_S / cfg.tracking.gridHz, trackingTargetAt(log.spec, 0, cfg));
}

/** Grid samples every stepMs from `start` to log.endT: the latest aim sample at or before each time (startAim before any)
 *  and the button state; logs without `holds` count as held throughout. */
export function walkPath(log: Pick<TrackingBlockLog, 't0' | 'endT' | 'path' | 'holds'>, start: number, stepMs: number,
  startAim: Aim): GridSample[] {
  const out: GridSample[] = [];
  const holds = log.holds;
  let idx = -1, hi = -1;
  for (let k = 0; ; k++) {
    const t = start + k * stepMs;
    if (t >= log.endT) break;
    while (idx + 1 < log.path.length && log.path[idx + 1]!.t <= t) idx++;
    if (holds) while (hi + 1 < holds.length && holds[hi + 1]!.t <= t) hi++;
    const p = idx >= 0 ? log.path[idx]! : startAim;
    out.push({ t, rel: t - log.t0, cross: { yaw: p.yaw, pitch: p.pitch }, held: !holds || (hi >= 0 && holds[hi]!.down) });
  }
  return out;
}

/** Full tracking metrics (spec §17.4). Error, speed and axis figures use held samples; null where there's no data. */
export interface TrackingDetail {
  errMean: number | null; errRms: number | null; errMedian: number | null;
  alongRms: number | null; perpMean: number | null; perpRms: number | null;
  /** Median crosshair speed along the target's direction ÷ target speed (> 1 = running ahead). */
  speedRatio: number | null;
  turnReactionMs: number | null; turnOvershootDeg: number | null; turnSettleMs: number | null;
  jitterDegPerSec: number | null;
  /** On-target → off-target changes (any cause, including releasing the button) and the mean time back on. */
  losses: number; reacquireMs: number | null;
  totSlow: number | null; totFast: number | null;
  /** Diagnose only: error RMS on each axis (yaw cos-scaled). Never used for a per-axis sens. */
  yawErrRms: number | null; pitchErrRms: number | null;
  totFirstHalf: number; totSecondHalf: number;
  heldFraction: number; releasesOnTarget: number;
}

interface Point {
  t: number; held: boolean; on: boolean; dist: number;
  ex: number; ey: number;            // error, flat plane (deg)
  vx: number; vy: number; speed: number;  // target velocity (deg/s)
  ax: number | null; ay: number | null;   // crosshair velocity over the previous grid step (deg/s)
}

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const rms = (xs: number[]): number | null => (xs.length === 0 ? null : Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length));
const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const frac = (ps: Point[]): number | null => (ps.length === 0 ? null : ps.filter((p) => p.on).length / ps.length);

export function measureTrackingDetail(log: TrackingBlockLog, cfg: Config): TrackingDetail {
  const tc = cfg.tracking;
  const stepMs = MS_PER_S / tc.gridHz;
  const grid = walkGrid(log, cfg);
  const pts: Point[] = grid.map((g, i) => {
    const tgt = trackingTargetAt(log.spec, g.rel, cfg);
    const k = Math.cos(tgt.pitch * RAD);
    const v = trackingVelocityAt(log.spec, g.rel, cfg);
    const prev = grid[i - 1];
    const dist = angleBetween(g.cross, tgt);
    return {
      t: g.t, held: g.held, on: g.held && dist <= tc.targetRadiusDeg, dist,
      ex: (g.cross.yaw - tgt.yaw) * k, ey: g.cross.pitch - tgt.pitch,
      vx: v.yaw * k, vy: v.pitch, speed: Math.hypot(v.yaw * k, v.pitch),
      ax: prev ? ((g.cross.yaw - prev.cross.yaw) * k * MS_PER_S) / stepMs : null,
      ay: prev ? ((g.cross.pitch - prev.cross.pitch) * MS_PER_S) / stepMs : null,
    };
  });
  const held = pts.filter((p) => p.held);
  const moving = held.filter((p) => p.speed > tc.minSpeedForLeadLag);
  const along = moving.map((p) => (p.ex * p.vx + p.ey * p.vy) / p.speed);
  const perp = moving.map((p) => (-p.ex * p.vy + p.ey * p.vx) / p.speed);
  const ratios = moving.filter((p) => p.ax !== null).map((p) => (p.ax! * p.vx + p.ay! * p.vy) / (p.speed * p.speed));
  const jitter = pts.filter((p) => p.on && p.ax !== null).map((p) => Math.hypot(p.ax! - p.vx, p.ay! - p.vy));

  // Losses: on → off changes; reacquire: how long until back on (completed spells only).
  let losses = 0, releasesOnTarget = 0, offSince: number | null = null;
  const reacquire: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    if (a.on && !b.on) { losses++; offSince = b.t; }
    if (!a.on && b.on && offSince !== null) { reacquire.push(b.t - offSince); offSince = null; }
    if (a.held && !b.held && a.on) releasesOnTarget++;
  }

  // Turns: reaction until the crosshair moves along the new direction at turnReactFraction of target speed;
  // overshoot past the target along the old direction until then; settle once within the radius for settleMs.
  const startRel = tc.leadInMs, endRel = log.endT - log.t0;
  const turns = trackingTurns(log.spec, startRel, endRel, cfg);
  const reacts: number[] = [], overs: number[] = [], settles: number[] = [];
  const settleSteps = Math.ceil(tc.settleMs / stepMs);
  turns.forEach((T, j) => {
    const absT = log.t0 + T;
    const until = Math.min(log.t0 + (turns[j + 1] ?? endRel), absT + MS_PER_S);
    const win = pts.filter((p) => p.t >= absT && p.t < until && p.held);
    if (win.length === 0) return;
    const old = trackingVelocityAt(log.spec, T - 5, cfg);
    const kOld = Math.cos(trackingTargetAt(log.spec, T, cfg).pitch * RAD);
    const ox = old.yaw * kOld, oy = old.pitch, olen = Math.hypot(ox, oy) || 1;
    const reactIdx = win.findIndex((p) => p.ax !== null && p.speed > 0
      && (p.ax * p.vx + p.ay! * p.vy) / p.speed >= tc.turnReactFraction * p.speed);
    const upto = reactIdx >= 0 ? reactIdx + 1 : win.length;
    if (reactIdx >= 0) reacts.push(win[reactIdx]!.t - absT - stepMs * HALF);
    overs.push(Math.max(0, ...win.slice(0, upto).map((p) => (p.ex * ox + p.ey * oy) / olen)));
    for (let i = 0; i + settleSteps <= win.length; i++) {
      if (win.slice(i, i + settleSteps).every((p) => p.dist <= tc.targetRadiusDeg)) { settles.push(win[i]!.t - absT); break; }
    }
  });

  const mid = (tc.speedDegPerSec.min + tc.speedDegPerSec.max) * HALF;
  const half = Math.floor(pts.length / 2);
  return {
    errMean: mean(held.map((p) => p.dist)), errRms: rms(held.map((p) => p.dist)), errMedian: median(held.map((p) => p.dist)),
    alongRms: rms(along), perpMean: mean(perp), perpRms: rms(perp),
    speedRatio: median(ratios),
    turnReactionMs: mean(reacts), turnOvershootDeg: mean(overs), turnSettleMs: mean(settles),
    jitterDegPerSec: rms(jitter),
    losses, reacquireMs: mean(reacquire),
    totSlow: frac(pts.filter((p) => p.speed < mid)), totFast: frac(pts.filter((p) => p.speed >= mid)),
    yawErrRms: rms(held.map((p) => p.ex)), pitchErrRms: rms(held.map((p) => p.ey)),
    totFirstHalf: frac(pts.slice(0, half)) ?? 0, totSecondHalf: frac(pts.slice(half)) ?? 0,
    heldFraction: pts.length > 0 ? held.length / pts.length : 0, releasesOnTarget,
  };
}
