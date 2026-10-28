import { describe, it, expect } from 'vitest';
import { aimToEuler, targetPosition, sphereRadiusFor } from '../../src/scene/camera';

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
