import { describe, it, expect } from 'vitest';
import { degPerCount, applyMove, aimToVec, angleBetween, offsetAim, alongPerp, vfovDeg , countsToCm } from '../../src/core/geometry';

describe('geometry', () => {
  it('degPerCount', () => { expect(degPerCount(800, 34.29)).toBeCloseTo(0.033333, 5); });
  it('applyMove moves yaw right and pitch down for +dy', () => {
    expect(applyMove({ yaw: 0, pitch: 0 }, 300, 100, 0.1)).toEqual({ yaw: 30, pitch: -10 });
  });
  it('applyMove clamps pitch', () => {
    expect(applyMove({ yaw: 0, pitch: 85 }, 0, -100, 0.1).pitch).toBe(89);
    expect(applyMove({ yaw: 0, pitch: -85 }, 0, 100, 0.1).pitch).toBe(-89);
  });
  it('angleBetween', () => {
    expect(angleBetween({ yaw: 0, pitch: 0 }, { yaw: 90, pitch: 0 })).toBeCloseTo(90, 6);
    expect(angleBetween({ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 45 })).toBeCloseTo(45, 6);
    expect(angleBetween({ yaw: 10, pitch: 5 }, { yaw: 10, pitch: 5 })).toBe(0);
  });
  it('aimToVec', () => {
    const near = (v: number[], e: number[]) => e.forEach((x, i) => expect(v[i]).toBeCloseTo(x, 9));
    near(aimToVec({ yaw: 90, pitch: 0 }), [1, 0, 0]);
    near(aimToVec({ yaw: 0, pitch: 0 }), [0, 0, -1]);
    near(aimToVec({ yaw: 0, pitch: 90 }), [0, 1, 0]);
  });
  it('offsetAim', () => {
    const a = offsetAim({ yaw: 1, pitch: 2 }, 10, 0);
    expect(a.yaw).toBeCloseTo(11, 9); expect(a.pitch).toBeCloseTo(2, 9);
    const b = offsetAim({ yaw: 0, pitch: 0 }, 10, 90);
    expect(b.yaw).toBeCloseTo(0, 9); expect(b.pitch).toBeCloseTo(10, 9);
  });
  it('alongPerp', () => {
    const r = alongPerp({ yaw: 0, pitch: 0 }, { yaw: 10, pitch: 0 }, { yaw: 11, pitch: 0.5 });
    expect(r.along).toBeCloseTo(11, 9); expect(r.perp).toBeCloseTo(0.5, 9);
  });
  it('vfovDeg', () => {
    expect(vfovDeg(103, 'horizontal', 16 / 9)).toBeCloseTo(70.53, 1);
    expect(vfovDeg(70, 'vertical', 16 / 9)).toBe(70);
  });
});

describe('countsToCm', () => {
  it('converts mouse counts to centimetres of travel', () => {
    expect(countsToCm(800, 800)).toBeCloseTo(2.54, 9);
    expect(countsToCm(-1600, 400)).toBeCloseTo(10.16, 9);
  });
});
