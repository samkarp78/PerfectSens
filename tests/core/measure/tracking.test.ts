import { describe, expect, it } from 'vitest';
import { trackingTargetAt } from '../../../src/core/blocks';
import { defaultConfig } from '../../../src/core/config';
import { measureTracking } from '../../../src/core/measure/tracking';
import { createRng } from '../../../src/core/rng';
import type { Aim, AimSample, BlockSpec, TrackingBlockLog } from '../../../src/core/types';

const cfg = defaultConfig;
const T0 = 1000;
const END = T0 + cfg.tracking.leadInMs + cfg.tracking.durationMs;
const spec: BlockSpec = { id: 'trk', stage: 'baseline', kind: 'tracking', cm360: 30, seed: 7, stepIndex: 0, arm: null };

const pathOf = (fn: (relMs: number) => Aim, from = T0, to = END): AimSample[] => {
  const out: AimSample[] = [];
  for (let t = from; t <= to; t++) out.push({ t, ...fn(t - T0) });
  return out;
};
const logOf = (path: AimSample[]): TrackingBlockLog => ({ spec, t0: T0, endT: END, path });
const target = (rel: number): Aim => trackingTargetAt(spec, rel, cfg);
const rng = () => createRng(1);

describe('measureTracking', () => {
  it('perfect following gives tot 1 and zero lead/lag', () => {
    const r = measureTracking(logOf(pathOf(target)), cfg, rng());
    expect(r.tot).toBe(1);
    expect(Math.abs(r.leadLagDeg)).toBeLessThan(0.05);
    expect(r.n).toBeGreaterThan(0);
  });

  it('a 100 ms delay gives negative lead/lag of about speed x 0.1 s', () => {
    const delay = 100;
    const r = measureTracking(logOf(pathOf((rel) => target(rel - delay))), cfg, rng());
    const h = 1000 / cfg.score.bootstrapSamples; // arbitrary small step in ms for the reference speed
    let sum = 0, n = 0;
    for (let rel = cfg.tracking.leadInMs; rel < END - T0; rel += 10) {
      const a = target(rel), b = target(rel + h);
      const k = Math.cos((a.pitch * Math.PI) / 180);
      const speed = Math.hypot((b.yaw - a.yaw) * k, b.pitch - a.pitch) / (h / 1000);
      if (speed > cfg.tracking.minSpeedForLeadLag) { sum += speed; n++; }
    }
    const expected = (sum / n) * 0.1;
    expect(r.leadLagDeg).toBeLessThan(0);
    expect(Math.abs(r.leadLagDeg)).toBeGreaterThan(expected * 0.7);
    expect(Math.abs(r.leadLagDeg)).toBeLessThan(expected * 1.3);
  });

  it('parked 20 degrees away gives tot 0 and finite logTotSe', () => {
    const r = measureTracking(logOf(pathOf((rel) => ({ yaw: target(rel).yaw + 20, pitch: target(rel).pitch }))), cfg, rng());
    expect(r.tot).toBe(0);
    expect(Number.isFinite(r.logTotSe)).toBe(true);
  });

  it('samples during the lead-in do not affect tot', () => {
    const lead = cfg.tracking.leadInMs;
    const far = (rel: number): Aim => ({ yaw: target(rel).yaw + 20, pitch: target(rel).pitch });
    const path = pathOf((rel) => (rel < lead ? target(rel) : far(rel)));
    // on target only during lead-in; the last lead-in sample is held until the first post-lead-in sample
    expect(measureTracking(logOf(path), cfg, rng()).tot).toBe(0);
  });

  it('bootstrap SE is positive when only part of the run is on target', () => {
    const half = cfg.tracking.leadInMs + cfg.tracking.durationMs / 2;
    const path = pathOf((rel) => (rel < half ? target(rel) : { yaw: target(rel).yaw + 20, pitch: target(rel).pitch }));
    const r = measureTracking(logOf(path), cfg, rng());
    expect(r.tot).toBeGreaterThan(0.4);
    expect(r.tot).toBeLessThan(0.6);
    expect(r.logTotSe).toBeGreaterThan(0);
  });
});
