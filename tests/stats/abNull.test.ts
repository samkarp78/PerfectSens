import { describe, it, expect } from 'vitest';
import { CURRENT, player, report, run } from './sim';

describe('simulator validation: A/B rule under the null', () => {
  it("false-change rate ≤ 0.05 over 200 quick A/B runs with a flat player (curvature 0, no familiarity), pick 1.1·current", () => {
    const p = player({ curvature: 0, familiarityBonus: 0 });
    const verdicts = Array.from({ length: 200 }, (_, i) => run(p, 50_000 + i, 1.1 * CURRENT).verdict);
    const rate = verdicts.filter((v) => v === 'change').length / verdicts.length;
    const keep = verdicts.filter((v) => v === 'keep').length / verdicts.length;
    report('null A/B', `change rate = ${rate.toFixed(3)} (keep ${keep.toFixed(3)}, none ${(1 - rate - keep).toFixed(3)})`);
    expect(rate).toBeLessThanOrEqual(0.05);
  });
});
