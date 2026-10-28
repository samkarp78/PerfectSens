import { describe, expect, it } from 'vitest';
import { trackingTargetAt, trackingTurns, trackingVelocityAt } from '../../../src/core/blocks';
import { defaultConfig } from '../../../src/core/config';
import { measureTrackingDetail } from '../../../src/core/measure/trackingDetail';
import type { Aim, AimSample, BlockSpec, HoldEvent, TrackingBlockLog } from '../../../src/core/types';

const cfg = defaultConfig;
const T0 = 1000;
const END = T0 + cfg.tracking.leadInMs + cfg.tracking.durationMs;
const spec: BlockSpec = { id: 'trk', stage: 'baseline', kind: 'tracking', cm360: 30, seed: 7, stepIndex: 0, arm: null };
const RAD = Math.PI / 180;

const target = (rel: number): Aim => trackingTargetAt(spec, rel, cfg);
const pathOf = (fn: (relMs: number) => Aim): AimSample[] => {
  const out: AimSample[] = [];
  for (let t = T0; t <= END; t++) out.push({ t, ...fn(t - T0) });
  return out;
};
const logOf = (path: AimSample[], holds?: HoldEvent[]): TrackingBlockLog => ({ spec, t0: T0, endT: END, path, holds });
/** Unit direction of the target's motion in yaw/pitch degrees (flat plane, cos-scaled back to yaw). */
const dirAt = (rel: number): { yaw: number; pitch: number } => {
  const v = trackingVelocityAt(spec, rel, cfg);
  const k = Math.cos(target(rel).pitch * RAD);
  const len = Math.hypot(v.yaw * k, v.pitch) || 1;
  return { yaw: (v.yaw * k) / len / k, pitch: v.pitch / len };
};

describe('trackingVelocityAt / trackingTurns', () => {
  it('velocity matches the finite difference of the target path', () => {
    const a = target(5000), b = target(5001);
    const v = trackingVelocityAt(spec, 5000.5, cfg);
    expect(v.yaw).toBeCloseTo((b.yaw - a.yaw) * 1000, 3);
    expect(v.pitch).toBeCloseTo((b.pitch - a.pitch) * 1000, 3);
  });
  it('turns are segment changes of more than turnMinDeg', () => {
    const turns = trackingTurns(spec, 0, 20000, cfg);
    expect(turns.length).toBeGreaterThan(0);
    for (const t of turns) {
      const u = trackingVelocityAt(spec, t - 5, cfg), w = trackingVelocityAt(spec, t + 5, cfg);
      const cos = (u.yaw * w.yaw + u.pitch * w.pitch) / (Math.hypot(u.yaw, u.pitch) * Math.hypot(w.yaw, w.pitch));
      expect(cos).toBeLessThan(Math.cos(cfg.tracking.turnMinDeg * RAD) + 1e-9);
    }
  });
});

describe('measureTrackingDetail', () => {
  it('perfect follow: errors ≈ 0, speedRatio ≈ 1, losses 0, heldFraction 1', () => {
    const d = measureTrackingDetail(logOf(pathOf(target)), cfg);
    expect(d.errMean!).toBeLessThan(0.05);
    expect(d.errRms!).toBeLessThan(0.05);
    expect(d.speedRatio!).toBeCloseTo(1, 1);
    expect(d.losses).toBe(0);
    expect(d.heldFraction).toBe(1);
    expect(d.totFirstHalf).toBe(1);
    expect(d.totSecondHalf).toBe(1);
  });
  it('constant 1° lag: alongRms ≈ 1, perpRms ≈ 0', () => {
    const d = measureTrackingDetail(logOf(pathOf((rel) => {
      const t = target(rel), u = dirAt(rel);
      return { yaw: t.yaw - u.yaw, pitch: t.pitch - u.pitch };
    })), cfg);
    expect(d.alongRms!).toBeCloseTo(1, 1);
    expect(d.perpRms!).toBeLessThan(0.15);
  });
  it('crosshair at 1.2× target speed gives speedRatio ≈ 1.2', () => {
    const o = target(0);
    const d = measureTrackingDetail(logOf(pathOf((rel) => {
      const t = target(rel);
      return { yaw: o.yaw + 1.2 * (t.yaw - o.yaw), pitch: o.pitch + 1.2 * (t.pitch - o.pitch) };
    })), cfg);
    expect(d.speedRatio!).toBeGreaterThan(1.15);
    expect(d.speedRatio!).toBeLessThan(1.25);
  });
  it('button released for 0.5 s on target: losses 1, releasesOnTarget 1, reacquireMs ≈ 500', () => {
    const holds: HoldEvent[] = [{ t: T0, down: true }, { t: T0 + 5000, down: false }, { t: T0 + 5500, down: true }];
    const d = measureTrackingDetail(logOf(pathOf(target), holds), cfg);
    expect(d.losses).toBe(1);
    expect(d.releasesOnTarget).toBe(1);
    expect(d.reacquireMs!).toBeGreaterThan(490);
    expect(d.reacquireMs!).toBeLessThan(510);
    expect(d.heldFraction).toBeLessThan(1);
  });
  it('turn reaction ≈ the injected 200 ms delay', () => {
    const d = measureTrackingDetail(logOf(pathOf((rel) => target(rel - 200))), cfg);
    expect(d.turnReactionMs!).toBeGreaterThan(180);
    expect(d.turnReactionMs!).toBeLessThan(225);
    expect(d.turnOvershootDeg!).toBeGreaterThan(0);
    expect(d.turnSettleMs).not.toBeUndefined();
  });
  it('pitch-only offset: pitchErrRms > yawErrRms', () => {
    const d = measureTrackingDetail(logOf(pathOf((rel) => ({ ...target(rel), pitch: target(rel).pitch + 1 }))), cfg);
    expect(d.pitchErrRms!).toBeCloseTo(1, 1);
    expect(d.yawErrRms!).toBeLessThan(0.05);
  });
  it('slow vs fast targets split ToT', () => {
    const d = measureTrackingDetail(logOf(pathOf(target)), cfg);
    expect(d.totSlow === null || d.totSlow === 1).toBe(true);
    expect(d.totFast === null || d.totFast === 1).toBe(true);
  });
  it('never held: all fields finite or null', () => {
    const d = measureTrackingDetail(logOf(pathOf(target), []), cfg);
    expect(d.heldFraction).toBe(0);
    for (const [k, v] of Object.entries(d)) expect(v === null || Number.isFinite(v), k).toBe(true);
  });
});
