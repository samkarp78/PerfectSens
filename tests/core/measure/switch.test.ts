import { describe, expect, it } from 'vitest';
import { classify } from '../../../src/core/blocks';
import { defaultConfig as cfg } from '../../../src/core/config';
import { measureSwitch, measureSwitchTrials } from '../../../src/core/measure/switch';
import { createRng } from '../../../src/core/rng';
import type { Aim, AimSample, BlockSpec, SwitchBlockLog, SwitchClick } from '../../../src/core/types';
import { minJerkMoves, movesToPath } from '../../helpers/paths';

const spec: BlockSpec = { id: 's', stage: 'baseline', kind: 'switch', cm360: 30, seed: 1, stepIndex: 0, arm: null };
const DPC = 0.01;
const HZ = 1000;
const at = (yaw: number): Aim => ({ yaw, pitch: 0 });

/** n kills, each 20° further along yaw than the previous kill, every `gapMs`; one min-jerk move per switch.
 *  `miss[i]` adds a missed click before kill i at `miss[i]`° past (+) or short of (−) the target. */
function log(n: number, gapMs: number, miss: Record<number, number> = {}): SwitchBlockLog {
  const t0 = 1000;
  const path: AimSample[] = [{ t: t0, yaw: 0, pitch: 0 }];
  const kills = [];
  const clicks: SwitchClick[] = [];
  for (let i = 0; i < n; i++) {
    const prevT = t0 + i * gapMs, t = t0 + (i + 1) * gapMs;
    const from = at(20 * i), target = at(20 * (i + 1));
    path.push(...movesToPath(from, minJerkMoves(from, target, prevT + 50, 250, HZ, DPC), DPC));
    if (miss[i] !== undefined) clicks.push({ t: t - 20, aim: at(20 * (i + 1) + miss[i]!), hit: false });
    clicks.push({ t, aim: target, hit: true });
    kills.push({ t, target, from });
  }
  return { spec, t0, endT: t0 + cfg.switch.blockMs, kills, clicks, path };
}

describe('measureSwitchTrials', () => {
  it('one trial per kill with D from the previous kill aim', () => {
    const trials = measureSwitchTrials(log(3, 500), cfg);
    expect(trials).toHaveLength(3);
    expect(trials[1]!.distance).toBeCloseTo(20, 6);
    expect(trials[1]!.cls).toBe(classify(20, cfg));
    expect(trials[1]!.mtMs).toBe(500);
    expect(trials[1]!.firstGain!).toBeCloseTo(1, 1);
    expect(trials.map((t) => t.scored)).toEqual([false, false, true]);
  });
  it('a misclick sets endAlong and widens We', () => {
    const clean = measureSwitch(log(8, 500), cfg, createRng(1));
    const l = log(8, 500, { 4: 2 });
    expect(measureSwitchTrials(l, cfg)[4]!.endAlong!).toBeCloseTo(2, 6);
    expect(measureSwitch(l, cfg, createRng(1)).weDeg).toBeGreaterThan(clean.weDeg);
  });
});

describe('measureSwitch', () => {
  it('tp is effective throughput over scored switches', () => {
    const r = measureSwitch(log(12, 500), cfg, createRng(1));
    expect(r.n).toBe(12 - cfg.switch.warmKills);
    expect(r.tp).toBeCloseTo(Math.log2(20 / cfg.score.minWeDeg + 1) / 0.5, 6);
    expect(r.kills).toBe(12);
  });
  it('misclickAlong is positive for overshooting misses', () => {
    expect(measureSwitch(log(8, 500, { 3: 2, 5: 1 }), cfg, createRng(1)).misclickAlong!).toBeCloseTo(1.5, 6);
    expect(measureSwitch(log(8, 500, { 3: -2 }), cfg, createRng(1)).misclickAlong!).toBeCloseTo(-2, 6);
    expect(measureSwitch(log(8, 500), cfg, createRng(1)).misclickAlong).toBeNull();
  });
  it('accuracy and misclickRate', () => {
    const r = measureSwitch(log(4, 500, { 1: 1, 2: -1 }), cfg, createRng(1));
    expect(r.clicks).toBe(6);
    expect(r.accuracy).toBeCloseTo(4 / 6, 9);
    expect(r.misclickRate).toBeCloseTo(2 / 6, 9);
  });
  it('only warm-in kills: n = 0, tp 0, finite SE, null gains', () => {
    const r = measureSwitch(log(cfg.switch.warmKills, 500), cfg, createRng(1));
    expect(r.n).toBe(0);
    expect(r.tp).toBe(0);
    expect(Number.isFinite(r.logTpSe)).toBe(true);
    expect(r.smallGain).toBeNull();
    expect(r.clickBias).toBeNull();
  });
  it('no clicks at all: accuracy 0, finite fields', () => {
    const r = measureSwitch(log(0, 500), cfg, createRng(1));
    expect(r.accuracy).toBe(0);
    expect(r.misclickRate).toBe(0);
    expect(Number.isFinite(r.tp)).toBe(true);
  });
  it('bootstrap SE is deterministic and positive for uneven switches', () => {
    const l = log(12, 500, { 3: 1, 6: -1.5, 9: 0.5 });
    const a = measureSwitch(l, cfg, createRng(4)).logTpSe;
    expect(a).toBeGreaterThan(0);
    expect(measureSwitch(l, cfg, createRng(4)).logTpSe).toBe(a);
  });
});
