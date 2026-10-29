import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import { decideAB, type AbBlock } from '../../src/core/ab';
import type { Arm } from '../../src/core/types';

const mk = (p: number, c: number, se: number): AbBlock[] => [
  { arm: 'P', logS: p, se }, { arm: 'C', logS: c, se }, { arm: 'C', logS: c, se }, { arm: 'P', logS: p, se },
];

describe('decideAB', () => {
  const cfg = defaultConfig;
  it('change when P clearly better at look 2 and look 1 favoured it', () => expect(decideAB(mk(0.08, 0, 0.01), 2, cfg, 0.05).decision).toBe('change'));
  it('look 1 never decides change', () => {
    expect(decideAB(mk(0.3, 0, 0.001), 1, cfg).decision).toBe('continue');
  });
  it('look 2 change needs look-1 delta > 0', () => {
    expect(decideAB(mk(0.08, 0, 0.01), 2, cfg, -0.01).decision).toBe('none');
    expect(decideAB(mk(0.08, 0, 0.01), 2, cfg, null).decision).toBe('none');
    expect(decideAB(mk(0.08, 0, 0.01), 2, cfg).decision).toBe('none');
  });
  it('z = 2.5 boundary', () => {
    expect(cfg.ab.z).toBe(2.5);
    // se of the difference equals the per-block se here (two blocks per arm)
    expect(decideAB(mk(0.1, 0, 0.039), 2, cfg, 0.1).decision).toBe('change');
    expect(decideAB(mk(0.1, 0, 0.041), 2, cfg, 0.1).decision).toBe('none');
  });
  it('keep when P clearly worse', () => expect(decideAB(mk(-0.08, 0, 0.01), 1, cfg).decision).toBe('keep'));
  it('none when effect is tiny and precise', () => {
    const r = decideAB(mk(0.005, 0, 0.005), 1, cfg);
    expect(r.decision).toBe('none');
    expect(r.delta).toBeCloseTo(0.005, 10);
  });
  it('continue at look 1, none at look 2 when inconclusive', () => {
    const blocks = mk(0.03, 0, 0.02);
    const r1 = decideAB(blocks, 1, cfg);
    expect(r1.se).toBeCloseTo(0.02, 10);
    expect(r1.decision).toBe('continue');
    expect(decideAB(blocks, 2, cfg).decision).toBe('none');
    expect(r1.look).toBe(1);
  });
  it('handles a missing arm without NaN', () => {
    const only: AbBlock[] = [{ arm: 'P', logS: 0.1, se: 0.01 }];
    const r1 = decideAB(only, 1, cfg);
    const r2 = decideAB(only, 2, cfg);
    expect(r1.decision).toBe('continue');
    expect(r2.decision).toBe('none');
    expect(r1.delta).toBe(0);
    expect(r1.se).toBe(Infinity);
    expect(decideAB([], 1, cfg).decision).toBe('continue');
  });
});
