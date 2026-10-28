import { trackSwitchTargetAim } from '../blocks';
import type { Config } from '../config';
import { alongPerp, angleBetween } from '../geometry';
import type { Rng } from '../rng';
import { damageTarget } from '../run/trackSwitchRunner';
import type { Aim, TrackSwitchBlockLog, TrackSwitchTarget } from '../types';
import { segmentSubmovements } from './submovements';
import { chunkBootstrapSe } from './tracking';
import { walkPath } from './trackingDetail';

const MS_PER_S = 1000;
const RAD = Math.PI / 180;
const VEL_H = 0.5;

/** Tracking switching (spec §17.5). dmg (the score term): fraction of scored time dealing damage. Per-kill means over
 *  kills after the lead-in; acquireGain is recorded but never steers (moving targets confound it). */
/** One scored kill: time to lock on (ms), time from lock-on to kill (ms), and the lock-on first-move gain. */
export interface TrackSwitchKill { acquireMs: number; killMs: number; gain: number | null }

export interface TrackSwitchSummary {
  dmg: number; logDmgSe: number; kills: number;
  acquireMs: number | null; acquireGain: number | null; killMs: number | null;
  losses: number; reacquireMs: number | null; leadLagDeg: number | null; heldFraction: number; n: number;
  /** Per-kill items for the Play-Along grade (absent on summaries saved before spec 19). */
  killItems?: TrackSwitchKill[];
}

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

const alive = (t: TrackSwitchTarget, at: number): boolean => t.spawnT <= at && (t.killT === null || at < t.killT);

export function measureTrackSwitch(log: TrackSwitchBlockLog, cfg: Config, rng: Rng): TrackSwitchSummary {
  const ts = cfg.trackswitch;
  const stepMs = MS_PER_S / cfg.tracking.gridHz;
  const scoredFrom = log.t0 + ts.leadInMs;
  // Which target (by index) the crosshair damages at each grid time across the whole block.
  const grid = walkPath(log, log.t0, stepMs, { yaw: 0, pitch: 0 }).map((g) => {
    const live = log.targets.filter((x) => alive(x, g.t));
    const i = g.held ? damageTarget(g.cross, live.map((x) => trackSwitchTargetAim(x, g.t, cfg)), ts.targetRadiusDeg) : null;
    return { ...g, hit: i === null ? null : live[i]!.index };
  });
  const scored = grid.filter((g) => g.t >= scoredFrom);
  const flags = scored.map((g) => g.hit !== null);

  const acquire: number[] = [], killTimes: number[] = [], gains: number[] = [], reacq: number[] = [], lags: number[] = [];
  const killItems: TrackSwitchKill[] = [];
  let losses = 0;
  log.kills.forEach((k, j) => {
    if (k.t < scoredFrom) return;
    const prevT = j === 0 ? log.t0 : log.kills[j - 1]!.t;
    const from: Aim = j === 0 ? { yaw: 0, pitch: 0 } : log.kills[j - 1]!.aim;
    const target = log.targets[k.index]!;
    const span = grid.filter((g) => g.t >= prevT && g.t < k.t);
    const first = span.findIndex((g) => g.hit === k.index);
    if (first < 0) return;
    acquire.push(span[first]!.t - prevT);
    killTimes.push(k.t - span[first]!.t);
    let offSince: number | null = null;
    for (let i = first + 1; i < span.length; i++) {
      const on = span[i]!.hit === k.index, was = span[i - 1]!.hit === k.index;
      if (was && !on) { losses++; offSince = span[i]!.t; }
      if (!was && on && offSince !== null) { reacq.push(span[i]!.t - offSince); offSince = null; }
      if (on) {
        const lag = leadLag(target, span[i]!.t, span[i]!.cross, cfg);
        if (lag !== null) lags.push(lag);
      }
    }
    const subs = segmentSubmovements(log.path, prevT, k.t, from, cfg);
    let gain: number | null = null;
    if (subs.length > 0) {
      const end = trackSwitchTargetAim(target, subs[0]!.t1, cfg);
      const d = angleBetween(from, end);
      if (d > 0) { gain = alongPerp(from, end, subs[0]!.to).along / d; gains.push(gain); }
    }
    killItems.push({ acquireMs: span[first]!.t - prevT, killMs: k.t - span[first]!.t, gain });
  });

  return {
    dmg: flags.length > 0 ? flags.filter(Boolean).length / flags.length : 0,
    logDmgSe: chunkBootstrapSe(flags, cfg, rng), kills: log.kills.length,
    acquireMs: mean(acquire), acquireGain: mean(gains), killMs: mean(killTimes),
    losses, reacquireMs: mean(reacq), leadLagDeg: mean(lags),
    heldFraction: scored.length > 0 ? scored.filter((g) => g.held).length / scored.length : 0, n: scored.length, killItems,
  };
}

/** Crosshair offset along the target's velocity (flat plane), or null when the target is too slow. */
function leadLag(target: TrackSwitchTarget, t: number, cross: Aim, cfg: Config): number | null {
  const a = trackSwitchTargetAim(target, t - VEL_H, cfg), b = trackSwitchTargetAim(target, t + VEL_H, cfg);
  const tgt = trackSwitchTargetAim(target, t, cfg);
  const k = Math.cos(tgt.pitch * RAD);
  const vx = (b.yaw - a.yaw) * k, vy = b.pitch - a.pitch;
  const len = Math.hypot(vx, vy);
  if (len === 0 || (len / (2 * VEL_H)) * MS_PER_S <= cfg.tracking.minSpeedForLeadLag) return null;
  return ((cross.yaw - tgt.yaw) * k * vx + (cross.pitch - tgt.pitch) * vy) / len;
}
