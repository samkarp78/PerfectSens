import { describe, it, expect } from 'vitest';
import { configForPlayAlong, defaultConfig as cfg, defaultConfig } from '../../src/core/config';
import { classify, makeFlickTargets, makeTrackSwitchTargets, movingAimAt, trackingTargetAt } from '../../src/core/blocks';
import type { BlockSpec } from '../../src/core/types';

const spec = (over: Partial<BlockSpec> = {}): BlockSpec =>
  ({ id: 'b', stage: 'baseline', kind: 'flick', cm360: 30, seed: 7, stepIndex: 0, arm: null, ...over });

describe('makeFlickTargets', () => {
  it('flick: waves of small→big with an equal class mix; wave 0 is unscored warm-in', () => {
    const t = makeFlickTargets(spec(), cfg);
    const W = 3 * cfg.flick.wavePerClass;
    expect(t.length).toBeGreaterThanOrEqual(cfg.flick.maxBlockTargets);
    expect(t.length % W).toBe(0);
    expect(t.map((x) => x.index)).toEqual(t.map((_, i) => i));
    for (let w = 0; w < t.length / W; w++) {
      const wave = t.slice(w * W, (w + 1) * W);
      expect(wave.every((x) => x.wave === w)).toBe(true);
      expect(wave.every((x) => x.scored === (w > 0))).toBe(true);
      for (const cls of ['small', 'medium', 'big'] as const) expect(wave.filter((x) => x.cls === cls)).toHaveLength(cfg.flick.wavePerClass);
      const third = W / 3;
      const mean = (a: { distance: number }[]) => a.reduce((s, x) => s + x.distance, 0) / a.length;
      expect(mean(wave.slice(0, third))).toBeLessThan(mean(wave.slice(-third))); // builds from small to big
    }
  });
  it('is deterministic and seed-sensitive', () => {
    expect(makeFlickTargets(spec(), cfg)).toEqual(makeFlickTargets(spec(), cfg));
    const a = makeFlickTargets(spec(), cfg).map((x) => x.distance);
    const b = makeFlickTargets(spec({ seed: 8 }), cfg).map((x) => x.distance);
    expect(a).not.toEqual(b);
  });
  it('stays in bounds and distances are flat distances from the previous target', () => {
    for (const seed of [1, 2, 3, 4, 5, 99, 1234]) {
      for (const kind of ['flick', 'warmup'] as const) {
        const t = makeFlickTargets(spec({ seed, kind }), cfg);
        let prev = { yaw: 0, pitch: 0 };
        for (const x of t) {
          expect(Math.abs(x.aim.yaw)).toBeLessThanOrEqual(cfg.flick.bounds.yaw + 1e-9);
          expect(Math.abs(x.aim.pitch)).toBeLessThanOrEqual(cfg.flick.bounds.pitch + 1e-9);
          expect(Math.hypot(x.aim.yaw - prev.yaw, x.aim.pitch - prev.pitch)).toBeCloseTo(x.distance, 9);
          prev = x.aim;
        }
      }
    }
  });
  it('warmup: 300 unscored targets', () => {
    const t = makeFlickTargets(spec({ kind: 'warmup', stage: 'warmup' }), cfg);
    expect(t).toHaveLength(300);
    expect(t.every((x) => !x.scored)).toBe(true);
  });
  it('rejects tracking', () => {
    expect(() => makeFlickTargets(spec({ kind: 'tracking' }), cfg)).toThrow();
  });
});

describe('classify', () => {
  it('splits small / medium / big', () => {
    expect(classify(21, cfg)).toBe('small');
    expect(classify(22, cfg)).toBe('medium');
    expect(classify(35, cfg)).toBe('medium');
    expect(classify(36, cfg)).toBe('big');
  });
});

describe('trackingTargetAt', () => {
  const s = spec({ kind: 'tracking', seed: 11 });
  it('starts at origin and is deterministic', () => {
    expect(trackingTargetAt(s, 0, cfg)).toEqual({ yaw: 0, pitch: 0 });
    expect(trackingTargetAt(s, 1234, cfg)).toEqual(trackingTargetAt(s, 1234, cfg));
  });
  it('is continuous and within bounds', () => {
    const end = cfg.tracking.leadInMs + cfg.tracking.durationMs;
    for (const seed of [11, 12, 13]) {
      const sp = spec({ kind: 'tracking', seed });
      for (let t = 0; t <= end; t += 10) {
        const a = trackingTargetAt(sp, t, cfg), b = trackingTargetAt(sp, t + 1, cfg);
        expect(Math.hypot(a.yaw - b.yaw, a.pitch - b.pitch)).toBeLessThan(0.1);
        expect(Math.abs(a.yaw)).toBeLessThanOrEqual(cfg.tracking.bounds.yaw + 1e-9);
        expect(Math.abs(a.pitch)).toBeLessThanOrEqual(cfg.tracking.bounds.pitch + 1e-9);
      }
    }
  });
});

describe('movingAimAt and tracking-switching targets', () => {
  const tspec = { id: 't', stage: 'baseline' as const, kind: 'tracking' as const, cm360: 30, seed: 4242, stepIndex: 0, arm: null };
  it('trackingTargetAt unchanged after the movingAimAt refactor', () => {
    const gold = [{ yaw: 0, pitch: 0 }, { yaw: -17.503637600880353, pitch: -0.13238864665353844 },
      { yaw: 2.5095286945518183, pitch: -2.4998703799110586 }, { yaw: 5.822488188995209, pitch: 8.277554488594298 },
      { yaw: 3.0182929397241764, pitch: -5.497429541825653 }];
    [0, 1234.5, 5000, 9999, 13999].forEach((t, i) => expect(trackingTargetAt(tspec, t, defaultConfig)).toEqual(gold[i]));
  });
  it('movingAimAt stays inside bounds and is deterministic per seed', () => {
    const ts = defaultConfig.trackswitch;
    const origin = { yaw: 30, pitch: -10 };
    expect(movingAimAt(7, origin, 0, ts.region, ts)).toEqual(origin);
    for (let t = 0; t < 20000; t += 37) {
      const a = movingAimAt(7, origin, t, ts.region, ts);
      expect(Math.abs(a.yaw)).toBeLessThanOrEqual(ts.region.yaw + 1e-9);
      expect(Math.abs(a.pitch)).toBeLessThanOrEqual(ts.region.pitch + 1e-9);
      expect(a).toEqual(movingAimAt(7, origin, t, ts.region, ts));
    }
    expect(movingAimAt(8, origin, 3000, ts.region, ts)).not.toEqual(movingAimAt(7, origin, 3000, ts.region, ts));
  });
  it('makeTrackSwitchTargets: deterministic origins in the region, first active set apart', () => {
    const sspec = { ...tspec, kind: 'trackswitch' as const };
    const a = makeTrackSwitchTargets(sspec, defaultConfig);
    expect(a).toEqual(makeTrackSwitchTargets(sspec, defaultConfig));
    expect(a).toHaveLength(defaultConfig.trackswitch.maxTargets);
    for (const t of a) expect(Math.abs(t.origin.yaw)).toBeLessThanOrEqual(defaultConfig.trackswitch.region.yaw);
    const first = a.slice(0, defaultConfig.trackswitch.active);
    for (let i = 0; i < first.length; i++) for (let j = i + 1; j < first.length; j++)
      expect(Math.hypot(first[i]!.origin.yaw - first[j]!.origin.yaw, first[i]!.origin.pitch - first[j]!.origin.pitch))
        .toBeGreaterThanOrEqual(defaultConfig.trackswitch.minSeparationDeg);
  });
});

describe('makeFlickTargets without the warm-in wave', () => {
  it('scores from the first target', () => {
    const t = makeFlickTargets(spec(), { ...configForPlayAlong(), flick: { ...configForPlayAlong().flick, warmWave: false } } as typeof cfg);
    expect(t.every((x) => x.scored)).toBe(true);
  });
});
