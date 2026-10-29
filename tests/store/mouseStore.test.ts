import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FIELDS, loadFields, saveFields } from '../../src/store/mouseStore';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, v); },
});
afterEach(() => memory.clear());

describe('mouse settings store', () => {
  it('returns the defaults when nothing is saved', () => {
    expect(loadFields()).toEqual(DEFAULT_FIELDS);
  });
  it('remembers what was saved', () => {
    const f = { ...DEFAULT_FIELDS, sens: '33', padWidthCm: '45' };
    saveFields(f);
    expect(loadFields()).toEqual(f);
  });
  it('falls back to the defaults on bad data', () => {
    memory.set('bsf.mouse', 'not json');
    expect(loadFields()).toEqual(DEFAULT_FIELDS);
  });
});
