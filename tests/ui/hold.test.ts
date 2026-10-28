import { describe, it, expect } from 'vitest';
import { holdProgress } from '../../src/ui/hold';

describe('holdProgress', () => {
  it('is empty with no press', () => expect(holdProgress(null, 5, 1000)).toEqual({ fraction: 0, done: false }));
  it('fills while held', () => expect(holdProgress(0, 500, 1000)).toEqual({ fraction: 0.5, done: false }));
  it('is done after the full hold', () => expect(holdProgress(0, 1000, 1000)).toEqual({ fraction: 1, done: true }));
});
