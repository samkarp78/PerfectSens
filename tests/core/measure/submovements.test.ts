import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../../src/core/config';
import { angleBetween } from '../../../src/core/geometry';
import { segmentSubmovements } from '../../../src/core/measure/submovements';
import type { Aim, AimSample } from '../../../src/core/types';
import { minJerkMoves, movesToPath } from '../../helpers/paths';

const DPC = 0.01;
const HZ = 1000;
const O: Aim = { yaw: 0, pitch: 0 };

describe('segmentSubmovements', () => {
  it('finds one submovement for a single 20 degree move', () => {
    const to: Aim = { yaw: 20, pitch: 0 };
    const path = movesToPath(O, minJerkMoves(O, to, 0, 200, HZ, DPC), DPC);
    const subs = segmentSubmovements(path, 0, 400, O, defaultConfig);
    expect(subs).toHaveLength(1);
    expect(angleBetween(subs[0]!.from, O)).toBeLessThan(0.3);
    expect(angleBetween(subs[0]!.to, to)).toBeLessThan(0.3);
    expect(subs[0]!.peakSpeed).toBeGreaterThan(100);
  });

  it('splits two 10 degree moves separated by an 80 ms hold', () => {
    const mid: Aim = { yaw: 10, pitch: 0 };
    const end: Aim = { yaw: 20, pitch: 0 };
    const path = [
      ...movesToPath(O, minJerkMoves(O, mid, 0, 100, HZ, DPC), DPC),
      ...movesToPath(mid, minJerkMoves(mid, end, 180, 100, HZ, DPC), DPC),
    ];
    // hold samples between the moves
    const hold: AimSample[] = [];
    for (let t = 101; t <= 180; t++) hold.push({ t, ...mid });
    const all = [...path.filter((s) => s.t <= 100), ...hold, ...path.filter((s) => s.t > 180)];
    expect(segmentSubmovements(all, 0, 400, O, defaultConfig)).toHaveLength(2);
  });

  it('ignores +-0.01 degree jitter', () => {
    const path: AimSample[] = [];
    for (let t = 1; t <= 400; t++) path.push({ t, yaw: t % 2 ? 0.01 : -0.01, pitch: 0 });
    expect(segmentSubmovements(path, 0, 400, O, defaultConfig)).toEqual([]);
  });

  it('keeps one submovement when speed dips to 25 deg/s for 20 ms', () => {
    const a: Aim = { yaw: 10, pitch: 0 };
    const b: Aim = { yaw: 10.5, pitch: 0 };
    const c: Aim = { yaw: 20.5, pitch: 0 };
    const path = [
      ...movesToPath(O, minJerkMoves(O, a, 0, 100, HZ, DPC), DPC),
      ...movesToPath(a, minJerkMoves(a, b, 100, 20, HZ, DPC), DPC),
      ...movesToPath(b, minJerkMoves(b, c, 120, 100, HZ, DPC), DPC),
    ];
    expect(segmentSubmovements(path, 0, 400, O, defaultConfig)).toHaveLength(1);
  });

  it('returns [] for an empty path', () => {
    expect(segmentSubmovements([], 0, 400, O, defaultConfig)).toEqual([]);
  });
});
