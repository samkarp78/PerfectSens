import { describe, it, expect } from 'vitest';
import { defaultConfig as cfg } from '../../src/core/config';
import { classify, makeFlickTargets, trackingTargetAt } from '../../src/core/blocks';
import type { BlockSpec } from '../../src/core/types';

const spec = (over: Partial<BlockSpec> = {}): BlockSpec =>
  ({ id: 'b', stage: 'baseline', kind: 'flick', cm360: 30, seed: 7, stepIndex: 0, arm: null, ...over });

describe('makeFlickTargets', () => {
  it('flick: 6 unscored then all 30 distances scored', () => {
    const t = makeFlickTargets(spec(), cfg);
    expect(t).toHaveLength(36);
    expect(t.slice(0, 6).every((x) => !x.scored)).toBe(true);
    expect(t.slice(6).every((x) => x.scored)).toBe(true);
    const d = t.slice(6).map((x) => x.distance).sort((a, b) => a - b);
    expect(d).toEqual([...cfg.flick.distancesDeg].sort((a, b) => a - b));
    expect(t.map((x) => x.index)).toEqual(t.map((_, i) => i));
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
