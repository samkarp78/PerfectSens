import { describe, it, expect } from 'vitest';
import { validateSetup } from '../../src/core/setup';

const good = { dpi: 800, cm360: 34.29, inGameSens: null, fov: 103, fovType: 'horizontal', mode: 'default' };
const errs = (o: object) => { const r = validateSetup({ ...good, ...o }); return r.ok ? {} : r.errors; };

describe('validateSetup', () => {
  it('accepts a valid setup', () => {
    const r = validateSetup(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.setup).toEqual({ ...good, padWidthCm: null });
  });
  it('rejects bad dpi', () => { expect(errs({ dpi: 0 }).dpi).toBeDefined(); expect(errs({ dpi: 800.5 }).dpi).toBeDefined(); });
  it('rejects bad cm360', () => { expect(errs({ cm360: 9999 }).cm360).toBeDefined(); });
  it('rejects empty/out-of-range fov, per type', () => {
    expect(errs({ fov: '' }).fov).toBeDefined();
    expect(errs({ fov: 120, fovType: 'vertical' }).fov).toBeDefined();
    expect(errs({ fov: 120 }).fov).toBeUndefined();
  });
  it('validates inGameSens', () => {
    expect(errs({ inGameSens: -1 }).inGameSens).toBeDefined();
    expect(errs({ inGameSens: 'abc' }).inGameSens).toBeDefined();
    for (const v of [null, undefined, '']) {
      const r = validateSetup({ ...good, inGameSens: v });
      expect(r.ok && r.setup.inGameSens).toBe(null);
    }
    const r = validateSetup({ ...good, inGameSens: '33' });
    expect(r.ok && r.setup.inGameSens).toBe(33);
  });
  it('rejects bad mode and fovType', () => {
    expect(errs({ mode: 'fast' }).mode).toBeDefined();
    expect(errs({ fovType: 'diagonal' }).fovType).toBeDefined();
  });
  it('accepts numeric strings', () => {
    const r = validateSetup({ ...good, dpi: '1600' });
    expect(r.ok && r.setup.dpi).toBe(1600);
  });
});

describe('validateSetup: play-area width', () => {
  const base = { dpi: 800, cm360: 34, inGameSens: null, fov: 103, fovType: 'horizontal', mode: 'default' };
  it('is optional', () => {
    const r = validateSetup(base);
    expect(r.ok && r.setup.padWidthCm).toBeNull();
  });
  it('accepts a measured width in range', () => {
    const r = validateSetup({ ...base, padWidthCm: 42.5 });
    expect(r.ok && r.setup.padWidthCm).toBe(42.5);
  });
  it('rejects nonsense widths', () => {
    const r = validateSetup({ ...base, padWidthCm: 3 });
    expect(r.ok).toBe(false);
  });
});
