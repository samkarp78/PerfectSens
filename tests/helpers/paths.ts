import type { Aim, MoveSample } from '../../src/core/types';

const minJerk = (tau: number): number => 10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5;

/** Integer-count mouse moves following a minimum-jerk profile from `from` to `to`; cumulative sum lands on the rounded target. */
export function minJerkMoves(from: Aim, to: Aim, t0: number, durMs: number, hz: number, dpc: number): MoveSample[] {
  const n = Math.max(1, Math.round((durMs * hz) / 1000));
  const totalDx = Math.round((to.yaw - from.yaw) / dpc);
  const totalDy = Math.round(-(to.pitch - from.pitch) / dpc);
  const out: MoveSample[] = [];
  let cx = 0, cy = 0;
  for (let k = 1; k <= n; k++) {
    const s = k === n ? 1 : minJerk(k / n);
    const nx = Math.round(s * totalDx), ny = Math.round(s * totalDy);
    out.push({ t: t0 + k * (1000 / hz), dx: nx - cx, dy: ny - cy });
    cx = nx; cy = ny;
  }
  return out;
}
