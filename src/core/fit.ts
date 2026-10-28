import type { Config } from './config';
import { solve } from './linalg';
import type { Rng } from './rng';

/** One block score. x = ln(cm360), t = normalized session time in [0, 1]; night (0-based) only for multi-night searches. */
export interface FitPoint { x: number; y: number; se: number; t: number; isCurrent: boolean; night?: number }

export interface FitResult {
  usable: boolean;
  coef: { a: number; b: number; c: number; d: number; f: number } | null;
  pickCm360: number;
  range: [number, number] | null;
  edge: 'faster' | 'slower' | null;
  lowConfidence: boolean;
}

type Coef = NonNullable<FitResult['coef']>;

/** Distinct-x counting resolution (values rounded to this grid before comparing). */
const DISTINCT_X_RESOLUTION = 1e6;

/** Night indices after the first that get an offset column; none unless the points span two or more nights. */
function offsetNights(points: readonly FitPoint[]): number[] {
  return [...new Set(points.map((p) => p.night ?? 0))].sort((a, b) => a - b).slice(1);
}

/**
 * Weighted ridge least squares for y = a + b·u + c·u² + d·t + f·isCurrent (+ one offset per later night), u = x − x0.
 * Weights 1/se²; ridge on d, f and the night offsets only.
 */
function solveModel(points: readonly FitPoint[], ys: readonly number[], x0: number, cfg: Config): Coef | null {
  const extra = offsetNights(points);
  const k = 5 + extra.length;
  const XtWX = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const XtWy = new Array<number>(k).fill(0);
  points.forEach((p, i) => {
    const u = p.x - x0;
    const row = [1, u, u * u, p.t, p.isCurrent ? 1 : 0, ...extra.map((n) => ((p.night ?? 0) === n ? 1 : 0))];
    const w = 1 / (p.se * p.se);
    for (let r = 0; r < k; r++) {
      XtWy[r] = XtWy[r]! + w * row[r]! * ys[i]!;
      for (let c = 0; c < k; c++) XtWX[r]![c] = XtWX[r]![c]! + w * row[r]! * row[c]!;
    }
  });
  XtWX[3]![3] = XtWX[3]![3]! + 1 / cfg.fit.driftPriorSd ** 2;
  XtWX[4]![4] = XtWX[4]![4]! + 1 / cfg.fit.familiarityPriorSd ** 2;
  for (let j = 5; j < k; j++) XtWX[j]![j] = XtWX[j]![j]! + 1 / cfg.playAlong.nightPriorSd ** 2;
  const sol = solve(XtWX, XtWy);
  if (!sol || !sol.every(Number.isFinite)) return null;
  const [a, b, c, d, f] = sol as [number, number, number, number, number];
  return { a, b, c, d, f };
}

function bestPoint(points: readonly FitPoint[]): FitPoint {
  let best = points[0]!;
  for (const p of points) if (p.y > best.y) best = p;
  return best;
}

/**
 * Edge flag for an upward (c ≥ 0) fit: the tested edge whose best score is within the minimum effect of the best point
 * (performs the same), when exactly one edge qualifies; if both do, the edge the best point sits on, if any.
 */
function upwardEdge(points: readonly FitPoint[], cfg: Config): FitResult['edge'] {
  const tolerance = Math.log(1 + cfg.ab.minEffect);
  const best = bestPoint(points);
  const xs = points.map((p) => p.x);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const bestAt = (x: number): number => Math.max(...points.filter((p) => p.x === x).map((p) => p.y));
  const fast = best.y - bestAt(minX) <= tolerance;
  const slow = best.y - bestAt(maxX) <= tolerance;
  if (fast && !slow) return 'faster';
  if (slow && !fast) return 'slower';
  if (fast && slow) return best.x === minX ? 'faster' : best.x === maxX ? 'slower' : null;
  return null;
}

function bootstrapRange(points: readonly FitPoint[], x0: number, minU: number, maxU: number,
  cfg: Config, rng: Rng): [number, number] | null {
  const n: number = cfg.fit.gridPoints;
  const grid = Array.from({ length: n }, (_, i) => (n === 1 ? minU : minU + ((maxU - minU) * i) / (n - 1)));
  const tolerance = Math.log(1 + cfg.ab.minEffect);
  const hits = new Array<number>(n).fill(0);
  let draws = 0;
  for (let s = 0; s < cfg.fit.bootstrapSamples; s++) {
    const ys = points.map((p) => p.y + p.se * rng.normal());
    const coef = solveModel(points, ys, x0, cfg);
    if (!coef) continue;
    draws++;
    const q = grid.map((u) => coef.a + coef.b * u + coef.c * u * u);
    const qMax = Math.max(...q);
    q.forEach((v, i) => { if (v >= qMax - tolerance) hits[i] = hits[i]! + 1; });
  }
  if (draws === 0) return null;
  let lo = -1, hi = -1;
  hits.forEach((h, i) => {
    if (h / draws >= cfg.fit.rangeFraction) {
      if (lo < 0) lo = i;
      hi = i;
    }
  });
  if (lo < 0) return null;
  return [Math.exp(x0 + grid[lo]!), Math.exp(x0 + grid[hi]!)];
}

export function fitCurve(points: FitPoint[], x0: number, cfg: Config, rng: Rng): FitResult {
  const fallback = (usable: boolean, coef: Coef | null): FitResult => ({
    usable, coef, pickCm360: Math.exp(bestPoint(points).x), range: null, edge: null, lowConfidence: true,
  });

  const distinct = new Set(points.map((p) => Math.round(p.x * DISTINCT_X_RESOLUTION)));
  if (distinct.size < cfg.fit.minDistinctX) return fallback(false, null);

  const coef = solveModel(points, points.map((p) => p.y), x0, cfg);
  if (!coef) return fallback(false, null);
  // Upward curve: pick the best point; flag an edge when a tested edge performs the same as it (peak at or beyond).
  if (coef.c >= 0) return { ...fallback(true, coef), edge: upwardEdge(points, cfg) };

  const uValues = points.map((p) => p.x - x0);
  const minU = Math.min(...uValues), maxU = Math.max(...uValues);
  let uStar = -coef.b / (2 * coef.c);
  let edge: FitResult['edge'] = null;
  if (uStar > maxU) { uStar = maxU; edge = 'slower'; }
  else if (uStar < minU) { uStar = minU; edge = 'faster'; }
  else {
    // A peak within one final step of a tested edge that performs the same as the best point: the optimum is at or
    // beyond that edge (the quadratic bends early when the far side of the range scores very low).
    const near = Math.log(1 + cfg.steer.finalStep);
    const flagged = upwardEdge(points, cfg);
    if (uStar - minU < near && flagged === 'faster') edge = 'faster';
    else if (maxU - uStar < near && flagged === 'slower') edge = 'slower';
  }

  return {
    usable: true, coef, pickCm360: Math.exp(x0 + uStar),
    range: bootstrapRange(points, x0, minU, maxU, cfg, rng), edge, lowConfidence: false,
  };
}
