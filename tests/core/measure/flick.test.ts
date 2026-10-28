import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../../src/core/config';
import { measureTrial, summarizeFlick, throughput } from '../../../src/core/measure/flick';
import type { TrialMetrics } from '../../../src/core/measure/flick';
import { createRng } from '../../../src/core/rng';
import type { Aim, AimSample, FlickTrial } from '../../../src/core/types';
import { minJerkMoves, movesToPath } from '../../helpers/paths';

const DPC = 0.01;
const HZ = 1000;
const O: Aim = { yaw: 0, pitch: 0 };
const at = (yaw: number): Aim => ({ yaw, pitch: 0 });
const move = (from: Aim, to: Aim, t0: number, dur: number): AimSample[] =>
  movesToPath(from, minJerkMoves(from, to, t0, dur, HZ, DPC), DPC);
const hold = (a: Aim, t0: number, t1: number): AimSample[] => {
  const out: AimSample[] = [];
  for (let t = t0; t <= t1; t++) out.push({ t, ...a });
  return out;
};

const metric = (over: Partial<TrialMetrics> = {}): TrialMetrics => ({
  index: 0, cls: 'medium', distance: 20, mtMs: 500, firstGain: 1, corrections: 0,
  endAlong: 0, endPerp: 0, hit: true, timedOut: false, scored: true, ...over,
});
const alternating = (n: number): TrialMetrics[] =>
  Array.from({ length: n }, (_, i) => metric({ index: i, endAlong: i % 2 ? -1 : 1 }));

describe('throughput', () => {
  it('computes We and TP from end-point scatter', () => {
    const r = throughput(alternating(10), defaultConfig);
    expect(r.tp).toBeCloseTo(4.966, 2);
    expect(r.weDeg).toBeCloseTo(4.357, 2);
  });

  it('floors We at minWeDeg when all end points are exact', () => {
    const r = throughput(Array.from({ length: 10 }, (_, i) => metric({ index: i })), defaultConfig);
    expect(r.weDeg).toBe(defaultConfig.score.minWeDeg);
    expect(Number.isFinite(r.tp)).toBe(true);
  });

  it('ignores unscored trials', () => {
    const trials = [...alternating(10), metric({ scored: false, endAlong: 50, mtMs: 4000, distance: 60 })];
    expect(throughput(trials, defaultConfig)).toEqual(throughput(alternating(10), defaultConfig));
  });

  it('handles timed-out trials without clicks', () => {
    const trials = [...alternating(10), metric({ timedOut: true, hit: false, mtMs: 4000, endAlong: null, endPerp: null, firstGain: null })];
    const r = throughput(trials, defaultConfig);
    expect(Number.isFinite(r.tp)).toBe(true);
    expect(r.tp).toBeGreaterThan(0);
    expect(r.tp).toBeLessThan(throughput(alternating(10), defaultConfig).tp);
  });

  it('falls back to minWeDeg when no trial has a click', () => {
    const r = throughput([metric({ endAlong: null, mtMs: 4000, timedOut: true, hit: false })], defaultConfig);
    expect(r.weDeg).toBe(defaultConfig.score.minWeDeg);
    expect(Number.isFinite(r.tp)).toBe(true);
  });
});

describe('measureTrial', () => {
  const trialBase = (over: Partial<FlickTrial>): FlickTrial => ({
    target: { index: 3, aim: at(20), distance: 20, cls: 'medium', scored: true, wave: 1 },
    spawnT: 0, spawnAim: O, clicks: [], hitT: null, timedOut: false, ...over,
  });

  it('measures overshoot gain and one correction', () => {
    const path = [...move(O, at(22), 0, 200), ...hold(at(22), 201, 300), ...move(at(22), at(20), 300, 80), ...hold(at(20), 381, 500)];
    const trial = trialBase({ clicks: [{ t: 450, aim: at(20), hit: true }], hitT: 450 });
    const m = measureTrial(trial, path, defaultConfig);
    expect(m.firstGain).not.toBeNull();
    expect(Math.abs(m.firstGain! - 1.1)).toBeLessThanOrEqual(0.03);
    expect(m.corrections).toBe(1);
    expect(m.hit).toBe(true);
    expect(m.mtMs).toBe(450);
    expect(m.distance).toBeCloseTo(20, 6);
    expect(m.endAlong!).toBeCloseTo(0, 6);
    expect(m.endPerp!).toBeCloseTo(0, 6);
    expect(m.index).toBe(3);
    expect(m.cls).toBe('medium');
  });

  it('reports click offset along and perpendicular to the axis', () => {
    const trial = trialBase({ clicks: [{ t: 300, aim: { yaw: 21, pitch: 0.5 }, hit: true }], hitT: 300 });
    const m = measureTrial(trial, [], defaultConfig);
    expect(m.endAlong!).toBeCloseTo(1, 2);
    expect(m.endPerp!).toBeCloseTo(0.5, 2);
    expect(m.firstGain).toBeNull();
  });

  it('gives timeoutMs and null end point for a timed-out trial with no clicks', () => {
    const m = measureTrial(trialBase({ timedOut: true }), [], defaultConfig);
    expect(m.mtMs).toBe(4000);
    expect(m.endAlong).toBeNull();
    expect(m.endPerp).toBeNull();
    expect(m.hit).toBe(false);
    expect(m.timedOut).toBe(true);
    expect(m.corrections).toBe(0);
    expect(throughput([m], defaultConfig).tp).toBeGreaterThanOrEqual(0);
  });
});

describe('summarizeFlick', () => {
  const noisy = (): TrialMetrics[] => {
    const rng = createRng(5);
    return Array.from({ length: 30 }, (_, i) =>
      metric({ index: i, cls: (['small', 'medium', 'big'] as const)[i % 3]!, firstGain: 0.9 + 0.1 * (i % 3),
        mtMs: 400 + rng.int(0, 300), endAlong: rng.normal() * 2, corrections: i % 2 }));
  };

  it('is deterministic for a seed and positive for noisy data', () => {
    const a = summarizeFlick(noisy(), defaultConfig, createRng(11));
    const b = summarizeFlick(noisy(), defaultConfig, createRng(11));
    expect(a.logTpSe).toBe(b.logTpSe);
    expect(a.logTpSe).toBeGreaterThan(0);
    expect(a.n).toBe(30);
  });

  it('computes class gains, spread ratio and timeout fraction', () => {
    const trials = [...noisy(), metric({ cls: 'big', timedOut: true, hit: false, endAlong: null, firstGain: null, mtMs: 4000 })];
    const s = summarizeFlick(trials, defaultConfig, createRng(1));
    expect(s.smallGain).toBeCloseTo(0.9, 6);
    expect(s.mediumGain).toBeCloseTo(1.0, 6);
    expect(s.bigGain).toBeCloseTo(1.1, 6);
    expect(s.spreadRatio).toBeCloseTo(s.weDeg / (2 * defaultConfig.flick.targetRadiusDeg), 9);
    expect(s.timeoutFraction).toBeCloseTo(1 / 31, 9);
  });

  it('returns null gain for an empty class', () => {
    const s = summarizeFlick(alternating(10), defaultConfig, createRng(1));
    expect(s.smallGain).toBeNull();
    expect(s.mediumGain).toBe(1);
  });
});

describe('summarizeFlick NaN guard', () => {
  it('stays finite when trials have zero along-travel', () => {
    const trials = Array.from({ length: 6 }, (_, i) => metric({ index: i, distance: 0, endAlong: 0 }));
    const s = summarizeFlick(trials, defaultConfig, createRng(1));
    expect(Number.isFinite(s.logTpSe)).toBe(true);
    expect(Number.isFinite(s.tp)).toBe(true);
  });

  it('stays finite when some trials have negative effective distance', () => {
    const trials = Array.from({ length: 6 }, (_, i) => metric({ index: i, distance: 1, endAlong: -5 }));
    expect(Number.isFinite(summarizeFlick(trials, defaultConfig, createRng(2)).logTpSe)).toBe(true);
  });
});

describe('measureFlickBlock: only complete waves are scored', () => {
  it('scores a wave only once every target in it is resolved', async () => {
    const { FlickRunner } = await import('../../../src/core/run/flickRunner');
    const { measureFlickBlock } = await import('../../../src/core/measure/flick');
    const { minJerkMoves } = await import('../../helpers/paths');
    const spec = { id: 'b', stage: 'baseline' as const, kind: 'flick' as const, cm360: 30, seed: 7, stepIndex: 0, arm: null };
    const W = 3 * defaultConfig.flick.wavePerClass;
    const play = (hits: number) => {
      const r = new FlickRunner(spec, 0.02, defaultConfig, 0);
      let t = 0;
      for (let i = 0; i < hits; i++) {
        const moves = minJerkMoves(r.state.aim, r.state.target!.aim, t, 200, 500, 0.02);
        for (const m of moves) r.onMove(m);
        t = moves[moves.length - 1]!.t + 10;
        r.onClick(t);
      }
      return measureFlickBlock(r.log(), defaultConfig); // mid-block: the open wave is still unresolved
    };
    expect(play(W + 3).filter((m) => m.scored)).toHaveLength(0); // wave 0 is warm-in, wave 1 unfinished
    expect(play(2 * W).filter((m) => m.scored)).toHaveLength(W);
  });
});

describe('summarizeFlick click bias and class counts', () => {
  it('clickBias is the mean first-click along offset', () => {
    const trials = [metric({ index: 0, endAlong: 1 }), metric({ index: 1, endAlong: 2 }), metric({ index: 2, endAlong: null, timedOut: true, hit: false })];
    expect(summarizeFlick(trials, defaultConfig, createRng(1)).clickBias).toBeCloseTo(1.5, 9);
  });
  it('clickBias is null without clicks', () => {
    expect(summarizeFlick([metric({ endAlong: null })], defaultConfig, createRng(1)).clickBias).toBeNull();
  });
  it('classN counts scored trials per class', () => {
    const trials = [metric({ cls: 'small' }), metric({ cls: 'small' }), metric({ cls: 'big' }), metric({ cls: 'big', scored: false })];
    expect(summarizeFlick(trials, defaultConfig, createRng(1)).classN).toEqual({ small: 2, medium: 0, big: 1 });
  });
});
