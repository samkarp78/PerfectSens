import type { Aim } from '../core/types';
import { aimToVec } from '../core/geometry';

const DEG = Math.PI / 180;

/** Camera rotation for an aim: x = pitch (rad), y = -yaw (rad), applied in YXZ order. */
export function aimToEuler(aim: Aim): { x: number; y: number; order: 'YXZ' } {
  return { x: aim.pitch * DEG, y: -aim.yaw * DEG, order: 'YXZ' };
}

export function targetPosition(aim: Aim, distance: number): [number, number, number] {
  const v = aimToVec(aim);
  return [v[0] * distance, v[1] * distance, v[2] * distance];
}

export function sphereRadiusFor(angularRadiusDeg: number, distance: number): number {
  return distance * Math.tan(angularRadiusDeg * DEG);
}

/**
 * Screen direction (radians; 0 = right, π/2 = up) from the view centre towards a target that is outside the view,
 * or null when the target is on screen. Works for targets behind the player too.
 */
export function offscreenArrow(view: Aim, target: Aim, vfovDeg: number, aspect: number): number | null {
  const v = aimToVec(target);
  const f = aimToVec(view);
  const y = view.yaw * DEG, p = view.pitch * DEG;
  const right = [Math.cos(y), 0, Math.sin(y)] as const;
  const up = [-Math.sin(y) * Math.sin(p), Math.cos(p), Math.cos(y) * Math.sin(p)] as const;
  const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const cx = dot(v, right), cy = dot(v, up), cz = dot(v, f);
  const tanV = Math.tan((vfovDeg * DEG) / 2);
  const tanH = tanV * aspect;
  if (cz > 0 && Math.abs(cx / cz) <= tanH && Math.abs(cy / cz) <= tanV) return null;
  return Math.atan2(cy, cx);
}
