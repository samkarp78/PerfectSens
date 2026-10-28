import type { Config } from './config';
import type { FitResult } from './fit';
import type { Rng } from './rng';
import type { FlickClass, StepResult } from './types';

/** Steering inputs; `steps` holds all non-baseline steps so far, in order. */
export interface SteerContext {
  currentCm360: number; baseline: StepResult; steps: StepResult[]; fit: FitResult | null;
  stepIndex: number; totalSteps: number; rng: Rng;
  /** Measured play-area width; caps the slowest test sens. */
  padWidthCm?: number | null;
}

/** The slowest cm/360 the test may use: the steering limit, and (with a measured pad) a 180° turn within
 *  pad.turnFraction of the pad, but never below the current sens. */
export function maxTestCm360(current: number, padWidthCm: number | null | undefined, cfg: Config): number {
  const limit = cfg.steer.limits.max * current;
  if (!padWidthCm) return limit;
  return Math.max(current, Math.min(limit, 2 * cfg.pad.turnFraction * padWidthCm));
}
export interface SteerDecision { cm360: number; direction: 'slower' | 'faster'; stepSize: number; signal: number; reason: string }

/** +1 = slower (higher cm/360), −1 = faster. */
type Dir = 1 | -1;

/** Number of bracketing steps (indices 0 and 1) before steering takes over. */
const BRACKET_STEPS = 2;

const dirName = (dir: Dir): 'slower' | 'faster' => (dir > 0 ? 'slower' : 'faster');

/** `bracket` for indices 0–1, then geometric from `bracket` to `finalStep` across indices 2…n−1. */
export function stepSize(stepIndex: number, totalSteps: number, cfg: Config): number {
  const { bracket, finalStep } = cfg.steer;
  if (stepIndex < BRACKET_STEPS) return bracket;
  const span = totalSteps - 1 - BRACKET_STEPS;
  if (span <= 0) return finalStep;
  const frac = Math.min(1, (stepIndex - BRACKET_STEPS) / span);
  return bracket * (finalStep / bracket) ** frac;
}

/** Mean of flick and switch values weighted by sample counts; the side with data if only one has it; null if neither. */
function pooled(a: number | null, na: number, b: number | null, nb: number): number | null {
  const wa = a === null ? 0 : na, wb = b === null ? 0 : nb;
  if (wa + wb === 0) return a ?? b;
  return ((a ?? 0) * wa + (b ?? 0) * wb) / (wa + wb);
}

const classTotal = (n: Record<FlickClass, number>): number => n.small + n.medium + n.big;

/** First-move gain for a distance class, pooled over the round's flicks and switches by classN. */
export function pooledGain(step: StepResult, cls: FlickClass): number | null {
  const gain = (x: StepResult['flick']): number | null => (cls === 'small' ? x.smallGain : cls === 'medium' ? x.mediumGain : x.bigGain);
  return pooled(gain(step.flick), step.flick.classN[cls], gain(step.switch), step.switch.classN[cls]);
}

/** First-click along offset (deg), pooled over flicks and switches by their scored counts. */
export function pooledClickBias(step: StepResult): number | null {
  return pooled(step.flick.clickBias, classTotal(step.flick.classN), step.switch.clickBias, classTotal(step.switch.classN));
}

function bestTested(ctx: SteerContext): StepResult {
  let best = ctx.baseline;
  for (const s of ctx.steps) if (s.score.logS > best.score.logS) best = s;
  return best;
}

function fitSlope(fit: FitResult | null, center: number, current: number): number {
  if (!fit || !fit.usable || !fit.coef) return 0;
  return fit.coef.b + 2 * fit.coef.c * Math.log(center / current);
}

export interface Driver { value: number; text: (positive: boolean) => string }

/**
 * The aim signals of a round against a reference round (+ = steer slower): small-flick overshoot, big-flick reach,
 * tracking lead/lag and speed match, and click bias, each scaled by `disc` (how much a sens jump just before may have
 * skewed them).
 */
export function aimDrivers(last: StepResult, base: StepResult, cfg: Config, disc = 1): Driver[] {
  const sc = cfg.steer;
  const dSmall = (pooledGain(last, 'small') ?? 0) - (pooledGain(base, 'small') ?? 0);
  const dBig = (pooledGain(last, 'big') ?? 0) - (pooledGain(base, 'big') ?? 0);
  const ratio = (st: StepResult): number | null => st.tracking.detail?.speedRatio ?? null;
  const lastRatio = ratio(last), baseRatio = ratio(base);
  const dSpeed = lastRatio === null || baseRatio === null ? 0 : lastRatio - baseRatio;
  const dBias = (pooledClickBias(last) ?? 0) - (pooledClickBias(base) ?? 0);
  const dLead = last.tracking.leadLagDeg - base.tracking.leadLagDeg;
  return [
    { value: disc * sc.weights.smallGain * dSmall,
      text: (p) => (p ? 'Small flicks and switches overshot more than baseline' : 'Small flicks and switches overshot less than baseline') },
    { value: disc * sc.weights.bigGain * dBig,
      text: (p) => (p ? 'Big flicks and switches reached further than baseline' : 'Big flicks and switches fell shorter than baseline') },
    { value: disc * sc.weights.leadLag * dLead / sc.leadLagScaleDeg,
      text: (p) => (p ? 'Tracking led the target more than baseline' : 'Tracking lagged the target more than baseline') },
    { value: disc * sc.weights.speedMatch * dSpeed,
      text: (p) => (p ? 'Tracking ran ahead of target speed more than baseline' : 'Tracking fell behind target speed more than baseline') },
    { value: disc * sc.weights.clickBias * dBias / sc.clickBiasScaleDeg,
      text: (p) => (p ? 'Clicks landed further past targets than baseline' : 'Clicks landed shorter of targets than baseline') },
  ];
}

export function chooseNext(ctx: SteerContext, cfg: Config): SteerDecision {
  const sc = cfg.steer;
  const current = ctx.currentCm360;
  const size = stepSize(ctx.stepIndex, ctx.totalSteps, cfg);

  if (ctx.stepIndex < BRACKET_STEPS) {
    // With no room for a slower sens (play-area cap at current), both brackets go faster: one and two steps out.
    const noSlower = Math.log(maxTestCm360(current, ctx.padWidthCm, cfg) / current) < Math.log(1 + sc.minSeparation);
    const first = ctx.steps[0];
    let dir: Dir = ctx.stepIndex === 1 && first ? (first.cm360 > current ? -1 : 1) : (ctx.rng.next() < 0.5 ? 1 : -1);
    let steps = 1;
    if (noSlower) { dir = -1; steps = ctx.stepIndex === 1 ? 2 : 1; }
    return {
      cm360: Math.min(current * (1 + sc.bracket) ** (dir * steps), maxTestCm360(current, ctx.padWidthCm, cfg)),
      direction: dirName(dir), stepSize: size, signal: 0,
      reason: `Bracketing: testing a ${dirName(dir)} sens`,
    };
  }

  const fit = ctx.fit;
  const confident = fit !== null && fit.usable && !fit.lowConfidence;
  const center = confident ? fit.pickCm360 : bestTested(ctx).cm360;
  const last = ctx.steps[ctx.steps.length - 1] ?? ctx.baseline;
  const prev = ctx.steps.length >= 2 ? ctx.steps[ctx.steps.length - 2]! : ctx.baseline;
  const base = ctx.baseline;

  const disc = Math.exp(-Math.abs(Math.log(last.cm360 / prev.cm360)) / sc.jumpScale);
  const dCorr = last.flick.corrections - base.flick.corrections;
  const dSpread = last.flick.spreadRatio - base.flick.spreadRatio;
  const slope = fitSlope(fit, center, current);

  const drivers: Driver[] = [
    ...aimDrivers(last, base, cfg, disc),
    { value: sc.weights.corrSpread * Math.sign(slope) * Math.max(0, dCorr / sc.correctionsScale + dSpread),
      text: () => 'More corrections or spread than baseline, following the fit slope' },
  ];
  const s = drivers.reduce((acc, d) => acc + d.value, 0);

  const tested = [base.cm360, ...ctx.steps.map((t) => t.cm360)];
  // The best guess sits at (or beyond) a tested edge: the confident fit's flag, or else the best tested step being the extreme.
  const atEdge: FitResult['edge'] = confident ? fit.edge
    : center <= Math.min(...tested) ? 'faster' : center >= Math.max(...tested) ? 'slower' : null;

  let dir: Dir;
  let why: string;
  if (atEdge) {
    // The pick is clamped to the tested range, so probe past its edge.
    dir = atEdge === 'slower' ? 1 : -1;
    why = `The best guess lies at the edge of the tested range, extending ${atEdge}`;
  } else if (Math.abs(s) < sc.deadband) {
    dir = last.cm360 > center ? -1 : 1;
    why = 'Aim signals were neutral, probing the other side of the best guess';
  } else {
    dir = s > 0 ? 1 : -1;
    const main = drivers.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
    why = main.text(main.value > 0);
  }

  const lo = sc.limits.min * current;
  const hi = maxTestCm360(current, ctx.padWidthCm, cfg);
  /** `k` steps of `size` from center in direction `d`, clamped to the limits. */
  const place = (d: Dir, k = 1): number => Math.min(hi, Math.max(lo, center * (1 + size) ** (k * d)));
  const minSep = Math.log(1 + sc.minSeparation);
  const collides = (v: number): boolean => tested.some((t) => Math.abs(Math.log(v / t)) < minSep);
  /** Best score among the tested steps that collide with `v`. */
  const neighbourScore = (v: number): number => Math.max(...[base, ...ctx.steps]
    .filter((t) => Math.abs(Math.log(v / t.cm360)) < minSep).map((t) => t.score.logS));
  /** First untested value walking outward from center in direction `d` (k = 2, 3, …) before the limit; null if none. */
  const walkOut = (d: Dir): number | null => {
    for (let k = 2; ; k++) {
      const v = place(d, k);
      if (!collides(v)) return v;
      if (v === lo || v === hi) return null;
    }
  };

  let cm360 = place(dir);
  if (collides(cm360)) {
    const chosen = dir;
    const flipped: Dir = dir > 0 ? -1 : 1;
    why += ', but that sens was already tested';
    if (!collides(place(flipped))) {
      dir = flipped;
      cm360 = place(flipped);
    } else {
      // Both neighbours of center were tested: keep stepping outward instead of repeating a test, past the
      // better-scoring neighbour first (the aim signals here mostly reflect adaptation to the last jump).
      const first: Dir = neighbourScore(place(flipped)) > neighbourScore(place(chosen)) ? flipped : chosen;
      const second: Dir = first > 0 ? -1 : 1;
      const out = walkOut(first);
      const other = out === null ? walkOut(second) : null;
      if (out !== null) { dir = first; cm360 = out; }
      else if (other !== null) { dir = second; cm360 = other; }
      else { dir = flipped; cm360 = place(flipped); }
    }
  }

  return { cm360, direction: dirName(dir), stepSize: size, signal: s, reason: `${why} → testing ${dirName(dir)}` };
}
