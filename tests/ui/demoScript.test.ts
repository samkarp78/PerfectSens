import { describe, expect, it } from 'vitest';
import { defaultSimPlayer } from '../../src/core/sim/player';
import { runSimSession } from '../../src/core/sim/runSession';
import type { Setup } from '../../src/core/types';
import { buildDemoScript } from '../../src/ui/demoScript';

const setup: Setup = { dpi: 800, cm360: 34.29, inGameSens: null, fov: 103, fovType: 'horizontal', mode: 'default' };
const run = runSimSession(setup, defaultSimPlayer(34.29), { seed: 20261027, warmup: false, quickAbCm360: null });
const clips = buildDemoScript(run);

describe('demo script', () => {
  it('has a non-empty caption on every clip', () => {
    expect(clips.length).toBeGreaterThanOrEqual(6);
    for (const c of clips) expect(c.caption.trim().length).toBeGreaterThan(0);
  });

  it('a dial-in clip caption contains its steer reason', () => {
    const reasons = run.state.steerLog.map((d) => d.reason);
    const dialin = clips.filter((c) => c.spec.stage === 'dialin');
    expect(dialin.length).toBeGreaterThan(0);
    expect(dialin.some((c) => reasons.some((r) => c.caption.includes(r)))).toBe(true);
  });

  it('every clip plays in at most 20 seconds', () => {
    for (const c of clips) {
      expect(c.toT).toBeGreaterThan(c.fromT);
      expect((c.toT - c.fromT) / c.speed).toBeLessThanOrEqual(20000);
    }
  });

  it('runs every clip at 1.5x and covers the planned stages', () => {
    for (const c of clips) expect(c.speed).toBe(1.5);
    expect(clips.some((c) => c.spec.stage === 'baseline' && c.spec.kind === 'flick')).toBe(true);
    expect(clips.some((c) => c.spec.stage === 'baseline' && c.spec.kind === 'tracking')).toBe(true);
    expect(clips.some((c) => c.spec.stage === 'ab')).toBe(true);
    expect(clips.some((c) => /Fast-forwarding through the remaining steps/.test(c.caption))).toBe(true);
  });

  it('never reveals a sens value in a caption', () => {
    for (const c of clips) {
      expect(c.caption).not.toMatch(/cm\s*\/\s*360\s*:?\s*\d/i);
      expect(c.caption).not.toMatch(/\d\s*cm/i);
    }
  });
});
