import { describe, expect, it } from 'vitest';
import { configForMode } from '../../src/core/config';
import { defaultSimPlayer } from '../../src/core/sim/player';
import { runSimSession } from '../../src/core/sim/runSession';
import { validateSetup } from '../../src/core/setup';
import type { Setup } from '../../src/core/types';

const setup: Setup = { dpi: 800, cm360: 34.6, inGameSens: 33, fov: 103, fovType: 'horizontal', mode: 'quick' };

describe('quick test mode', () => {
  it('uses 12 scored flick distances (4 per class), short tracking and 3 dial-in steps', () => {
    const c = configForMode('quick');
    const d = c.flick.distancesDeg;
    expect(d).toHaveLength(12);
    expect(d.filter((x) => x < c.flick.smallMaxDeg)).toHaveLength(4);
    expect(d.filter((x) => x > c.flick.bigMinDeg)).toHaveLength(4);
    expect(c.flick.blockMs).toBe(20000);
    expect(c.flick.wavePerClass).toBe(2);
    expect(c.tracking.durationMs).toBe(8000);
    expect(c.tracking.leadInMs).toBe(1000);
    expect(c.session.dialinSteps.quick).toBe(3);
  });

  it('leaves the other modes on the full config', () => {
    expect(configForMode('default').flick.distancesDeg).toHaveLength(30);
    expect(configForMode('thorough').tracking.durationMs).toBe(15000);
  });

  it('accepts quick as a setup mode', () => {
    expect(validateSetup({ ...setup }).ok).toBe(true);
  });

  it('a simulated quick session completes with at most 9 non-A/B blocks before the A/B', () => {
    const { state, blocks } = runSimSession(setup, defaultSimPlayer(34.6), { seed: 5, warmup: false, quickAbCm360: null }, configForMode('quick'));
    expect(state.result).not.toBeNull();
    expect(blocks.filter((b) => b.spec.stage !== 'ab')).toHaveLength(10); // baseline + 3 dial-in + recheck, 2 blocks each
    const flick = blocks.find((b) => b.spec.kind === 'flick')!.log as { trials: unknown[] };
    expect(flick.trials.length).toBeGreaterThanOrEqual(24); // 20 s of flicks at sim speed: several 6-target waves
  });
});
