import { describe, it, expect } from 'vitest';
import { countdownTone } from '../../src/ui/sound';

describe('countdownTone', () => {
  it('rises in pitch as the count nears zero', () => {
    const hz = [5, 4, 3, 2, 1].map((n) => countdownTone(n, false).hz);
    for (let i = 1; i < hz.length; i++) expect(hz[i]!).toBeGreaterThan(hz[i - 1]!);
  });
  it('makes the last second and the go beep stand out', () => {
    expect(countdownTone(1, false).ms).toBeGreaterThan(countdownTone(2, false).ms);
    expect(countdownTone(null, true).hz).toBeGreaterThan(countdownTone(1, false).hz);
  });
  it('keeps the plain beep when no count is given', () => {
    expect(countdownTone(null, false)).toEqual({ hz: 440, ms: 120 });
  });
});
