import { defaultConfig, type Config } from '../core/config';
import type { FlickClass, StepResult } from '../core/types';

export type StatId = 'overshoot' | 'corrections' | 'timeToHit' | 'misclicks' | 'onTarget' | 'lead' | 'lockOn' | 'tsLead';
/** signed: values around a zero line (+ = too fast); better: which way is better, for the chart hint. */
export interface StatDef { id: StatId; label: string; unit: string; signed: boolean; better: 'up' | 'down' | 'zero' }

/** The end-screen stats (spec 19.5), in display order. */
export const STATS: StatDef[] = [
  { id: 'overshoot', label: 'First move: overshoot (+) / undershoot (−)', unit: '%', signed: true, better: 'zero' },
  { id: 'corrections', label: 'Corrections per target', unit: '', signed: false, better: 'down' },
  { id: 'timeToHit', label: 'Time to hit', unit: 'ms', signed: false, better: 'down' },
  { id: 'misclicks', label: 'Misclicks per target', unit: '', signed: false, better: 'down' },
  { id: 'onTarget', label: 'Tracking: time on target', unit: '%', signed: false, better: 'up' },
  { id: 'lead', label: 'Tracking: ahead (+) / behind (−)', unit: '°', signed: true, better: 'zero' },
  { id: 'lockOn', label: 'Tracking switching: lock-on time', unit: 'ms', signed: false, better: 'down' },
  { id: 'tsLead', label: 'Tracking switching: ahead (+) / behind (−)', unit: '°', signed: true, better: 'zero' },
];

export interface SensStats { cm360: number; values: Record<StatId, number | null> }

const CLASSES: FlickClass[] = ['small', 'medium', 'big'];
/** Rounds at cm/360 values this close (relative) are the same sens. */
const SAME_TOL = 1e-6;
const PCT = 100;

const avg = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
};

/** One round's overshoot: first-move gain against the normal landing point per distance class, as a % (0 = normal). */
function overshoot(st: StepResult, cfg: Config): number | null {
  const ideal = cfg.playAlong.direction.idealGain;
  const gain = (cls: FlickClass, s: StepResult['flick']): number | null =>
    cls === 'small' ? s.smallGain : cls === 'medium' ? s.mediumGain : s.bigGain;
  return avg(CLASSES.flatMap((cls) => [st.flick, st.switch].map((s) => {
    const g = gain(cls, s);
    return g === null ? null : (g / ideal[cls] - 1) * PCT;
  })));
}

function roundValues(st: StepResult, cfg: Config): Record<StatId, number | null> {
  const scored = st.trials.filter((t) => t.scored);
  return {
    overshoot: overshoot(st, cfg),
    corrections: avg([st.flick.corrections, st.switch.corrections]),
    timeToHit: avg(scored.filter((t) => t.hit).map((t) => t.mtMs)),
    misclicks: avg(scored.map((t) => t.misses)),
    onTarget: st.tracking.n > 0 ? st.tracking.tot * PCT : null,
    lead: st.tracking.n > 0 ? st.tracking.leadLagDeg : null,
    lockOn: st.trackSwitch.acquireMs,
    tsLead: st.trackSwitch.leadLagDeg,
  };
}

/** Every stat for each tested sens (rounds at the same sens averaged), slowest sens first. */
export function statsBySens(steps: StepResult[], cfg: Config = defaultConfig): SensStats[] {
  const groups: StepResult[][] = [];
  for (const st of steps) {
    const g = groups.find((x) => Math.abs(Math.log(x[0]!.cm360 / st.cm360)) < SAME_TOL);
    if (g) g.push(st); else groups.push([st]);
  }
  return groups
    .map((g) => {
      const per = g.map((st) => roundValues(st, cfg));
      const values = Object.fromEntries(STATS.map((s) => [s.id, avg(per.map((p) => p[s.id]))])) as Record<StatId, number | null>;
      return { cm360: g[0]!.cm360, values };
    })
    .sort((a, b) => b.cm360 - a.cm360);
}
