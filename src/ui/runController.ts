import type { Config } from '../core/config';
import { degPerCount } from '../core/geometry';
import { FlickRunner } from '../core/run/flickRunner';
import { TrackingRunner } from '../core/run/trackingRunner';
import { nextBlock, submitBlock, type SessionState } from '../core/session';
import type { MoveSample } from '../core/types';

export type RunPhase = 'rest' | 'running' | 'paused' | 'finished';

export interface RunController {
  readonly phase: RunPhase;
  readonly session: SessionState;
  readonly hud: string;
  readonly restText: string;
  begin(t: number): void;
  onMove(s: MoveSample): void;
  onClick(t: number): void;
  tick(t: number): void;
  onLockLost(): void;
  skipWarmup(): void;
  readonly runner: FlickRunner | TrackingRunner | null;
}

type Progress = NonNullable<SessionState['progress']>;

export const WARMUP_REST_TEXT = 'Warm-up — free targets at your current sens, not scored.';
export const FLICK_REST_TEXT = 'Next: flicks — click each target as fast as you can.';
export const TRACKING_REST_TEXT = 'Next: tracking — keep the crosshair on the moving target.';

const kindLabel = (p: Progress): string => (p.kind === 'tracking' ? 'Tracking' : 'Flick');

/** HUD label for a block. Never contains a sensitivity value; the recheck reads as a normal step. */
export function hudText(p: Progress): string {
  switch (p.stage) {
    case 'warmup': return 'Warm-up';
    case 'baseline': return `Baseline · ${kindLabel(p)}`;
    case 'dialin':
    case 'recheck': return `Step ${p.stepIndex + 1} of ${p.totalSteps} · ${kindLabel(p)}`;
    case 'ab': return `Final check · ${kindLabel(p)}`;
  }
}

export function createRunController(initial: SessionState, cfg: Config = initial._cfg): RunController {
  let session = initial;
  let phase: RunPhase = session.result ? 'finished' : 'rest';
  let runner: FlickRunner | TrackingRunner | null = null;

  const settle = (): void => {
    runner = null;
    phase = session.result ? 'finished' : 'rest';
  };

  const checkDone = (): void => {
    if (!runner || !runner.state.done) return;
    session = submitBlock(session, runner.log());
    settle();
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
      return spec.kind === 'tracking' ? TRACKING_REST_TEXT : FLICK_REST_TEXT;
    },
    begin(t) {
      if (phase !== 'rest' && phase !== 'paused') return;
      const spec = nextBlock(session);
      if (!spec) return;
      const dpc = degPerCount(session.setup.dpi, spec.cm360);
      runner = spec.kind === 'tracking' ? new TrackingRunner(spec, dpc, cfg, t) : new FlickRunner(spec, dpc, cfg, t);
      phase = 'running';
    },
    onMove(s) {
      if (phase !== 'running' || !runner) return;
      runner.onMove(s);
      checkDone();
    },
    onClick(t) {
      if (phase !== 'running' || !runner) return;
      if (runner instanceof FlickRunner) runner.onClick(t);
      checkDone();
    },
    tick(t) {
      if (phase !== 'running' || !runner) return;
      runner.tick(t);
      checkDone();
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
  };
}
