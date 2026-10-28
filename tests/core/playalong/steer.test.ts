import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../../../src/core/config';
import { finalsToCm360, gameSensOf } from '../../../src/core/playalong/gameSens';
import { choosePair, nextStep, type PairContext } from '../../../src/core/playalong/steer';
import { maxTestCm360 } from '../../../src/core/steer';

const finals = (sens: number): number => finalsToCm360(sens, 800);
const ctx = (o: Partial<PairContext>): PairContext => ({
  game: 'finals', dpi: 800, defaultCm360: finals(33), padWidthCm: 60, centerCm360: finals(33), step: 0.2, testedCm360: [finals(33)], ...o,
});

describe('choosePair', () => {
  it('first pair is ±20% snapped to whole Finals numbers', () => {
    const d = choosePair(ctx({}));
    expect(d.exhausted).toBe(false);
    expect(d.targets.map((cm) => gameSensOf('finals', cm, 800))).toEqual([40, 27]);
  });

  it('too slow for the pad moves to the slowest sens that fits', () => {
    const c = ctx({ game: 'other', defaultCm360: 30, centerCm360: 30, padWidthCm: 18, testedCm360: [30] });
    const cap = maxTestCm360(30, 18, defaultConfig);
    const d = choosePair(c);
    expect(d.targets).toHaveLength(2);
    expect(d.targets[1]).toBeCloseTo(cap, 9);
    expect(d.reason).toMatch(/pad/);
  });

  it('a clamped side already tested is skipped', () => {
    const cap = maxTestCm360(30, 18, defaultConfig);
    const d = choosePair(ctx({ game: 'other', defaultCm360: 30, centerCm360: 30, padWidthCm: 18, testedCm360: [30, cap] }));
    expect(d.targets).toHaveLength(1);
    expect(d.targets[0]).toBeCloseTo(25, 9);
  });

  it('a snapped side already tested moves one whole number further out', () => {
    const d = choosePair(ctx({ testedCm360: [finals(33), finals(40)] }));
    expect(d.targets.map((cm) => gameSensOf('finals', cm, 800))).toEqual([41, 27]);
  });

  it('low Finals sens never goes below 1 and exhausts', () => {
    const d = choosePair(ctx({ defaultCm360: finals(2), centerCm360: finals(2), testedCm360: [finals(1), finals(2), finals(3)] }));
    expect(d.exhausted).toBe(true);
    expect(d.targets).toEqual([]);
  });

  it('other game is not snapped', () => {
    const d = choosePair(ctx({ game: 'other', defaultCm360: 30, centerCm360: 30, testedCm360: [30] }));
    expect(d.targets[0]).toBeCloseTo(25, 9);
    expect(d.targets[1]).toBeCloseTo(36, 9);
  });
});

describe('nextStep', () => {
  it('halves down to the 4% floor', () => {
    expect(nextStep(0.2)).toBeCloseTo(0.1, 12);
    expect(nextStep(0.1)).toBeCloseTo(0.05, 12);
    expect(nextStep(0.05)).toBeCloseTo(0.04, 12);
    expect(nextStep(0.04)).toBeCloseTo(0.04, 12);
  });
});
