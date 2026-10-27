import { describe, it, expect } from 'vitest';
import { defaultConfig as cfg } from '../../../src/core/config';
import { FlickRunner } from '../../../src/core/run/flickRunner';
import { makeFlickTargets } from '../../../src/core/blocks';
import { angleBetween } from '../../../src/core/geometry';
import { minJerkMoves } from '../../helpers/paths';
import type { BlockSpec, FlickTrial } from '../../../src/core/types';

const spec = (over: Partial<BlockSpec> = {}): BlockSpec =>
  ({ id: 'b', stage: 'baseline', kind: 'flick', cm360: 30, seed: 7, stepIndex: 0, arm: null, ...over });
const DPC = 0.02;
const T0 = 1000;

function moveOnto(r: FlickRunner, start: number): number {
  const target = r.state.target!;
  const moves = minJerkMoves(r.state.aim, target.aim, start, 200, 500, DPC);
  for (const m of moves) r.onMove(m);
  return moves[moves.length - 1]!.t;
}

describe('FlickRunner', () => {
  it('hits target 0, advances, and chains spawn to the click', () => {
    const r = new FlickRunner(spec(), DPC, cfg, T0);
    const t = moveOnto(r, T0);
    expect(angleBetween(r.state.aim, makeFlickTargets(spec(), cfg)[0]!.aim)).toBeLessThanOrEqual(cfg.flick.targetRadiusDeg);
    const aimAtClick = { ...r.state.aim };
    expect(r.onClick(t + 10)).toEqual({ hit: true });
    expect(r.state.trialIndex).toBe(1);
    const [a, b] = r.log().trials as [FlickTrial, FlickTrial];
    expect(a.hitT).toBe(t + 10);
    expect(b.spawnT).toBe(t + 10);
    expect(b.spawnAim).toEqual(aimAtClick);
  });

  it('miss is recorded and keeps the same target', () => {
    const r = new FlickRunner(spec(), DPC, cfg, T0);
    r.onMove({ t: T0 + 5, dx: Math.round(5 / DPC), dy: 0 });
    expect(r.onClick(T0 + 10)).toEqual({ hit: false });
    expect(r.state.trialIndex).toBe(0);
    const tr = r.log().trials[0]!;
    expect(tr.clicks).toHaveLength(1);
    expect(tr.clicks[0]!.hit).toBe(false);
    expect(r.state.target?.index).toBe(0);
  });

  it('times out on tick and spawns the next at spawnT + timeout', () => {
    const r = new FlickRunner(spec(), DPC, cfg, T0);
    r.tick(T0 + 4000);
    const trials = r.log().trials;
    expect(trials[0]!.timedOut).toBe(true);
    expect(trials[1]!.spawnT).toBe(T0 + 4000);
    expect(r.state.trialIndex).toBe(1);
  });

  it('a large time jump fires a chain of timeouts; all-timeout run finishes', () => {
    const r = new FlickRunner(spec(), DPC, cfg, T0);
    r.tick(T0 + 4000 * 36);
    expect(r.state.done).toBe(true);
    expect(r.state.target).toBeNull();
    const trials = r.log().trials;
    expect(trials).toHaveLength(36);
    expect(trials.every((x) => x.timedOut)).toBe(true);
    expect(trials[35]!.spawnT).toBe(T0 + 4000 * 35);
  });

  it('timeouts fire before a move at a later time', () => {
    const r = new FlickRunner(spec(), DPC, cfg, T0);
    r.onMove({ t: T0 + 4001, dx: 1, dy: 0 });
    expect(r.log().trials[0]!.timedOut).toBe(true);
    expect(r.log().trials[1]!.spawnT).toBe(T0 + 4000);
  });

  it('36 hits finish the block; later input is ignored', () => {
    const r = new FlickRunner(spec(), DPC, cfg, T0);
    let t = T0;
    for (let i = 0; i < 36; i++) {
      t = moveOnto(r, t) + 10;
      expect(r.onClick(t).hit).toBe(true);
    }
    expect(r.state.done).toBe(true);
    expect(r.log().trials).toHaveLength(36);
    const n = r.log().path.length;
    r.onMove({ t: t + 5, dx: 10, dy: 10 });
    expect(r.log().path.length).toBe(n);
    expect(r.onClick(t + 10)).toEqual({ hit: false });
  });

  it('each onMove appends exactly one path sample', () => {
    const r = new FlickRunner(spec(), DPC, cfg, T0);
    for (let i = 1; i <= 5; i++) r.onMove({ t: T0 + i, dx: 1, dy: -1 });
    expect(r.log().path).toHaveLength(5);
  });

  it('warmup finishes at warmupMs even with targets left', () => {
    const r = new FlickRunner(spec({ kind: 'warmup', stage: 'warmup' }), DPC, cfg, T0);
    r.tick(T0 + cfg.session.warmupMs - 1);
    expect(r.state.done).toBe(false);
    r.tick(T0 + cfg.session.warmupMs);
    expect(r.state.done).toBe(true);
    expect(r.state.total).toBe(cfg.flick.warmupTargets);
  });
});
