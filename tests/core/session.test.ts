import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../../src/core/config';
import { degPerCount } from '../../src/core/geometry';
import { createRng } from '../../src/core/rng';
import { FlickRunner } from '../../src/core/run/flickRunner';
import { TrackingRunner } from '../../src/core/run/trackingRunner';
import { TrackSwitchRunner } from '../../src/core/run/trackSwitchRunner';
import { createSession, nextBlock, submitBlock, type SessionOptions } from '../../src/core/session';
import { defaultSimPlayer } from '../../src/core/sim/player';
import { runSimSession } from '../../src/core/sim/runSession';
import { simulateBlock } from '../../src/core/sim/simulate';
import type { BlockSpec, FlickBlockLog, Setup } from '../../src/core/types';

const CURRENT = 40;
const setup: Setup = { dpi: 800, cm360: CURRENT, inGameSens: 33, fov: 103, fovType: 'horizontal', mode: 'default' };
const opts = (o: Partial<SessionOptions> = {}): SessionOptions => ({ seed: 7, warmup: false, rounds: 3, scoreBaseline: null, ...o });

/** A flick log in which every target timed out. */
function allTimeouts(spec: BlockSpec): FlickBlockLog {
  const runner = new FlickRunner(spec, degPerCount(setup.dpi, spec.cm360), cfg, 0);
  runner.tick(1e9);
  return runner.log();
}

describe('test block', () => {
  it('plays N rounds of flicks, switching, tracking and tracking switching at one sens, then is done', () => {
    const { state, blocks } = runSimSession(setup, defaultSimPlayer(CURRENT), opts());
    expect(blocks.map((b) => b.spec.kind)).toEqual(Array.from({ length: 3 }, () => ['flick', 'switch', 'tracking', 'trackswitch']).flat());
    expect(blocks.every((b) => b.spec.cm360 === CURRENT)).toBe(true);
    expect(state.steps).toHaveLength(3);
    expect(state.done).toBe(true);
    expect(nextBlock(state)).toBeNull();
  });

  it('warmup on: the first spec is a warmup; submitting null advances to round 1', () => {
    const s = createSession(setup, opts({ warmup: true }), cfg);
    expect(nextBlock(s)!.kind).toBe('warmup');
    expect(nextBlock(submitBlock(s, null))!.id).toBe('round-0-flick');
  });

  it('an all-timeout flick log is retried once with the same spec, then accepted', () => {
    const s = createSession(setup, opts(), cfg);
    const spec = nextBlock(s)!;
    const s2 = submitBlock(s, allTimeouts(spec));
    expect(nextBlock(s2)).toEqual(spec);
    const s3 = submitBlock(s2, allTimeouts(spec));
    expect(nextBlock(s3)!.id).toBe('round-0-switch');
    expect(s3.logs.flick).toHaveLength(2);
  });

  it('a tracking log with no movement is retried once, then accepted', () => {
    let s = createSession(setup, opts(), cfg);
    for (let i = 0; i < 2; i++) {
      const sp = nextBlock(s)!;
      s = submitBlock(s, simulateBlock(sp, setup, defaultSimPlayer(CURRENT), { adaptedCm360: CURRENT, blocksDone: i }, createRng(i + 1), cfg, 0).log);
    }
    const spec = nextBlock(s)!;
    expect(spec.id).toBe('round-0-tracking');
    const runner = new TrackingRunner(spec, degPerCount(setup.dpi, spec.cm360), cfg, 0);
    runner.tick(cfg.tracking.leadInMs + cfg.tracking.durationMs);
    const s2 = submitBlock(s, runner.log());
    expect(nextBlock(s2)).toEqual(spec);
    expect(nextBlock(submitBlock(s2, runner.log()))!.id).toBe('round-0-trackswitch');
  });

  it('tracking switching with no kills is retried once, then the round is scored', () => {
    let s = createSession(setup, opts(), cfg);
    for (let i = 0; i < 3; i++) {
      const sp = nextBlock(s)!;
      s = submitBlock(s, simulateBlock(sp, setup, defaultSimPlayer(CURRENT), { adaptedCm360: CURRENT, blocksDone: i }, createRng(10 + i), cfg, 0).log);
    }
    const spec = nextBlock(s)!;
    const runner = new TrackSwitchRunner(spec, degPerCount(setup.dpi, spec.cm360), cfg, 0);
    runner.tick(cfg.trackswitch.blockMs);
    const s2 = submitBlock(s, runner.log());
    expect(nextBlock(s2)).toEqual(spec);
    const s3 = submitBlock(s2, runner.log());
    expect(s3.steps).toHaveLength(1);
    expect(s3.steps[0]!.score.logS).toBe(0); // the first round is its own baseline
    expect(nextBlock(s3)!.id).toBe('round-1-flick');
  });

  it('scores against a supplied baseline', () => {
    const { state } = runSimSession(setup, defaultSimPlayer(CURRENT), opts({ scoreBaseline: { tp: 1, switchTp: 1, tot: 1, dmg: 1 } }));
    expect(state.steps[0]!.score.logS).not.toBe(0);
  });

  it('progress counts the rounds and blocks', () => {
    const s = createSession(setup, opts(), cfg);
    expect(s.progress).toMatchObject({ stepIndex: 0, totalSteps: 3, kind: 'flick', blocksDone: 0, blocksTotal: 12 });
    expect(runSimSession(setup, defaultSimPlayer(CURRENT), opts()).state.progress).toBeNull();
  });

  it('submitBlock does not mutate its input state', () => {
    const s = createSession(setup, opts({ warmup: true }), cfg);
    const before = structuredClone(s);
    const s2 = submitBlock(s, null);
    expect(s).toEqual(before);
    const snap = structuredClone(s2);
    submitBlock(s2, allTimeouts(nextBlock(s2)!));
    expect(s2).toEqual(snap);
  });

  it('is deterministic for a seed', () => {
    const a = runSimSession(setup, defaultSimPlayer(CURRENT), opts()).state.steps.map((st) => st.score.logS);
    const b = runSimSession(setup, defaultSimPlayer(CURRENT), opts()).state.steps.map((st) => st.score.logS);
    expect(a).toEqual(b);
  });

});
