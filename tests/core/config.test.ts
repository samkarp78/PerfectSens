import { expect, test } from 'vitest';
import { configForMode, defaultConfig, PART_KINDS, partMs } from '../../src/core/config';

test('30 flick distances, 10 per class', () => {
  const d = defaultConfig.flick.distancesDeg;
  expect(d).toHaveLength(30);
  expect(d.filter(x => x < defaultConfig.flick.smallMaxDeg)).toHaveLength(10);
  expect(d.filter(x => x > defaultConfig.flick.bigMinDeg)).toHaveLength(10);
});

test('all parts are equal length (default and quick)', () => {
  expect(PART_KINDS).toEqual(['flick', 'switch', 'tracking', 'trackswitch']);
  for (const cfg of [defaultConfig, configForMode('quick')]) {
    const lens = PART_KINDS.map((k) => partMs(k, cfg));
    expect(new Set(lens).size).toBe(1);
  }
  expect(partMs('flick', defaultConfig)).toBe(14000);
  expect(partMs('flick', configForMode('quick'))).toBe(8000);
  expect(defaultConfig.round.cueMs).toBe(1800);
  expect(defaultConfig.round.cueTickMs).toBe(600);
});
