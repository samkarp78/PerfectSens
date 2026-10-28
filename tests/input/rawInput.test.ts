import { describe, it, expect } from 'vitest';
import { requestRawPointerLock, samplesFromEvent } from '../../src/input/rawInput';

describe('requestRawPointerLock', () => {
  it('resolves raw when the promise resolves and asks for unadjusted movement', async () => {
    let opts: unknown;
    const el = { requestPointerLock: (o?: unknown) => { opts = o; return Promise.resolve(); } };
    expect(await requestRawPointerLock(el)).toBe('raw');
    expect(opts).toEqual({ unadjustedMovement: true });
  });
  it('maps NotSupportedError to unsupported', async () => {
    const el = { requestPointerLock: () => Promise.reject({ name: 'NotSupportedError' }) };
    expect(await requestRawPointerLock(el)).toBe('unsupported');
  });
  it('maps other rejections to denied', async () => {
    const el = { requestPointerLock: () => Promise.reject({ name: 'SecurityError' }) };
    expect(await requestRawPointerLock(el)).toBe('denied');
  });
  it('treats a non-promise return as unsupported', async () => {
    const el = { requestPointerLock: () => undefined };
    expect(await requestRawPointerLock(el)).toBe('unsupported');
  });
});

describe('samplesFromEvent', () => {
  it('expands coalesced events with their own timestamps', () => {
    const e = {
      timeStamp: 100, movementX: 9, movementY: 9,
      getCoalescedEvents: () => [
        { timeStamp: 10, movementX: 1, movementY: 2 },
        { timeStamp: 20, movementX: 3, movementY: 4 },
        { timeStamp: 30, movementX: 5, movementY: 6 },
      ],
    };
    expect(samplesFromEvent(e)).toEqual([
      { t: 10, dx: 1, dy: 2 }, { t: 20, dx: 3, dy: 4 }, { t: 30, dx: 5, dy: 6 },
    ]);
  });
  it('uses the event itself without getCoalescedEvents', () => {
    expect(samplesFromEvent({ timeStamp: 7, movementX: 2, movementY: -3 })).toEqual([{ t: 7, dx: 2, dy: -3 }]);
  });
  it('falls back to the event when the coalesced list is empty', () => {
    expect(samplesFromEvent({ timeStamp: 7, movementX: 2, movementY: -3, getCoalescedEvents: () => [] }))
      .toEqual([{ t: 7, dx: 2, dy: -3 }]);
  });
});
