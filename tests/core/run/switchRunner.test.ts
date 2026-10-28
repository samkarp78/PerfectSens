import { describe, it, expect } from 'vitest';
import { defaultConfig as cfg } from '../../../src/core/config';
import { makeSwitchTargets } from '../../../src/core/blocks';
import { SwitchRunner } from '../../../src/core/run/switchRunner';
import { angleBetween } from '../../../src/core/geometry';
import { minJerkMoves } from '../../helpers/paths';
import type { BlockSpec } from '../../../src/core/types';

const spec = (over: Partial<BlockSpec> = {}): BlockSpec =>
  ({ id: 's', stage: 'baseline', kind: 'switch', cm360: 30, seed: 9, stepIndex: 0, arm: null, ...over });
const DPC = 0.02;
const T0 = 1000;

describe('makeSwitchTargets', () => {
  it('is deterministic, in the forward region, and keeps the first active set apart', () => {
    const a = makeSwitchTargets(spec(), cfg);
    expect(a).toEqual(makeSwitchTargets(spec(), cfg));
    expect(a.length).toBe(cfg.switch.maxTargets);
    for (const t of a) {
      expect(Math.abs(t.yaw)).toBeLessThanOrEqual(cfg.switch.region.yaw);
      expect(Math.abs(t.pitch)).toBeLessThanOrEqual(cfg.switch.region.pitch);
    }
    const first = a.slice(0, cfg.switch.active);
    for (let i = 0; i < first.length; i++) for (let j = i + 1; j < first.length; j++)
      expect(angleBetween(first[i]!, first[j]!)).toBeGreaterThanOrEqual(cfg.switch.minSeparationDeg);
  });
});

describe('SwitchRunner', () => {
  it('shows several targets; hitting one replaces it and logs a kill with its start aim', () => {
    const r = new SwitchRunner(spec(), DPC, cfg, T0);
    expect(r.state.targets).toHaveLength(cfg.switch.active);
    const goal = r.state.targets[1]!;
    const moves = minJerkMoves(r.state.aim, goal, T0, 200, 500, DPC);
    for (const m of moves) r.onMove(m);
    const t = moves[moves.length - 1]!.t + 10;
    expect(r.onClick(t)).toEqual({ hit: true });
    const log = r.log();
    expect(log.kills).toHaveLength(1);
    expect(log.kills[0]!.from).toEqual({ yaw: 0, pitch: 0 });
    expect(log.kills[0]!.t).toBe(t);
    expect(r.state.targets).toHaveLength(cfg.switch.active);
    expect(r.state.targets).not.toContainEqual(goal);
  });

  it('a miss is logged as a click without a kill', () => {
    const r = new SwitchRunner(spec(), DPC, cfg, T0);
    r.onMove({ t: T0 + 5, dx: 0, dy: Math.round(-40 / DPC) }); // look far up, away from the region
    expect(r.onClick(T0 + 10)).toEqual({ hit: false });
    expect(r.log().clicks).toEqual([{ t: T0 + 10, aim: r.state.aim, hit: false }]);
    expect(r.log().kills).toHaveLength(0);
  });

  it('logs the aim at every click', () => {
    const r = new SwitchRunner(spec(), DPC, cfg, T0);
    r.onMove({ t: T0 + 5, dx: 0, dy: Math.round(-40 / DPC) });
    const away = r.state.aim;
    r.onClick(T0 + 10);
    const goal = r.state.targets[0]!;
    for (const m of minJerkMoves(away, goal, T0 + 20, 200, 500, DPC)) r.onMove(m);
    const here = r.state.aim;
    expect(r.onClick(T0 + 300).hit).toBe(true);
    const clicks = r.log().clicks;
    expect(clicks[0]!.aim).toEqual(away);
    expect(clicks[1]!).toEqual({ t: T0 + 300, aim: here, hit: true });
  });

  it('ends at blockMs and ignores input afterwards', () => {
    const r = new SwitchRunner(spec(), DPC, cfg, T0);
    r.tick(T0 + cfg.switch.blockMs - 1);
    expect(r.state.done).toBe(false);
    r.tick(T0 + cfg.switch.blockMs);
    expect(r.state.done).toBe(true);
    expect(r.state.endsAt).toBe(T0 + cfg.switch.blockMs);
    expect(r.onClick(T0 + cfg.switch.blockMs + 1)).toEqual({ hit: false });
    expect(r.log().endT).toBe(T0 + cfg.switch.blockMs);
  });
});
