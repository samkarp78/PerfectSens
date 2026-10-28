import { PART_KINDS, type Config, type PartKind } from '../core/config';
import { degPerCount } from '../core/geometry';
import { FlickRunner } from '../core/run/flickRunner';
import { SwitchRunner } from '../core/run/switchRunner';
import { TrackingRunner } from '../core/run/trackingRunner';
import { TrackSwitchRunner } from '../core/run/trackSwitchRunner';
import { extendAb, nextBlock, submitBlock, type SessionState } from '../core/session';
import type { MoveSample } from '../core/types';

/** 'asking': the first A/B round was too close to call and the player chooses whether to play the second. */
/** 'break': a longer pause after every few rounds (the player clicks to go on). */
/** 'cue': the short unscored handover between two parts of a round (mouse stays locked, input ignored). */
export type RunPhase = 'rest' | 'running' | 'cue' | 'paused' | 'break' | 'asking' | 'finished';
export interface Cue { kind: PartKind; startedAt: number; endsAt: number }

export interface RunController {
  readonly phase: RunPhase;
  readonly session: SessionState;
  readonly hud: string;
  readonly restText: string;
  begin(t: number): void;
  onMove(s: MoveSample): void;
  onClick(t: number): void;
  onRelease(t: number): void;
  tick(t: number): void;
  onLockLost(): void;
  skipWarmup(): void;
  answerExtension(accept: boolean): void;
  readonly runner: Runner | null;
  /** The handover in progress (phase 'cue'), else null. */
  readonly cue: Cue | null;
}

type Progress = NonNullable<SessionState['progress']>;
export type Runner = FlickRunner | SwitchRunner | TrackingRunner | TrackSwitchRunner;

export const WARMUP_REST_TEXT = 'Warm-up — free targets at your current sens, not scored.';
/** Shown before a round: its four parts follow each other with a short cue in between. */
export const ROUND_REST_TEXT = 'Next round: flick each target, clear the targets in any order, hold the button and track, then hold on the moving targets to take them down.';
/** Shown when a single part is retried. */
export const SWITCH_REST_TEXT = 'Next: switching — clear the targets in any order.';
export const TRACKING_REST_TEXT = 'Next: tracking — hold the mouse button and keep the crosshair on the moving target.';
export const TRACKSWITCH_REST_TEXT = 'Next: tracking switching — hold the mouse button on a moving target until it goes down, then the next.';

const PART_LABEL: Record<PartKind, string> = { flick: 'Flicks', switch: 'Switching', tracking: 'Tracking', trackswitch: 'Tracking switching' };
export const partLabel = (kind: PartKind): string => PART_LABEL[kind];
const kindLabel = (p: Progress): string => (p.kind === 'warmup' ? 'Warm-up' : PART_LABEL[p.kind]);
/** Banner text during the handover to `kind`. */
export const cueText = (kind: PartKind): string => `Next: ${PART_LABEL[kind]}`;
/** True when `next` is the part that follows `prev` within a round. */
const follows = (prev: string, next: string | undefined): boolean => {
  const i = PART_KINDS.indexOf(prev as PartKind);
  return i >= 0 && i + 1 < PART_KINDS.length && PART_KINDS[i + 1] === next;
};

/** HUD label for a block. Never contains a sensitivity value; the recheck reads as a normal step. */
export function hudText(p: Progress): string {
  switch (p.stage) {
    case 'warmup': return 'Warm-up';
    case 'baseline': return `Calibration · ${kindLabel(p)}`;
    case 'dialin':
    case 'recheck': return `Dial-in ${p.stepIndex + 1} of ${p.totalSteps} · ${kindLabel(p)}`;
    case 'ab': return `Final Showdown · ${kindLabel(p)}`;
  }
}

/** Seconds counted down with a beep at the end of every part (sound only; nothing is drawn). */
export const COUNTDOWN_BEEPS_FROM_S = 5;

/** The second (5…1) whose mark the time left crossed between two frames, or null: one beep per mark, the latest if a
 *  slow frame skipped some. */
export function countdownBeep(prevLeftMs: number, leftMs: number): number | null {
  const was = Math.ceil(prevLeftMs / 1000), now = Math.ceil(leftMs / 1000);
  return now < was && now >= 1 && now <= COUNTDOWN_BEEPS_FROM_S ? now : null;
}

/** Where the run goes once no block is running: the end, the A/B question, a break after every
 *  session.breakEveryRounds-th completed round, or a normal rest. */
export function restPhase(session: SessionState, completedRound: boolean): RunPhase {
  if (session.result) return 'finished';
  if (session.awaitingExtension) return 'asking';
  const every = session._cfg.session.breakEveryRounds;
  if (completedRound && session.steps.length % every === 0 && nextBlock(session)) return 'break';
  return 'rest';
}

export function createRunController(initial: SessionState, cfg: Config = initial._cfg): RunController {
  let session = initial;
  let phase: RunPhase = session.result ? 'finished' : session.awaitingExtension ? 'asking' : 'rest';
  let runner: Runner | null = null;
  let cue: Cue | null = null;
  /** The part whose cue was interrupted by a pause; resuming replays that cue. */
  let pausedCue: PartKind | null = null;
  /** The left button's state from every press and release, whatever the phase, so a button held through a handover
   *  counts as held from the start of the next hold part. */
  let buttonDown = false;

  const settle = (completedRound = false): void => {
    runner = null;
    cue = null;
    phase = restPhase(session, completedRound);
  };

  const start = (t: number): void => {
    const spec = nextBlock(session);
    if (!spec) return;
    const dpc = degPerCount(session.setup.dpi, spec.cm360);
    cue = null;
    runner = spec.kind === 'tracking' ? new TrackingRunner(spec, dpc, cfg, t)
      : spec.kind === 'trackswitch' ? new TrackSwitchRunner(spec, dpc, cfg, t)
      : spec.kind === 'switch' ? new SwitchRunner(spec, dpc, cfg, t)
      : new FlickRunner(spec, dpc, cfg, t);
    if (buttonDown && (runner instanceof TrackingRunner || runner instanceof TrackSwitchRunner)) runner.onPress(t);
    phase = 'running';
  };

  const startCue = (t: number, kind: PartKind): void => {
    runner = null;
    cue = { kind, startedAt: t, endsAt: t + cfg.round.cueMs };
    phase = 'cue';
  };
  /** Within a round each part hands over to the next through a short cue; a finished round (or a retry) rests. */
  const checkDone = (t: number): void => {
    if (!runner || !runner.state.done) return;
    const kind = runner.log().spec.kind;
    const rounds = session.steps.length;
    session = submitBlock(session, runner.log());
    settle(session.steps.length > rounds);
    const next = nextBlock(session)?.kind;
    if (follows(kind, next) && phase === 'rest') startCue(t, next as PartKind);
  };

  return {
    get phase() { return phase; },
    get session() { return session; },
    get runner() { return runner; },
    get cue() { return cue; },
    get hud() { return session.progress ? hudText(session.progress) : ''; },
    get restText() {
      const spec = nextBlock(session);
      if (!spec) return '';
      if (spec.kind === 'warmup') return WARMUP_REST_TEXT;
      if (spec.kind === 'switch') return SWITCH_REST_TEXT;
      if (spec.kind === 'tracking') return TRACKING_REST_TEXT;
      return spec.kind === 'trackswitch' ? TRACKSWITCH_REST_TEXT : ROUND_REST_TEXT;
    },
    begin(t) {
      if (phase !== 'rest' && phase !== 'paused' && phase !== 'break') return;
      const replay = phase === 'paused' ? pausedCue : null;
      pausedCue = null;
      if (replay) startCue(t, replay);
      else start(t);
    },
    onMove(s) {
      if (phase !== 'running' || !runner) return;
      runner.onMove(s);
      checkDone(s.t);
    },
    onClick(t) {
      buttonDown = true;
      if (phase !== 'running' || !runner) return;
      if (runner instanceof TrackingRunner || runner instanceof TrackSwitchRunner) runner.onPress(t);
      else runner.onClick(t);
      checkDone(t);
    },
    onRelease(t) {
      buttonDown = false;
      if (phase !== 'running' || !(runner instanceof TrackingRunner || runner instanceof TrackSwitchRunner)) return;
      runner.onRelease(t);
    },
    tick(t) {
      if (phase === 'cue' && cue && t >= cue.endsAt) { start(t); return; }
      if (phase !== 'running' || !runner) return;
      runner.tick(t);
      checkDone(t);
    },
    onLockLost() {
      if (phase !== 'running' && phase !== 'cue') return;
      pausedCue = phase === 'cue' ? cue!.kind : null;
      runner = null;
      cue = null;
      phase = 'paused';
    },
    skipWarmup() {
      if (phase !== 'rest') return;
      if (nextBlock(session)?.kind !== 'warmup') return;
      session = submitBlock(session, null);
      settle();
    },
    answerExtension(accept) {
      if (phase !== 'asking') return;
      session = extendAb(session, accept);
      settle();
    },
  };
}
