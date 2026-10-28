import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../../../src/core/config';
import { measureSwitch } from '../../../src/core/measure/switch';
import { createRng } from '../../../src/core/rng';
import type { BlockSpec, SwitchBlockLog } from '../../../src/core/types';

const spec: BlockSpec = { id: 's', stage: 'baseline', kind: 'switch', cm360: 30, seed: 1, stepIndex: 0, arm: null };
const O = { yaw: 0, pitch: 0 };
/** n kills, each 20° from the previous kill, every `gapMs`. */
function log(n: number, gapMs: number, misses = 0): SwitchBlockLog {
  const kills = Array.from({ length: n }, (_, i) => ({ t: 1000 + (i + 1) * gapMs, target: { yaw: 20 * (i + 1), pitch: 0 }, from: { yaw: 20 * i, pitch: 0 } }));
  const clicks = [...kills.map((k) => ({ t: k.t, hit: true })), ...Array.from({ length: misses }, (_, i) => ({ t: 1001 + i, hit: false }))];
  return { spec, t0: 1000, endT: 1000 + cfg.switch.blockMs, kills, clicks, path: [{ t: 1000, ...O }] };
}

describe('measureSwitch', () => {
  it('throughput = Σ ID / Σ interval over kills after the warm-in', () => {
    const id = Math.log2(20 / (2 * cfg.switch.targetRadiusDeg) + 1);
    const r = measureSwitch(log(12, 500), cfg, createRng(1));
    expect(r.n).toBe(12 - cfg.switch.warmKills);
    expect(r.tp).toBeCloseTo(id / 0.5, 6);
    expect(r.kills).toBe(12);
  });
  it('accuracy counts misses', () => {
    expect(measureSwitch(log(8, 500, 2), cfg, createRng(1)).accuracy).toBeCloseTo(0.8, 6);
  });
  it('no scored kills → tp 0, finite SE', () => {
    const r = measureSwitch(log(cfg.switch.warmKills, 500), cfg, createRng(1));
    expect(r.n).toBe(0);
    expect(r.tp).toBe(0);
    expect(Number.isFinite(r.logTpSe)).toBe(true);
  });
  it('bootstrap SE is deterministic and positive for uneven kills', () => {
    const l = log(12, 500);
    l.kills.forEach((k, i) => { k.t += (i % 3) * 120; });
    const a = measureSwitch(l, cfg, createRng(4)).logTpSe;
    expect(a).toBeGreaterThan(0);
    expect(measureSwitch(l, cfg, createRng(4)).logTpSe).toBe(a);
  });
});
