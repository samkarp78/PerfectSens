import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import { fitCurve, type FitPoint } from '../../src/core/fit';

const x0 = Math.log(30);
const us = Array.from({ length: 7 }, (_, i) => (i - 3) / 15); // u = -0.2 ... 0.2

const inOrder = [0, 1, 2, 3, 4, 5, 6];

function dataset(peak: number, extra: (u: number, t: number) => number = () => 0, order = inOrder): FitPoint[] {
  return us.map((u, i) => {
    const t = order[i]! / 6;
    return { x: x0 + u, y: -2 * (u - peak) ** 2 + extra(u, t), se: 0.01, t, isCurrent: u === 0 };
  });
}

const fit = (pts: FitPoint[]) => fitCurve(pts, x0, defaultConfig, createRng(123));

describe('fitCurve', () => {
  it('recovers an interior peak with a range containing the pick', () => {
    const r = fit(dataset(0.1));
    expect(r.usable).toBe(true);
    expect(r.lowConfidence).toBe(false);
    expect(r.coef!.c).toBeGreaterThan(-2.05);
    expect(r.coef!.c).toBeLessThan(-1.95);
    expect(Math.abs(r.pickCm360 / Math.exp(x0 + 0.1) - 1)).toBeLessThan(0.005);
    expect(r.edge).toBeNull();
    expect(r.range).not.toBeNull();
    expect(r.range![0]).toBeLessThanOrEqual(r.pickCm360);
    expect(r.range![1]).toBeGreaterThanOrEqual(r.pickCm360);
    // strictly narrower than the tested span [exp(x0 - 0.2), exp(x0 + 0.2)]
    expect(r.range![0] >= Math.exp(x0 - 0.2) - 1e-9 && r.range![1] <= Math.exp(x0 + 0.2) + 1e-9).toBe(true);
    expect(r.range![1] / r.range![0]).toBeLessThan(Math.exp(0.4) * (1 - 1e-9));
  });

  it('clamps a peak beyond the slow end to maxU with edge slower', () => {
    const r = fit(dataset(0.5));
    expect(r.edge).toBe('slower');
    expect(r.pickCm360).toBeCloseTo(Math.exp(x0 + 0.2), 9);
  });

  it('clamps a peak beyond the fast end to minU with edge faster', () => {
    const r = fit(dataset(-0.5));
    expect(r.edge).toBe('faster');
    expect(r.pickCm360).toBeCloseTo(Math.exp(x0 - 0.2), 9);
  });

  it('upward curvature is low confidence with the pick at the best point', () => {
    const pts = us.map((u, i) => ({ x: x0 + u, y: 2 * u * u, se: 0.01, t: i / 6, isCurrent: u === 0 }));
    const r = fit(pts);
    expect(r.usable).toBe(true);
    expect(r.lowConfidence).toBe(true);
    expect(r.range).toBeNull();
    // u = -0.2 and u = 0.2 tie for highest y; the earliest wins
    expect(r.pickCm360).toBeCloseTo(Math.exp(x0 - 0.2), 9);
  });

  it('upward curvature with the best point at a tested edge flags that edge (low confidence)', () => {
    // Flattening at both ends of a monotone drop (a floor at the slow end) fits as an upward curve.
    const ys = [1.6, 1.5, 1.2, 0.6, 0.15, 0.05, 0.0];
    const fast = fit(us.map((u, i) => ({ x: x0 + u, y: ys[i]!, se: 0.01, t: i / 6, isCurrent: u === 0 })));
    expect(fast.coef!.c).toBeGreaterThanOrEqual(0);
    expect(fast.lowConfidence).toBe(true);
    expect(fast.edge).toBe('faster');
    expect(fast.pickCm360).toBeCloseTo(Math.exp(x0 - 0.2), 9);
    const slow = fit(us.map((u, i) => ({ x: x0 + u, y: ys[6 - i]!, se: 0.01, t: i / 6, isCurrent: u === 0 })));
    expect(slow.edge).toBe('slower');
  });

  it('upward curvature with an interior best point flags no edge', () => {
    const ys = [0.5, 0.2, 0.6, 0.0, 0.2, 0.3, 0.55];
    const r = fit(us.map((u, i) => ({ x: x0 + u, y: ys[i]!, se: 0.01, t: i / 6, isCurrent: u === 0 })));
    expect(r.coef!.c).toBeGreaterThanOrEqual(0);
    expect(r.pickCm360).toBeCloseTo(Math.exp(x0 + us[2]!), 9);
    expect(r.edge).toBeNull();
  });

  it('fewer than minDistinctX distinct x values is unusable', () => {
    const tri = [-0.1, 0, 0.1, -0.1, 0, 0.1];
    const pts = tri.map((u, i) => ({ x: x0 + u, y: -2 * (u - 0.08) ** 2, se: 0.01, t: i / 5, isCurrent: u === 0 }));
    const r = fit(pts);
    expect(r.usable).toBe(false);
    expect(r.lowConfidence).toBe(true);
    expect(r.range).toBeNull();
    expect(r.coef).toBeNull();
    expect(r.pickCm360).toBeCloseTo(Math.exp(x0 + 0.1), 9);
  });

  it('shrinks a familiarity bonus on the current sens', () => {
    const base = dataset(0.1);
    const pts: FitPoint[] = [...base, { x: x0, y: -2 * (0 - 0.1) ** 2, se: 0.01, t: 0, isCurrent: true }]
      .map((p) => (p.isCurrent ? { ...p, y: p.y + 0.03 } : p));
    expect(pts.filter((p) => p.isCurrent).map((p) => p.t).sort()).toEqual([0, 0.5]);
    const r = fit(pts);
    expect(Math.abs(r.pickCm360 / Math.exp(x0 + 0.1) - 1)).toBeLessThan(0.05);
    // f absorbs most of the bonus, shrunk by the ridge (no f term -> 0, no ridge -> 0.03)
    expect(r.coef!.f).toBeGreaterThan(0.015);
    expect(r.coef!.f).toBeLessThan(0.0295);
  });

  it('attributes a linear time trend to drift', () => {
    // block order decoupled from u, so t is not collinear with the intercept and u
    const r = fit(dataset(0.1, (_u, t) => 0.05 * t, [3, 0, 5, 1, 6, 2, 4]));
    // ridge shrinks d below the true 0.05 (no d term -> 0)
    expect(r.coef!.d).toBeGreaterThan(0.02);
    expect(r.coef!.d).toBeLessThan(0.05);
    expect(Math.abs(r.pickCm360 / Math.exp(x0 + 0.1) - 1)).toBeLessThan(0.02);
  });

  it('down-weights a noisy point by its se', () => {
    const clean = fit(dataset(0.1));
    const noisy = dataset(0.1).map((p, i) => (i === 0 ? { ...p, y: p.y + 0.3, se: 0.2 } : p));
    const r = fit(noisy);
    expect(Math.abs(r.pickCm360 / clean.pickCm360 - 1)).toBeLessThan(0.01);
  });

  it('is deterministic for a given seed', () => {
    expect(fit(dataset(0.1))).toEqual(fit(dataset(0.1)));
  });
});
