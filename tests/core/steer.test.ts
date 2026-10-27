import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import type { FitResult } from '../../src/core/fit';
import type { StepResult } from '../../src/core/types';
import { chooseNext, stepSize, type SteerContext } from '../../src/core/steer';

const current = 30;

interface Over {
  smallGain?: number | null; bigGain?: number | null; corrections?: number; spreadRatio?: number;
  leadLagDeg?: number; logS?: number;
}

function step(order: number, cm360: number, o: Over = {}): StepResult {
  return {
    order, stage: order === 0 ? 'baseline' : 'dialin', arm: null, cm360, trials: [],
    flick: {
      tp: 4, logTpSe: 0.05, smallGain: o.smallGain === undefined ? 1 : o.smallGain, mediumGain: 1,
      bigGain: o.bigGain === undefined ? 0.95 : o.bigGain, corrections: o.corrections ?? 0.5, weDeg: 1,
      spreadRatio: o.spreadRatio ?? 0.5, timeoutFraction: 0, n: 30,
    },
    tracking: { tot: 0.5, logTotSe: 0.05, leadLagDeg: o.leadLagDeg ?? 0, n: 1 },
    score: { logS: o.logS ?? 0, se: 0.05 },
  };
}

function fitAt(pick: number, usable = true, lowConfidence = false, b = 0, c = -1): FitResult {
  return { usable, coef: { a: 0, b, c, d: 0, f: 0 }, pickCm360: pick, range: null, edge: null, lowConfidence };
}

function ctx(p: Partial<SteerContext>): SteerContext {
  return {
    currentCm360: current, baseline: step(0, current), steps: [], fit: null, stepIndex: 2, totalSteps: 6,
    rng: createRng(1), ...p,
  };
}

describe('stepSize', () => {
  it('brackets first, then shrinks geometrically to finalStep', () => {
    expect(stepSize(0, 6, cfg)).toBe(cfg.steer.bracket);
    expect(stepSize(1, 6, cfg)).toBe(cfg.steer.bracket);
    expect(stepSize(2, 6, cfg)).toBeCloseTo(0.15, 12);
    expect(stepSize(5, 6, cfg)).toBeCloseTo(0.04, 12);
    for (let i = 3; i < 6; i++) expect(stepSize(i, 6, cfg)).toBeLessThan(stepSize(i - 1, 6, cfg));
  });

  it('returns finalStep past the bracket when there are three steps or fewer', () => {
    expect(stepSize(2, 3, cfg)).toBe(cfg.steer.finalStep);
  });
});

describe('chooseNext bracketing', () => {
  const run = (seed: number) => {
    const rng = createRng(seed);
    const d0 = chooseNext(ctx({ stepIndex: 0, rng }), cfg);
    const d1 = chooseNext(ctx({ stepIndex: 1, steps: [step(1, d0.cm360)], rng }), cfg);
    return [d0, d1] as const;
  };

  it('index 0 and 1 land on opposite sides of current at ±bracket', () => {
    const [a0, a1] = run(7);
    expect(a0.direction).not.toBe(a1.direction);
    const vals = [a0.cm360, a1.cm360].sort((x, y) => x - y);
    expect(vals[0]).toBeCloseTo(current / 1.15, 9);
    expect(vals[1]).toBeCloseTo(current * 1.15, 9);
    for (const d of [a0, a1]) {
      expect(d.stepSize).toBe(cfg.steer.bracket);
      expect(d.reason).toMatch(/^Bracketing: testing a (slower|faster) sens$/);
    }
  });

  it('is deterministic per seed and randomizes the order across seeds', () => {
    const [a0, a1] = run(7);
    const [b0, b1] = run(7);
    expect(b0.cm360).toBe(a0.cm360);
    expect(b1.cm360).toBe(a1.cm360);
    const firstDirs = new Set(Array.from({ length: 20 }, (_, s) => run(s)[0].direction));
    expect(firstDirs.size).toBe(2);
  });
});

describe('chooseNext after bracketing', () => {
  const center = 32;
  const fit = fitAt(center);
  const bracketSteps = (last: StepResult) => [step(1, current * 1.15), step(2, current / 1.15), last];

  it('small-flick overshoot steers slower, above center', () => {
    const d = chooseNext(ctx({ steps: bracketSteps(step(3, 31, { smallGain: 1.15 })), fit }), cfg);
    expect(d.direction).toBe('slower');
    expect(d.cm360).toBeGreaterThan(center);
    expect(d.cm360).toBeCloseTo(center * (1 + stepSize(2, 6, cfg)), 9);
    expect(d.stepSize).toBe(stepSize(2, 6, cfg));
    expect(d.signal).toBeGreaterThan(0);
    expect(d.reason).toMatch(/small flicks/i);
  });

  it('big-flick undershoot steers faster, below center', () => {
    const d = chooseNext(ctx({ steps: bracketSteps(step(3, 31, { bigGain: 0.8 })), fit }), cfg);
    expect(d.direction).toBe('faster');
    expect(d.cm360).toBeLessThan(center);
    expect(d.signal).toBeLessThan(0);
    expect(d.reason).toMatch(/big flicks/i);
  });

  it('tracking lead steers slower and lag steers faster', () => {
    const lead = chooseNext(ctx({ steps: bracketSteps(step(3, 31, { leadLagDeg: 0.5 })), fit }), cfg);
    const lag = chooseNext(ctx({ steps: bracketSteps(step(3, 31, { leadLagDeg: -0.5 })), fit }), cfg);
    expect(lead.direction).toBe('slower');
    expect(lag.direction).toBe('faster');
  });

  it('more corrections follow the sign of the fit slope at center', () => {
    const steps = bracketSteps(step(3, 31, { corrections: 1.0 }));
    const up = chooseNext(ctx({ steps, fit: fitAt(center, true, false, 0.5) }), cfg);
    const down = chooseNext(ctx({ steps, fit: fitAt(center, true, false, -0.5) }), cfg);
    expect(up.direction).toBe('slower');
    expect(down.direction).toBe('faster');
  });

  it('fewer corrections than baseline do not steer', () => {
    const steps = bracketSteps(step(3, 31, { corrections: 0.1, spreadRatio: 0.2 }));
    const d = chooseNext(ctx({ steps, fit: fitAt(center, true, false, 0.5) }), cfg);
    expect(d.signal).toBe(0);
  });

  it('within the deadband, goes to the opposite side of center from last', () => {
    const above = chooseNext(ctx({ steps: bracketSteps(step(3, 33)), fit }), cfg);
    expect(above.direction).toBe('faster');
    expect(above.cm360).toBeLessThan(center);
    const below = chooseNext(ctx({ steps: bracketSteps(step(3, 31)), fit }), cfg);
    expect(below.direction).toBe('slower');
    expect(below.cm360).toBeGreaterThan(center);
    expect(Math.abs(below.signal)).toBeLessThan(cfg.steer.deadband);
  });

  it('falls back to the best-scoring tested step when the fit is missing, unusable or low-confidence', () => {
    const steps = [step(1, current * 1.15, { logS: 0.2 }), step(2, current / 1.15, { logS: 0.1 }),
      step(3, 31, { smallGain: 1.15 })];
    for (const f of [null, fitAt(center, false), fitAt(center, true, true)]) {
      const d = chooseNext(ctx({ steps, fit: f }), cfg);
      expect(d.cm360).toBeCloseTo(current * 1.15 * (1 + stepSize(2, 6, cfg)), 9);
    }
  });

  it('clamps to the upper limit', () => {
    const d = chooseNext(ctx({ steps: bracketSteps(step(3, 31, { smallGain: 1.15 })), fit: fitAt(current * 1.58) }), cfg);
    expect(d.direction).toBe('slower');
    expect(d.cm360).toBeLessThanOrEqual(current * cfg.steer.limits.max + 1e-9);
    expect(d.cm360).toBeCloseTo(current * cfg.steer.limits.max, 9);
  });

  it('flips direction when the next value coincides with a tested value', () => {
    const size = stepSize(2, 6, cfg);
    const target = center * (1 + size);
    const steps = [step(1, current * 1.15), step(2, target), step(3, 33, { smallGain: 1.15 })];
    const d = chooseNext(ctx({ steps, fit }), cfg);
    expect(d.direction).toBe('faster');
    expect(d.cm360).toBeCloseTo(center / (1 + size), 9);
  });

  it('down-weights signals after a bigger preceding jump', () => {
    const prev = step(2, 30);
    const small = chooseNext(ctx({ steps: [step(1, 34.5), prev, step(3, 31, { smallGain: 1.15 })], fit }), cfg);
    const big = chooseNext(ctx({ steps: [step(1, 34.5), prev, step(3, 40, { smallGain: 1.15 })], fit }), cfg);
    expect(Math.abs(big.signal)).toBeLessThan(Math.abs(small.signal));
  });

  it('reasons are non-empty and never leak sens values', () => {
    const cases = [step(3, 31, { smallGain: 1.15 }), step(3, 31, { bigGain: 0.8 }), step(3, 31, { leadLagDeg: 1 }),
      step(3, 31, { leadLagDeg: -1 }), step(3, 31, { corrections: 1 }), step(3, 33), step(3, 31, { smallGain: 0.8 })];
    for (const last of cases) {
      const d = chooseNext(ctx({ steps: bracketSteps(last), fit: fitAt(center, true, false, 0.5) }), cfg);
      expect(d.reason.length).toBeGreaterThan(0);
      expect(d.reason).not.toMatch(/\d\s*cm/i);
      expect(d.reason).not.toMatch(/\d/);
    }
  });
});
