import { expect, test } from 'vitest';
import { defaultConfig } from '../../src/core/config';

test('30 flick distances, 10 per class', () => {
  const d = defaultConfig.flick.distancesDeg;
  expect(d).toHaveLength(30);
  expect(d.filter(x => x < defaultConfig.flick.smallMaxDeg)).toHaveLength(10);
  expect(d.filter(x => x > defaultConfig.flick.bigMinDeg)).toHaveLength(10);
});
