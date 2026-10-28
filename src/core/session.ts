import { AB_ROUND_LENGTH, abSequence, decideAB, extendSequence, type AbBlock, type AbDecision } from './ab';
import { defaultConfig, type Config } from './config';
import { diagnose } from './diagnose';
import { fitCurve, type FitPoint, type FitResult } from './fit';
import { measureFlickBlock, summarizeFlick, type FlickSummary, type TrialMetrics } from './measure/flick';
import { measureSwitch, type SwitchSummary } from './measure/switch';
import { measureTracking, type TrackingSummary } from './measure/tracking';
import { measureTrackSwitch } from './measure/trackSwitch';
import { buildResult, type SessionResult } from './result';
import { createRng, type Rng } from './rng';
import { stepScore } from './score';
import { chooseNext, type SteerDecision } from './steer';
import type { Arm, BlockKind, BlockSpec, FlickBlockLog, Setup, Stage, StepResult, SwitchBlockLog, TrackingBlockLog,
  TrackSwitchBlockLog } from './types';

export interface SessionOptions { seed: number; warmup: boolean; quickAbCm360: number | null; askBeforeExtending?: boolean }

type StepStage = Exclude<Stage, 'warmup'>;

/** The step currently being played: its flick, switching, tracking and tracking-switching blocks, in that order. */
interface PendingStep {
  stage: StepStage; arm: Arm | null; cm360: number; idBase: string;
  /** Spec stepIndex: sequence position for dial-in/recheck, A/B index for A/B, 0 for baseline. */
  specIndex: number;
  flick: { trials: TrialMetrics[]; summary: FlickSummary } | null;
  switch: SwitchSummary | null;
  tracking: TrackingSummary | null;
}

export interface SessionState {
  readonly setup: Setup; readonly mode: 'full' | 'quickab'; readonly steps: StepResult[];
  readonly fit: FitResult | null; readonly steerLog: SteerDecision[]; readonly abDecisions: AbDecision[];
  readonly logs: { flick: FlickBlockLog[]; switch: SwitchBlockLog[]; tracking: TrackingBlockLog[]; trackSwitch: TrackSwitchBlockLog[] }; readonly result: SessionResult | null;
  /** The first A/B round was too close to call and the player must choose (extendAb) whether to play the second. */
  readonly awaitingExtension: boolean;
  /** Why it is asking: 'ahead' when look 1 favoured the pick (confirming it), 'close' otherwise; null when not asking. */
  readonly extensionReason: 'ahead' | 'close' | null;
  /** blocksDone/blocksTotal count scored part blocks (warm-up excluded); the total is an estimate
   *  that grows if the A/B adds its second round. */
  readonly progress: {
    stage: Stage; stepIndex: number; totalSteps: number; kind: BlockKind; blocksDone: number; blocksTotal: number;
  } | null;
  /** @internal */ readonly _cfg: Config;
  /** @internal */ readonly _seed: number;
  /** @internal */ readonly _warmupPending: boolean;
  /** @internal */ readonly _pending: PendingStep | null;
  /** @internal retries already used on the current block */ readonly _retries: number;
  /** @internal */ readonly _arms: Arm[];
  /** @internal A/B pick (P arm); null until the dial-in is done */ readonly _pick: number | null;
  /** @internal ask the player before the second A/B round instead of extending automatically */ readonly _ask: boolean;
}

/** Each step is a round of four blocks: flicks, switching, tracking, tracking switching. */
export const BLOCKS_PER_STEP = 4;

/** Spec seeds are integers in [0, 2^31). */
const SEED_RANGE = 2 ** 31;

const rootFork = (s: { _seed: number }, label: string): Rng => createRng(s._seed).fork(label);
const dialinCount = (s: SessionState): number => s._cfg.session.dialinSteps[s.setup.mode];
/** Dial-in index after which the recheck is inserted is floor(n/2) − 1, i.e. the recheck sits at position floor(n/2). */
const recheckPos = (s: SessionState): number => Math.floor(dialinCount(s) / 2);
const isFitStep = (st: StepResult): boolean => st.stage !== 'ab';

export function createSession(setup: Setup, opts: SessionOptions, cfg: Config = defaultConfig): SessionState {
  const quick = opts.quickAbCm360 !== null;
  const base: SessionState = {
    setup, mode: quick ? 'quickab' : 'full', steps: [], fit: null, steerLog: [], abDecisions: [],
    logs: { flick: [], switch: [], tracking: [], trackSwitch: [] }, result: null, progress: null, awaitingExtension: false, extensionReason: null, _ask: opts.askBeforeExtending ?? false,
    _cfg: cfg, _seed: opts.seed, _warmupPending: opts.warmup, _pending: null, _retries: 0,
    _arms: [], _pick: null,
  };
  const start = quick ? { ...base, _pick: opts.quickAbCm360, _arms: abSequence(rootFork(base, 'ab')) } : base;
  return withProgress(planNext(start));
}

function specOf(s: SessionState, p: PendingStep, kind: Exclude<BlockKind, 'warmup'>): BlockSpec {
  const id = `${p.idBase}-${kind}`;
  return { id, stage: p.stage, kind, cm360: p.cm360, seed: seedFor(s, id), stepIndex: p.specIndex, arm: p.arm };
}

function seedFor(s: SessionState, id: string): number {
  return Math.floor(rootFork(s, id).next() * SEED_RANGE);
}

export function nextBlock(s: SessionState): BlockSpec | null {
  if (s.result) return null;
  if (s._warmupPending) {
    const id = 'warmup';
    return { id, stage: 'warmup', kind: 'warmup', cm360: s.setup.cm360, seed: seedFor(s, id), stepIndex: 0, arm: null };
  }
  const p = s._pending;
  if (!p) return null;
  return specOf(s, p, !p.flick ? 'flick' : !p.switch ? 'switch' : !p.tracking ? 'tracking' : 'trackswitch');
}

/** Position in the combined dial-in + recheck sequence of the current step (0 for baseline, warmup and A/B). */
function withProgress(s: SessionState): SessionState {
  const spec = nextBlock(s);
  if (!spec) return { ...s, progress: null };
  const inSequence = spec.stage === 'dialin' || spec.stage === 'recheck';
  const p = s._pending;
  const blocksDone = BLOCKS_PER_STEP * s.steps.length + (p?.flick ? 1 : 0) + (p?.switch ? 1 : 0) + (p?.tracking ? 1 : 0);
  return {
    ...s,
    progress: {
      stage: spec.stage, stepIndex: inSequence ? spec.stepIndex : 0, totalSteps: dialinCount(s) + 1, kind: spec.kind,
      blocksDone, blocksTotal: BLOCKS_PER_STEP * plannedSteps(s),
    },
  };
}

/** Steps the session expects to run: baseline + dial-in + recheck + the A/B arms planned so far
 *  (one ABBA round until the A/B is planned); quick A/B runs only its arms. */
function plannedSteps(s: SessionState): number {
  if (s.mode === 'quickab') return s._arms.length;
  const ab = s._pick === null ? AB_ROUND_LENGTH : s._arms.length;
  return 1 + dialinCount(s) + 1 + ab;
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
  const baseline = s.mode === 'quickab' ? null
    : p.stage === 'baseline' || !first ? { tp: flick.summary.tp, switchTp: sw.tp, tot: tracking.tot, dmg: ts.dmg }
    : { tp: first.flick.tp, switchTp: first.switch.tp, tot: first.tracking.tot, dmg: first.trackSwitch.dmg };
  const step: StepResult = {
    order: s.steps.length, stage: p.stage, arm: p.arm, cm360: p.cm360, trials: flick.trials,
    flick: flick.summary, switch: sw, tracking, trackSwitch: ts, score: stepScore(flick.summary, sw, tracking, ts, baseline, cfg),
  };
  const steps = [...s.steps, step];
  const fit = s.mode === 'full' && isFitStep(step) ? refit(s, steps) : s.fit;
  return withProgress(planNext({ ...next, steps, fit, _retries: 0, _pending: null }));
}

function fitPoints(steps: StepResult[]): FitPoint[] {
  const span = Math.max(1, steps.length - 1);
  return steps.filter(isFitStep).map((st) => ({
    x: Math.log(st.cm360), y: st.score.logS, se: st.score.se, t: st.order / span,
    isCurrent: st.stage === 'baseline' || st.stage === 'recheck',
  }));
}

function refit(s: SessionState, steps: StepResult[]): FitResult {
  const order = steps[steps.length - 1]!.order;
  return fitCurve(fitPoints(steps), Math.log(s.setup.cm360), s._cfg, rootFork(s, `fit-${order}`));
}

/** Rebuilds a saved full session's final fit (as of its last fit step) for redrawing the curve. The curve itself is
 *  deterministic; the bootstrap range may differ slightly, so show the saved result's range rather than this one's. */
export function fitFromSteps(setup: Setup, steps: StepResult[], cfg: Config = defaultConfig): FitResult | null {
  let last = -1;
  steps.forEach((st, i) => { if (isFitStep(st)) last = i; });
  if (last < 0) return null;
  return fitCurve(fitPoints(steps.slice(0, last + 1)), Math.log(setup.cm360), cfg, createRng(0));
}

/** Decides what the next step is (or finishes the session) once no step is pending. */
function planNext(s: SessionState): SessionState {
  const current = s.setup.cm360;
  if (s.mode === 'full') {
    if (s.steps.length === 0) {
      return { ...s, _pending: { stage: 'baseline', arm: null, cm360: current, idBase: 'baseline', specIndex: 0, flick: null, switch: null, tracking: null } };
    }
    const seq = s.steps.filter((st) => st.stage === 'dialin' || st.stage === 'recheck');
    const n = dialinCount(s);
    if (seq.length < n + 1) {
      const pos = seq.length;
      if (pos === recheckPos(s)) {
        return { ...s, _pending: { stage: 'recheck', arm: null, cm360: current, idBase: 'recheck', specIndex: pos, flick: null, switch: null, tracking: null } };
      }
      const i = pos < recheckPos(s) ? pos : pos - 1;
      const decision = chooseNext({
        currentCm360: current, baseline: s.steps[0]!, steps: seq, fit: s.fit, stepIndex: i, totalSteps: n,
        rng: rootFork(s, `steer-${i}`), padWidthCm: s.setup.padWidthCm ?? null,
      }, s._cfg);
      return {
        ...s, steerLog: [...s.steerLog, decision],
        _pending: { stage: 'dialin', arm: null, cm360: decision.cm360, idBase: `dialin-${i}`, specIndex: pos, flick: null, switch: null, tracking: null },
      };
    }
    if (s._pick === null) {
      const pick = s.fit!.pickCm360;
      if (Math.abs(Math.log(pick / current)) < Math.log(1 + s._cfg.ab.minEffect)) return finish({ ...s, _pick: pick }, true);
      return planAb({ ...s, _pick: pick, _arms: abSequence(rootFork(s, 'ab')) });
    }
  }
  return planAb(s);
}

function planAb(s: SessionState): SessionState {
  const ab = s.steps.filter((st) => st.stage === 'ab');
  if (ab.length > 0 && ab.length === s._arms.length) {
    const look: 1 | 2 = s.abDecisions.length === 0 ? 1 : 2;
    const blocks: AbBlock[] = ab.map((st) => ({ arm: st.arm!, logS: st.score.logS, se: st.score.se }));
    const decision = decideAB(blocks, look, s._cfg, s.abDecisions[0]?.delta ?? null);
    const decided = { ...s, abDecisions: [...s.abDecisions, decision] };
    if (decision.decision !== 'continue') return finish(decided, false);
    if (s._ask) {
      const m = Math.log(1 + s._cfg.ab.minEffect);
      const ahead = decision.delta > m && decision.delta > s._cfg.ab.z * decision.se;
      return { ...decided, _pending: null, awaitingExtension: true, extensionReason: ahead ? 'ahead' : 'close' };
    }
    return planAb({ ...decided, _arms: [...s._arms, ...extendSequence(s._arms)] });
  }
  const j = ab.length;
  const arm = s._arms[j]!;
  return {
    ...s, _pending: { stage: 'ab', arm, cm360: arm === 'P' ? s._pick! : s.setup.cm360, idBase: `ab-${j}`, specIndex: j, flick: null, switch: null, tracking: null },
  };
}

/** The player's answer to a borderline first A/B round: play the mirrored second round, or stop with no clear winner. */
export function extendAb(s: SessionState, accept: boolean): SessionState {
  if (!s.awaitingExtension) throw new Error('extendAb: the session is not waiting for an answer');
  const waiting = { ...s, awaitingExtension: false, extensionReason: null };
  if (accept) return withProgress(planAb({ ...waiting, _arms: [...s._arms, ...extendSequence(s._arms)] }));
  const last = s.abDecisions[s.abDecisions.length - 1]!;
  return withProgress(finish({ ...waiting, abDecisions: [...s.abDecisions, { ...last, decision: 'none' }] }, false));
}

function finish(s: SessionState, abSkipped: boolean): SessionState {
  const ab = s.abDecisions[s.abDecisions.length - 1] ?? null;
  const atRecommended = abSkipped
    ? s.steps.filter((st) => st.stage === 'baseline' || st.stage === 'recheck')
    : s.steps.filter((st) => st.stage === 'ab' && st.arm === (ab?.decision === 'change' ? 'P' : 'C'));
  const findings = diagnose(atRecommended.map((st) => st.flick), atRecommended.map((st) => st.tracking), s._cfg,
    atRecommended.map((st) => st.switch));
  const result = buildResult({ setup: s.setup, fit: s.fit, pickCm360: s._pick!, ab, abSkipped, findings });
  return { ...s, result, _pending: null };
}
