import { applyMove, angleBetween } from '../geometry';
import { trackingTargetAt } from '../blocks';
import type { Config } from '../config';
import type { Aim, AimSample, BlockSpec, HoldEvent, MoveSample, TrackingBlockLog } from '../types';

export class TrackingRunner {
  private aim: Aim;
  private targetAim: Aim;
  private readonly path: AimSample[] = [];
  private readonly endT: number;
  private lastT: number;
  private finished = false;
  private held = false;
  private readonly holds: HoldEvent[] = [];

  constructor(private readonly spec: BlockSpec, private readonly dpc: number, private readonly cfg: Config, private readonly t0: number) {
    this.aim = trackingTargetAt(spec, 0, cfg);
    this.targetAim = this.aim;
    this.endT = t0 + cfg.tracking.leadInMs + cfg.tracking.durationMs;
    this.lastT = t0;
  }

  get state(): { aim: Aim; targetAim: Aim; held: boolean; onTarget: boolean; done: boolean } {
    const near = angleBetween(this.aim, this.targetAim) <= this.cfg.tracking.targetRadiusDeg;
    return { aim: this.aim, targetAim: this.targetAim, held: this.held, onTarget: this.held && near, done: this.finished };
  }

  onPress(t: number): void { this.setHeld(t, true); }
  onRelease(t: number): void { this.setHeld(t, false); }

  private setHeld(t: number, down: boolean): void {
    this.advanceTime(t);
    if (this.finished || this.held === down) return;
    this.held = down;
    this.holds.push({ t, down });
  }

  private advanceTime(t: number): void {
    if (this.finished) return;
    if (t >= this.endT) { this.finished = true; this.lastT = this.endT; return; }
    this.lastT = t;
    this.targetAim = trackingTargetAt(this.spec, t - this.t0, this.cfg);
  }

  onMove(s: MoveSample): void {
    if (this.finished) return;
    this.advanceTime(s.t);
    if (this.finished) return;
    this.aim = applyMove(this.aim, s.dx, s.dy, this.dpc);
    this.path.push({ t: s.t, yaw: this.aim.yaw, pitch: this.aim.pitch });
  }

  tick(t: number): void {
    this.advanceTime(t);
  }

  log(): TrackingBlockLog {
    return { spec: this.spec, t0: this.t0, endT: this.finished ? this.endT : this.lastT, path: this.path, holds: this.holds };
  }
}
