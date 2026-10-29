import { makeTrackSwitchTargets, trackSwitchTargetAim } from '../blocks';
import type { Config } from '../config';
import { angleBetween, applyMove } from '../geometry';
import type { Aim, AimSample, BlockSpec, HoldEvent, MoveSample, TrackSwitchBlockLog, TrackSwitchKill, TrackSwitchTarget } from '../types';

/** The target the crosshair damages: the nearest one within `radius`, or null. Only one target takes damage at a time. */
export function damageTarget(aim: Aim, targets: readonly Aim[], radius: number): number | null {
  let best: number | null = null, bestD = Infinity;
  targets.forEach((t, i) => {
    const d = angleBetween(aim, t);
    if (d <= radius && d < bestD) { best = i; bestD = d; }
  });
  return best;
}

interface Slot { target: TrackSwitchTarget; damage: number }

/** Tracking switching: `active` moving targets; holding the button with the crosshair on one deals damage over time.
 *  A target with healthMs of damage dies and the next seeded target spawns in its place. */
export class TrackSwitchRunner {
  private aim: Aim = { yaw: 0, pitch: 0 };
  private readonly queue: { seed: number; origin: Aim }[];
  private readonly targets: TrackSwitchTarget[] = [];
  private readonly slots: Slot[] = [];
  private readonly kills: TrackSwitchKill[] = [];
  private readonly path: AimSample[] = [];
  private readonly holds: HoldEvent[] = [];
  private endT: number;
  private lastT: number;
  private held = false;
  private damaging: number | null = null;
  private finished = false;

  constructor(private readonly spec: BlockSpec, private readonly dpc: number, private readonly cfg: Config, private readonly t0: number) {
    this.queue = makeTrackSwitchTargets(spec, cfg);
    this.endT = t0 + cfg.trackswitch.blockMs;
    this.lastT = t0;
    for (let i = 0; i < cfg.trackswitch.active; i++) this.slots.push({ target: this.spawn(t0), damage: 0 });
  }

  private spawn(t: number): TrackSwitchTarget {
    const i = this.targets.length;
    const q = this.queue[i % this.queue.length]!;
    const target: TrackSwitchTarget = { index: i, seed: q.seed, origin: q.origin, spawnT: t, killT: null };
    this.targets.push(target);
    return target;
  }

  private aimsAt(t: number): Aim[] {
    return this.slots.map((s) => trackSwitchTargetAim(s.target, t, this.cfg));
  }

  /** health: remaining fraction (1 = full). damaging: the slot taking damage now, or null. */
  get state(): { aim: Aim; targets: { aim: Aim; health: number }[]; held: boolean; damaging: number | null; kills: number;
    done: boolean; endsAt: number; scoredFrom: number } {
    const aims = this.aimsAt(this.lastT);
    const hp = this.cfg.trackswitch.healthMs;
    return {
      aim: this.aim, held: this.held, damaging: this.finished ? null : this.damaging, kills: this.kills.length, done: this.finished,
      targets: this.finished ? [] : this.slots.map((s, i) => ({ aim: aims[i]!, health: Math.max(0, 1 - s.damage / hp) })),
      endsAt: this.endT, scoredFrom: this.t0 + this.cfg.trackswitch.leadInMs,
    };
  }

  /** Deals the damage for (lastT, t] with the aim held over that interval, then kills and replaces a finished target. */
  private advanceTime(t: number): void {
    if (this.finished) return;
    const until = Math.min(t, this.endT);
    if (until > this.lastT) {
      const i = this.held ? damageTarget(this.aim, this.aimsAt(until), this.cfg.trackswitch.targetRadiusDeg) : null;
      this.damaging = i;
      if (i !== null) {
        const slot = this.slots[i]!;
        slot.damage += until - this.lastT;
        if (slot.damage >= this.cfg.trackswitch.healthMs) {
          slot.target.killT = until;
          this.kills.push({ t: until, index: slot.target.index, aim: { ...this.aim } });
          this.slots[i] = { target: this.spawn(until), damage: 0 };
          this.damaging = null;
          // Count mode: end after trackswitch.count kills after the lead-in.
          const ts = this.cfg.trackswitch, from = this.t0 + ts.leadInMs;
          if (ts.count > 0 && this.kills.filter((k) => k.t >= from).length >= ts.count) { this.finished = true; this.endT = until; this.lastT = until; return; }
        }
      }
      this.lastT = until;
    }
    if (t >= this.endT) this.finished = true;
  }

  onPress(t: number): void { this.setHeld(t, true); }
  onRelease(t: number): void { this.setHeld(t, false); }

  private setHeld(t: number, down: boolean): void {
    this.advanceTime(t);
    if (this.finished || this.held === down) return;
    this.held = down;
    this.holds.push({ t, down });
  }

  onMove(s: MoveSample): void {
    this.advanceTime(s.t);
    if (this.finished) return;
    this.aim = applyMove(this.aim, s.dx, s.dy, this.dpc);
    this.path.push({ t: s.t, yaw: this.aim.yaw, pitch: this.aim.pitch });
  }

  tick(t: number): void { this.advanceTime(t); }

  log(): TrackSwitchBlockLog {
    return { spec: this.spec, t0: this.t0, endT: this.finished ? this.endT : this.lastT, path: this.path, holds: this.holds,
      targets: this.targets, kills: this.kills };
  }
}
