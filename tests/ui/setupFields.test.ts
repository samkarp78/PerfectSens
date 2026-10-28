import { describe, expect, it } from 'vitest';
import { dpiEdit, dpiValid, RECALIBRATE_TEXT } from '../../src/ui/setupFields';

describe('setup DPI and play area', () => {
  it('Calibrate needs a valid DPI', () => {
    expect(dpiValid('800')).toBe(true);
    expect(dpiValid('abc')).toBe(false);
    expect(dpiValid('')).toBe(false);
    expect(dpiValid('50')).toBe(false);
    expect(dpiValid('800.5')).toBe(false);
  });
  it('changing the DPI after calibrating clears the play area and asks to re-calibrate', () => {
    const f = { dpi: '800', padWidthCm: '40' };
    expect(dpiEdit(f, '1600')).toEqual({ fields: { dpi: '1600', padWidthCm: '' }, note: RECALIBRATE_TEXT });
    expect(dpiEdit(f, '800')).toEqual({ fields: f, note: null });
    expect(dpiEdit({ dpi: '800', padWidthCm: '' }, '1600')).toEqual({ fields: { dpi: '1600', padWidthCm: '' }, note: null });
  });
});
