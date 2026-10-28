import { describe, it, expect } from 'vitest';
import { aimToEuler, offscreenArrow, targetPosition, sphereRadiusFor } from '../../src/scene/camera';

describe('camera math', () => {
  it('places a target at yaw 90 on +x', () => {
    const p = targetPosition({ yaw: 90, pitch: 0 }, 20);
    expect(p[0]).toBeCloseTo(20, 6); expect(p[1]).toBeCloseTo(0, 6); expect(p[2]).toBeCloseTo(0, 6);
  });
  it('places a target straight ahead on -z', () => {
    const p = targetPosition({ yaw: 0, pitch: 0 }, 20);
    expect(p[2]).toBeCloseTo(-20, 6);
  });
  it('converts aim to YXZ euler', () => {
    const e = aimToEuler({ yaw: 90, pitch: 10 });
    expect(e.order).toBe('YXZ');
    expect(e.y).toBeCloseTo(-Math.PI / 2, 6);
    expect(e.x).toBeCloseTo(0.1745, 4);
  });
  it('computes sphere radius from angular radius', () => {
    expect(sphereRadiusFor(1.5, 20)).toBeCloseTo(0.5237, 4);
  });
});

describe('offscreenArrow', () => {
  const V = 70.53; // vertical FOV for 103° horizontal at 16:9
  const A = 16 / 9;
  it('returns null for a target in view', () => {
    expect(offscreenArrow({ yaw: 0, pitch: 0 }, { yaw: 30, pitch: 5 }, V, A)).toBeNull();
  });
  it('points right (angle 0) for a target 90° to the right', () => {
    expect(offscreenArrow({ yaw: 0, pitch: 0 }, { yaw: 90, pitch: 0 }, V, A)).toBeCloseTo(0, 6);
  });
  it('points up (π/2) for a target above the view', () => {
    expect(offscreenArrow({ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 45 }, V, A)).toBeCloseTo(Math.PI / 2, 6);
  });
  it('points left (±π) for a target behind and to the left', () => {
    expect(Math.abs(offscreenArrow({ yaw: 0, pitch: 0 }, { yaw: -150, pitch: 0 }, V, A)!)).toBeCloseTo(Math.PI, 6);
  });
  it('works relative to a turned and tilted view', () => {
    expect(offscreenArrow({ yaw: 60, pitch: 20 }, { yaw: 60, pitch: 20 }, V, A)).toBeNull();
    expect(offscreenArrow({ yaw: 60, pitch: 0 }, { yaw: 0, pitch: 0 }, V, A)).toBeCloseTo(Math.PI, 6);
  });
});
