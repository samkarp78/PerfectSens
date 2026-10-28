import type { Config } from '../config';
import { angleBetween } from '../geometry';
import type { Rng } from '../rng';
import type { SwitchBlockLog } from '../types';

const MS_PER_S = 1000;

export interface SwitchSummary { tp: number; logTpSe: number; kills: number; accuracy: number; n: number }

interface Kill { id: number; dtS: number }

const tpOf = (ks: readonly Kill[]): number => {
  const time = ks.reduce((s, k) => s + k.dtS, 0);
  return time > 0 ? ks.reduce((s, k) => s + k.id, 0) / time : 0;
};

/** Switching throughput: Σ log2(D/(2r) + 1) / Σ kill interval (s) over kills after the warm-in, where D runs from the aim
 *  at the previous kill to the killed target. SE: SD of ln tp over kill resamples. */
export function measureSwitch(log: SwitchBlockLog, cfg: Config, rng: Rng): SwitchSummary {
  const sc = cfg.switch;
  const all: Kill[] = log.kills.map((k, i) => ({
    id: Math.log2(angleBetween(k.from, k.target) / (2 * sc.targetRadiusDeg) + 1),
    dtS: (k.t - (i === 0 ? log.t0 : log.kills[i - 1]!.t)) / MS_PER_S,
  }));
  const scored = all.slice(sc.warmKills);
  const hits = log.clicks.filter((c) => c.hit).length;
  const accuracy = log.clicks.length > 0 ? hits / log.clicks.length : 0;
  const tp = tpOf(scored);
  const logs: number[] = [];
  if (scored.length > 0) {
    for (let b = 0; b < cfg.score.bootstrapSamples; b++) {
      const sample = scored.map(() => scored[rng.int(0, scored.length - 1)]!);
      logs.push(Math.log(Math.max(tpOf(sample), cfg.score.minTp)));
    }
  }
  return { tp, logTpSe: sd(logs), kills: log.kills.length, accuracy, n: scored.length };
}

function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
