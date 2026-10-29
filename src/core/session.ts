import { defaultConfig, type Config } from './config';
import { measureFlickBlock, summarizeFlick, type FlickSummary, type TrialMetrics } from './measure/flick';
import { measureSwitch, type SwitchSummary } from './measure/switch';
import { measureTracking, type TrackingSummary } from './measure/tracking';
import { measureTrackSwitch } from './measure/trackSwitch';
import { createRng, type Rng } from './rng';
import { stepScore, type ScoreBaseline } from './score';
import type { BlockKind, BlockSpec, FlickBlockLog, Setup, Stage, StepResult, SwitchBlockLog, TrackingBlockLog,
  TrackSwitchBlockLog } from './types';

/**
 * A test block: an optional warm-up, then `rounds` rounds at setup.cm360. Each round plays the four parts (flicks,
 * switching, tracking, tracking switching), and each part is measured as it ends; an invalid part is replayed once.
 * Rounds are scored against scoreBaseline, or against the block's own first round when that is null.
 */
export interface SessionOptions { seed: number; warmup: boolean; rounds: number; scoreBaseline: ScoreBaseline | null }

/** The round being played: its flick, switching and tracking results so far. */
interface PendingStep {
  index: number;
  flick: { trials: TrialMetrics[]; summary: FlickSummary } | null;
  switch: SwitchSummary | null;
  tracking: TrackingSummary | null;
}

export interface SessionState {
  readonly setup: Setup; readonly steps: StepResult[];
  readonly logs: { flick: FlickBlockLog[]; switch: SwitchBlockLog[]; tracking: TrackingBlockLog[]; trackSwitch: TrackSwitchBlockLog[] };
  /** Every round has been played. */
  readonly done: boolean;
  /** blocksDone/blocksTotal count scored part blocks (warm-up excluded). */
  readonly progress: {
    stage: Stage; stepIndex: number; totalSteps: number; kind: BlockKind; blocksDone: number; blocksTotal: number;
  } | null;
  /** @internal */ readonly _cfg: Config;
  /** @internal */ readonly _seed: number;
  /** @internal */ readonly _warmupPending: boolean;
  /** @internal */ readonly _pending: PendingStep | null;
  /** @internal retries already used on the current block */ readonly _retries: number;
  /** @internal */ readonly _rounds: number;
  /** @internal */ readonly _scoreBaseline: ScoreBaseline | null;
}

/** Each round is four blocks: flicks, switching, tracking, tracking switching. */
export const BLOCKS_PER_STEP = 4;

/** Spec seeds are integers in [0, 2^31). */
const SEED_RANGE = 2 ** 31;

const rootFork = (s: { _seed: number }, label: string): Rng => createRng(s._seed).fork(label);
const newRound = (index: number): PendingStep => ({ index, flick: null, switch: null, tracking: null });

export function createSession(setup: Setup, opts: SessionOptions, cfg: Config = defaultConfig): SessionState {
  return withProgress({
    setup, steps: [], logs: { flick: [], switch: [], tracking: [], trackSwitch: [] }, done: opts.rounds <= 0, progress: null,
    _cfg: cfg, _seed: opts.seed, _warmupPending: opts.warmup, _pending: opts.rounds > 0 ? newRound(0) : null, _retries: 0,
    _rounds: opts.rounds, _scoreBaseline: opts.scoreBaseline,
  });
}

function seedFor(s: SessionState, id: string): number {
  return Math.floor(rootFork(s, id).next() * SEED_RANGE);
}

export function nextBlock(s: SessionState): BlockSpec | null {
  if (s.done) return null;
  if (s._warmupPending) {
    const id = 'warmup';
    return { id, stage: 'warmup', kind: 'warmup', cm360: s.setup.cm360, seed: seedFor(s, id), stepIndex: 0, arm: null };
  }
  const p = s._pending;
  if (!p) return null;
  const kind: Exclude<BlockKind, 'warmup'> = !p.flick ? 'flick' : !p.switch ? 'switch' : !p.tracking ? 'tracking' : 'trackswitch';
  const id = `round-${p.index}-${kind}`;
  return { id, stage: 'baseline', kind, cm360: s.setup.cm360, seed: seedFor(s, id), stepIndex: p.index, arm: null };
}

function withProgress(s: SessionState): SessionState {
  const spec = nextBlock(s);
  if (!spec) return { ...s, progress: null };
  const p = s._pending;
  const blocksDone = BLOCKS_PER_STEP * s.steps.length + (p?.flick ? 1 : 0) + (p?.switch ? 1 : 0) + (p?.tracking ? 1 : 0);
  return {
    ...s,
    progress: { stage: spec.stage, stepIndex: s.steps.length, totalSteps: s._rounds, kind: spec.kind, blocksDone,
      blocksTotal: BLOCKS_PER_STEP * s._rounds },
  };
}

export function submitBlock(s: SessionState,
  log: FlickBlockLog | SwitchBlockLog | TrackingBlockLog | TrackSwitchBlockLog | null): SessionState {
  const spec = nextBlock(s);
  if (!spec) throw new Error('submitBlock: the session is finished');
  if (spec.kind === 'warmup') return withProgress({ ...s, _warmupPending: false });
  if (!log) throw new Error('submitBlock: a log is required for non-warmup blocks');
  if (log.spec.id !== spec.id) throw new Error(`submitBlock: expected a log for ${spec.id}, got ${log.spec.id}`);
  const cfg = s._cfg;
  const p = s._pending!;
  const canRetry = s._retries < cfg.session.maxRetries;
  const rng = rootFork(s, `measure-${spec.id}`);

  if (spec.kind === 'flick') {
    const fl = log as FlickBlockLog;
    const next: SessionState = { ...s, logs: { ...s.logs, flick: [...s.logs.flick, fl] } };
    const trials = measureFlickBlock(fl, cfg);
    const summary = summarizeFlick(trials, cfg, rng);
    const invalid = summary.n === 0 || summary.timeoutFraction > cfg.session.invalidTimeoutFraction; // n = 0: no complete scored wave
    if (invalid && canRetry) return withProgress({ ...next, _retries: s._retries + 1 });
    return withProgress({ ...next, _retries: 0, _pending: { ...p, flick: { trials, summary } } });
  }

  if (spec.kind === 'switch') {
    const sl = log as SwitchBlockLog;
    const next: SessionState = { ...s, logs: { ...s.logs, switch: [...s.logs.switch, sl] } };
    const summary = measureSwitch(sl, cfg, rng);
    if (summary.n === 0 && canRetry) return withProgress({ ...next, _retries: s._retries + 1 });
    return withProgress({ ...next, _retries: 0, _pending: { ...p, switch: summary } });
  }

  if (spec.kind === 'tracking') {
    const tl = log as TrackingBlockLog;
    const next: SessionState = { ...s, logs: { ...s.logs, tracking: [...s.logs.tracking, tl] } };
    const tracking = measureTracking(tl, cfg, rng);
    if (tracking.tot < cfg.session.invalidMinTot && canRetry) return withProgress({ ...next, _retries: s._retries + 1 });
    return withProgress({ ...next, _retries: 0, _pending: { ...p, tracking } });
  }

  const tsl = log as TrackSwitchBlockLog;
  const next: SessionState = { ...s, logs: { ...s.logs, trackSwitch: [...s.logs.trackSwitch, tsl] } };
  const ts = measureTrackSwitch(tsl, cfg, rng);
  const invalid = ts.kills === 0 || ts.dmg < cfg.session.invalidMinDmg;
  if (invalid && canRetry) return withProgress({ ...next, _retries: s._retries + 1 });
  const flick = p.flick!;
  const sw = p.switch!;
  const tracking = p.tracking!;
  const first = s.steps[0];
  const baseline: ScoreBaseline = s._scoreBaseline
    ?? (first ? { tp: first.flick.tp, switchTp: first.switch.tp, tot: first.tracking.tot, dmg: first.trackSwitch.dmg }
      : { tp: flick.summary.tp, switchTp: sw.tp, tot: tracking.tot, dmg: ts.dmg });
  const step: StepResult = {
    order: s.steps.length, stage: 'baseline', arm: null, cm360: s.setup.cm360, trials: flick.trials,
    flick: flick.summary, switch: sw, tracking, trackSwitch: ts, score: stepScore(flick.summary, sw, tracking, ts, baseline, cfg),
  };
  const steps = [...s.steps, step];
  const done = steps.length >= s._rounds;
  return withProgress({ ...next, steps, done, _retries: 0, _pending: done ? null : newRound(steps.length) });
}
