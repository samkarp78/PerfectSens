import { describe, expect, it } from 'vitest';
import { createScoreKeeper, gradeFor, flickEvents, switchEvents, POINTS } from '../../src/ui/scoreKeeper';
import type { FlickTrial } from '../../src/core/types';

const trial = (o: Partial<FlickTrial>): FlickTrial => ({
  target: { index: 0, aim: { yaw: 0, pitch: 0 }, distance: 10, cls: 'small', scored: true, wave: 1 },
  spawnT: 0, spawnAim: { yaw: 0, pitch: 0 }, clicks: [], hitT: null, timedOut: false, ...o,
});

describe('ScoreKeeper', () => {
  it('a hit scores base points plus a speed bonus, multiplied by the streak', () => {
    const k = createScoreKeeper();
    k.hit(200);
    expect(k.state.points).toBe(Math.round(POINTS.hit + POINTS.speedBonus(200)));
    expect(k.state.streak).toBe(1);
    k.hit(200);
    expect(k.state.points).toBe(Math.round(POINTS.hit + POINTS.speedBonus(200)) + Math.round((POINTS.hit + POINTS.speedBonus(200)) * POINTS.multiplier(1)));
    expect(k.state.bestStreak).toBe(2);
  });
  it('a miss breaks the streak but keeps the best', () => {
    const k = createScoreKeeper();
    k.hit(300); k.hit(300); k.hit(300); k.miss();
    expect(k.state.streak).toBe(0);
    expect(k.state.bestStreak).toBe(3);
  });
  it('tracking earns points per second on target only', () => {
    const k = createScoreKeeper();
    k.track(500, true); k.track(500, false);
    expect(k.state.points).toBe(Math.round(POINTS.trackPerSecond * 0.5));
  });
  it('stretch() returns and resets the stretch totals while the session totals keep growing', () => {
    const k = createScoreKeeper();
    k.hit(300); k.hit(300); k.miss();
    const s = k.stretch();
    expect(s.bestStreak).toBe(2);
    expect(s.points).toBe(k.state.points);
    k.hit(300);
    expect(k.stretch().points).toBeLessThan(k.state.points);
  });
});

describe('event diffs', () => {
  it('flick: a first-click hit counts as a hit; a missed click or a timeout as a miss', () => {
    const trials = [
      trial({ hitT: 250, clicks: [{ t: 250, aim: { yaw: 0, pitch: 0 }, hit: true }] }),
      trial({ spawnT: 250, hitT: 700, clicks: [{ t: 500, aim: { yaw: 5, pitch: 0 }, hit: false }, { t: 700, aim: { yaw: 0, pitch: 0 }, hit: true }] }),
      trial({ spawnT: 700, timedOut: true }),
      trial({ spawnT: 4700 }), // still up: not resolved yet
    ];
    const r = flickEvents(trials, { trial: 0, click: 0 });
    expect(r.events).toEqual([{ hit: true, ms: 250 }, { hit: false, ms: 0 }, { hit: true, ms: 450 }, { hit: false, ms: 0 }]);
    expect(r.next).toEqual({ trial: 3, click: 0 });
    expect(flickEvents(trials, r.next).events).toEqual([]);
  });
  it('switch: new clicks map to hits (with the interval since the previous kill) and misses', () => {
    const log = { t0: 0, kills: [{ t: 400, target: { yaw: 0, pitch: 0 }, from: { yaw: 0, pitch: 0 } }], clicks: [{ t: 300, aim: { yaw: 0, pitch: 0 }, hit: false }, { t: 400, aim: { yaw: 0, pitch: 0 }, hit: true }] };
    expect(switchEvents(log, 0)).toEqual({ events: [{ hit: false, ms: 0 }, { hit: true, ms: 400 }], next: 2 });
  });
});

describe('gradeFor', () => {
  it('grades a stretch by its score relative to the calibration round', () => {
    expect(gradeFor(0.08)).toBe('S');
    expect(gradeFor(0.03)).toBe('A');
    expect(gradeFor(0)).toBe('B');
    expect(gradeFor(-0.04)).toBe('C');
    expect(gradeFor(-0.2)).toBe('D');
  });
});

describe('flick events are live', () => {
  it('reports a misclick on the target that is still up, once, before it is hit', () => {
    const open = [trial({ clicks: [{ t: 100, aim: { yaw: 5, pitch: 0 }, hit: false }] })];
    const a = flickEvents(open, { trial: 0, click: 0 });
    expect(a.events).toEqual([{ hit: false, ms: 0 }]);
    const b = flickEvents(open, a.next);
    expect(b.events).toEqual([]);
    const hitNow = [trial({ hitT: 300, clicks: [{ t: 100, aim: { yaw: 5, pitch: 0 }, hit: false }, { t: 300, aim: { yaw: 0, pitch: 0 }, hit: true }] })];
    expect(flickEvents(hitNow, b.next).events).toEqual([{ hit: true, ms: 300 }]);
  });
});
