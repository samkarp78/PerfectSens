import { defaultConfig, type Config } from '../config';
import type { TrialMetrics } from '../measure/flick';
import { measureSwitchTrials } from '../measure/switch';
import type { TrackSwitchKill } from '../measure/trackSwitch';
import type { SessionState } from '../session';

/** One part's grade: the mean item score and its standard error (sd/√n). */
export interface PartGrade { mean: number; se: number; n: number }
export interface PartGrades { flick: PartGrade; switch: PartGrade; tracking: PartGrade; trackswitch: PartGrade }
/** The aim measurements that say which way to move (+ = too fast); null when a part gave none. */
export interface DirectionInputs { overshoot: number | null; leadDeg: number | null; tsLeadDeg: number | null }
export interface Direction extends DirectionInputs { signal: number; dir: 'lower' | 'higher' | 'none' }

const MS_PER_S = 1000;
const PARTS = ['flick', 'switch', 'tracking', 'trackswitch'] as const;

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** |ln(gain ÷ ideal)|, capped; a missing or backwards first move costs the cap. */
function gainCost(gain: number | null, ideal: number, cfg: Config): number {
  const cap = cfg.playAlong.grade.maxGainCost;
  return gain === null || gain <= 0 ? cap : Math.min(cap, Math.abs(Math.log(gain / ideal)));
}

/** Score of one flick or switch (spec 19.1): fast, landing close on the first move, few corrections and misclicks. */
export function aimItem(t: TrialMetrics, cfg: Config = defaultConfig): number {
  const g = cfg.playAlong.grade;
  return -Math.log(t.mtMs / MS_PER_S) - gainCost(t.firstGain, cfg.playAlong.direction.idealGain[t.cls], cfg)
    - g.correctionCost * t.corrections - g.missCost * (t.misses ?? 0);
}

/** Score of one tracking-switching kill: fast lock-on and kill, lock-on landing close. */
export function killItem(k: TrackSwitchKill, cfg: Config = defaultConfig): number {
  return -Math.log((k.acquireMs + k.killMs) / MS_PER_S) - gainCost(k.gain, 1, cfg);
}

export function partGrade(items: number[]): PartGrade {
  const n = items.length;
  if (n === 0) return { mean: 0, se: 0, n: 0 };
  const m = mean(items);
  const sd = n < 2 ? 0 : Math.sqrt(items.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
  return { mean: m, se: sd / Math.sqrt(n), n };
}

/** The four part grades of a finished test block, pooling the items of all its rounds. */
export function partGrades(done: SessionState, cfg: Config = defaultConfig): PartGrades {
  const flick = done.steps.flatMap((st) => st.trials.filter((t) => t.scored)).map((t) => aimItem(t, cfg));
  const sw = done.logs.switch.flatMap((l) => measureSwitchTrials(l, cfg).filter((t) => t.scored)).map((t) => aimItem(t, cfg));
  const kills = done.steps.flatMap((st) => st.trackSwitch.killItems ?? []).map((k) => killItem(k, cfg));
  // Tracking: ln(time on target), averaged over rounds, with its chunk-bootstrap SE.
  const trk = done.steps.map((st) => ({ v: Math.log(Math.max(st.tracking.tot, cfg.score.minTot)), se: st.tracking.logTotSe }));
  const tracking: PartGrade = {
    mean: mean(trk.map((x) => x.v)), se: Math.sqrt(trk.reduce((a, x) => a + x.se ** 2, 0)) / trk.length, n: trk.length,
  };
  return { flick: partGrade(flick), switch: partGrade(sw), tracking, trackswitch: partGrade(kills) };
}

/** The test grade: the average difference from the control's parts (equal weights), with its SE. */
export function testGrade(parts: PartGrades, control: PartGrades): { logS: number; se: number } {
  const diffs = PARTS.map((p) => parts[p].mean - control[p].mean);
  return { logS: mean(diffs), se: Math.sqrt(PARTS.reduce((a, p) => a + parts[p].se ** 2, 0)) / PARTS.length };
}

/** The direction inputs of a finished test block, against the normal human pattern (never the player's own sens). */
export function directionInputs(done: SessionState, cfg: Config = defaultConfig): DirectionInputs {
  const ideal = cfg.playAlong.direction.idealGain;
  const trials = [
    ...done.steps.flatMap((st) => st.trials),
    ...done.logs.switch.flatMap((l) => measureSwitchTrials(l, cfg)),
  ].filter((t) => t.scored && t.firstGain !== null && t.firstGain > 0);
  const avg = (xs: (number | null)[]): number | null => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length === 0 ? null : mean(v);
  };
  return {
    overshoot: trials.length === 0 ? null : mean(trials.map((t) => Math.log(t.firstGain! / ideal[t.cls]))),
    leadDeg: avg(done.steps.map((st) => (st.tracking.n > 0 ? st.tracking.leadLagDeg : null))),
    tsLeadDeg: avg(done.steps.map((st) => st.trackSwitch.leadLagDeg)),
  };
}

/** Which way to move (spec 19.2): the average of the scaled signals; past the threshold, + means test lower. */
export function directionSignal(d: DirectionInputs, cfg: Config = defaultConfig): Direction {
  const c = cfg.playAlong.direction;
  const parts = [
    d.overshoot === null ? null : d.overshoot / c.gainScale,
    d.leadDeg === null ? null : d.leadDeg / c.leadScaleDeg,
    d.tsLeadDeg === null ? null : d.tsLeadDeg / c.leadScaleDeg,
  ].filter((x): x is number => x !== null);
  const signal = parts.length === 0 ? 0 : mean(parts);
  return { ...d, signal, dir: signal > c.threshold ? 'lower' : signal < -c.threshold ? 'higher' : 'none' };
}
