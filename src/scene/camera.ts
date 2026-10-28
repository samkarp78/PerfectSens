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
