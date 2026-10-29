import { describe, expect, it } from 'vitest';
import { degPerCount } from '../../src/core/geometry';
import { createSession, nextBlock, submitBlock } from '../../src/core/session';
import { defaultSimPlayer } from '../../src/core/sim/player';
import { runSimSession } from '../../src/core/sim/runSession';
import type { Setup } from '../../src/core/types';
import { countdownBeep, countLeft, createRunController, cueText, hudText, ROUND_REST_TEXT, type RunController } from '../../src/ui/runController';
import { configForPlayAlong, defaultConfig } from '../../src/core/config';
import { TrackSwitchRunner } from '../../src/core/run/trackSwitchRunner';
import { TrackingRunner } from '../../src/core/run/trackingRunner';
import { SwitchRunner } from '../../src/core/run/switchRunner';
import { minJerkMoves } from '../helpers/paths';
import { FlickRunner } from '../../src/core/run/flickRunner';

const CURRENT = 40;
const setup: Setup = { dpi: 800, cm360: CURRENT, inGameSens: 33, fov: 103, fovType: 'horizontal', mode: 'default' };
const opts = { seed: 7, warmup: false, rounds: 3, scoreBaseline: null };
const DPC = degPerCount(setup.dpi, CURRENT);

describe('run controller', () => {
  it('lock loss pauses without touching the session; begin restarts the same spec fresh', () => {
    const c = createRunController(createSession(setup, opts));
    expect(c.phase).toBe('rest');
    const specId = nextBlock(c.session)!.id;
    c.begin(0);
    expect(c.phase).toBe('running');
    const first = c.runner;
    c.onMove({ t: 10, dx: 50, dy: 0 });
    c.onMove({ t: 20, dx: 50, dy: 0 });
    const stepsBefore = c.session.steps;
    c.onLockLost();
    expect(c.phase).toBe('paused');
    expect(c.runner).toBeNull();
    expect(c.session.steps).toBe(stepsBefore);
    c.begin(1000);
    expect(c.phase).toBe('running');
    expect(c.runner).not.toBe(first);
    const log = (c.runner as FlickRunner).log();
    expect(log.spec.id).toBe(specId);
    expect(log.path).toHaveLength(0);
  });

  it('a round runs flicks, switching and tracking back to back, then rests before the next round', () => {
    const c = createRunController(createSession(setup, opts));
    c.begin(0);
    let t = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 2000 && !(c.runner instanceof TrackingRunner); i++) {
      if (c.phase === 'cue') { t = c.cue!.endsAt; c.tick(t); continue; }
      const r = c.runner!;
      seen.add(r.constructor.name);
      const goal = r instanceof FlickRunner ? r.state.target!.aim : (r as SwitchRunner).state.targets[0]!;
      const moves = minJerkMoves(r.state.aim, goal, t, 150, 500, DPC);
      for (const m of moves) c.onMove(m);
      t = moves[moves.length - 1]!.t + 10;
      c.onClick(t);
      t += 50;
    }
    expect([...seen]).toEqual(['FlickRunner', 'SwitchRunner']);
    expect(c.phase).toBe('running'); // no rest card between the round's parts, only the short cue
    expect(c.runner).toBeInstanceOf(TrackingRunner);
    expect(c.hud).toBe('Test · Round 1 of 3 · Tracking');
    c.onClick(t + 1);
    c.tick(t + 1e6);
    expect(c.phase).toBe('rest'); // the idle tracking block is queued for one retry: its own rest text
    c.begin(t + 2e6);
    c.onClick(t + 2e6 + 1);
    for (let k = 1; k < 2000 && c.runner instanceof TrackingRunner; k++) {
      const r = c.runner;
      const a = r.state.aim, g = r.state.targetAim;
      c.onMove({ t: t + 2e6 + k * 10, dx: Math.round((g.yaw - a.yaw) / DPC), dy: Math.round(-(g.pitch - a.pitch) / DPC) });
    }
    expect(c.phase).toBe('cue');
    const tsStart = c.cue!.endsAt;
    c.tick(tsStart);
    expect(c.runner).toBeInstanceOf(TrackSwitchRunner);
    expect(c.hud).toBe('Test · Round 1 of 3 · Tracking switching');
    c.onClick(tsStart + 1);
    c.tick(tsStart + 1e6);
    expect(c.phase).toBe('rest'); // the round is over (here the idle tracking block is queued for one retry)
    expect(c.runner).toBeNull();
    expect(createRunController(createSession(setup, opts)).restText).toBe(ROUND_REST_TEXT);
  });

  it('onLockLost outside running is a no-op', () => {
    const c = createRunController(createSession(setup, opts));
    c.onLockLost();
    expect(c.phase).toBe('rest');
    c.begin(0);
    c.onLockLost();
    c.onLockLost();
    expect(c.phase).toBe('paused');
  });

  it('warm-up has its own copy and skipWarmup advances', () => {
    const c = createRunController(createSession(setup, { ...opts, warmup: true }));
    expect(c.hud).toBe('Warm-up');
    expect(c.restText).toBe('Warm-up — free targets at your current sens, not scored.');
    c.skipWarmup();
    expect(c.phase).toBe('rest');
    expect(nextBlock(c.session)!.stage).toBe('baseline');
    expect(c.restText).toBe(ROUND_REST_TEXT);
  });
});

describe('run controller: tracking needs the mouse button', () => {
  it('a press during tracking holds, a release lets go', async () => {
    const { createSession, nextBlock, submitBlock } = await import('../../src/core/session');
    const { simulateBlock } = await import('../../src/core/sim/simulate');
    const { defaultSimPlayer } = await import('../../src/core/sim/player');
    const { createRng } = await import('../../src/core/rng');
    const { defaultConfig } = await import('../../src/core/config');
    const { TrackingRunner } = await import('../../src/core/run/trackingRunner');
    const setup = { dpi: 800, cm360: 34, inGameSens: null, fov: 103, fovType: 'horizontal' as const, mode: 'default' as const };
    let s = createSession(setup, { seed: 1, warmup: false, rounds: 2, scoreBaseline: null });
    for (let i = 0; i < 2; i++) { // play the round's flick and switching parts with the simulated player
      const spec = nextBlock(s)!;
      s = submitBlock(s, simulateBlock(spec, setup, defaultSimPlayer(34), { adaptedCm360: 34, blocksDone: i }, createRng(1 + i), defaultConfig, 0).log);
    }
    const c = createRunController(s);
    c.begin(0);
    expect(c.runner).toBeInstanceOf(TrackingRunner);
    const r = c.runner as InstanceType<typeof TrackingRunner>;
    expect(r.state.held).toBe(false);
    c.onClick(10);
    expect(r.state.held).toBe(true);
    c.onRelease(20);
    expect(r.state.held).toBe(false);
  });
});

describe('handover cue between parts', () => {
  /** Plays the flick part of the first round to its end by hitting every target. */
  function finishFlicks(c: RunController): number {
    let t = 0;
    c.begin(0);
    while (c.runner instanceof FlickRunner) {
      const r = c.runner;
      const moves = minJerkMoves(r.state.aim, r.state.target!.aim, t, 150, 500, DPC);
      for (const m of moves) c.onMove(m);
      t = moves[moves.length - 1]!.t + 10;
      c.onClick(t);
      t += 50;
      c.tick(t);
    }
    return t;
  }
  it('after flicks the phase is cue, then switching starts after cueMs', () => {
    const c = createRunController(createSession(setup, opts));
    finishFlicks(c);
    expect(c.phase).toBe('cue');
    expect(c.runner).toBeNull();
    const cue = c.cue!;
    expect(cue.kind).toBe('switch');
    expect(cue.endsAt - cue.startedAt).toBe(defaultConfig.round.cueMs);
    expect(cueText('switch')).toBe('Next: Switching');
    expect(cueText('trackswitch')).toBe('Next: Tracking switching');
    c.onClick(cue.startedAt + 10); // input during the cue is ignored
    c.tick(cue.endsAt - 1);
    expect(c.phase).toBe('cue');
    c.tick(cue.endsAt);
    expect(c.phase).toBe('running');
    expect(c.runner).toBeInstanceOf(SwitchRunner);
    expect((c.runner as SwitchRunner).log().clicks).toHaveLength(0);
  });
  it('no cue after the last part of a round', () => {
    const c = createRunController(createSession(setup, opts));
    finishFlicks(c);
    expect(c.phase).toBe('cue');
    // Skip ahead: the round ends with tracking switching, which rests (or breaks) instead of cueing.
    let guard = 0;
    while (c.phase !== 'rest' && guard++ < 50) {
      if (c.phase === 'cue') c.tick(c.cue!.endsAt);
      else if (c.runner) { const end = c.runner.state.endsAt; c.onClick(end - 1); c.tick(end); }
      else c.begin(guard * 1e6);
    }
    expect(c.phase).toBe('rest');
    expect(c.cue).toBeNull();
  });
  it('Esc during cue pauses; resume restarts the cue', () => {
    const c = createRunController(createSession(setup, opts));
    finishFlicks(c);
    const steps = c.session.steps;
    const flickLogs = c.session.logs.flick.length;
    c.onLockLost();
    expect(c.phase).toBe('paused');
    expect(c.cue).toBeNull();
    c.begin(5e6);
    expect(c.phase).toBe('cue');
    expect(c.cue!.startedAt).toBe(5e6);
    expect(c.session.steps).toBe(steps);
    expect(c.session.logs.flick).toHaveLength(flickLogs);
    c.tick(5e6 + defaultConfig.round.cueMs);
    expect(c.runner).toBeInstanceOf(SwitchRunner);
  });
});

describe('mouse button held across a handover', () => {
  /** Plays flicks, then lets switching run out its time, leaving the cue before tracking. */
  function toTrackingCue(): { c: RunController; t: number } {
    const c = createRunController(createSession(setup, opts));
    let t = 0;
    c.begin(0);
    for (let guard = 0; guard < 500 && !(c.phase === 'cue' && c.cue!.kind === 'tracking'); guard++) {
      if (c.phase === 'cue') { t = c.cue!.endsAt; c.tick(t); continue; }
      const r = c.runner!;
      if (r instanceof FlickRunner) {
        const moves = minJerkMoves(r.state.aim, r.state.target!.aim, t, 150, 500, DPC);
        for (const m of moves) c.onMove(m);
        t = moves[moves.length - 1]!.t + 10;
        c.onClick(t);
        c.onRelease(t + 5);
        t += 50;
      } else if (r instanceof SwitchRunner) {
        for (let k = 0; k < 6; k++) {
          const goal = r.state.targets[0]!;
          const moves = minJerkMoves(r.state.aim, goal, t, 150, 500, DPC);
          for (const m of moves) c.onMove(m);
          t = moves[moves.length - 1]!.t + 10;
          c.onClick(t);
          c.onRelease(t + 5);
          t += 50;
        }
        t = r.state.endsAt; c.tick(t);
      } else break;
    }
    return { c, t };
  }
  it('a button pressed during the cue counts as held when the hold part starts', () => {
    const { c } = toTrackingCue();
    const cue = c.cue!;
    c.onClick(cue.startedAt + 100);
    c.tick(cue.endsAt);
    const r = c.runner as TrackingRunner;
    expect(r).toBeInstanceOf(TrackingRunner);
    expect(r.state.held).toBe(true);
    expect(r.log().holds![0]).toEqual({ t: cue.endsAt, down: true });
  });
  it('a button released during the cue is not held', () => {
    const { c } = toTrackingCue();
    const cue = c.cue!;
    c.onClick(cue.startedAt + 100);
    c.onRelease(cue.startedAt + 200);
    c.tick(cue.endsAt);
    expect((c.runner as TrackingRunner).state.held).toBe(false);
  });
});

describe('countdownBeep', () => {
  it('beeps as the time left crosses 5, 4, 3, 2 and 1 seconds, and not otherwise', () => {
    expect(countdownBeep(5016, 4999)).toBe(5);
    expect(countdownBeep(4999, 4983)).toBeNull();
    expect(countdownBeep(2010, 1995)).toBe(2);
    expect(countdownBeep(1016, 999)).toBe(1);
    expect(countdownBeep(999, -5)).toBeNull();
    expect(countdownBeep(6016, 5999)).toBeNull();
    expect(countdownBeep(5500, 3500)).toBe(4); // a slow frame: one beep, for the latest second
  });
});

describe('hudText in fixed mode', () => {
  it('numbers the rounds of a test and never shows a sens', () => {
    const p = { stage: 'baseline' as const, stepIndex: 1, totalSteps: 3, kind: 'flick' as const, blocksDone: 4, blocksTotal: 12 };
    expect(hudText(p)).toBe('Test · Round 2 of 3 · Flicks');
  });
});

describe('countLeft (set-count parts)', () => {
  const pa = configForPlayAlong();
  const spec = (kind: 'flick' | 'switch' | 'trackswitch' | 'tracking' | 'warmup') =>
    ({ id: kind, stage: 'baseline' as const, kind, cm360: 30, seed: 3, stepIndex: 0, arm: null });

  it('counts down the targets of a count part', () => {
    expect(countLeft(new FlickRunner(spec('flick'), 0.02, pa, 0), pa)).toEqual({ left: 24, total: 24 }); // 21 scored + 3 warm-up
    expect(countLeft(new SwitchRunner(spec('switch'), 0.02, pa, 0), pa)).toEqual({ left: 28, total: 28 });
    expect(countLeft(new TrackSwitchRunner(spec('trackswitch'), 0.02, pa, 0), pa)).toEqual({ left: 10, total: 10 });
  });

  it('is null for timed parts: tracking, the lead-in, and Standard', () => {
    expect(countLeft(new TrackingRunner(spec('tracking'), 0.02, pa, 0), pa)).toBeNull();
    expect(countLeft(new FlickRunner(spec('warmup'), 0.02, pa, 0), pa)).toBeNull();
    expect(countLeft(new FlickRunner(spec('flick'), 0.02, defaultConfig, 0), defaultConfig)).toBeNull();
  });
});

