import { it } from 'vitest';
import { defaultConfig, type Config } from '../../src/core/config';
import { finalsToCm360 } from '../../src/core/playalong/gameSens';
import type { PaSetup } from '../../src/core/playalong/state';
import { createRng } from '../../src/core/rng';
import { defaultSimPlayer } from '../../src/core/sim/player';
import { runPlayAlongSim } from '../../src/core/sim/runPlayAlong';
import { median, report } from './sim';

/**
 * Play-Along accuracy on random bots. Report only.
 * Run: npx vitest run tests/stats/accuracy.test.ts --silent=false --maxWorkers=1   (SET=tune or SET=check, N=bots)
 *
 * Each bot's noise and tracking lag come from the real player's sessions (2026-10-29), each varied ±30%. Sweet-spot sharpness
 * (how much worse a wrong sens is) is the one thing a single player's cold-switch data can't pin down, so it ranges from
 * flat to sharp. Every bot gets a random starting sens (Finals 20–50) and a random perfect sens (0.6–1.6× the start).
 * "tune" and "check" use different bots: tune the algorithm on one, confirm on the other.
 *
 * Accuracy target: for bots whose sweet spot is sharp enough to detect, the final answer (change, keep or best guess)
 * lands within ±5% of the perfect sens for at least 8 of 10 bots; nothing confidently wrong ("change" more than 10% off).
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SET = env.SET ?? 'tune';
const N = Number(env.N ?? 60);
/** TIGHT overrides playAlong.tightRange (how tight the range must get before the final check). */
const TIGHT = env.TIGHT === undefined ? defaultConfig.playAlong.tightRange : Number(env.TIGHT);
/** NIGHTS: how many nights the simulated player keeps going before stopping with the best guess. */
const NIGHTS = Number(env.NIGHTS ?? 6);
const REAL = { motorNoise: 1.6, amplitudeNoise: 0.2, trackingDelayMs: 350, trackingNoiseDegPerSec: 10 };
const BUCKETS = [{ name: 'flat (<0.6)', max: 0.6 }, { name: 'medium (0.6–1.5)', max: 1.5 }, { name: 'sharp (>1.5)', max: Infinity }];

it(`Play-Along accuracy (${SET})`, () => {
  const rng = createRng(SET === 'tune' ? 11 : 97);
  const vary = (v: number): number => v * (0.7 + 0.6 * rng.next());
  type Row = { curv: number; err: number; kind: string; nights: number; tests: number };
  const rows: Row[] = [];
  for (let i = 0; i < N; i++) {
    const curvature = Math.exp(Math.log(0.2) + rng.next() * Math.log(4 / 0.2));
    const start = 20 + Math.floor(rng.next() * 31);
    const bestCm = finalsToCm360(start, 800) / (0.6 + rng.next());
    const cfg = { ...defaultConfig,
      sim: { ...defaultConfig.sim, amplitudeNoise: vary(REAL.amplitudeNoise), trackingDelayMs: vary(REAL.trackingDelayMs),
        trackingNoiseDegPerSec: vary(REAL.trackingNoiseDegPerSec) },
      playAlong: { ...defaultConfig.playAlong, tightRange: TIGHT, sim: { ...defaultConfig.playAlong.sim, maxNights: NIGHTS } } } as unknown as Config;
    const setup: PaSetup = { game: 'finals', dpi: 800, defaultCm360: finalsToCm360(start, 800), padWidthCm: 60, fov: 103, fovType: 'horizontal' };
    const player = defaultSimPlayer(setup.defaultCm360, { optimalCm360: bestCm, curvature, motorNoise: vary(REAL.motorNoise) });
    const r = runPlayAlongSim(setup, player, (SET === 'tune' ? 300_000 : 400_000) + i, cfg);
    const res = r.state.result!;
    rows.push({ curv: curvature, err: Math.abs(Math.log(res.recommendedCm360 / bestCm)), kind: res.kind, nights: r.nights, tests: r.state.tests.length });
    if (env.DEBUG && res.kind === 'change' && Math.abs(Math.log(res.recommendedCm360 / bestCm)) > Math.log(1.1)) {
      const n = (cm: number): number => Math.round(914_400 / (cm * 800));
      report('debug', `bot ${i}: start ${start} best ${n(bestCm)} curv ${curvature.toFixed(2)} → change to ${n(res.recommendedCm360)}; h2h δ ${res.h2h?.delta.toFixed(3)} se ${res.h2h?.se.toFixed(3)}; tests ${r.state.tests.map((t) => n(t.cm360) + (t.role === 'h2h' ? '*' : '')).join(' ')}`);
    }
  }
  const pct = (x: number): string => `${Math.round(100 * x)}%`;
  let lo = 0;
  for (const b of BUCKETS) {
    const g = rows.filter((r) => r.curv >= lo && r.curv < b.max);
    lo = b.max;
    if (g.length === 0) continue;
    const within = (e: number): number => g.filter((r) => r.err < Math.log(1 + e)).length / g.length;
    const wrong = g.filter((r) => r.kind === 'change' && r.err > Math.log(1.1)).length;
    report(`accuracy ${SET} tight ${TIGHT} nights ${NIGHTS}`, `${b.name}: ${g.length} bots · within ±5% ${pct(within(0.05))} · within ±10% ${pct(within(0.1))} · `
      + `median error ${(100 * median(g.map((r) => r.err))).toFixed(1)}% · confirmed changes ${g.filter((r) => r.kind === 'change').length}`
      + ` · confidently wrong ${wrong} · median nights ${median(g.map((r) => r.nights))} · median tests ${median(g.map((r) => r.tests))}`);
  }
}, 3_600_000);
