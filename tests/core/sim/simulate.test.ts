import { describe, it, expect } from 'vitest';
import { defaultConfig as cfg, type Config } from '../../../src/core/config';
import { createRng } from '../../../src/core/rng';
import { measureTrial, summarizeFlick } from '../../../src/core/measure/flick';
import { measureTracking } from '../../../src/core/measure/tracking';
import { defaultSimPlayer, performance, type SimPlayer } from '../../../src/core/sim/player';
import { simulateBlock } from '../../../src/core/sim/simulate';
import type { BlockSpec, FlickBlockLog, Setup, SwitchBlockLog, TrackingBlockLog } from '../../../src/core/types';
import { measureSwitch } from '../../../src/core/measure/switch';
import { measureTrackSwitch } from '../../../src/core/measure/trackSwitch';
import type { TrackSwitchBlockLog } from '../../../src/core/types';

const CURRENT = 40;
const setup: Setup = { dpi: 800, cm360: CURRENT, inGameSens: null, fov: 103, fovType: 'horizontal', mode: 'default' };
const player = (over: Partial<SimPlayer> = {}): SimPlayer => defaultSimPlayer(CURRENT, over);
const OPT = player().optimalCm360;

const spec = (kind: 'flick' | 'switch' | 'tracking' | 'trackswitch', cm360: number, seed: number): BlockSpec =>
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
  it('at test = adapted = optimal: a full block, ≥ 95% hits, no timeouts, first gain ≈ 1', () => {
    const log = runFlick(OPT, OPT, 3);
    const done = log.trials.filter((t) => t.hitT !== null || t.timedOut);
    expect(done.length).toBeGreaterThanOrEqual(14);
    expect(done.filter((t) => t.hitT !== null).length / done.length).toBeGreaterThanOrEqual(0.95);
    expect(log.trials.filter((t) => t.timedOut)).toHaveLength(0);
    const gains = log.trials.filter((t) => t.target.scored).map((t) => measureTrial(t, log.path, cfg).firstGain).filter((g): g is number => g !== null);
    expect(gains.length).toBeGreaterThanOrEqual(12);
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
    expect(r.endT).toBe(1000 + 14000);
    expect(log.endT).toBe(1000 + 14000);
    expect(log.path.length).toBeGreaterThan(1000);
    expect(log.path[log.path.length - 1]!.t).toBeLessThan(1000 + 14000);
  });
});

describe('simulateBlock: flick endT', () => {
  it('a block where every target times out ends at the time limit', () => {
    const fast = { ...cfg, flick: { ...cfg.flick, timeoutMs: 100 } } as unknown as Config; // shorter than the reaction-time floor: every target times out
    const r = simulateBlock(spec('flick', OPT, 4), setup, player(), { adaptedCm360: OPT, blocksDone: 0 }, createRng(4), fast, 1000);
    const trials = (r.log as FlickBlockLog).trials;
    expect(trials.slice(0, -1).every((t) => t.timedOut)).toBe(true);
    expect(r.endT).toBe(1000 + cfg.flick.blockMs);
  });

  it('a warmup that ends by time ends at t0 + warmupMs', () => {
    const short = { ...cfg, session: { ...cfg.session, warmupMs: 5000 } } as unknown as Config;
    const w: BlockSpec = { id: 'warmup', stage: 'warmup', kind: 'warmup', cm360: OPT, seed: 6, stepIndex: 0, arm: null };
    const r = simulateBlock(w, setup, player(), { adaptedCm360: OPT, blocksDone: 0 }, createRng(6), short, 1000);
    expect(r.endT).toBe(1000 + 5000);
  });
});

describe('simulateBlock: switch', () => {
  it('clears targets for the whole block with high accuracy and ends at the time limit', () => {
    const r = simulateBlock(spec('switch', OPT, 5), setup, player(), { adaptedCm360: OPT, blocksDone: 0 }, createRng(5), cfg, 1000);
    const log = r.log as SwitchBlockLog;
    expect(r.endT).toBe(1000 + cfg.switch.blockMs);
    expect(log.kills.length).toBeGreaterThanOrEqual(15);
    expect(log.kills.length / log.clicks.length).toBeGreaterThanOrEqual(0.9);
  });
  it('switch throughput is higher at the optimum than at 1.4·optimum (10 seeds)', () => {
    const tp = (cm: number) => {
      let s = 0;
      for (let seed = 0; seed < 10; seed++) {
        const r = simulateBlock(spec('switch', cm, seed), setup, player(), { adaptedCm360: cm, blocksDone: 0 }, createRng(seed), cfg, 0);
        s += measureSwitch(r.log as SwitchBlockLog, cfg, createRng(seed)).tp;
      }
      return s / 10;
    };
    expect(tp(OPT)).toBeGreaterThan(tp(1.4 * OPT));
  });
});

describe('simulateBlock: tracking switching', () => {
  const runTs = (cm360: number, seed: number) =>
    simulateBlock(spec('trackswitch', cm360, seed), setup, player(), { adaptedCm360: cm360, blocksDone: 0 }, createRng(seed + 3000), cfg, 1000);
  it('simulated trackswitch kills targets and is deterministic', () => {
    const a = runTs(OPT, 1), b = runTs(OPT, 1);
    const log = a.log as TrackSwitchBlockLog;
    expect(log.kills.length).toBeGreaterThan(4);
    expect(a.endT).toBe(1000 + cfg.trackswitch.blockMs);
    expect(b.log).toEqual(a.log);
    expect(measureTrackSwitch(log, cfg, createRng(1)).dmg).toBeGreaterThan(0.3);
  });
  it('better sens → higher dmg', () => {
    const dmg = (cm: number) => mean([...Array(8).keys()].map((seed) =>
      measureTrackSwitch(runTs(cm, 300 + seed).log as TrackSwitchBlockLog, cfg, createRng(seed)).dmg));
    expect(dmg(OPT)).toBeGreaterThan(dmg(OPT * 0.6));
  });
});
