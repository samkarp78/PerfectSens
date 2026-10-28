import { applyMove, angleBetween } from '../geometry';
import { makeSwitchTargets } from '../blocks';
import type { Config } from '../config';
import type { Aim, AimSample, BlockSpec, MoveSample, SwitchBlockLog, SwitchClick, SwitchKill } from '../types';

/** Target switching: `active` static targets are up at once; hitting one replaces it with the next seeded target. */
export class SwitchRunner {
  private aim: Aim = { yaw: 0, pitch: 0 };
  private lastKillAim: Aim = { yaw: 0, pitch: 0 };
  private readonly queue: Aim[];
  private next: number;
  private readonly active: Aim[];
  private readonly kills: SwitchKill[] = [];
  private readonly clicks: SwitchClick[] = [];
  private readonly path: AimSample[] = [];
  private readonly endT: number;
  private finished = false;

  constructor(private readonly spec: BlockSpec, private readonly dpc: number, private readonly cfg: Config, private readonly t0: number) {
    this.queue = makeSwitchTargets(spec, cfg);
    this.active = this.queue.slice(0, cfg.switch.active);
    this.next = cfg.switch.active;
    this.endT = t0 + cfg.switch.blockMs;
  }

  get state(): { aim: Aim; targets: Aim[]; kills: number; done: boolean; endsAt: number } {
    return { aim: this.aim, targets: this.finished ? [] : [...this.active], kills: this.kills.length, done: this.finished, endsAt: this.endT };
  }

  private advanceTime(t: number): void {
    if (!this.finished && t >= this.endT) this.finished = true;
  }

  onMove(s: MoveSample): void {
    this.advanceTime(s.t);
    if (this.finished) return;
    this.aim = applyMove(this.aim, s.dx, s.dy, this.dpc);
    this.path.push({ t: s.t, yaw: this.aim.yaw, pitch: this.aim.pitch });
  }

  onClick(t: number): { hit: boolean } {
    this.advanceTime(t);
    if (this.finished) return { hit: false };
    const r = this.cfg.switch.targetRadiusDeg;
    const i = this.active.findIndex((a) => angleBetween(this.aim, a) <= r);
    const hit = i >= 0;
    this.clicks.push({ t, aim: { ...this.aim }, hit });
    if (hit) {
      const target = this.active[i]!;
      this.kills.push({ t, target, from: this.lastKillAim });
      this.lastKillAim = { ...this.aim };
      this.active[i] = this.queue[this.next % this.queue.length]!;
      this.next++;
    }
    return { hit };
  }

  tick(t: number): void { this.advanceTime(t); }

  log(): SwitchBlockLog {
    return { spec: this.spec, t0: this.t0, endT: this.finished ? this.endT : (this.path[this.path.length - 1]?.t ?? this.t0),
      kills: this.kills, clicks: this.clicks, path: this.path };
  }
}
