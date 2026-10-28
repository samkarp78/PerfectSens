import type { Config } from '../core/config';
import { degPerCount } from '../core/geometry';
import { FlickRunner } from '../core/run/flickRunner';
import { SwitchRunner } from '../core/run/switchRunner';
import { TrackingRunner } from '../core/run/trackingRunner';
import { extendAb, nextBlock, submitBlock, type SessionState } from '../core/session';
import type { MoveSample } from '../core/types';

/** 'asking': the first A/B round was too close to call and the player chooses whether to play the second. */
export type RunPhase = 'rest' | 'running' | 'paused' | 'asking' | 'finished';

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
}

type Progress = NonNullable<SessionState['progress']>;
export type Runner = FlickRunner | SwitchRunner | TrackingRunner;

export const WARMUP_REST_TEXT = 'Warm-up — free targets at your current sens, not scored.';
/** Shown before a round: a flick block followed straight away by a tracking block. */
export const ROUND_REST_TEXT = 'Next round: click each target as fast as you can, then hold the mouse button and track the moving target.';
export const TRACKING_REST_TEXT = 'Next: tracking — hold the mouse button and keep the crosshair on the moving target.';

const kindLabel = (p: Progress): string => (p.kind === 'tracking' ? 'Tracking' : p.kind === 'switch' ? 'Switching' : 'Flicks');

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

export function createRunController(initial: SessionState, cfg: Config = initial._cfg): RunController {
  let session = initial;
  let phase: RunPhase = session.result ? 'finished' : session.awaitingExtension ? 'asking' : 'rest';
  let runner: Runner | null = null;

  const settle = (): void => {
    runner = null;
    phase = session.result ? 'finished' : session.awaitingExtension ? 'asking' : 'rest';
  };

  const start = (t: number): void => {
    const spec = nextBlock(session);
    if (!spec) return;
    const dpc = degPerCount(session.setup.dpi, spec.cm360);
    runner = spec.kind === 'tracking' ? new TrackingRunner(spec, dpc, cfg, t)
      : spec.kind === 'switch' ? new SwitchRunner(spec, dpc, cfg, t)
      : new FlickRunner(spec, dpc, cfg, t);
    phase = 'running';
  };

  /** Within a round, flicks flow straight into switching and switching into tracking; a finished round rests. */
  const checkDone = (t: number): void => {
    if (!runner || !runner.state.done) return;
    const kind = runner.log().spec.kind;
    session = submitBlock(session, runner.log());
    settle();
    const next = nextBlock(session)?.kind;
    const continues = (kind === 'flick' && next === 'switch') || (kind === 'switch' && next === 'tracking');
    if (continues && phase === 'rest') start(t);
  };

  return {
    get phase() { return phase; },
    get session() { return session; },
    get runner() { return runner; },
    get hud() { return session.progress ? hudText(session.progress) : ''; },
    get restText() {
      const spec = nextBlock(session);
      if (!spec) return '';
      if (spec.kind === 'warmup') return WARMUP_REST_TEXT;
      return spec.kind === 'tracking' ? TRACKING_REST_TEXT : ROUND_REST_TEXT;
    },
    begin(t) {
      if (phase !== 'rest' && phase !== 'paused') return;
      start(t);
    },
    onMove(s) {
      if (phase !== 'running' || !runner) return;
      runner.onMove(s);
      checkDone(s.t);
    },
    onClick(t) {
      if (phase !== 'running' || !runner) return;
      if (runner instanceof TrackingRunner) runner.onPress(t);
      else runner.onClick(t);
      checkDone(t);
    },
    onRelease(t) {
      if (phase !== 'running' || !(runner instanceof TrackingRunner)) return;
      runner.onRelease(t);
    },
    tick(t) {
      if (phase !== 'running' || !runner) return;
      runner.tick(t);
      checkDone(t);
    },
    onLockLost() {
      if (phase !== 'running') return;
      runner = null;
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
