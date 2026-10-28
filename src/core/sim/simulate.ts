import { trackingTargetAt } from '../blocks';
import type { Config } from '../config';
import { angleBetween, degPerCount } from '../geometry';
import type { Rng } from '../rng';
import { FlickRunner } from '../run/flickRunner';
import { SwitchRunner } from '../run/switchRunner';
import { TrackingRunner } from '../run/trackingRunner';
import type { Aim, BlockSpec, FlickBlockLog, MoveSample, Setup, SwitchBlockLog, TrackingBlockLog } from '../types';
import { adaptToward, moveGain, performance, type SimPlayer, type SimState } from './player';

const MS_PER_S = 1000;
const RAD = Math.PI / 180;

export interface SimBlockResult { log: FlickBlockLog | SwitchBlockLog | TrackingBlockLog; state: SimState; endT: number }

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

interface Motor { em: CountEmitter; rng: Rng; cfg: Config; perf: number; k: number; stepMs: number; radius: number }

/**
 * One target acquisition: a minimum-jerk first move (gain and noise from the player model), corrections while off target,
 * then a click; a miss starts another correction cycle. Returns the time of the hitting click, or null once `alive` says
 * the target is gone (timed out or the block ended).
 */
function strike(m: Motor, aim: () => Aim, target: Aim, gain: number, start: number,
  alive: (t: number) => boolean, click: (t: number) => boolean): number | null {
  const sc = m.cfg.sim;
  const move = (from: number, d: { dYaw: number; dPitch: number }, durMs: number): number | null => {
    const n = Math.max(1, Math.round((durMs * sc.sampleHz) / MS_PER_S));
    let prev = 0;
    for (let i = 1; i <= n; i++) {
      const ts = from + i * m.stepMs;
      if (!alive(ts)) return null;
      const s = minJerk(i / n);
      m.em.emit(ts, (s - prev) * d.dYaw, (s - prev) * d.dPitch);
      prev = s;
    }
    return from + n * m.stepMs;
  };
  const first = plan(aim(), target, gain * (1 + sc.amplitudeNoise * m.k * m.rng.normal()), sc.directionNoiseDeg * m.k * m.rng.normal());
  let t: number | null = move(start, first, (sc.durationMs.base + sc.durationMs.slope * Math.log2(first.dist / (2 * m.radius) + 1)) / m.perf);
  let corrections = 0;
  const correct = (from: number): number | null => {
    corrections++;
    const d = plan(aim(), target, 1 + sc.correctionNoise * m.k * m.rng.normal(), 0);
    return move(from + sc.correctionPauseMs, d, sc.correctionDurationMs / m.perf);
  };
  while (t !== null) {
    while (t !== null && corrections < sc.maxCorrections && angleBetween(aim(), target) > sc.correctionThreshold * m.radius) t = correct(t);
    if (t === null) return null;
    t += sc.clickDelayMs;
    if (!alive(t)) return null;
    if (click(t)) return t;
    t = correct(t); // a miss starts another correction cycle from the actual aim
  }
  return null;
}

function simulateFlick(spec: BlockSpec, setup: Setup, player: SimPlayer, state: SimState, rng: Rng, cfg: Config, t0: number): SimBlockResult {
  const sc = cfg.sim;
  const dpc = degPerCount(setup.dpi, spec.cm360);
  const runner = new FlickRunner(spec, dpc, cfg, t0);
  const perf = performance(player, spec.cm360, state);
  let adapted = state.adaptedCm360;
  let lastT = t0;
  const em = new CountEmitter(dpc, (s) => { runner.onMove(s); lastT = s.t; });
  const m: Motor = { em, rng, cfg, perf, k: player.motorNoise / perf, stepMs: MS_PER_S / sc.sampleHz, radius: cfg.flick.targetRadiusDeg };

  while (!runner.state.done) {
    const index = runner.state.trialIndex;
    const target = runner.state.target;
    const trials = runner.log().trials;
    const trial = trials[trials.length - 1];
    if (!target || !trial) break;
    const alive = (t: number): boolean => { runner.tick(t); return !runner.state.done && runner.state.trialIndex === index; };
    const reaction = Math.max(sc.reactionMs.min, sc.reactionMs.mean + sc.reactionMs.sd * rng.normal());
    strike(m, () => runner.state.aim, target.aim, moveGain(player, adapted, spec.cm360), trial.spawnT + reaction, alive,
      (t) => { lastT = t; return runner.onClick(t).hit; });
    adapted = adaptToward(player, adapted, spec.cm360);
  }
  const log = runner.log();
  return { log, state: { adaptedCm360: adapted, blocksDone: state.blocksDone + 1 }, endT: Math.max(lastT, finishTime(log, cfg)) };
}

/** Switching: the player clears the nearest target each time, with the same motor model as flicks. */
function simulateSwitch(spec: BlockSpec, setup: Setup, player: SimPlayer, state: SimState, rng: Rng, cfg: Config, t0: number): SimBlockResult {
  const sc = cfg.sim;
  const dpc = degPerCount(setup.dpi, spec.cm360);
  const runner = new SwitchRunner(spec, dpc, cfg, t0);
  const perf = performance(player, spec.cm360, state);
  let adapted = state.adaptedCm360;
  let lastT = t0;
  const em = new CountEmitter(dpc, (s) => { runner.onMove(s); lastT = s.t; });
  const m: Motor = { em, rng, cfg, perf, k: player.motorNoise / perf, stepMs: MS_PER_S / sc.sampleHz, radius: cfg.switch.targetRadiusDeg };
  const same = (a: Aim, b: Aim) => a.yaw === b.yaw && a.pitch === b.pitch;

  while (!runner.state.done) {
    const here = runner.state.aim;
    const target = [...runner.state.targets].sort((a, b) => angleBetween(here, a) - angleBetween(here, b))[0];
    if (!target) break;
    const alive = (t: number): boolean => { runner.tick(t); return !runner.state.done && runner.state.targets.some((x) => same(x, target)); };
    const reaction = Math.max(sc.reactionMs.min, sc.switchReactionMs + sc.reactionMs.sd * rng.normal());
    const hitT = strike(m, () => runner.state.aim, target, moveGain(player, adapted, spec.cm360), lastT + reaction, alive,
      (t) => { lastT = t; return runner.onClick(t).hit; });
    if (hitT === null) runner.tick(runner.state.endsAt);
    adapted = adaptToward(player, adapted, spec.cm360);
  }
  return { log: runner.log(), state: { adaptedCm360: adapted, blocksDone: state.blocksDone + 1 }, endT: t0 + cfg.switch.blockMs };
}

/** When the runner finished: the last hit, the last target's timeout, or the block's time limit with a target still up. */
function finishTime(log: FlickBlockLog, cfg: Config): number {
  const last = log.trials[log.trials.length - 1];
  if (!last) return log.t0;
  if (last.timedOut) return last.spawnT + cfg.flick.timeoutMs;
  if (last.hitT !== null) return last.hitT;
  return log.t0 + (log.spec.kind === 'warmup' ? cfg.session.warmupMs : cfg.flick.blockMs);
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
  runner.onPress(t0); // the simulated player holds the mouse button for the whole block
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
  if (spec.kind === 'tracking') return simulateTracking(spec, setup, player, state, rng, cfg, t0);
  if (spec.kind === 'switch') return simulateSwitch(spec, setup, player, state, rng, cfg, t0);
  return simulateFlick(spec, setup, player, state, rng, cfg, t0);
}
