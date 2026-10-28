import { describe, it, expect } from 'vitest';
import type { StepResult } from '../../src/core/types';
import { STATS, statsBySens } from '../../src/ui/statsBySens';
import { flickSummary, switchSummary, trackingSummary, trackSwitchSummary } from '../helpers/summaries';

const step = (cm360: number, o: { gain?: number; tot?: number; lead?: number; mt?: number } = {}): StepResult => ({
  order: 0, stage: 'baseline', arm: null, cm360,
  trials: [{ index: 0, cls: 'small', distance: 15, mtMs: o.mt ?? 400, firstGain: o.gain ?? 1, corrections: 1, endAlong: 0, endPerp: 0,
    hit: true, timedOut: false, scored: true, misses: 1 }],
  flick: flickSummary({ smallGain: o.gain ?? 1, mediumGain: o.gain ?? 1, bigGain: o.gain ?? 1, corrections: 1 }),
  switch: switchSummary({ smallGain: o.gain ?? 1, mediumGain: o.gain ?? 1, bigGain: o.gain ?? 1, corrections: 1 }),
  tracking: trackingSummary({ tot: o.tot ?? 0.5, leadLagDeg: o.lead ?? 0 }), trackSwitch: trackSwitchSummary(),
  score: { logS: 0, se: 0 },
});

describe('statsBySens', () => {
  it('groups rounds by sens, sorted slowest to fastest, averaging each stat', () => {
    const rows = statsBySens([step(30, { tot: 0.4 }), step(40), step(30, { tot: 0.6 })]);
    expect(rows.map((r) => r.cm360)).toEqual([40, 30]);
    expect(rows[1]!.values.onTarget).toBeCloseTo(50, 9);
  });

  it('shows overshoot as % past the normal landing point (0 = normal)', () => {
    const [r] = statsBySens([step(30, { gain: 1.2 })]);
    expect(r!.values.overshoot!).toBeGreaterThan(10);
    const [ok] = statsBySens([step(30, { gain: 1 })]);
    expect(Math.abs(ok!.values.overshoot!)).toBeLessThan(5);
  });

  it('fills every listed stat', () => {
    const [r] = statsBySens([step(30, { lead: 0.8, mt: 350 })]);
    for (const s of STATS) expect(r!.values[s.id], s.id).not.toBeUndefined();
    expect(r!.values.timeToHit).toBe(350);
    expect(r!.values.lead).toBeCloseTo(0.8, 9);
    expect(r!.values.misclicks).toBe(1);
  });
});
