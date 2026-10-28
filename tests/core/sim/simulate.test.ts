import { describe, it, expect } from 'vitest';
import { defaultConfig as cfg } from '../../../src/core/config';
import { createRng } from '../../../src/core/rng';
import { measureTrial, summarizeFlick } from '../../../src/core/measure/flick';
import { measureTracking } from '../../../src/core/measure/tracking';
import { defaultSimPlayer, performance, type SimPlayer } from '../../../src/core/sim/player';
import { simulateBlock } from '../../../src/core/sim/simulate';
import type { BlockSpec, FlickBlockLog, Setup, TrackingBlockLog } from '../../../src/core/types';

const CURRENT = 40;
const setup: Setup = { dpi: 800, cm360: CURRENT, inGameSens: null, fov: 103, fovType: 'horizontal', mode: 'default' };
const player = (over: Partial<SimPlayer> = {}): SimPlayer => defaultSimPlayer(CURRENT, over);
const OPT = player().optimalCm360;

const spec = (kind: 'flick' | 'tracking', cm360: number, seed: number): BlockSpec =>
  ({ id: `${kind}-${seed}`, stage: 'dialin', kind, cm360, seed, stepIndex: 0, arm: null });

const runFlick = (cm360: number, adapted: number, seed: number, over: Partial<SimPlayer> = {}): FlickBlockLog =>
  simulateBlock(spec('flick', cm360, seed), setup, player(over), { adaptedCm360: adapted, blocksDone: 0 }, createRng(seed + 1000), cfg, 1000).log as FlickBlockLog;

const runTracking = (cm360: number, seed: number) =>
  simulateBlock(spec('tracking', cm360, seed), setup, player(), { adaptedCm360: cm360, blocksDone: 0 }, createRng(seed + 2000), cfg, 1000);

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('performance', () => {
  it('peaks at the optimum, adds familiarity at current, grows with drift', () => {
    const p = player();
    const s = { adaptedCm360: OPT, blocksDone: 0 };
    expect(performance(p, OPT, s)).toBeCloseTo(1, 12);
    expect(performance(p, OPT * 1.4, s)).toBeCloseTo(Math.exp(-2 * Math.log(1.4) ** 2), 12);
    const atCurrent = Math.exp(-2 * Math.log(CURRENT / OPT) ** 2);
    expect(performance(p, CURRENT, s)).toBeCloseTo(atCurrent * 1.02, 12);
    expect(performance(p, OPT, { adaptedCm360: OPT, blocksDone: 10 })).toBeCloseTo(1.02, 12);
  });
});

describe('simulateBlock: flick', () => {
  it('at test = adapted = optimal: ≥ 34 of 36 hits, no timeouts, first gain ≈ 1', () => {
    const log = runFlick(OPT, OPT, 3);
    expect(log.trials).toHaveLength(36);
    expect(log.trials.filter((t) => t.hitT !== null).length).toBeGreaterThanOrEqual(34);
    expect(log.trials.filter((t) => t.timedOut)).toHaveLength(0);
    const gains = log.trials.filter((t) => t.target.scored).map((t) => measureTrial(t, log.path, cfg).firstGain).filter((g): g is number => g !== null);
    expect(gains.length).toBeGreaterThanOrEqual(28);
    expect(Math.abs(mean(gains) - 1)).toBeLessThan(0.05);
  });

  it('adapted = 1.2·test overshoots small and big flicks (no adaptation)', () => {
    const log = runFlick(OPT, OPT * 1.2, 5, { adaptationRate: 0 });
    const m = log.trials.map((t) => measureTrial(t, log.path, cfg));
    const s = summarizeFlick(m, cfg, createRng(1));
    expect(s.smallGain!).toBeGreaterThan(1.1);
    expect(s.bigGain!).toBeGreaterThan(1.1);
  });

  it('same seed gives an identical log and state', () => {
    const a = simulateBlock(spec('flick', 33, 9), setup, player(), { adaptedCm360: 40, blocksDone: 2 }, createRng(9), cfg, 500);
    const b = simulateBlock(spec('flick', 33, 9), setup, player(), { adaptedCm360: 40, blocksDone: 2 }, createRng(9), cfg, 500);
    expect(b).toEqual(a);
    expect(a.state.blocksDone).toBe(3);
    expect(a.state.adaptedCm360).toBeLessThan(40);
    expect(a.state.adaptedCm360).toBeGreaterThan(33);
  });
});

describe('simulateBlock: optimum is better', () => {
  it('flick tp and tracking tot averaged over 10 seeds are higher at the optimum than at 1.4·optimum', () => {
    const tp = (cm: number) => mean([...Array(10).keys()].map((seed) => {
      const log = runFlick(cm, cm, 100 + seed);
      return summarizeFlick(log.trials.map((t) => measureTrial(t, log.path, cfg)), cfg, createRng(seed)).tp;
    }));
    const tot = (cm: number) => mean([...Array(10).keys()].map((seed) =>
      measureTracking(runTracking(cm, 200 + seed).log as TrackingBlockLog, cfg, createRng(seed)).tot));
    expect(tp(OPT)).toBeGreaterThan(tp(OPT * 1.4));
    expect(tot(OPT)).toBeGreaterThan(tot(OPT * 1.4));
  });
});

describe('simulateBlock: tracking', () => {
  it('ends at t0 + leadIn + duration', () => {
    const r = runTracking(OPT, 1);
    const log = r.log as TrackingBlockLog;
    expect(r.endT).toBe(1000 + 28000);
    expect(log.endT).toBe(1000 + 28000);
    expect(log.path.length).toBeGreaterThan(1000);
    expect(log.path[log.path.length - 1]!.t).toBeLessThan(1000 + 28000);
  });
});
