import { it } from 'vitest';
import { defaultConfig, type Config } from '../../src/core/config';
import { finalsToCm360, gameSensOf } from '../../src/core/playalong/gameSens';
import type { PaSetup } from '../../src/core/playalong/state';
import { defaultSimPlayer, type SimPlayer } from '../../src/core/sim/player';
import { runPlayAlongSim } from '../../src/core/sim/runPlayAlong';
import { median, report } from './sim';

/**
 * Play-Along "bot tests": simulated players with a known best sens, started from a known sens. Report only, no pass/fail.
 * Run: npx vitest run tests/stats/scenarios.test.ts --silent=false --maxWorkers=1
 * One line per scenario: how often it said "change", how often its final answer (change, keep or best guess) landed within
 * 8% of the true best, how often the final range held the true best, the median answer and the median number of nights.
 */
const RUNS = 5;
const STARTS = [20, 33, 50];
/** Best sens as a multiple of the starting Finals number (1.6 = much faster). */
const BEST_RATIOS = [0.6, 0.8, 1, 1.25, 1.6];
const PLAYERS: Record<string, Partial<SimPlayer>> = {
  typical: {},
  inconsistent: { motorNoise: 1.5 },
  flat: { curvature: 1 },
};
const LANDED = Math.log(1.08);
const cfg = { ...defaultConfig, playAlong: { ...defaultConfig.playAlong, sim: { ...defaultConfig.playAlong.sim, maxNights: 6 } } } as unknown as Config;

it('Play-Along scenario grid', () => {
  let seed = 200_000;
  for (const [type, over] of Object.entries(PLAYERS)) {
    for (const start of STARTS) {
      for (const ratio of BEST_RATIOS) {
        const best = Math.round(start * ratio);
        const setup: PaSetup = { game: 'finals', dpi: 800, defaultCm360: finalsToCm360(start, 800), padWidthCm: 60, fov: 103, fovType: 'horizontal' };
        const bestCm = finalsToCm360(best, 800);
        let change = 0, landed = 0, inRange = 0;
        const answers: number[] = [], nights: number[] = [];
        for (let i = 0; i < RUNS; i++) {
          const r = runPlayAlongSim(setup, defaultSimPlayer(setup.defaultCm360, { optimalCm360: bestCm, ...over }), seed++, cfg);
          const res = r.state.result!;
          if (res.kind === 'change') change++;
          if (Math.abs(Math.log(res.recommendedCm360 / bestCm)) < LANDED) landed++;
          const range = res.rangeCm360;
          if (range && bestCm >= Math.min(...range) && bestCm <= Math.max(...range)) inRange++;
          answers.push(gameSensOf('finals', res.recommendedCm360, 800)!);
          nights.push(r.nights);
        }
        report('scenario', `start ${start} → best ${best} (${type}): change ${change}/${RUNS} · landed within 8% ${landed}/${RUNS} · range holds best ${inRange}/${RUNS} · median answer ${median(answers)} · median nights ${median(nights)}`);
      }
    }
  }
}, 3_600_000);
