import type { Config } from './config';
import { createRng, type Rng } from './rng';
import { offsetAim } from './geometry';
import type { Aim, BlockSpec, FlickClass, FlickTarget } from './types';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const HALF_TURN_DEG = 180;
const MS_PER_S = 1000;

export function classify(distanceDeg: number, cfg: Config): FlickClass {
  if (distanceDeg < cfg.flick.smallMaxDeg) return 'small';
  if (distanceDeg > cfg.flick.bigMinDeg) return 'big';
  return 'medium';
}

function at<T>(a: readonly T[], i: number): T {
  const v = a[i];
  if (v === undefined) throw new Error('index out of range');
  return v;
}

const uniform = (rng: Rng, lo: number, hi: number): number => lo + rng.next() * (hi - lo);

function inBounds(a: Aim, b: { yaw: number; pitch: number }): boolean {
  return Math.abs(a.yaw) <= b.yaw && Math.abs(a.pitch) <= b.pitch;
}

function nextAim(prev: Aim, distance: number, rng: Rng, cfg: Config): Aim {
  const spread = cfg.flick.directionSpreadDeg;
  const theta = (rng.int(0, 1) === 0 ? 0 : HALF_TURN_DEG) + uniform(rng, -spread, spread);
  const candidates = [
    theta,
    HALF_TURN_DEG - theta, // mirror horizontally
    -theta,                // mirror vertically
    theta + HALF_TURN_DEG, // both
    Math.atan2(-prev.pitch, -prev.yaw) * DEG, // toward centre
  ];
  for (const c of candidates) {
    const a = offsetAim(prev, distance, c);
    if (inBounds(a, cfg.flick.bounds)) return a;
  }
  return offsetAim(prev, distance, at(candidates, candidates.length - 1));
}

export function makeFlickTargets(spec: BlockSpec, cfg: Config): FlickTarget[] {
  if (spec.kind === 'tracking') throw new Error('makeFlickTargets: tracking blocks have no flick targets');
  const rng = createRng(spec.seed);
  const dists = cfg.flick.distancesDeg;
  const plan: { distance: number; scored: boolean; wave: number }[] = [];
  if (spec.kind === 'warmup') {
    for (let i = 0; i < cfg.flick.warmupTargets; i++) {
      plan.push({ distance: at(dists, rng.int(0, dists.length - 1)), scored: false, wave: 0 });
    }
  } else {
    const fc = cfg.flick;
    const pools = (['small', 'medium', 'big'] as const).map((c) => dists.filter((d) => classify(d, cfg) === c));
    const waveSize = 3 * fc.wavePerClass;
    const waves = Math.ceil(fc.maxBlockTargets / waveSize);
    for (let w = 0; w < waves; w++) {
      const picks = pools.flatMap((pool) => rng.shuffle(pool).slice(0, fc.wavePerClass));
      // Roughly small→big: sort by distance scaled by a little random jitter.
      const keyed = picks.map((d) => ({ d, key: d * (1 + uniform(rng, -fc.waveOrderJitter, fc.waveOrderJitter)) }));
      keyed.sort((a, b) => a.key - b.key);
      for (const k of keyed) plan.push({ distance: k.d, scored: w > 0, wave: w });
    }
  }
  const out: FlickTarget[] = [];
  let prev: Aim = { yaw: 0, pitch: 0 };
  plan.forEach((p, index) => {
    const aim = nextAim(prev, p.distance, rng, cfg);
    out.push({ index, aim, distance: p.distance, cls: classify(p.distance, cfg), scored: p.scored, wave: p.wave });
    prev = aim;
  });
  return out;
}

interface Segment { t0: number; t1: number; x0: number; y0: number; vx: number; vy: number } // raw (unfolded) path, deg and deg/ms
interface Path { rng: Rng; segs: Segment[] }

const paths = new WeakMap<Config, Map<number, Path>>();

function pathFor(seed: number, cfg: Config): Path {
  let bySeed = paths.get(cfg);
  if (!bySeed) paths.set(cfg, (bySeed = new Map()));
  let p = bySeed.get(seed);
  if (!p) bySeed.set(seed, (p = { rng: createRng(seed), segs: [] }));
  return p;
}

function extend(p: Path, tMs: number, cfg: Config): void {
  const tc = cfg.tracking;
  while (p.segs.length === 0 || at(p.segs, p.segs.length - 1).t1 <= tMs) {
    const last = p.segs[p.segs.length - 1];
    const t0 = last ? last.t1 : 0;
    const x0 = last ? last.x0 + last.vx * (last.t1 - last.t0) : 0;
    const y0 = last ? last.y0 + last.vy * (last.t1 - last.t0) : 0;
    const dur = uniform(p.rng, tc.segmentMs.min, tc.segmentMs.max);
    const speed = uniform(p.rng, tc.speedDegPerSec.min, tc.speedDegPerSec.max) / MS_PER_S;
    const theta = (p.rng.int(0, 1) === 0 ? 0 : HALF_TURN_DEG) + uniform(p.rng, -tc.directionSpreadDeg, tc.directionSpreadDeg);
    p.segs.push({ t0, t1: t0 + dur, x0, y0, vx: speed * Math.cos(theta * RAD), vy: speed * Math.sin(theta * RAD) });
  }
}

// Reflecting at ±bound is a triangle-wave fold of the unbounded path.
function fold(x: number, bound: number): number {
  const period = 4 * bound;
  const m = ((x + bound) % period + period) % period;
  return (m <= 2 * bound ? m : period - m) - bound;
}

export function trackingTargetAt(spec: BlockSpec, tMs: number, cfg: Config): Aim {
  const p = pathFor(spec.seed, cfg);
  const t = Math.max(0, tMs);
  extend(p, t, cfg);
  let lo = 0, hi = p.segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(p.segs, mid).t1 <= t) lo = mid + 1; else hi = mid;
  }
  const s = at(p.segs, lo);
  const dt = t - s.t0;
  return { yaw: fold(s.x0 + s.vx * dt, cfg.tracking.bounds.yaw), pitch: fold(s.y0 + s.vy * dt, cfg.tracking.bounds.pitch) };
}

/** Target velocity (deg/s in yaw and pitch) at tMs: central difference over ±0.5 ms of the folded path. */
export function trackingVelocityAt(spec: BlockSpec, tMs: number, cfg: Config): { yaw: number; pitch: number } {
  const h = 0.5;
  const a = trackingTargetAt(spec, tMs - h, cfg), b = trackingTargetAt(spec, tMs + h, cfg);
  return { yaw: ((b.yaw - a.yaw) / (2 * h)) * MS_PER_S, pitch: ((b.pitch - a.pitch) / (2 * h)) * MS_PER_S };
}

/** Segment-change times (rel ms) in [fromMs, toMs) where the target turns by more than tracking.turnMinDeg. */
export function trackingTurns(spec: BlockSpec, fromMs: number, toMs: number, cfg: Config): number[] {
  const p = pathFor(spec.seed, cfg);
  extend(p, toMs, cfg);
  const probe = 5;
  const out: number[] = [];
  for (const seg of p.segs) {
    const t = seg.t0;
    if (t < Math.max(fromMs, probe) || t >= toMs) continue;
    const u = trackingVelocityAt(spec, t - probe, cfg), w = trackingVelocityAt(spec, t + probe, cfg);
    const k = Math.cos(trackingTargetAt(spec, t, cfg).pitch * RAD);
    const cos = (u.yaw * w.yaw * k * k + u.pitch * w.pitch) / (Math.hypot(u.yaw * k, u.pitch) * Math.hypot(w.yaw * k, w.pitch));
    if (cos < Math.cos(cfg.tracking.turnMinDeg * RAD)) out.push(t);
  }
  return out;
}

/** Seeded switching targets: uniform in the forward region, each at least minSeparationDeg from the previous `active - 1`
 *  targets (the ones that can be on screen with it). */
export function makeSwitchTargets(spec: BlockSpec, cfg: Config): Aim[] {
  const sc = cfg.switch;
  const rng = createRng(spec.seed);
  const out: Aim[] = [];
  while (out.length < sc.maxTargets) {
    const recent = out.slice(-(sc.active - 1));
    let a: Aim = { yaw: 0, pitch: 0 };
    for (let tries = 0; tries < 50; tries++) {
      a = { yaw: uniform(rng, -sc.region.yaw, sc.region.yaw), pitch: uniform(rng, -sc.region.pitch, sc.region.pitch) };
      if (recent.every((r) => Math.hypot(r.yaw - a.yaw, r.pitch - a.pitch) >= sc.minSeparationDeg)) break;
    }
    out.push(a);
  }
  return out;
}
