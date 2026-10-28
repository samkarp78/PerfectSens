import { trackingTargetAt, trackSwitchTargetAim } from '../blocks';
import type { Config } from '../config';
import { angleBetween, degPerCount } from '../geometry';
import type { Rng } from '../rng';
import { FlickRunner } from '../run/flickRunner';
import { SwitchRunner } from '../run/switchRunner';
import { TrackingRunner } from '../run/trackingRunner';
import { TrackSwitchRunner } from '../run/trackSwitchRunner';
import type { Aim, BlockSpec, FlickBlockLog, MoveSample, Setup, SwitchBlockLog, TrackingBlockLog, TrackSwitchBlockLog,
  TrackSwitchTarget } from '../types';
import { adaptToward, moveGain, performance, type SimPlayer, type SimState } from './player';

const MS_PER_S = 1000;
const RAD = Math.PI / 180;

export interface SimBlockResult { log: FlickBlockLog | SwitchBlockLog | TrackingBlockLog | TrackSwitchBlockLog; state: SimState; endT: number }

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

/** One step of the tracking pursuit controller: follow the target velocity seen `delayMs` ago plus a correction toward
 *  the target's last seen position, scaled by the movement gain, with motor noise. `at` gives the target at a time. */
function pursuitStep(at: (t: number) => Aim, t: number, aim: Aim, gain: number, delayMs: number, stepMs: number, k: number,
  rng: Rng, cfg: Config): { dYaw: number; dPitch: number } {
  const sc = cfg.sim;
  const seenA = at(t - delayMs - stepMs), seenB = at(t - delayMs);
  const vYaw = ((seenB.yaw - seenA.yaw) / stepMs) * MS_PER_S, vPitch = ((seenB.pitch - seenA.pitch) / stepMs) * MS_PER_S;
  const tgt = at(t - stepMs);
  const noise = k * sc.trackingNoiseDegPerSec;
  const wYaw = gain * (vYaw + sc.trackingErrorGain * (tgt.yaw - aim.yaw)) + noise * rng.normal();
  const wPitch = gain * (vPitch + sc.trackingErrorGain * (tgt.pitch - aim.pitch)) + noise * rng.normal();
  return { dYaw: (wYaw * stepMs) / MS_PER_S, dPitch: (wPitch * stepMs) / MS_PER_S };
}

/** Tracking switching: hold throughout; after a reaction, one min-jerk acquisition move (gain and noise as a strike's first
 *  move) to where the nearest target will be on arrival, then pursue it until it dies; repeat. */
function simulateTrackSwitch(spec: BlockSpec, setup: Setup, player: SimPlayer, state: SimState, rng: Rng, cfg: Config, t0: number): SimBlockResult {
  const sc = cfg.sim;
  const dpc = degPerCount(setup.dpi, spec.cm360);
  const runner = new TrackSwitchRunner(spec, dpc, cfg, t0);
  const perf = performance(player, spec.cm360, state);
  const k = player.motorNoise / perf;
  const stepMs = MS_PER_S / sc.sampleHz;
  const delayMs = sc.trackingDelayMs / perf;
  const radius = cfg.trackswitch.targetRadiusDeg;
  const endT = t0 + cfg.trackswitch.blockMs;
  const em = new CountEmitter(dpc, (m) => runner.onMove(m));
  runner.onPress(t0);
  let adapted = state.adaptedCm360;
  let nextAdapt = t0 + sc.trackingAdaptMs;
  const live = (): TrackSwitchTarget[] => runner.log().targets.filter((x) => x.killT === null);

  let cur: TrackSwitchTarget | null = null;
  let acquireAt = t0 + Math.max(sc.reactionMs.min, sc.switchReactionMs + sc.reactionMs.sd * rng.normal());
  let move: { from: number; n: number; dYaw: number; dPitch: number; prev: number } | null = null;
  for (let i = 1; ; i++) {
    const ts = t0 + i * stepMs;
    if (ts >= endT) break;
    while (ts >= nextAdapt) { adapted = adaptToward(player, adapted, spec.cm360); nextAdapt += sc.trackingAdaptMs; }
    const gain = moveGain(player, adapted, spec.cm360);
    if (cur && cur.killT !== null) {
      cur = null; move = null;
      acquireAt = ts + Math.max(sc.reactionMs.min, sc.switchReactionMs + sc.reactionMs.sd * rng.normal());
    }
    if (!cur) {
      if (ts < acquireAt) { runner.tick(ts); continue; }
      const here = runner.state.aim;
      const at = (x: TrackSwitchTarget) => trackSwitchTargetAim(x, ts, cfg);
      cur = live().sort((a, b) => angleBetween(here, at(a)) - angleBetween(here, at(b)))[0] ?? null;
      if (!cur) { runner.tick(ts); continue; }
      const dist = angleBetween(here, at(cur));
      const durMs = (sc.durationMs.base + sc.durationMs.slope * Math.log2(dist / (2 * radius) + 1)) / perf;
      const d = plan(here, trackSwitchTargetAim(cur, ts + durMs, cfg), gain * (1 + sc.amplitudeNoise * k * rng.normal()),
        sc.directionNoiseDeg * k * rng.normal());
      move = { from: ts, n: Math.max(1, Math.round((durMs * sc.sampleHz) / MS_PER_S)), dYaw: d.dYaw, dPitch: d.dPitch, prev: 0 };
    }
    if (move) {
      const step = Math.round((ts - move.from) / stepMs) + 1;
      const sNow = minJerk(Math.min(1, step / move.n));
      em.emit(ts, (sNow - move.prev) * move.dYaw, (sNow - move.prev) * move.dPitch);
      move.prev = sNow;
      if (step >= move.n) move = null;
      continue;
    }
    const target = cur;
    const d = pursuitStep((t) => trackSwitchTargetAim(target, t, cfg), ts, runner.state.aim, gain, delayMs, stepMs, k, rng, cfg);
    em.emit(ts, d.dYaw, d.dPitch);
  }
  runner.tick(endT);
  return { log: runner.log(), state: { adaptedCm360: adapted, blocksDone: state.blocksDone + 1 }, endT };
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
    const d = pursuitStep((r) => trackingTargetAt(spec, r, cfg), rel, runner.state.aim, gain, delayMs, stepMs, k, rng, cfg);
    em.emit(ts, d.dYaw, d.dPitch);
  }
  runner.tick(endT);
  return { log: runner.log(), state: { adaptedCm360: adapted, blocksDone: state.blocksDone + 1 }, endT };
}

/** Plays one block with the simulated player, feeding integer-count moves and clicks into the real runner. Warmup plays like flick. */
export function simulateBlock(spec: BlockSpec, setup: Setup, player: SimPlayer, state: SimState, rng: Rng, cfg: Config, t0: number): SimBlockResult {
  if (spec.kind === 'tracking') return simulateTracking(spec, setup, player, state, rng, cfg, t0);
  if (spec.kind === 'switch') return simulateSwitch(spec, setup, player, state, rng, cfg, t0);
  if (spec.kind === 'trackswitch') return simulateTrackSwitch(spec, setup, player, state, rng, cfg, t0);
  return simulateFlick(spec, setup, player, state, rng, cfg, t0);
}
