import { describe, it, expect } from 'vitest';
import { defaultSimPlayer } from '../../src/core/sim/player';
import { runPlayAlongSim } from '../../src/core/sim/runPlayAlong';
import { finalsToCm360 } from '../../src/core/playalong/gameSens';
import type { PaSetup } from '../../src/core/playalong/state';
import { median, report, uniforms } from './sim';

const DEFAULT = finalsToCm360(33, 800);
const setup: PaSetup = { game: 'finals', dpi: 800, defaultCm360: DEFAULT, padWidthCm: 60, fov: 103, fovType: 'horizontal',
  sitting: (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SITTING === '1' };
/** Searches per check; PA_N overrides it for quick timing runs. */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const N = (n: number): number => Number(env.PA_N ?? n);

describe('simulator validation: Play-Along', () => {
  it('null false change ≤ 1% with a flat player', () => {
    const n = N(300);
    const p = defaultSimPlayer(DEFAULT, { curvature: 0, familiarityBonus: 0 });
    const kinds = Array.from({ length: n }, (_, i) => runPlayAlongSim(setup, p, 60_000 + i).state.result!.kind);
    const rate = kinds.filter((k) => k === 'change').length / n;
    const count = (k: string) => kinds.filter((x) => x === k).length;
    report('playalong null', `change ${rate.toFixed(3)} (keep ${count('keep')}, none ${count('none')}, bestGuess ${count('bestGuess')} of ${n})`);
    expect(rate).toBeLessThanOrEqual(0.01);
  }, 1_800_000);

  it('convergence: ≥ 80% of answers within ±8% of a planted optimum, u ∈ [0.75, 1.3]', () => {
    const n = N(100);
    const us = uniforms(1801, n, 0.75, 1.3);
    let scored = 0, within = 0;
    const kinds: Record<string, number> = {};
    const nights: number[] = [], tests: number[] = [];
    us.forEach((u, i) => {
      const optimal = DEFAULT * u;
      const r = runPlayAlongSim(setup, defaultSimPlayer(DEFAULT, { optimalCm360: optimal }), 70_000 + i);
      const res = r.state.result!;
      kinds[res.kind] = (kinds[res.kind] ?? 0) + 1;
      nights.push(r.nights);
      tests.push(...r.testsPerNight);
      const far = Math.abs(Math.log(u)) >= Math.log(1.03);
      if (res.kind === 'change' || (res.kind === 'bestGuess' && far)) {
        scored++;
        if (Math.abs(Math.log(res.recommendedCm360 / optimal)) < Math.log(1.08)) within++;
      }
    });
    report('playalong convergence', `${within}/${scored} answers within ln 1.08; kinds ${JSON.stringify(kinds)}`);
    report('playalong effort', `median nights ${median(nights)}, median tests per night ${median(tests)}`);
    expect(within / Math.max(1, scored)).toBeGreaterThanOrEqual(0.8);
  }, 1_800_000);
});
