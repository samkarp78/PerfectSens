import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../../../src/core/config';
import { nextBlock } from '../../../src/core/session';
import { finalsToCm360, gameSensOf } from '../../../src/core/playalong/gameSens';
import {
  abandonTest, answerFeel, answerHourCheck, createPlayAlong, currentTarget, feelFlagsOf, isStale, markBack, startNight,
  submitTest, testSession, type Feel, type PaSetup, type PaState, type TestRole,
} from '../../../src/core/playalong/state';
import { fakeDone } from '../../helpers/paSteps';

const MIN = 60_000;
const DAY = 86_400_000;
const finals = (n: number): number => finalsToCm360(n, 800);
const DEFAULT = finals(33);
const setup: PaSetup = { game: 'finals', dpi: 800, defaultCm360: DEFAULT, padWidthCm: 60, fov: 103, fovType: 'horizontal' };
const num = (cm: number): number | null => gameSensOf('finals', cm, 800);

/** A player whose test score is a log-quadratic around `opt` (curvature k per ln² unit). */
const peaked = (opt: number, k = 2) => (cm: number): number => -k * Math.log(cm / opt) ** 2;

interface Clock { now: number }
type ScoreFn = (cm: number, role: TestRole) => number;

/** One match + test on the queue head: back after dtMs, answer feel, submit a fake test block with score(cm, role). */
function play(s: PaState, clock: Clock, score: ScoreFn, feel: Feel | ((cm: number) => Feel) = 'right', dtMs = MIN, se = 0.02): PaState {
  const head = s.queue[0]!;
  clock.now += dtMs;
  let next = markBack(s, clock.now);
  next = answerFeel(next, typeof feel === 'function' ? feel(head.cm360) : feel);
  return submitTest(next, fakeDone(head.cm360, score(head.cm360, head.role), se), clock.now);
}

/** Plays until the search finishes (or `stop` holds), at most 40 tests. */
function playUntil(s: PaState, clock: Clock, score: ScoreFn, stop: (s: PaState) => boolean = () => false,
  feel: Feel | ((cm: number) => Feel) = 'right'): PaState {
  for (let i = 0; i < 40 && s.phase !== 'finished' && !stop(s); i++) s = play(s, clock, score, feel);
  return s;
}

const fresh = (seed = 1): { s: PaState; clock: Clock } => ({ s: createPlayAlong(setup, seed, 0), clock: { now: 0 } });

describe('Play-Along search', () => {
  it('starts waiting on the default sens labelled Sens A', () => {
    const { s } = fresh();
    expect(s.phase).toBe('waiting');
    const t = currentTarget(s)!;
    expect(t.cm360).toBe(DEFAULT);
    expect(t.gameSens).toBe(33);
    expect(t.label).toBe('Sens A');
  });

  it('markBack then answerFeel moves to testing and the feel is stored on the test', () => {
    const { s } = fresh();
    const back = markBack(s, 9 * MIN);
    expect(back.phase).toBe('feel');
    const testing = answerFeel(back, 'slow');
    expect(testing.phase).toBe('testing');
    const done = submitTest(testing, fakeDone(DEFAULT, 0), 12 * MIN);
    expect(done.tests[0]!.feel).toBe('slow');
    expect(done.tests[0]!.awayMs).toBe(9 * MIN);
  });

  it('after the default test, two pair targets are queued around the default', () => {
    const { s, clock } = fresh();
    const next = play(s, clock, () => 0);
    expect(next.queue.map((q) => q.role)).toEqual(['pair', 'pair']);
    expect(new Set(next.queue.map((q) => num(q.cm360)))).toEqual(new Set([40, 27]));
    expect(currentTarget(next)!.label).toBe('Sens B');
  });

  it('pair targets play in a random but seed-stable order', () => {
    const order = (seed: number): (number | null)[] => {
      const { s, clock } = fresh(seed);
      return play(s, clock, () => 0).queue.map((q) => num(q.cm360));
    };
    expect(order(5)).toEqual(order(5));
    const firsts = new Set(Array.from({ length: 20 }, (_, i) => order(i)[0]));
    expect(firsts.size).toBe(2);
  });

  it('a pair at the 4% step leads to the head-to-head', () => {
    const { s, clock } = fresh();
    const out = playUntil(s, clock, peaked(finals(30)), (x) => x.queue[0]?.role === 'h2h');
    expect(out.queue[0]?.role).toBe('h2h');
    expect(Math.abs(num(out.h2h!.leaderCm360)! - 30)).toBeLessThanOrEqual(1);
  });

  it('leader equal to default finishes keep without a head-to-head', () => {
    const { s, clock } = fresh();
    const out = playUntil(s, clock, peaked(DEFAULT));
    expect(out.phase).toBe('finished');
    expect(out.result!.kind).toBe('keep');
    expect(out.tests.some((t) => t.role === 'h2h')).toBe(false);
  });

  it('a clear head-to-head win gives change', () => {
    const { s, clock } = fresh();
    const out = playUntil(s, clock, peaked(finals(28), 5));
    expect(out.result!.kind).toBe('change');
    expect(Math.abs(out.result!.recommendedGameSens! - 28)).toBeLessThanOrEqual(1);
    expect(out.tests.filter((t) => t.role === 'h2h')).toHaveLength(2);
  });

  it("a head-to-head loss in its own pair blocks change even if pooled is ahead", () => {
    const { s, clock } = fresh();
    const base = peaked(finals(28), 5);
    const out = playUntil(s, clock, (cm, role) => (role === 'h2h' && num(cm) !== 33 ? -0.3 : base(cm)));
    expect(out.result!.kind).not.toBe('change');
  });

  it('none with only the leader rated right is tie-broken by feel', () => {
    const { s, clock } = fresh();
    const out = playUntil(s, clock, peaked(finals(30), 0.3), () => false, (cm) => (num(cm) === 33 ? 'slow' : 'right'));
    expect(out.result!.kind).toBe('none');
    expect(out.result!.tieBrokenByFeel).toBe(true);
    expect(num(out.result!.recommendedCm360)).not.toBe(33);
  });

  it('feel never changes the queue', () => {
    const run = (feel: Feel): PaState => {
      const { s, clock } = fresh();
      let x = s;
      for (let i = 0; i < 5; i++) x = play(x, clock, peaked(finals(30)), feel);
      return x;
    };
    const a = run('right'), b = run('fast');
    expect(b.queue).toEqual(a.queue);
    expect(b.tests.map((t) => t.cm360)).toEqual(a.tests.map((t) => t.cm360));
  });

  it('hour check appears only after a test finishing past 50 min', () => {
    const { s, clock } = fresh();
    let x = s;
    for (let i = 0; i < 3; i++) { x = play(x, clock, peaked(finals(30)), 'right', 13 * MIN); expect(x.phase).toBe('waiting'); }
    x = play(x, clock, peaked(finals(30)), 'right', 13 * MIN); // 52 min
    expect(x.phase).toBe('hourCheck');
    expect(answerHourCheck(x, 'continue', clock.now).phase).toBe('waiting');
  });

  it('later then startNight runs the anchor first, then the untested pair member', () => {
    const { s, clock } = fresh();
    let x = play(s, clock, () => 0, 'right', 20 * MIN);
    const second = x.queue[1]!;
    x = play(x, clock, () => 0, 'right', 35 * MIN);
    expect(x.phase).toBe('hourCheck');
    x = answerHourCheck(x, 'later', clock.now);
    x = startNight(x, clock.now + DAY);
    expect(x.nights).toHaveLength(2);
    expect(x.queue[0]).toEqual({ cm360: DEFAULT, role: 'anchor' });
    expect(x.queue[1]).toEqual(second);
    expect(x.phase).toBe('waiting');
  });

  it('done gives a labelled best guess; startNight then queues the head-to-head', () => {
    const { s, clock } = fresh();
    let x = s;
    for (let i = 0; i < 3; i++) x = play(x, clock, peaked(finals(28), 5), 'right', 20 * MIN);
    expect(x.phase).toBe('hourCheck');
    x = answerHourCheck(x, 'done', clock.now);
    expect(x.phase).toBe('finished');
    expect(x.result!.kind).toBe('bestGuess');
    x = startNight(x, clock.now + DAY);
    expect(x.result).toBeNull();
    expect(x.queue.length).toBeGreaterThan(0);
    expect(x.queue.every((q) => q.role === 'h2h')).toBe(true);
  });

  it('a head-to-head split by the hour check is replayed in full the next night', () => {
    const { s, clock } = fresh();
    let x = playUntil(s, clock, peaked(finals(28), 5), (y) => y.queue[0]?.role === 'h2h');
    const leader = x.h2h!.leaderCm360;
    x = play(x, clock, peaked(finals(28), 5), 'right', 60 * MIN); // first h2h test, past the hour
    expect(x.phase).toBe('hourCheck');
    x = startNight(answerHourCheck(x, 'later', clock.now), clock.now + DAY);
    expect(x.queue.filter((q) => q.role === 'h2h')).toHaveLength(2);
    expect(x.h2h!.testIds).toEqual([]);
    x = playUntil(x, clock, peaked(finals(28), 5));
    const own = x.tests.filter((t) => x.result!.h2h && t.role === 'h2h' && t.night === 1);
    expect(own).toHaveLength(2);
    expect(Math.abs(num(leader)! - num(x.result!.recommendedCm360)!)).toBeLessThanOrEqual(1);
  });

  it('abandonTest returns to waiting on the same target and records nothing', () => {
    const { s } = fresh();
    const testing = answerFeel(markBack(s, MIN), 'right');
    const back = abandonTest(testing, 2 * MIN);
    expect(back.phase).toBe('waiting');
    expect(back.tests).toHaveLength(0);
    expect(currentTarget(back)!.cm360).toBe(DEFAULT);
    expect(back.waitingSince).toBe(2 * MIN);
  });

  it('flags a sens rated too slow on two separate matches', () => {
    const { s, clock } = fresh();
    let x = play(s, clock, () => 0, 'slow', 55 * MIN);
    x = startNight(answerHourCheck(x, 'later', clock.now), clock.now + DAY);
    x = play(x, clock, () => 0, 'slow'); // the anchor, at the default again
    expect(feelFlagsOf(x.tests, 'finals')).toEqual([{ cm360: DEFAULT, feel: 'slow' }]);
  });

  it('isStale after 14 days', () => {
    const { s } = fresh();
    expect(isStale(s, 13 * DAY)).toBe(false);
    expect(isStale(s, 15 * DAY)).toBe(true);
  });

  it('testSession plays the queue head with the fixed-mode lead-in', () => {
    const { s, clock } = fresh();
    const x = answerFeel(markBack(play(s, clock, () => 0), clock.now + MIN), 'right');
    const session = testSession(x);
    const first = nextBlock(session)!;
    expect(session.mode).toBe('fixed');
    expect(first.kind).toBe('warmup');
    expect(first.cm360).toBe(x.queue[0]!.cm360);
    expect(session._cfg.session.warmupMs).toBe(defaultConfig.playAlong.leadInMs);
  });
});
