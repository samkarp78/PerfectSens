import { defaultConfig } from './config';
import type { Aim, FovType } from './types';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const CM_PER_INCH = 2.54;
const FULL_TURN_DEG = 360;

export function degPerCount(dpi: number, cm360: number): number {
  return (CM_PER_INCH / dpi) * (FULL_TURN_DEG / cm360);
}

export function applyMove(aim: Aim, dx: number, dy: number, dpc: number): Aim {
  const max = defaultConfig.geometry.maxPitchDeg;
  const pitch = Math.max(-max, Math.min(max, aim.pitch - dy * dpc));
  return { yaw: aim.yaw + dx * dpc, pitch };
}

export function aimToVec(aim: Aim): [number, number, number] {
  const y = aim.yaw * RAD, p = aim.pitch * RAD;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
}

export function angleBetween(a: Aim, b: Aim): number {
  const u = aimToVec(a), v = aimToVec(b);
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
  return Math.atan2(cross, dot) * DEG;
}

export function offsetAim(from: Aim, distanceDeg: number, directionDeg: number): Aim {
  const t = directionDeg * RAD;
  return { yaw: from.yaw + distanceDeg * Math.cos(t), pitch: from.pitch + distanceDeg * Math.sin(t) };
}

export function alongPerp(from: Aim, to: Aim, p: Aim): { along: number; perp: number } {
  const k = Math.cos(((from.pitch + to.pitch) / 2) * RAD); // one flat plane: scale fixed by the from→to segment
  const proj = (b: Aim) => ({ x: (b.yaw - from.yaw) * k, y: b.pitch - from.pitch });
  const d = proj(to), q = proj(p);
  const len = Math.hypot(d.x, d.y);
  if (len === 0) return { along: 0, perp: 0 };
  const ux = d.x / len, uy = d.y / len;
  return { along: q.x * ux + q.y * uy, perp: -q.x * uy + q.y * ux };
}

export function vfovDeg(fov: number, type: FovType, aspect: number): number {
  if (type === 'vertical') return fov;
  return 2 * Math.atan(Math.tan((fov * RAD) / 2) / aspect) * DEG;
}
