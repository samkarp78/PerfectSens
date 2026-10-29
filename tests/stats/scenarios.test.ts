import { it } from 'vitest';
import { defaultConfig, type Config } from '../../src/core/config';
import { finalsToCm360, gameSensOf } from '../../src/core/playalong/gameSens';
import type { PaSetup } from '../../src/core/playalong/state';
import { defaultSimPlayer, type SimPlayer } from '../../src/core/sim/player';
import { runPlayAlongSim } from '../../src/core/sim/runPlayAlong';
import { median, report } from './sim';

/**
 * Play-Along "bot tests": simulated players with a known best sens, started from a known sens. Report only, no pass/fail.
 * Run: npx vitest run tests/stats/scenarios.test.ts --silent=false --maxWorkers=1   (BOTS=realistic,sharp to pick types)
 * One line per scenario: how often it said "change", how often its final answer (change, keep or best guess) landed within
 * 8% of the true best, how often the final range held the true best, the median range width, answer and nights.
 *
 * Bot types. "realistic" is calibrated to the only real player's sessions (2026-10-29, 41 rounds): a flat sweet spot,
 * round-to-round spread like theirs, and a steady ~1° tracking lag. "sharp" is the same player with a sharper sweet spot.
 */
const RUNS = 5;
const STARTS = [20, 33, 50];
/** Best sens as a multiple of the starting Finals number (1.6 = much faster). */
const BEST_RATIOS = [0.6, 0.8, 1, 1.25, 1.6];
const REAL_SIM: Record<string, number> = { amplitudeNoise: 0.2, trackingDelayMs: 350, trackingNoiseDegPerSec: 10 };
const BOTS: Record<string, { player: Partial<SimPlayer>; sim: Record<string, number> }> = {
  realistic: { player: { curvature: 0.3, motorNoise: 1.6 }, sim: REAL_SIM },
  sharp: { player: { curvature: 1, motorNoise: 1.6 }, sim: REAL_SIM },
  typical: { player: {}, sim: {} },
  inconsistent: { player: { motorNoise: 1.5 }, sim: {} },
  flat: { player: { curvature: 1 }, sim: {} },
};
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const PICK = (env.BOTS ?? 'realistic,sharp').split(',');
const LANDED = Math.log(1.08);

it('Play-Along scenario grid', () => {
  let seed = 200_000;
  for (const type of PICK) {
    const bot = BOTS[type]!;
    const cfg = { ...defaultConfig, sim: { ...defaultConfig.sim, ...bot.sim },
      playAlong: { ...defaultConfig.playAlong, sim: { ...defaultConfig.playAlong.sim, maxNights: 6 } } } as unknown as Config;
    for (const start of STARTS) {
      for (const ratio of BEST_RATIOS) {
        const best = Math.round(start * ratio);
        const setup: PaSetup = { game: 'finals', dpi: 800, defaultCm360: finalsToCm360(start, 800), padWidthCm: 60, fov: 103, fovType: 'horizontal' };
        const bestCm = finalsToCm360(best, 800);
        let change = 0, landed = 0, inRange = 0;
        const answers: number[] = [], nights: number[] = [], widths: number[] = [];
        for (let i = 0; i < RUNS; i++) {
          const r = runPlayAlongSim(setup, defaultSimPlayer(setup.defaultCm360, { optimalCm360: bestCm, ...bot.player }), seed++, cfg);
          const res = r.state.result!;
          if (res.kind === 'change') change++;
          if (Math.abs(Math.log(res.recommendedCm360 / bestCm)) < LANDED) landed++;
          const range = res.rangeCm360;
          if (range && bestCm >= Math.min(...range) && bestCm <= Math.max(...range)) inRange++;
          if (range) widths.push(Math.round(100 * (Math.max(...range) / Math.min(...range) - 1)));
          answers.push(gameSensOf('finals', res.recommendedCm360, 800)!);
          nights.push(r.nights);
        }
        report('scenario', `start ${start} → best ${best} (${type}): change ${change}/${RUNS} · landed ${landed}/${RUNS} · range holds best ${inRange}/${RUNS} · range width ${widths.length ? median(widths) + '%' : '-'} · answer ${median(answers)} · nights ${median(nights)}`);
      }
    }
  }
}, 3_600_000);
