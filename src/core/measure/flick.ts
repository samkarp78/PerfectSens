import type { Config } from '../config';
import { alongPerp, angleBetween } from '../geometry';
import type { Rng } from '../rng';
import type { AimSample, FlickBlockLog, FlickClass, FlickTrial } from '../types';
import { segmentSubmovements } from './submovements';

export interface TrialMetrics {
  index: number; cls: FlickClass; distance: number; mtMs: number; firstGain: number | null;
  corrections: number; endAlong: number | null; endPerp: number | null; hit: boolean; timedOut: boolean; scored: boolean;
}
export interface FlickSummary {
  tp: number; logTpSe: number; smallGain: number | null; mediumGain: number | null; bigGain: number | null;
  corrections: number; weDeg: number; spreadRatio: number; timeoutFraction: number; n: number;
  /** Mean first-click along offset (deg; + = overshoot at the click); null without clicks. */
  clickBias: number | null;
  /** Scored trials per distance class, for pooling gains across parts. */
  classN: Record<FlickClass, number>;
}

const MS_PER_S = 1000;

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const sampleSd = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

export function measureTrial(trial: FlickTrial, path: AimSample[], cfg: Config): TrialMetrics {
  const { target, spawnT, spawnAim } = trial;
  const distance = angleBetween(spawnAim, target.aim);
  const mtMs = trial.timedOut || trial.hitT === null ? cfg.flick.timeoutMs : trial.hitT - spawnT;
  const tEnd = trial.hitT ?? spawnT + cfg.flick.timeoutMs;
  const subs = segmentSubmovements(path, spawnT, tEnd, spawnAim, cfg);
  const firstGain = subs.length > 0 && distance > 0 ? alongPerp(spawnAim, target.aim, subs[0]!.to).along / distance : null;
  const click = trial.clicks[0];
  const end = click ? alongPerp(spawnAim, target.aim, click.aim) : null;
  return {
    index: target.index, cls: target.cls, distance, mtMs, firstGain,
    corrections: Math.max(0, subs.length - 1),
    endAlong: end ? end.along - distance : null, endPerp: end ? end.perp : null,
    hit: trial.hitT !== null && !trial.timedOut, timedOut: trial.timedOut, scored: target.scored,
  };
}

/** Per-trial metrics for a whole flick block. A trial counts as scored only if its target is scored and every
 *  target in its wave was resolved (hit or timed out), so each scored wave has the full small/medium/big mix. */
export function measureFlickBlock(log: FlickBlockLog, cfg: Config): TrialMetrics[] {
  const waveSize = 3 * cfg.flick.wavePerClass;
  const resolved = new Map<number, number>();
  for (const t of log.trials) {
    if (t.hitT !== null || t.timedOut) resolved.set(t.target.wave, (resolved.get(t.target.wave) ?? 0) + 1);
  }
  return log.trials.map((t) => {
    const m = measureTrial(t, log.path, cfg);
    return { ...m, scored: m.scored && resolved.get(t.target.wave) === waveSize };
  });
}

const MAD_TO_SD = 1.4826;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Trials whose first click is not a stray: within max(score.stray.sds robust SDs (1.4826·MAD), score.stray.minDeg) of the
 *  median along offset. A stray click (e.g. a click as the target appears) still counts as a miss and in the time; it is
 *  only left out of the end-point spread, which one such click would otherwise dominate. */
export function nonStray(trials: TrialMetrics[], cfg: Config): TrialMetrics[] {
  const withClick = trials.filter((t) => t.endAlong !== null);
  if (withClick.length < 3) return withClick;
  const along = withClick.map((t) => t.endAlong!);
  const m = median(along);
  const robustSd = MAD_TO_SD * median(along.map((a) => Math.abs(a - m)));
  const cut = Math.max(cfg.score.stray.sds * robustSd, cfg.score.stray.minDeg);
  return withClick.filter((t) => Math.abs(t.endAlong! - m) <= cut);
}

function tpOf(scored: TrialMetrics[], cfg: Config): { tp: number; weDeg: number } {
  const withClick = nonStray(scored, cfg);
  if (scored.length === 0) return { tp: 0, weDeg: cfg.score.minWeDeg };
  const weDeg = withClick.length > 0
    ? Math.max(cfg.score.weFactor * sampleSd(withClick.map((t) => t.endAlong!)), cfg.score.minWeDeg)
    : cfg.score.minWeDeg;
  const de = Math.max(0, withClick.length > 0 ? mean(withClick.map((t) => t.distance + t.endAlong!)) : mean(scored.map((t) => t.distance)));
  const mt = mean(scored.map((t) => t.mtMs)) / MS_PER_S;
  return { tp: Math.log2(de / weDeg + 1) / mt, weDeg };
}

export function throughput(trials: TrialMetrics[], cfg: Config): { tp: number; weDeg: number } {
  return tpOf(trials.filter((t) => t.scored), cfg);
}

export function summarizeFlick(trials: TrialMetrics[], cfg: Config, rng: Rng): FlickSummary {
  const scored = trials.filter((t) => t.scored);
  const { tp, weDeg } = tpOf(scored, cfg);

  const logs: number[] = [];
  if (scored.length > 0) {
    for (let b = 0; b < cfg.score.bootstrapSamples; b++) {
      const sample = scored.map(() => scored[rng.int(0, scored.length - 1)]!);
      logs.push(Math.log(Math.max(tpOf(sample, cfg).tp, cfg.score.minTp)));
    }
  }

  const classGain = (cls: FlickClass): number | null => {
    const g = scored.filter((t) => t.cls === cls && t.firstGain !== null).map((t) => t.firstGain!);
    return g.length > 0 ? mean(g) : null;
  };

  const withClick = nonStray(scored, cfg); // a stray click would dominate the mean
  const countOf = (cls: FlickClass): number => scored.filter((t) => t.cls === cls).length;

  return {
    tp, logTpSe: sampleSd(logs),
    smallGain: classGain('small'), mediumGain: classGain('medium'), bigGain: classGain('big'),
    corrections: scored.length > 0 ? mean(scored.map((t) => t.corrections)) : 0,
    weDeg, spreadRatio: weDeg / (2 * cfg.flick.targetRadiusDeg),
    timeoutFraction: scored.length > 0 ? scored.filter((t) => t.timedOut).length / scored.length : 0,
    n: scored.length,
    clickBias: withClick.length > 0 ? mean(withClick.map((t) => t.endAlong!)) : null,
    classN: { small: countOf('small'), medium: countOf('medium'), big: countOf('big') },
  };
}
