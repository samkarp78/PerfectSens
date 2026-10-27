import { applyMove, angleBetween } from '../geometry';
import { makeFlickTargets } from '../blocks';
import type { Config } from '../config';
import type { Aim, BlockSpec, FlickBlockLog, FlickTarget, FlickTrial, AimSample, MoveSample } from '../types';

export class FlickRunner {
  private aim: Aim = { yaw: 0, pitch: 0 };
  private readonly targets: FlickTarget[];
  private readonly trials: FlickTrial[] = [];
  private readonly path: AimSample[] = [];
  private readonly warmupEnd: number | null;
  private resolved = 0;
  private finished = false;

  constructor(private readonly spec: BlockSpec, private readonly dpc: number, private readonly cfg: Config, private readonly t0: number) {
    this.targets = makeFlickTargets(spec, cfg);
    this.warmupEnd = spec.kind === 'warmup' ? t0 + cfg.session.warmupMs : null;
    this.spawn(t0);
  }

  get state(): { aim: Aim; target: FlickTarget | null; trialIndex: number; total: number; done: boolean } {
    return { aim: this.aim, target: this.finished ? null : (this.targets[this.resolved] ?? null), trialIndex: this.resolved, total: this.targets.length, done: this.finished };
  }

  private get current(): FlickTrial {
    const trial = this.trials[this.trials.length - 1];
    if (!trial) throw new Error('FlickRunner: no active trial');
    return trial;
  }

  private spawn(t: number): void {
    const target = this.targets[this.resolved];
    if (!target) throw new Error('FlickRunner: no target to spawn');
    this.trials.push({ target, spawnT: t, spawnAim: { ...this.aim }, clicks: [], hitT: null, timedOut: false });
  }

  private advance(t: number): void {
    this.resolved++;
    if (this.resolved >= this.targets.length) this.finished = true;
    else this.spawn(t);
  }

  private processTimeouts(t: number): void {
    while (!this.finished) {
      const trial = this.current;
      const due = trial.spawnT + this.cfg.flick.timeoutMs;
      if (this.warmupEnd !== null && this.warmupEnd <= due && this.warmupEnd <= t) { this.finished = true; return; }
      if (due > t) break;
      trial.timedOut = true;
      this.advance(due);
    }
    if (!this.finished && this.warmupEnd !== null && t >= this.warmupEnd) this.finished = true;
  }

  onMove(s: MoveSample): void {
    this.processTimeouts(s.t);
    if (this.finished) return;
    this.aim = applyMove(this.aim, s.dx, s.dy, this.dpc);
    this.path.push({ t: s.t, yaw: this.aim.yaw, pitch: this.aim.pitch });
  }

  onClick(t: number): { hit: boolean } {
    this.processTimeouts(t);
    if (this.finished) return { hit: false };
    const trial = this.current;
    const hit = angleBetween(this.aim, trial.target.aim) <= this.cfg.flick.targetRadiusDeg;
    trial.clicks.push({ t, aim: { ...this.aim }, hit });
    if (hit) {
      trial.hitT = t;
      this.advance(t);
    }
    return { hit };
  }

  tick(t: number): void {
    this.processTimeouts(t);
  }

  log(): FlickBlockLog {
    return { spec: this.spec, t0: this.t0, trials: this.trials, path: this.path };
  }
}
