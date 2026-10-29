import { describe, expect, it } from 'vitest';
import { configForPlayAlong, defaultConfig as cfg } from '../../src/core/config';
import { degPerCount } from '../../src/core/geometry';
import { createRng } from '../../src/core/rng';
import { FlickRunner } from '../../src/core/run/flickRunner';
import { TrackingRunner } from '../../src/core/run/trackingRunner';
import { TrackSwitchRunner } from '../../src/core/run/trackSwitchRunner';
import { createSession, extendAb, fitFromSteps, nextBlock, submitBlock, type SessionOptions, type SessionState } from '../../src/core/session';
import { defaultSimPlayer, type SimState } from '../../src/core/sim/player';
import { runSimSession } from '../../src/core/sim/runSession';
import { simulateBlock } from '../../src/core/sim/simulate';
import type { BlockSpec, FlickBlockLog, Mode, Setup } from '../../src/core/types';

const CURRENT = 40;
const setupFor = (mode: Mode = 'default'): Setup => ({ dpi: 800, cm360: CURRENT, inGameSens: 33, fov: 103, fovType: 'horizontal', mode });
const opts = (o: Partial<SessionOptions> = {}): SessionOptions => ({ seed: 7, warmup: false, quickAbCm360: null, ...o });
const label = (b: BlockSpec): string => `${b.stage}:${b.kind}`;

/** A flick log in which every target timed out. */
function allTimeouts(spec: BlockSpec, setup: Setup): FlickBlockLog {
  const runner = new FlickRunner(spec, degPerCount(setup.dpi, spec.cm360), cfg, 0);
  runner.tick(1e9);
  return runner.log();
}

const defaultRun = (() => {
  let cached: ReturnType<typeof runSimSession> | null = null;
  return () => (cached ??= runSimSession(setupFor(), defaultSimPlayer(CURRENT), opts()));
})();

describe('session sequence', () => {
  it('a step is four blocks: flick, switch, tracking, trackswitch', () => {
    const { blocks } = defaultRun();
    const pre = blocks.filter((b) => b.spec.stage !== 'ab').map((b) => b.spec);
    const expected: string[] = [];
    const step = (stage: string) => expected.push(`${stage}:flick`, `${stage}:switch`, `${stage}:tracking`, `${stage}:trackswitch`);
    step('baseline');
    for (let i = 0; i < 2; i++) step('dialin');
    step('recheck');
    for (let i = 2; i < 5; i++) step('dialin');
    expect(pre.map(label)).toEqual(expected);
    const bases = ['baseline', 'dialin-0', 'dialin-1', 'recheck', 'dialin-2', 'dialin-3', 'dialin-4'];
    expect(pre.map((s) => s.id)).toEqual(bases.flatMap((b) => ['flick', 'switch', 'tracking', 'trackswitch'].map((k) => `${b}-${k}`)));
    for (const s of pre.filter((p) => p.stage === 'baseline' || p.stage === 'recheck')) expect(s.cm360).toBe(CURRENT);
    // the A/B (if any) comes only after all of it
    const firstAb = blocks.findIndex((b) => b.spec.stage === 'ab');
    if (firstAb >= 0) expect(firstAb).toBe(pre.length);
  });

  it('thorough mode: 8 dial-in steps with the recheck after step 3', () => {
    const { blocks, state } = runSimSession(setupFor('thorough'), defaultSimPlayer(CURRENT), opts({ seed: 3 }));
    const flicks = blocks.filter((b) => b.spec.kind === 'flick' && b.spec.stage !== 'ab').map((b) => b.spec.id);
    expect(flicks).toEqual([
      'baseline-flick', 'dialin-0-flick', 'dialin-1-flick', 'dialin-2-flick', 'dialin-3-flick',
      'recheck-flick', 'dialin-4-flick', 'dialin-5-flick', 'dialin-6-flick', 'dialin-7-flick',
    ]);
    expect(state.steerLog).toHaveLength(8);
  });

  it('warmup on: the first spec is a warmup; submitting null advances to the baseline', () => {
    const s = createSession(setupFor(), opts({ warmup: true }), cfg);
    const first = nextBlock(s)!;
    expect(first.kind).toBe('warmup');
    expect(first.stage).toBe('warmup');
    expect(first.cm360).toBe(CURRENT);
    const s2 = submitBlock(s, null);
    expect(nextBlock(s2)!.id).toBe('baseline-flick');
  });

  it('an all-timeout flick log is retried once with the same spec, then accepted', () => {
    const setup = setupFor();
    const s = createSession(setup, opts(), cfg);
    const spec = nextBlock(s)!;
    const bad = allTimeouts(spec, setup);
    const s2 = submitBlock(s, bad);
    expect(nextBlock(s2)).toEqual(spec);
    const s3 = submitBlock(s2, bad);
    expect(nextBlock(s3)!.id).toBe('baseline-switch');
    expect(s3.logs.flick).toHaveLength(2);
  });

  it('a tracking log with no movement (tot ≈ 0) is retried once, then accepted', () => {
    const setup = setupFor();
    let s = createSession(setup, opts(), cfg);
    const flickSpec = nextBlock(s)!;
    const sim = simulateBlock(flickSpec, setup, defaultSimPlayer(CURRENT), { adaptedCm360: CURRENT, blocksDone: 0 }, createRng(1), cfg, 0);
    s = submitBlock(s, sim.log);
    const swSpec = nextBlock(s)!;
    s = submitBlock(s, simulateBlock(swSpec, setup, defaultSimPlayer(CURRENT), { adaptedCm360: CURRENT, blocksDone: 1 }, createRng(2), cfg, 0).log);
    const spec = nextBlock(s)!;
    expect(spec.id).toBe('baseline-tracking');
    const runner = new TrackingRunner(spec, degPerCount(setup.dpi, spec.cm360), cfg, 0);
    runner.tick(cfg.tracking.leadInMs + cfg.tracking.durationMs);
    const idle = runner.log();
    const s2 = submitBlock(s, idle);
    expect(nextBlock(s2)).toEqual(spec);
    expect(s2.steps).toHaveLength(0);
    const s3 = submitBlock(s2, idle);
    expect(s3.steps).toHaveLength(0);
    expect(nextBlock(s3)!.id).toBe('baseline-trackswitch');
  });

  it('trackswitch with no kills retries once', () => {
    const setup = setupFor();
    let s = createSession(setup, opts(), cfg);
    for (let i = 0; i < 3; i++) {
      const sp = nextBlock(s)!;
      s = submitBlock(s, simulateBlock(sp, setup, defaultSimPlayer(CURRENT), { adaptedCm360: CURRENT, blocksDone: i }, createRng(10 + i), cfg, 0).log);
    }
    const spec = nextBlock(s)!;
    expect(spec.id).toBe('baseline-trackswitch');
    const runner = new TrackSwitchRunner(spec, degPerCount(setup.dpi, spec.cm360), cfg, 0);
    runner.tick(cfg.trackswitch.blockMs);
    const idle = runner.log();
    const s2 = submitBlock(s, idle);
    expect(nextBlock(s2)).toEqual(spec);
    expect(s2.steps).toHaveLength(0);
    const s3 = submitBlock(s2, idle);
    expect(s3.steps).toHaveLength(1);
    expect(s3.steps[0]!.score.logS).toBe(0);
    expect(s3.steps[0]!.trackSwitch.kills).toBe(0);
    expect(s3.logs.trackSwitch).toHaveLength(2);
    expect(nextBlock(s3)!.id).toBe('dialin-0-flick');
  });

  it('submitBlock does not mutate its input state', () => {
    const setup = setupFor();
    const s = createSession(setup, opts({ warmup: true }), cfg);
    const before = structuredClone(s);
    const s2 = submitBlock(s, null);
    expect(s).toEqual(before);
    const spec = nextBlock(s2)!;
    const snap = structuredClone(s2);
    const s3 = submitBlock(s2, allTimeouts(spec, setup));
    expect(s2).toEqual(snap);
    expect(s3).not.toBe(s2);
  });

  it('progress: baseline at 0/6, recheck at position 2 of 6, null once finished', () => {
    const setup = setupFor();
    const player = defaultSimPlayer(CURRENT);
    let s: SessionState = createSession(setup, opts(), cfg);
    expect(s.progress).toMatchObject({ stage: 'baseline', stepIndex: 0, totalSteps: 6, kind: 'flick' });
    let sim: SimState = { adaptedCm360: CURRENT, blocksDone: 0 };
    let t = 0;
    const seen: { stage: string; stepIndex: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const spec = nextBlock(s)!;
      seen.push({ stage: s.progress!.stage, stepIndex: s.progress!.stepIndex });
      const r = simulateBlock(spec, setup, player, sim, createRng(100 + i), cfg, t);
      sim = r.state; t = r.endT + cfg.sim.blockGapMs;
      s = submitBlock(s, r.log);
    }
    expect(s.progress).toMatchObject({ stage: 'recheck', stepIndex: 2, totalSteps: 6, kind: 'tracking' });
    expect(seen.filter((p) => p.stage === 'dialin').map((p) => p.stepIndex)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(defaultRun().state.progress).toBeNull();
  });

  it('progress counts blocks done against an estimated total (baseline + dial-in + recheck + first A/B round)', () => {
    const setup = setupFor();
    let s: SessionState = createSession(setup, opts({ warmup: true }), cfg);
    // 4 blocks per step: baseline 1 + dial-in 5 + recheck 1 + A/B 4 = 11 steps
    expect(s.progress).toMatchObject({ kind: 'warmup', blocksDone: 0, blocksTotal: 44 });
    s = submitBlock(s, null);
    expect(s.progress).toMatchObject({ blocksDone: 0, blocksTotal: 44 });
    const spec = nextBlock(s)!;
    const r = simulateBlock(spec, setup, defaultSimPlayer(CURRENT), { adaptedCm360: CURRENT, blocksDone: 0 }, createRng(1), cfg, 0);
    s = submitBlock(s, r.log);
    expect(s.progress).toMatchObject({ blocksDone: 1, blocksTotal: 44 });
  });

  it('progress in quick A/B mode totals only the A/B blocks', () => {
    const s = createSession(setupFor(), opts({ quickAbCm360: 36 }), cfg);
    expect(s.progress).toMatchObject({ blocksDone: 0, blocksTotal: 16 });
  });
});

describe('runSimSession', () => {
  it('default player: completes with a result, 0/8/16 A/B blocks, one flick log per flick spec', () => {
    const { state, blocks } = defaultRun();
    expect(state.result).not.toBeNull();
    expect(nextBlock(state)).toBeNull();
    const ab = blocks.filter((b) => b.spec.stage === 'ab');
    if (state.result!.abSkipped) expect(ab).toHaveLength(0);
    else expect([16, 32]).toContain(ab.length);
    expect(state.logs.flick).toHaveLength(blocks.filter((b) => b.spec.kind === 'flick').length);
    expect(state.logs.tracking).toHaveLength(blocks.filter((b) => b.spec.kind === 'tracking').length);
    expect(state.steerLog).toHaveLength(5);
    expect(state.fit).not.toBeNull();
    // block timestamps never go backwards
    const t0s = blocks.map((b) => b.log!.t0);
    for (let i = 1; i < t0s.length; i++) expect(t0s[i]!).toBeGreaterThan(t0s[i - 1]!);
  });

  it('is deterministic for a seed', () => {
    const a = runSimSession(setupFor(), defaultSimPlayer(CURRENT), opts({ seed: 11 }));
    const b = runSimSession(setupFor(), defaultSimPlayer(CURRENT), opts({ seed: 11 }));
    expect(b.state.result).toEqual(a.state.result);
    expect(b.blocks.map((x) => x.spec)).toEqual(a.blocks.map((x) => x.spec));
  });

  it('optimal = current, curvature 6: A/B skipped and verdict keep in ≥ 8 of 10 seeds', () => {
    const player = defaultSimPlayer(CURRENT, { optimalCm360: CURRENT, curvature: 6 });
    let skipped = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = runSimSession(setupFor(), player, opts({ seed })).state.result!;
      if (r.abSkipped && r.verdict === 'keep') skipped++;
    }
    expect(skipped).toBeGreaterThanOrEqual(8);
  });

  it('quick A/B: only A/B steps, P = quickAbCm360 and C = current', () => {
    const quick = 34;
    const s = createSession(setupFor(), opts({ quickAbCm360: quick }), cfg);
    expect(nextBlock(s)!.stage).toBe('ab');
    expect(s.mode).toBe('quickab');
    const { state, blocks } = runSimSession(setupFor(), defaultSimPlayer(CURRENT), opts({ quickAbCm360: quick }));
    expect(blocks.every((b) => b.spec.stage === 'ab')).toBe(true);
    expect([16, 32]).toContain(blocks.length);
    for (const b of blocks) expect(b.spec.cm360).toBe(b.spec.arm === 'P' ? quick : CURRENT);
    expect(state.result).not.toBeNull();
    expect(state.result!.abSkipped).toBe(false);
    expect(state.result!.pickCm360).toBe(quick);
  });
});

describe('asking before the extra A/B round', () => {
  /** Plays simulated blocks until the session finishes or waits for the extension answer. */
  function playUntilAsked(seed: number): SessionState {
    const setup = setupFor();
    const player = defaultSimPlayer(CURRENT);
    let s = createSession(setup, opts({ seed, askBeforeExtending: true }), cfg);
    let sim: SimState = { adaptedCm360: CURRENT, blocksDone: 0 };
    let t = 0;
    for (let i = 0, spec = nextBlock(s); spec; i++, spec = nextBlock(s)) {
      const r = simulateBlock(spec, setup, player, sim, createRng(seed * 100 + i), cfg, t);
      sim = r.state; t = r.endT + cfg.sim.blockGapMs;
      s = submitBlock(s, r.log);
    }
    return s;
  }
  const asked = (() => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = playUntilAsked(seed);
      if (s.awaitingExtension) return s;
    }
    throw new Error('no seed reached a borderline A/B');
  })();

  /** Quick A/B with the pick at a much better sens than current: look 1 favours the pick, so the session asks to confirm. */
  function aheadAsk(): SessionState {
    const setup = setupFor();
    const player = defaultSimPlayer(CURRENT, { optimalCm360: 0.7 * CURRENT, curvature: 6 });
    let s = createSession(setup, opts({ seed: 11, askBeforeExtending: true, quickAbCm360: 0.7 * CURRENT }), cfg);
    let sim: SimState = { adaptedCm360: CURRENT, blocksDone: 0 };
    let t = 0;
    for (let i = 0, spec = nextBlock(s); spec; i++, spec = nextBlock(s)) {
      const r = simulateBlock(spec, setup, player, sim, createRng(1100 + i), cfg, t);
      sim = r.state; t = r.endT + cfg.sim.blockGapMs;
      s = submitBlock(s, r.log);
    }
    if (!s.awaitingExtension) throw new Error('expected the session to ask');
    return s;
  }

  it('pauses with no next block and no result while waiting for the answer', () => {
    expect(asked.result).toBeNull();
    expect(nextBlock(asked)).toBeNull();
    expect(asked.abDecisions.at(-1)!.decision).toBe('continue');
  });

  it('declining ends with no clear winner at look 1', () => {
    const s = extendAb(asked, false);
    expect(s.awaitingExtension).toBe(false);
    expect(s.result!.verdict).toBe('none');
    expect(s.result!.ab!.look).toBe(1);
  });

  it('accepting queues the mirrored round', () => {
    const s = extendAb(asked, true);
    expect(s.awaitingExtension).toBe(false);
    expect(nextBlock(s)!.stage).toBe('ab');
    expect(s.progress!.blocksTotal).toBe(4 * (1 + cfg.session.dialinSteps.default + 1 + 8));
  });

  it('extensionReason is ahead when look 1 favours the pick', () => {
    expect(aheadAsk().extensionReason).toBe('ahead');
    expect(['ahead', 'close']).toContain(asked.extensionReason);
  });

  it('declining the confirmation while ahead gives none', () => {
    const s = extendAb(aheadAsk(), false);
    expect(s.result!.verdict).toBe('none');
    expect(s.abDecisions.every((d) => d.decision !== 'change')).toBe(true);
    expect(s.extensionReason).toBeNull();
  });

  it('without the option the session extends automatically, as before', () => {
    const { state } = runSimSession(setupFor(), defaultSimPlayer(CURRENT), opts());
    expect(state.awaitingExtension).toBe(false);
  });
});

describe('fitFromSteps', () => {
  it('rebuilds the same curve and pick a finished session used', () => {
    const setup = setupFor();
    const { state } = runSimSession(setup, defaultSimPlayer(CURRENT), { seed: 1, warmup: false, quickAbCm360: null });
    const rebuilt = fitFromSteps(setup, state.steps);
    expect(rebuilt?.coef).toEqual(state.fit?.coef);
    expect(rebuilt?.pickCm360).toBeCloseTo(state.fit!.pickCm360, 9);
  });

  it('returns null with no fit steps', () => {
    expect(fitFromSteps(setupFor(), [])).toBeNull();
  });
});

describe('fixed mode (Play-Along test block)', () => {
  const fixedRun = (scoreBaseline: { tp: number; switchTp: number; tot: number; dmg: number } | null) =>
    runSimSession(setupFor(), defaultSimPlayer(CURRENT),
      opts({ warmup: true, fixed: { rounds: 3, scoreBaseline } }), configForPlayAlong());

  it('plays a lead-in then N rounds at one sens and finishes', () => {
    const { state, blocks } = fixedRun(null);
    expect(state.mode).toBe('fixed');
    expect(blocks[0]!.spec.kind).toBe('warmup');
    expect(blocks[0]!.spec.cm360).toBe(CURRENT);
    expect(state.steps).toHaveLength(3);
    expect(state.steps.every((st) => st.cm360 === CURRENT)).toBe(true);
    expect(state.result).not.toBeNull();
    expect(state.fit).toBeNull();
  });

  it('scores against a supplied baseline', () => {
    expect(fixedRun(null).state.steps[0]!.score.logS).toBe(0);
    expect(fixedRun({ tp: 1, switchTp: 1, tot: 1, dmg: 1 }).state.steps[0]!.score.logS).not.toBe(0);
  });

  it('has no breaks inside a test', () => {
    const c = configForPlayAlong();
    expect(c.session.breakEveryRounds).toBeGreaterThan(1000);
  });
});
