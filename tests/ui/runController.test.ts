import { describe, expect, it } from 'vitest';
import { degPerCount } from '../../src/core/geometry';
import { createSession, nextBlock, submitBlock } from '../../src/core/session';
import { defaultSimPlayer } from '../../src/core/sim/player';
import { runSimSession } from '../../src/core/sim/runSession';
import type { Setup } from '../../src/core/types';
import { createRunController, hudText } from '../../src/ui/runController';
import { minJerkMoves } from '../helpers/paths';
import type { FlickRunner } from '../../src/core/run/flickRunner';

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

  it('finishing the flick block returns to rest with the tracking block next', () => {
    const c = createRunController(createSession(setup, opts));
    c.begin(0);
    let t = 0;
    for (let i = 0; i < 1000 && c.phase === 'running'; i++) {
      const r = c.runner as FlickRunner;
      const moves = minJerkMoves(r.state.aim, r.state.target!.aim, t, 150, 500, DPC);
      for (const m of moves) c.onMove(m);
      t = moves[moves.length - 1]!.t + 10;
      c.onClick(t);
      t += 50;
    }
    expect(c.phase).toBe('rest');
    expect(c.runner).toBeNull();
    expect(nextBlock(c.session)!.kind).toBe('tracking');
    expect(c.restText).toBe('Next: tracking — keep the crosshair on the moving target.');
    expect(c.hud).toBe('Baseline · Tracking');
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
    expect(c.restText).toBe('Next: flicks — click each target as fast as you can.');
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
    expect(huds).toContain('Step 4 of 7 · Flick');
    expect(huds).toContain('Step 4 of 7 · Tracking');
    expect(huds).toContain('Baseline · Flick');
    expect(huds.some((h) => h.startsWith('Final check'))).toBe(true);
  });
});
