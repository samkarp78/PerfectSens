import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../../../src/core/config';
import { measureTrackSwitch } from '../../../src/core/measure/trackSwitch';
import { createRng } from '../../../src/core/rng';
import type { BlockSpec } from '../../../src/core/types';
import { playTrackSwitch } from '../../helpers/trackSwitchPlay';

const spec: BlockSpec = { id: 'ts', stage: 'baseline', kind: 'trackswitch', cm360: 30, seed: 3, stepIndex: 0, arm: null };

describe('measureTrackSwitch', () => {
  it('dmg = damaging time / scored time', () => {
    const s = measureTrackSwitch(playTrackSwitch(spec, cfg, { gapMs: 100 }), cfg, createRng(1));
    const expected = cfg.trackswitch.healthMs / (cfg.trackswitch.healthMs + 100);
    expect(s.dmg).toBeGreaterThan(expected - 0.04);
    expect(s.dmg).toBeLessThan(expected + 0.04);
    expect(s.heldFraction).toBe(1);
    expect(s.losses).toBe(0);
    expect(s.logDmgSe).toBeGreaterThanOrEqual(0);
  });
  it('acquireMs and killMs from known spawn and kill times', () => {
    const s = measureTrackSwitch(playTrackSwitch(spec, cfg, { gapMs: 200 }), cfg, createRng(1));
    expect(s.acquireMs!).toBeGreaterThan(195);
    expect(s.acquireMs!).toBeLessThan(215);
    expect(s.killMs!).toBeGreaterThan(cfg.trackswitch.healthMs - 10);
    expect(s.killMs!).toBeLessThan(cfg.trackswitch.healthMs + 10);
    expect(Math.abs(s.leadLagDeg!)).toBeLessThan(0.1);
  });
  it('no kills: dmg 0, n > 0, nulls, finite SE', () => {
    const s = measureTrackSwitch(playTrackSwitch(spec, cfg, { press: false }), cfg, createRng(1));
    expect(s.kills).toBe(0);
    expect(s.dmg).toBe(0);
    expect(s.n).toBeGreaterThan(0);
    expect(s.acquireMs).toBeNull();
    expect(s.killMs).toBeNull();
    expect(Number.isFinite(s.logDmgSe)).toBe(true);
    for (const [k, v] of Object.entries(s)) expect(v === null || Number.isFinite(v), k).toBe(true);
  });
});
