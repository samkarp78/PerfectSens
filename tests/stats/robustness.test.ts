import { it } from 'vitest';
import { defaultConfig, type Config } from '../../src/core/config';
import { finalsToCm360, gameSensOf } from '../../src/core/playalong/gameSens';
import type { PaSetup } from '../../src/core/playalong/state';
import { createRng } from '../../src/core/rng';
import { defaultSimPlayer, type SimPlayer } from '../../src/core/sim/player';
import { runPlayAlongSim } from '../../src/core/sim/runPlayAlong';
import { median, report } from './sim';

/**
 * Does the Play-Along answer depend on things it shouldn't? Report only.
 * Run: npx vitest run tests/stats/robustness.test.ts --silent=false --maxWorkers=1
 *
 * 20 bots (noise and lag from the real player's sessions ±30%, sweet spot flat to sharp, random perfect sens), 3 nights:
 *  1. Consistency: the same bot 5 times with fresh randomness. Do the answers agree?
 *  2. Starting sens: the same bot started 30% faster, at its best, and 30% slower. Same answer?
 *  3. Familiarity: a stronger advantage on the starting sens. Does it wrongly keep the start?
 *  4. Bad night: night 1 played 15% worse. Does one bad night throw the answer off?
 * "Agree" = within ±5%.
 */
const NIGHTS = 3;
const BOTS = 20;
const REAL = { motorNoise: 1.6, amplitudeNoise: 0.2, trackingDelayMs: 350, trackingNoiseDegPerSec: 10 };
const AGREE = Math.log(1.05);

interface Bot { curvature: number; bestN: number; startN: number; noise: number; cfg: Config }

const runOnce = (bot: Bot, seed: number, o: { startN?: number; player?: Partial<SimPlayer>; nightForms?: (number | undefined)[] } = {}): number => {
  const startN = o.startN ?? bot.startN;
  const setup: PaSetup = { game: 'finals', dpi: 800, defaultCm360: finalsToCm360(startN, 800), padWidthCm: 60, fov: 103, fovType: 'horizontal' };
  const player = defaultSimPlayer(setup.defaultCm360, { optimalCm360: finalsToCm360(bot.bestN, 800), curvature: bot.curvature,
    motorNoise: bot.noise, ...o.player });
  const r = runPlayAlongSim(setup, player, seed, bot.cfg, { nightForms: o.nightForms });
  return gameSensOf('finals', r.state.result!.recommendedCm360, 800)!;
};

const spreadPct = (ns: number[]): number => Math.round(100 * (Math.max(...ns) / Math.min(...ns) - 1));
const agreeShare = (ns: number[]): number => {
  let pairs = 0, ok = 0;
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) { pairs++; if (Math.abs(Math.log(ns[i]! / ns[j]!)) < AGREE) ok++; }
  return pairs === 0 ? 1 : ok / pairs;
};
const near = (n: number, best: number): boolean => Math.abs(Math.log(n / best)) < AGREE;
const bucket = (c: number): string => (c < 0.6 ? 'flat' : c < 1.5 ? 'medium' : 'sharp');
const pct = (x: number): string => `${Math.round(100 * x)}%`;

it('Play-Along robustness', () => {
  const rng = createRng(2024);
  const vary = (v: number): number => v * (0.7 + 0.6 * rng.next());
  const bots: Bot[] = Array.from({ length: BOTS }, () => {
    const bestN = 25 + Math.floor(rng.next() * 21);
    return {
      curvature: Math.exp(Math.log(0.2) + rng.next() * Math.log(4 / 0.2)), bestN,
      startN: Math.max(1, Math.round(bestN / (0.75 + 0.55 * rng.next()))), noise: vary(REAL.motorNoise),
      cfg: { ...defaultConfig,
        sim: { ...defaultConfig.sim, amplitudeNoise: vary(REAL.amplitudeNoise), trackingDelayMs: vary(REAL.trackingDelayMs),
          trackingNoiseDegPerSec: vary(REAL.trackingNoiseDegPerSec) },
        playAlong: { ...defaultConfig.playAlong, sim: { ...defaultConfig.playAlong.sim, maxNights: NIGHTS } } } as unknown as Config,
    };
  });

  type Out = { b: Bot; repeat: number[]; starts: number[]; familiar: number[]; bad: number[] };
  const outs: Out[] = bots.map((b, i) => {
    const seed = 600_000 + i * 100;
    const repeat = Array.from({ length: 5 }, (_, k) => runOnce(b, seed + k));
    const starts = [Math.round(b.bestN * 1.3), b.bestN, Math.round(b.bestN / 1.3)].map((s, k) => runOnce(b, seed + 10 + k, { startN: s }));
    const familiar = Array.from({ length: 3 }, (_, k) => runOnce(b, seed + 20 + k, { player: { familiarityBonus: 0.06 } }));
    const bad = Array.from({ length: 3 }, (_, k) => runOnce(b, seed + 30 + k, { nightForms: [0.85] }));
    return { b, repeat, starts, familiar, bad };
  });

  for (const name of ['flat', 'medium', 'sharp', 'all']) {
    const g = outs.filter((o) => name === 'all' || bucket(o.b.curvature) === name);
    if (g.length === 0) continue;
    const m = (f: (o: Out) => number): string => `${median(g.map(f))}`;
    report(`robust ${name}`, `${g.length} bots\n`
      + `  1 consistency: answers agree ${pct(median(g.map((o) => agreeShare(o.repeat))))} of pairs (median) · spread of 5 runs ${m((o) => spreadPct(o.repeat))}%\n`
      + `  2 starting sens: answers agree ${pct(median(g.map((o) => agreeShare(o.starts))))} · spread across 3 starts ${m((o) => spreadPct(o.starts))}%\n`
      + `  3 familiarity: within ±5% of best ${pct(g.flatMap((o) => o.familiar).filter((n, k) => near(n, g[Math.floor(k / 3)]!.b.bestN)).length / (3 * g.length))}`
      + ` vs normal ${pct(g.flatMap((o) => o.repeat.slice(0, 3)).filter((n, k) => near(n, g[Math.floor(k / 3)]!.b.bestN)).length / (3 * g.length))}`
      + ` · answer = start ${pct(g.flatMap((o) => o.familiar.map((n) => (n === o.b.startN ? 1 : 0))).reduce((a: number, v) => a + v, 0) / (3 * g.length))}`
      + ` vs normal ${pct(g.flatMap((o) => o.repeat.slice(0, 3).map((n) => (n === o.b.startN ? 1 : 0))).reduce((a: number, v) => a + v, 0) / (3 * g.length))}\n`
      + `  4 bad first night: within ±5% of best ${pct(g.flatMap((o) => o.bad).filter((n, k) => near(n, g[Math.floor(k / 3)]!.b.bestN)).length / (3 * g.length))}`
      + ` vs normal ${pct(g.flatMap((o) => o.repeat.slice(0, 3)).filter((n, k) => near(n, g[Math.floor(k / 3)]!.b.bestN)).length / (3 * g.length))}`);
  }
  for (const o of outs) {
    report('robust bot', `best ${o.b.bestN} start ${o.b.startN} (${bucket(o.b.curvature)}): repeat ${o.repeat.join(' ')} | starts ${o.starts.join(' ')} | familiar ${o.familiar.join(' ')} | bad night ${o.bad.join(' ')}`);
  }
}, 3_600_000);
