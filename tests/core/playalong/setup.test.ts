import { describe, it, expect } from 'vitest';
import { validatePaSetup } from '../../../src/core/playalong/setup';

const base = { game: 'finals', dpi: '800', sens: '33', fov: '103', fovType: 'horizontal', padWidthCm: '45' };

describe('validatePaSetup', () => {
  it('converts a whole Finals sens to cm/360', () => {
    const r = validatePaSetup(base);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.setup.defaultCm360).toBeCloseTo(34.6364, 4); expect(r.setup.padWidthCm).toBe(45); }
  });
  it('rejects a decimal Finals sens', () => {
    const r = validatePaSetup({ ...base, sens: '33.5' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sens).toMatch(/whole number/);
  });
  it('requires the pad measurement', () => {
    const r = validatePaSetup({ ...base, padWidthCm: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.padWidthCm).toBeDefined();
  });
  it('shows the missing pad together with other errors', () => {
    const r = validatePaSetup({ ...base, sens: '', padWidthCm: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errors.sens).toBeDefined(); expect(r.errors.padWidthCm).toBeDefined(); }
  });

  it('takes cm/360 for other games', () => {
    const r = validatePaSetup({ ...base, game: 'other', sens: '28.5' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.setup.defaultCm360).toBe(28.5);
  });
});
