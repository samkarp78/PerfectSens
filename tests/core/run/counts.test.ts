import { describe, it, expect } from 'vitest';
import { defaultConfig, type Config } from '../../../src/core/config';
import { createRng } from '../../../src/core/rng';
import { defaultSimPlayer } from '../../../src/core/sim/player';
import { simulateBlock } from '../../../src/core/sim/simulate';
import type { BlockSpec, FlickBlockLog, Setup, SwitchBlockLog, TrackSwitchBlockLog } from '../../../src/core/types';

const CM = 34.6364;
const setup: Setup = { dpi: 800, cm360: CM, inGameSens: null, fov: 103, fovType: 'horizontal', mode: 'default' };
/** Count mode: parts end after a set number of targets or kills; the time limit is only a safety cap. */
const cfg = { ...defaultConfig,
  flick: { ...defaultConfig.flick, count: 12, blockMs: 120_000, warmWave: false },
  switch: { ...defaultConfig.switch, count: 15, blockMs: 120_000 },
  trackswitch: { ...defaultConfig.trackswitch, count: 6, blockMs: 120_000 } } as unknown as Config;
const spec = (kind: BlockSpec['kind']): BlockSpec => ({ id: kind, stage: 'baseline', kind, cm360: CM, seed: 4, stepIndex: 0, arm: null });
const play = (kind: BlockSpec['kind']) =>
  simulateBlock(spec(kind), setup, defaultSimPlayer(CM, { optimalCm360: CM }), { adaptedCm360: CM, blocksDone: 0 }, createRng(1), cfg, 0);

describe('set-count parts', () => {
  it('flicks end after the set number of targets', () => {
    const r = play('flick');
    const log = r.log as FlickBlockLog;
    expect(log.trials).toHaveLength(12);
    expect(r.endT).toBeLessThan(30_000);
  });

  it('switching ends after the set number of scored kills (plus the warm-in kills)', () => {
    const r = play('switch');
    const log = r.log as SwitchBlockLog;
    expect(log.kills).toHaveLength(15 + defaultConfig.switch.warmKills);
    expect(r.endT).toBe(log.endT);
    expect(r.endT).toBeLessThan(30_000);
  });

  it('tracking switching ends after the set number of kills after the lead-in', () => {
    const r = play('trackswitch');
    const log = r.log as TrackSwitchBlockLog;
    const scored = log.kills.filter((k) => k.t >= log.t0 + defaultConfig.trackswitch.leadInMs);
    expect(scored).toHaveLength(6);
    expect(r.endT).toBe(log.endT);
    expect(r.endT).toBeLessThan(30_000);
  });

  it('without a count, parts stay timed', () => {
    const r = simulateBlock(spec('switch'), setup, defaultSimPlayer(CM, { optimalCm360: CM }), { adaptedCm360: CM, blocksDone: 0 },
      createRng(1), defaultConfig, 0);
    expect(r.endT).toBe(defaultConfig.switch.blockMs);
  });
});

describe('set counts with a warm-up wave', () => {
  it('the warm-up flicks come on top: 21 scored flicks out of 24 shown', () => {
    const warmCfg = { ...cfg, flick: { ...cfg.flick, count: 21, warmWave: true } } as unknown as Config;
    const r = simulateBlock(spec('flick'), setup, defaultSimPlayer(CM, { optimalCm360: CM }), { adaptedCm360: CM, blocksDone: 0 },
      createRng(1), warmCfg, 0);
    const log = r.log as FlickBlockLog;
    expect(log.trials).toHaveLength(24);
    expect(log.trials.filter((t) => t.target.scored)).toHaveLength(21);
  });
});
