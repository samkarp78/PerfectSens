import { describe, expect, it } from 'vitest';
import { degPerCount } from '../../src/core/geometry';
import { createSession, nextBlock, submitBlock } from '../../src/core/session';
import { defaultSimPlayer } from '../../src/core/sim/player';
import { runSimSession } from '../../src/core/sim/runSession';
import type { Setup } from '../../src/core/types';
import { createRunController, hudText, ROUND_REST_TEXT } from '../../src/ui/runController';
import { TrackingRunner } from '../../src/core/run/trackingRunner';
import { SwitchRunner } from '../../src/core/run/switchRunner';
import { minJerkMoves } from '../helpers/paths';
import { FlickRunner } from '../../src/core/run/flickRunner';

const CURRENT = 40;
const setup: Setup = { dpi: 800, cm360: CURRENT, inGameSens: 33, fov: 103, fovType: 'horizontal', mode: 'default' };
const opts = { seed: 7, warmup: false, quickAbCm360: null };
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
    expect(c.phase).toBe('running'); // no rest card between the round's parts
    expect(c.runner).toBeInstanceOf(TrackingRunner);
    expect(c.hud).toBe('Calibration · Tracking');
    c.onClick(t + 1);
    c.tick(t + 1e6);
    expect(c.phase).toBe('rest'); // the round is over (here the idle tracking block is queued for one retry)
    expect(c.runner).toBeNull();
    expect(createRunController(createSession(setup, opts)).restText).toBe(ROUND_REST_TEXT);
  });

  it('asks before the extra A/B round and resumes or finishes on the answer', () => {
    let waiting = null as ReturnType<typeof runSimSession>['state'] | null;
    for (let seed = 1; seed <= 40 && !waiting; seed++) {
      const { state } = runSimSession(setup, defaultSimPlayer(CURRENT), { ...opts, seed, askBeforeExtending: true });
      if (state.awaitingExtension) waiting = state;
    }
    expect(waiting).not.toBeNull();
    const yes = createRunController(waiting!);
    expect(yes.phase).toBe('asking');
    yes.answerExtension(true);
    expect(yes.phase).toBe('rest');
    expect(nextBlock(yes.session)!.stage).toBe('ab');
    const no = createRunController(waiting!);
    no.answerExtension(false);
    expect(no.phase).toBe('finished');
    expect(no.session.result!.verdict).toBe('none');
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

describe('hudText', () => {
  it('never leaks cm/360 and numbers the recheck as a normal step', () => {
    const { blocks } = runSimSession(setup, defaultSimPlayer(CURRENT), opts);
    let s = createSession(setup, opts);
    const huds: string[] = [];
    const cms = new Set<string>();
    for (const b of blocks) {
      if (s.progress) huds.push(hudText(s.progress));
      cms.add(String(b.spec.cm360));
      s = submitBlock(s, b.log);
    }
    expect(huds.length).toBeGreaterThan(10);
    for (const h of huds) {
      expect(h).not.toMatch(/cm/i);
      for (const v of cms) if (v.length > 2) expect(h).not.toContain(v);
    }
    expect(huds).toContain('Dial-in 3 of 6 · Flicks');
    expect(huds).toContain('Dial-in 3 of 6 · Switching');
    expect(huds).toContain('Dial-in 3 of 6 · Tracking');
    expect(huds).toContain('Calibration · Flicks');
    expect(huds.some((h) => h.startsWith('Final Showdown'))).toBe(true);
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
    let s = createSession(setup, { seed: 1, warmup: false, quickAbCm360: null });
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

describe('breaks between stretches of rounds', () => {
  it('rests normally after most rounds and takes a break after every breakEveryRounds-th round', async () => {
    const { restPhase } = await import('../../src/ui/runController');
    const { simulateBlock } = await import('../../src/core/sim/simulate');
    const { createRng } = await import('../../src/core/rng');
    const { defaultConfig } = await import('../../src/core/config');
    let s = createSession(setup, opts);
    const phases: string[] = [];
    for (let i = 0; s.steps.length < 4; i++) {
      const before = s.steps.length;
      const spec = nextBlock(s)!;
      s = submitBlock(s, simulateBlock(spec, setup, defaultSimPlayer(CURRENT), { adaptedCm360: CURRENT, blocksDone: i }, createRng(i), defaultConfig, 0).log);
      if (s.steps.length > before) phases.push(restPhase(s, true));
    }
    expect(phases).toEqual(['rest', 'rest', 'break', 'rest']);
    expect(restPhase(s, false)).toBe('rest');
  });
});
