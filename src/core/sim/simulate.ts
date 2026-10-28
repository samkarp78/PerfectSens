import { trackingTargetAt } from '../blocks';
import type { Config } from '../config';
import { angleBetween, degPerCount } from '../geometry';
import type { Rng } from '../rng';
import { FlickRunner } from '../run/flickRunner';
import { TrackingRunner } from '../run/trackingRunner';
import type { Aim, BlockSpec, FlickBlockLog, MoveSample, Setup, TrackingBlockLog } from '../types';
import { adaptToward, moveGain, performance, type SimPlayer, type SimState } from './player';

const MS_PER_S = 1000;
const RAD = Math.PI / 180;

export interface SimBlockResult { log: FlickBlockLog | TrackingBlockLog; state: SimState; endT: number }

const minJerk = (tau: number): number => 10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5;

/** Turns degree displacements into integer counts, carrying the rounding residual; zero moves are not sent. */
class CountEmitter {
  private fx = 0;
  private fy = 0;
  constructor(private readonly dpc: number, private readonly sink: (s: MoveSample) => void) {}

  emit(t: number, dYaw: number, dPitch: number): void {
    this.fx += dYaw / this.dpc;
    this.fy -= dPitch / this.dpc; // dy positive = pitch down
    const dx = Math.round(this.fx), dy = Math.round(this.fy);
    this.fx -= dx; this.fy -= dy;
    if (dx !== 0 || dy !== 0) this.sink({ t, dx, dy });
  }
}

/** Displacement from `from` to `to` in the flat cos-pitch-scaled plane, scaled by `scale` and rotated by `rotDeg`, back in yaw/pitch. */
function plan(from: Aim, to: Aim, scale: number, rotDeg: number): { dYaw: number; dPitch: number; dist: number } {
  const kc = Math.cos(((from.pitch + to.pitch) / 2) * RAD);
  const x = (to.yaw - from.yaw) * kc, y = to.pitch - from.pitch;
  const c = Math.cos(rotDeg * RAD), s = Math.sin(rotDeg * RAD);
  return { dYaw: ((x * c - y * s) * scale) / kc, dPitch: (x * s + y * c) * scale, dist: Math.hypot(x, y) };
}

function simulateFlick(spec: BlockSpec, setup: Setup, player: SimPlayer, state: SimState, rng: Rng, cfg: Config, t0: number): SimBlockResult {
  const sc = cfg.sim;
  const dpc = degPerCount(setup.dpi, spec.cm360);
  const runner = new FlickRunner(spec, dpc, cfg, t0);
  const perf = performance(player, spec.cm360, state);
  const k = player.motorNoise / perf;
  const r = cfg.flick.targetRadiusDeg;
  const stepMs = MS_PER_S / sc.sampleHz;
  let adapted = state.adaptedCm360;
  let lastT = t0;
  const em = new CountEmitter(dpc, (s) => { runner.onMove(s); lastT = s.t; });

  while (!runner.state.done) {
    const index = runner.state.trialIndex;
    const target = runner.state.target;
    const trials = runner.log().trials;
    const trial = trials[trials.length - 1];
    if (!target || !trial) break;
    const alive = (t: number): boolean => { runner.tick(t); return !runner.state.done && runner.state.trialIndex === index; };

    /** Minimum-jerk move starting at `start`; returns its end time, or null if the target was lost (timed out) meanwhile. */
    const move = (start: number, d: { dYaw: number; dPitch: number }, durMs: number): number | null => {
      const n = Math.max(1, Math.round((durMs * sc.sampleHz) / MS_PER_S));
      let prev = 0;
      for (let i = 1; i <= n; i++) {
        const ts = start + i * stepMs;
        if (!alive(ts)) return null;
        const s = minJerk(i / n);
        em.emit(ts, (s - prev) * d.dYaw, (s - prev) * d.dPitch);
        prev = s;
      }
      return start + n * stepMs;
    };

    let t: number | null = trial.spawnT + Math.max(sc.reactionMs.min, sc.reactionMs.mean + sc.reactionMs.sd * rng.normal());
    const gain = moveGain(player, adapted, spec.cm360);
    const first = plan(runner.state.aim, target.aim, gain * (1 + sc.amplitudeNoise * k * rng.normal()), sc.directionNoiseDeg * k * rng.normal());
    t = move(t, first, (sc.durationMs.base + sc.durationMs.slope * Math.log2(first.dist / (2 * r) + 1)) / perf);

    let corrections = 0;
    const correct = (start: number): number | null => {
      corrections++;
      const d = plan(runner.state.aim, target.aim, 1 + sc.correctionNoise * k * rng.normal(), 0);
      return move(start + sc.correctionPauseMs, d, sc.correctionDurationMs / perf);
    };
    while (t !== null) {
      while (t !== null && corrections < sc.maxCorrections && angleBetween(runner.state.aim, target.aim) > sc.correctionThreshold * r) t = correct(t);
      if (t === null) break;
      t += sc.clickDelayMs;
      if (!alive(t)) break;
      lastT = t;
      if (runner.onClick(t).hit) break;
      t = correct(t); // a miss starts another correction cycle from the actual aim
    }
    adapted = adaptToward(player, adapted, spec.cm360);
  }
  return { log: runner.log(), state: { adaptedCm360: adapted, blocksDone: state.blocksDone + 1 }, endT: lastT };
}

function simulateTracking(spec: BlockSpec, setup: Setup, player: SimPlayer, state: SimState, rng: Rng, cfg: Config, t0: number): SimBlockResult {
  const sc = cfg.sim;
  const dpc = degPerCount(setup.dpi, spec.cm360);
  const runner = new TrackingRunner(spec, dpc, cfg, t0);
  const perf = performance(player, spec.cm360, state);
  const k = player.motorNoise / perf;
  const stepMs = MS_PER_S / sc.sampleHz;
  const delayMs = sc.trackingDelayMs / perf;
  const endT = t0 + cfg.tracking.leadInMs + cfg.tracking.durationMs;
  const em = new CountEmitter(dpc, (s) => runner.onMove(s));
  let adapted = state.adaptedCm360;
  let nextAdapt = t0 + sc.trackingAdaptMs;

  for (let i = 1; ; i++) {
    const ts = t0 + i * stepMs;
    if (ts >= endT) break;
    while (ts >= nextAdapt) { adapted = adaptToward(player, adapted, spec.cm360); nextAdapt += sc.trackingAdaptMs; }
    const gain = moveGain(player, adapted, spec.cm360);
    const rel = ts - t0;
    const seenA = trackingTargetAt(spec, rel - delayMs - stepMs, cfg), seenB = trackingTargetAt(spec, rel - delayMs, cfg);
    const vYaw = ((seenB.yaw - seenA.yaw) / stepMs) * MS_PER_S, vPitch = ((seenB.pitch - seenA.pitch) / stepMs) * MS_PER_S;
    const tgt = trackingTargetAt(spec, rel - stepMs, cfg);
    const aim = runner.state.aim;
    const noise = k * sc.trackingNoiseDegPerSec;
    const wYaw = gain * (vYaw + sc.trackingErrorGain * (tgt.yaw - aim.yaw)) + noise * rng.normal();
    const wPitch = gain * (vPitch + sc.trackingErrorGain * (tgt.pitch - aim.pitch)) + noise * rng.normal();
    em.emit(ts, (wYaw * stepMs) / MS_PER_S, (wPitch * stepMs) / MS_PER_S);
  }
  runner.tick(endT);
  return { log: runner.log(), state: { adaptedCm360: adapted, blocksDone: state.blocksDone + 1 }, endT };
}

/** Plays one block with the simulated player, feeding integer-count moves and clicks into the real runner. Warmup plays like flick. */
export function simulateBlock(spec: BlockSpec, setup: Setup, player: SimPlayer, state: SimState, rng: Rng, cfg: Config, t0: number): SimBlockResult {
  return spec.kind === 'tracking'
    ? simulateTracking(spec, setup, player, state, rng, cfg, t0)
    : simulateFlick(spec, setup, player, state, rng, cfg, t0);
}
