import { defaultConfig, type Config } from '../core/config';
import type { runSimSession } from '../core/sim/runSession';
import type { BlockSpec, FlickBlockLog, SwitchBlockLog, TrackingBlockLog } from '../core/types';

export interface DemoClip { caption: string; spec: BlockSpec; log: FlickBlockLog | TrackingBlockLog; fromT: number; toT: number; speed: number }

export const DEMO_SPEED = 1.5;
export const FAST_FORWARD = 'Fast-forwarding through the remaining steps.';
const FLICK_TRIALS = 8;
const BASELINE_TRACKING_MS = 6000;
const EXCERPT_TRACKING_MS = 9000;
const MAX_CLIP_PLAYBACK_MS = 20000;
const DIALIN_CLIP_STEPS = [0, 2];

type Run = ReturnType<typeof runSimSession>;
type Logged = { spec: BlockSpec; log: FlickBlockLog | SwitchBlockLog | TrackingBlockLog };

const isFlick = (b: Logged): b is { spec: BlockSpec; log: FlickBlockLog } => b.spec.kind === 'flick';
const isTracking = (b: Logged): b is { spec: BlockSpec; log: TrackingBlockLog } => b.spec.kind === 'tracking';

/** The first `FLICK_TRIALS` scored trials of a flick log, as a playback window. */
function flickWindow(log: FlickBlockLog, cfg: Config): { fromT: number; toT: number } {
  const scored = log.trials.filter((t) => t.target.scored).slice(0, FLICK_TRIALS);
  const first = scored[0] ?? log.trials[0];
  const last = scored[scored.length - 1] ?? first;
  const fromT = first ? first.spawnT : log.t0;
  const end = last ? (last.hitT ?? last.spawnT + cfg.flick.timeoutMs) : fromT + 1;
  const cap = fromT + MAX_CLIP_PLAYBACK_MS * DEMO_SPEED;
  return { fromT, toT: Math.max(fromT + 1, Math.min(end, cap)) };
}

function trackingWindow(log: TrackingBlockLog, offsetMs: number, lengthMs: number): { fromT: number; toT: number } {
  const fromT = Math.min(log.t0 + offsetMs, log.endT - 1);
  return { fromT, toT: Math.min(fromT + lengthMs, log.endT) };
}

/** Builds the demo clips from a finished simulated session. Captions never include sensitivity values. */
export function buildDemoScript(run: Run, cfg: Config = defaultConfig): DemoClip[] {
  const blocks = run.blocks.filter((b): b is Logged => b.log !== null);
  const clips: DemoClip[] = [];
  const add = (b: Logged, caption: string, w: { fromT: number; toT: number }): void => {
    clips.push({ caption, spec: b.spec, log: b.log, fromT: w.fromT, toT: w.toT, speed: DEMO_SPEED });
  };

  const baseFlick = blocks.find((b) => b.spec.stage === 'baseline' && isFlick(b));
  if (baseFlick && isFlick(baseFlick)) {
    add(baseFlick, 'Baseline flicks. A target appears, you flick to it and click. We time every hit and watch how cleanly you land.', flickWindow(baseFlick.log, cfg));
  }
  const baseTrack = blocks.find((b) => b.spec.stage === 'baseline' && isTracking(b));
  if (baseTrack && isTracking(baseTrack)) {
    add(baseTrack, 'Baseline tracking. Keep the crosshair on a moving target. We measure how much of the time you stay on it.', trackingWindow(baseTrack.log, 0, BASELINE_TRACKING_MS));
  }

  const dialinFlicks = blocks.filter((b) => b.spec.stage === 'dialin' && isFlick(b));
  DIALIN_CLIP_STEPS.forEach((step, n) => {
    const b = dialinFlicks[step];
    if (!b || !isFlick(b)) return;
    const reason = run.state.steerLog[step]?.reason;
    const intro = n > 0 ? `${FAST_FORWARD} ` : '';
    const why = reason ? ` Why this one: ${reason}.` : '';
    add(b, `${intro}Dial-in step ${step + 1}. Each step quietly changes your sensitivity; the value stays hidden so it cannot bias you.${why}`, flickWindow(b.log, cfg));
  });

  const dialinTracks = blocks.filter((b) => b.spec.stage === 'dialin' && isTracking(b));
  const track = dialinTracks[dialinTracks.length - 1];
  if (track && isTracking(track)) {
    add(track, `${FAST_FORWARD} Another tracking test, at a later step. Tracking often prefers a different sensitivity than flicks.`, trackingWindow(track.log, cfg.tracking.leadInMs, EXCERPT_TRACKING_MS));
  }

  const ab = blocks.find((b) => b.spec.stage === 'ab' && isFlick(b));
  if (ab && isFlick(ab)) {
    add(ab, `${FAST_FORWARD} Finally, a blind A/B check: two sensitivities in a shuffled order, so the final pick is confirmed head to head.`, flickWindow(ab.log, cfg));
  }
  return clips;
}
