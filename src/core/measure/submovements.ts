import type { Config } from '../config';
import { angleBetween } from '../geometry';
import type { Aim, AimSample } from '../types';

export interface Submovement { t0: number; t1: number; from: Aim; to: Aim; peakSpeed: number }

const MS_PER_S = 1000;

/** Splits [tStart, tEnd] into velocity-thresholded submovements using binned, smoothed angular speed. */
export function segmentSubmovements(path: AimSample[], tStart: number, tEnd: number, startAim: Aim, cfg: Config): Submovement[] {
  const c = cfg.submovement;
  const n = Math.floor((tEnd - tStart) / c.binMs);
  if (n <= 0 || path.length === 0) return [];

  let k = 0;
  const posAt = (t: number): Aim => {
    while (k < path.length && path[k]!.t <= t) k++;
    return k === 0 ? startAim : path[k - 1]!;
  };
  // pos[i + 1] = position at the end of bin i; pos[0] = position at tStart.
  const pos: Aim[] = [posAt(tStart)];
  for (let i = 0; i < n; i++) pos.push(posAt(tStart + (i + 1) * c.binMs));

  const raw: number[] = [];
  for (let i = 0; i < n; i++) raw.push((angleBetween(pos[i + 1]!, pos[i]!) / c.binMs) * MS_PER_S);
  const half = Math.floor(c.smoothBins / 2);
  const speed = raw.map((_, i) => {
    const lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += raw[j]!;
    return sum / (hi - lo + 1);
  });

  const endBins = Math.ceil(c.endHoldMs / c.binMs);
  const out: Submovement[] = [];
  let i = 0;
  while (i < n) {
    if (speed[i]! <= c.onsetDegPerSec) { i++; continue; }
    // Smoothing is centred, so speed really crossed onset about half a window before bin i; back up by that lag.
    const lead = Math.max(0, i - half);
    let peak = speed[i]!;
    let end = -1;
    for (let j = i + 1; j < n; j++) {
      if (speed[j]! < c.endDegPerSec) {
        let run = 1;
        while (j + run < n && run < endBins && speed[j + run]! < c.endDegPerSec) run++;
        if (run >= endBins) { end = j; break; }
      }
      peak = Math.max(peak, speed[j]!);
    }
    const finished = end >= 0;
    out.push({
      t0: tStart + lead * c.binMs,
      t1: finished ? tStart + end * c.binMs : tEnd,
      from: pos[lead]!,
      to: finished ? pos[end]! : posAt(tEnd),
      peakSpeed: peak,
    });
    i = finished ? end + endBins : n;
  }
  return out;
}
