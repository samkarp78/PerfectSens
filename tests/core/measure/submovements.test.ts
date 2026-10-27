import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../../src/core/config';
import { angleBetween } from '../../../src/core/geometry';
import { segmentSubmovements } from '../../../src/core/measure/submovements';
import type { Aim, AimSample } from '../../../src/core/types';
import { minJerkMoves, movesToPath } from '../../helpers/paths';

const DPC = 0.01;
const HZ = 1000;
const O: Aim = { yaw: 0, pitch: 0 };
const at = (yaw: number): Aim => ({ yaw, pitch: 0 });

const move = (from: Aim, to: Aim, t0: number, dur: number): AimSample[] =>
  movesToPath(from, minJerkMoves(from, to, t0, dur, HZ, DPC), DPC);
const hold = (a: Aim, t0: number, t1: number): AimSample[] => {
  const out: AimSample[] = [];
  for (let t = t0; t <= t1; t++) out.push({ t, ...a });
  return out;
};

describe('segmentSubmovements', () => {
  it('finds one submovement for a single 20 degree move', () => {
    const path = move(O, at(20), 0, 200);
    const subs = segmentSubmovements(path, 0, 400, O, defaultConfig);
    expect(subs).toHaveLength(1);
    const fromErr = angleBetween(subs[0]!.from, O);
    const toErr = angleBetween(subs[0]!.to, at(20));
    expect(fromErr).toBeLessThanOrEqual(0.3);
    expect(toErr).toBeLessThanOrEqual(0.3);
    expect(subs[0]!.peakSpeed).toBeGreaterThan(100);
  });

  it('measures a 3 degree flick gain within 3 percent', () => {
    const path = move(O, at(3), 0, 120);
    const subs = segmentSubmovements(path, 0, 400, O, defaultConfig);
    expect(subs).toHaveLength(1);
    const gainErr = angleBetween(subs[0]!.to, at(3)) / 3;
    expect(gainErr).toBeLessThanOrEqual(0.03);
  });

  it('splits two 10 degree moves separated by an 80 ms hold', () => {
    const path = [...move(O, at(10), 0, 100), ...hold(at(10), 101, 180), ...move(at(10), at(20), 180, 100)];
    const subs = segmentSubmovements(path, 0, 400, O, defaultConfig);
    expect(subs).toHaveLength(2);
    expect(angleBetween(subs[0]!.to, at(10))).toBeLessThanOrEqual(0.3);
    expect(angleBetween(subs[1]!.from, at(10))).toBeLessThanOrEqual(0.3);
  });

  it('keeps a 20 ms gap in one submovement but splits at 40 ms', () => {
    // Constant 200 deg/s runs (abrupt edges) around a stationary gap below endDegPerSec.
    const run = (a: number, b: number, t0: number): AimSample[] => {
      const out: AimSample[] = [];
      for (let k = 1; k <= 50; k++) out.push({ t: t0 + k, yaw: a + ((b - a) * k) / 50, pitch: 0 });
      return out;
    };
    const build = (gap: number) => [...run(0, 10, 0), ...hold(at(10), 51, 50 + gap), ...run(10, 20, 50 + gap)];
    expect(segmentSubmovements(build(20), 0, 400, O, defaultConfig)).toHaveLength(1);
    expect(segmentSubmovements(build(40), 0, 400, O, defaultConfig)).toHaveLength(2);
  });

  it('ignores +-0.01 degree jitter', () => {
    const path: AimSample[] = [];
    for (let t = 1; t <= 400; t++) path.push({ t, yaw: t % 2 ? 0.01 : -0.01, pitch: 0 });
    expect(segmentSubmovements(path, 0, 400, O, defaultConfig)).toEqual([]);
  });

  it('keeps one submovement when speed dips to 25 deg/s for 20 ms', () => {
    const path = [...move(O, at(10), 0, 100), ...move(at(10), at(10.5), 100, 20), ...move(at(10.5), at(20.5), 120, 100)];
    expect(segmentSubmovements(path, 0, 400, O, defaultConfig)).toHaveLength(1);
  });

  it('returns [] for an empty path', () => {
    expect(segmentSubmovements([], 0, 400, O, defaultConfig)).toEqual([]);
  });
});
