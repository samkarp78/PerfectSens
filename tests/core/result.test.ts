import { describe, expect, it } from 'vitest';
import { buildResult } from '../../src/core/result';
import type { AbDecision } from '../../src/core/ab';
import type { FitResult } from '../../src/core/fit';
import type { Setup } from '../../src/core/types';

const setup = { dpi: 800, cm360: 30, inGameSens: 33, fov: 103, fovType: 'horizontal', mode: 'thorough' } as Setup;
const ab = (decision: AbDecision['decision']): AbDecision => ({ decision, delta: 0.1, se: 0.01, look: 1 });
const fit: FitResult = { usable: true, coef: null, pickCm360: 33.333, range: [31, 36], edge: 'faster', lowConfidence: true };

describe('buildResult', () => {
  it('change: multiplier and new sens', () => {
    const r = buildResult({ setup, fit, pickCm360: 33.333, ab: ab('change'), abSkipped: false, findings: [] });
    expect(r.verdict).toBe('change');
    expect(r.recommendedCm360).toBe(33.333);
    expect(r.multiplier).toBe(0.9);
    expect(r.newInGameSens).toBe(29.7);
    expect(r.range).toEqual([31, 36]);
    expect(r.edge).toBe('faster');
    expect(r.lowConfidence).toBe(true);
    expect(r.ab?.decision).toBe('change');
  });
  it('abSkipped: keep', () => {
    const r = buildResult({ setup, fit, pickCm360: 33.333, ab: null, abSkipped: true, findings: [] });
    expect(r.verdict).toBe('keep');
    expect(r.recommendedCm360).toBe(30);
    expect(r.multiplier).toBe(1);
    expect(r.newInGameSens).toBe(33);
    expect(r.abSkipped).toBe(true);
  });
  it('keep and none use current', () => {
    expect(buildResult({ setup, fit, pickCm360: 33.333, ab: ab('keep'), abSkipped: false, findings: [] }).verdict).toBe('keep');
    const r = buildResult({ setup, fit, pickCm360: 33.333, ab: ab('none'), abSkipped: false, findings: [] });
    expect(r.verdict).toBe('none');
    expect(r.recommendedCm360).toBe(30);
    expect(r.multiplier).toBe(1);
  });
  it('null fit and null inGameSens', () => {
    const r = buildResult({ setup: { ...setup, inGameSens: null }, fit: null, pickCm360: 33, ab: ab('continue'), abSkipped: false, findings: [] });
    expect(r.verdict).toBe('none');
    expect(r.newInGameSens).toBeNull();
    expect(r.range).toBeNull();
    expect(r.edge).toBeNull();
    expect(r.lowConfidence).toBe(false);
  });
});
