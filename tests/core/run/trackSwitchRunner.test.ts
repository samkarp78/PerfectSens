import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../../../src/core/config';
import { angleBetween } from '../../../src/core/geometry';
import { damageTarget, TrackSwitchRunner } from '../../../src/core/run/trackSwitchRunner';
import type { BlockSpec } from '../../../src/core/types';
import { playTrackSwitch } from '../../helpers/trackSwitchPlay';

const spec: BlockSpec = { id: 'ts', stage: 'baseline', kind: 'trackswitch', cm360: 30, seed: 3, stepIndex: 0, arm: null };
const DPC = 0.001;
const T0 = 1000;
const snapTo = (r: TrackSwitchRunner, slot: number, t: number) => {
  const goal = r.state.targets[slot]!.aim, aim = r.state.aim;
  r.onMove({ t, dx: Math.round((goal.yaw - aim.yaw) / DPC), dy: Math.round(-(goal.pitch - aim.pitch) / DPC) });
};

describe('TrackSwitchRunner', () => {
  it('shows active targets at full health and ends at blockMs', () => {
    const r = new TrackSwitchRunner(spec, DPC, cfg, T0);
    expect(r.state.targets).toHaveLength(cfg.trackswitch.active);
    expect(r.state.targets.every((x) => x.health === 1)).toBe(true);
    expect(r.state.endsAt).toBe(T0 + cfg.trackswitch.blockMs);
    expect(r.state.scoredFrom).toBe(T0 + cfg.trackswitch.leadInMs);
    r.tick(T0 + cfg.trackswitch.blockMs);
    expect(r.state.done).toBe(true);
  });
  it('holding on a target for 0.7 s kills it and spawns the next', () => {
    const r = new TrackSwitchRunner(spec, DPC, cfg, T0);
    r.onPress(T0);
    let t = T0 + 1;
    for (; r.state.kills === 0 && t < T0 + 3000; t++) snapTo(r, 0, t);
    const log = r.log();
    expect(log.kills).toHaveLength(1);
    expect(log.kills[0]!.t - (T0 + 1)).toBeGreaterThanOrEqual(cfg.trackswitch.healthMs - 2);
    expect(log.kills[0]!.t - (T0 + 1)).toBeLessThanOrEqual(cfg.trackswitch.healthMs + 2);
    expect(log.targets[0]!.killT).toBe(log.kills[0]!.t);
    expect(log.targets).toHaveLength(cfg.trackswitch.active + 1);
    expect(log.targets[cfg.trackswitch.active]!.spawnT).toBe(log.kills[0]!.t);
    expect(r.state.targets).toHaveLength(cfg.trackswitch.active);
    expect(r.state.targets[0]!.health).toBe(1);
  });
  it('no damage when not held or off target', () => {
    const r = new TrackSwitchRunner(spec, DPC, cfg, T0);
    for (let t = T0 + 1; t < T0 + 1000; t++) snapTo(r, 0, t);
    expect(r.state.targets[0]!.health).toBe(1);
    r.onMove({ t: T0 + 1000, dx: 0, dy: Math.round(-60 / DPC) });
    r.onPress(T0 + 1001);
    r.tick(T0 + 2000);
    expect(r.state.targets.every((x) => x.health === 1)).toBe(true);
    expect(r.state.damaging).toBeNull();
  });
  it('overlapping targets: only the nearest takes damage', () => {
    const aim = { yaw: 0, pitch: 0 };
    expect(damageTarget(aim, [{ yaw: 1, pitch: 0 }, { yaw: 0.5, pitch: 0 }, { yaw: 30, pitch: 0 }], 2)).toBe(1);
    expect(damageTarget(aim, [{ yaw: 3, pitch: 0 }], 2)).toBeNull();
  });
  it('kills record the aim', () => {
    const log = playTrackSwitch(spec, cfg);
    expect(log.kills.length).toBeGreaterThan(5);
    const k = log.kills[0]!;
    // The aim held over the interval that dealt the final damage (moves at k.t apply after it).
    const last = [...log.path].reverse().find((p) => p.t < k.t)!;
    expect(angleBetween(k.aim, last)).toBeLessThan(1e-9);
  });
});
