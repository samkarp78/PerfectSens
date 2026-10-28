import { describe, it, expect } from 'vitest';
import { cm360ToFinals, finalsToCm360, gameSensOf, sameSens, snapCm360 } from '../../../src/core/playalong/gameSens';

describe('The Finals conversion', () => {
  it('matches the mouse-sensitivity.com lookups at 800 DPI', () => {
    expect(finalsToCm360(33, 800)).toBeCloseTo(34.6364, 4);
    expect(finalsToCm360(16.5, 800)).toBeCloseTo(69.2727, 4);
    expect(finalsToCm360(66, 800)).toBeCloseTo(17.3182, 4);
  });

  it('converts back to the in-game number', () => {
    expect(cm360ToFinals(34.6364, 800)).toBeCloseTo(33, 3);
  });
});

describe('snapping to whole Finals numbers', () => {
  it('gives the nearest whole number for display', () => {
    expect(gameSensOf('finals', 28, 800)).toBe(41); // 40.82 → 41
    expect(snapCm360('finals', 28, 800, 'nearest')).toBeCloseTo(finalsToCm360(41, 800), 9);
  });

  it('rounds down the number when snapping slower (higher cm/360)', () => {
    expect(snapCm360('finals', 28, 800, 'slower')).toBeCloseTo(finalsToCm360(40, 800), 9);
  });

  it('never goes below sens 1', () => {
    expect(snapCm360('finals', 2000, 800, 'faster')).toBeCloseTo(finalsToCm360(1, 800), 9);
    expect(snapCm360('finals', 2000, 800, 'slower')).toBeCloseTo(finalsToCm360(1, 800), 9);
  });

  it('leaves other games unsnapped', () => {
    expect(snapCm360('other', 28.37, 800, 'nearest')).toBe(28.37);
    expect(gameSensOf('other', 28, 800)).toBeNull();
  });
});

describe('sameSens', () => {
  it('treats equal snapped Finals values as the same and others within 0.5%', () => {
    expect(sameSens('finals', finalsToCm360(33, 800), finalsToCm360(33, 800))).toBe(true);
    expect(sameSens('finals', finalsToCm360(33, 800), finalsToCm360(34, 800))).toBe(false);
    expect(sameSens('other', 30, 30.1)).toBe(true);
    expect(sameSens('other', 30, 30.3)).toBe(false);
  });
});
