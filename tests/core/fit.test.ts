import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import { fitCurve, type FitPoint } from '../../src/core/fit';

const x0 = Math.log(30);
const us = Array.from({ length: 7 }, (_, i) => (i - 3) / 15); // u = -0.2 ... 0.2

function dataset(peak: number, extra: (u: number, t: number) => number = () => 0): FitPoint[] {
  return us.map((u, i) => {
    const t = i / 6;
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
  });

  it('attributes a linear time trend to drift', () => {
    const r = fit(dataset(0.1, (_u, t) => 0.05 * t));
    expect(r.coef!.d).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    expect(fit(dataset(0.1))).toEqual(fit(dataset(0.1)));
  });
});
