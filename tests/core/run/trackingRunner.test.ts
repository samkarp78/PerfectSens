import { describe, it, expect } from 'vitest';
import { defaultConfig as cfg } from '../../../src/core/config';
import { TrackingRunner } from '../../../src/core/run/trackingRunner';
import { trackingTargetAt } from '../../../src/core/blocks';
import type { BlockSpec } from '../../../src/core/types';

const spec: BlockSpec = { id: 't', stage: 'baseline', kind: 'tracking', cm360: 30, seed: 3, stepIndex: 0, arm: null };
const DPC = 0.02;
const T0 = 500;
const END = cfg.tracking.leadInMs + cfg.tracking.durationMs;

describe('TrackingRunner', () => {
  it('starts on the target and is done exactly at lead-in + duration', () => {
    const r = new TrackingRunner(spec, DPC, cfg, T0);
    expect(r.state.aim).toEqual(trackingTargetAt(spec, 0, cfg));
    r.tick(T0 + END - 1);
    expect(r.state.done).toBe(false);
    r.tick(T0 + END);
    expect(r.state.done).toBe(true);
    expect(r.log().endT).toBe(T0 + END);
  });

  it('stays on target when the aim follows the target path', () => {
    const r = new TrackingRunner(spec, DPC, cfg, T0);
    let cx = 0, cy = 0;
    for (let ms = 8; ms <= 5000; ms += 8) {
      const tg = trackingTargetAt(spec, ms, cfg);
      const nx = Math.round(tg.yaw / DPC), ny = Math.round(-tg.pitch / DPC);
      r.onMove({ t: T0 + ms, dx: nx - cx, dy: ny - cy });
      cx = nx; cy = ny;
      expect(r.state.onTarget).toBe(true);
    }
    expect(r.log().path).toHaveLength(Math.floor(5000 / 8));
  });

  it('is off target when the aim is far away, and ignores moves after done', () => {
    const r = new TrackingRunner(spec, DPC, cfg, T0);
    r.onMove({ t: T0 + 10, dx: Math.round(10 / DPC), dy: 0 });
    expect(r.state.onTarget).toBe(false);
    r.tick(T0 + END);
    const n = r.log().path.length;
    r.onMove({ t: T0 + END + 5, dx: 5, dy: 5 });
    expect(r.log().path).toHaveLength(n);
  });
});
