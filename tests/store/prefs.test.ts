import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, loadPrefs, savePrefs } from '../../src/store/prefs';

afterEach(() => { vi.unstubAllGlobals(); });

describe('prefs', () => {
  it('round-trips through localStorage and fills missing keys with defaults', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    savePrefs({ sound: false, autoContinue: true });
    expect(loadPrefs()).toEqual({ sound: false, autoContinue: true });
    store.set('bsf.prefs', JSON.stringify({ sound: false }));
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, sound: false });
  });
  it('falls back to defaults when storage throws or holds junk', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(DEFAULT_PREFS)).not.toThrow();
    vi.stubGlobal('localStorage', { getItem: () => '[1,2]', setItem: () => {} });
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});
