import { expect, test } from 'vitest';
import { configForMode, configForPlayAlong, defaultConfig, PART_KINDS, partMs } from '../../src/core/config';

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

test('Play-Along: 2 rounds of equal 20 s parts, flicks scored from the first wave', () => {
  const c = configForPlayAlong();
  expect(c.playAlong.roundsPerTest).toBe(2);
  for (const k of PART_KINDS) expect(partMs(k, c)).toBe(20000);
  expect(c.tracking.leadInMs).toBe(2000);
  expect(c.flick.warmWave).toBe(false);
  expect(defaultConfig.flick.warmWave).toBe(true);
  expect(partMs('flick', defaultConfig)).toBe(14000);
});

test('Play-Along uses the more sensitive test; Standard keeps the original targets (spec 20)', () => {
  const pa = configForPlayAlong();
  expect(pa.flick.targetRadiusDeg).toBe(0.8);
  expect(pa.switch.targetRadiusDeg).toBe(0.8);
  expect(pa.tracking.targetRadiusDeg).toBe(1.2);
  expect(pa.trackswitch.targetRadiusDeg).toBe(1.2);
  for (const d of [90, 120, 150]) expect(pa.flick.distancesDeg).toContain(d);
  expect(defaultConfig.flick.targetRadiusDeg).toBe(1.5);
  expect(defaultConfig.flick.distancesDeg).not.toContain(150);
});
