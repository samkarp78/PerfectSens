import { describe, it, expect } from 'vitest';
import { CURRENT, median, player, report, run, uniforms } from './sim';

describe('simulator validation: steering and fit', () => {
  it('convergence: ≥ 80 of 100 picks within ±8% (log) of a planted optimum, u ∈ [0.75, 1.3]', () => {
    const us = uniforms(1301, 100, 0.75, 1.3);
    const errs = us.map((u, i) => {
      const optimal = CURRENT * u;
      return Math.log(run(player({ optimalCm360: optimal }), 10_000 + i).pickCm360 / optimal);
    });
    const within = errs.filter((e) => Math.abs(e) < Math.log(1.08)).length;
    report('convergence', `${within}/100 within ln 1.08; median ln(pick/opt) = ${median(errs).toFixed(4)}`);
    expect(within).toBeGreaterThanOrEqual(80);
  });

  it('familiarity: median pick/optimal ∈ [0.94, 1.06] with familiarityBonus 0.04, optimal 0.85·current', () => {
    const optimal = 0.85 * CURRENT;
    const ratios = Array.from({ length: 50 }, (_, i) =>
      run(player({ familiarityBonus: 0.04, optimalCm360: optimal }), 20_000 + i).pickCm360 / optimal);
    const m = median(ratios);
    report('familiarity', `median pick/optimal = ${m.toFixed(4)}`);
    expect(m).toBeGreaterThanOrEqual(0.94);
    expect(m).toBeLessThanOrEqual(1.06);
  });

  it("edge: ≥ 18 of 20 runs flag edge 'faster' with optimal 0.4·current", () => {
    const edges = Array.from({ length: 20 }, (_, i) => run(player({ optimalCm360: 0.4 * CURRENT }), 30_000 + i).edge);
    const faster = edges.filter((e) => e === 'faster').length;
    report('edge', `${faster}/20 'faster'`);
    expect(faster).toBeGreaterThanOrEqual(18);
  });

  it('test-retest: in ≥ 16 of 20 same-player pairs (different seeds) the picks are within ±10% of each other', () => {
    const p = player();
    const agree = Array.from({ length: 20 }, (_, i) => {
      const a = run(p, 40_000 + 2 * i).pickCm360;
      const b = run(p, 40_000 + 2 * i + 1).pickCm360;
      return Math.abs(a / b - 1) <= 0.1 && Math.abs(b / a - 1) <= 0.1;
    }).filter(Boolean).length;
    report('test-retest', `${agree}/20 pairs within ±10%`);
    expect(agree).toBeGreaterThanOrEqual(16);
  });
});
