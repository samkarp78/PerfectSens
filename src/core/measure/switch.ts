import { classify } from '../blocks';
import type { Config } from '../config';
import { alongPerp, angleBetween } from '../geometry';
import type { Rng } from '../rng';
import type { SwitchBlockLog } from '../types';
import { summarizeFlick, type FlickSummary, type TrialMetrics } from './flick';
import { segmentSubmovements } from './submovements';

/** Switching is measured like flicks (each switch is a trial), plus click accounting.
 *  misclickAlong: mean along offset of missed clicks against their switch's from→target line (+ = overshooting misses). */
export type SwitchSummary = FlickSummary & {
  kills: number; clicks: number; accuracy: number; misclickRate: number; misclickAlong: number | null;
};

/** One flick-style record per completed switch (previous kill → this kill). The intended target is the one killed next;
 *  the first click in the switch gives the end point, so a first-click miss counts in the spread. */
export function measureSwitchTrials(log: SwitchBlockLog, cfg: Config): TrialMetrics[] {
  return log.kills.map((k, i) => {
    const prevT = i === 0 ? log.t0 : log.kills[i - 1]!.t;
    const distance = angleBetween(k.from, k.target);
    const subs = segmentSubmovements(log.path, prevT, k.t, k.from, cfg);
    const click = log.clicks.find((c) => c.t > prevT && c.t <= k.t);
    const end = click ? alongPerp(k.from, k.target, click.aim) : null;
    return {
      index: i, cls: classify(distance, cfg), distance, mtMs: k.t - prevT,
      firstGain: subs.length > 0 && distance > 0 ? alongPerp(k.from, k.target, subs[0]!.to).along / distance : null,
      corrections: Math.max(0, subs.length - 1),
      endAlong: end ? end.along - distance : null, endPerp: end ? end.perp : null,
      hit: true, timedOut: false, scored: i >= cfg.switch.warmKills,
    };
  });
}

export function measureSwitch(log: SwitchBlockLog, cfg: Config, rng: Rng): SwitchSummary {
  const summary = summarizeFlick(measureSwitchTrials(log, cfg), cfg, rng);
  const misses: number[] = [];
  log.kills.forEach((k, i) => {
    const prevT = i === 0 ? log.t0 : log.kills[i - 1]!.t;
    for (const c of log.clicks) {
      if (!c.hit && c.t > prevT && c.t <= k.t) misses.push(alongPerp(k.from, k.target, c.aim).along - angleBetween(k.from, k.target));
    }
  });
  const clicks = log.clicks.length;
  const hits = log.clicks.filter((c) => c.hit).length;
  return {
    ...summary, kills: log.kills.length, clicks,
    accuracy: clicks > 0 ? hits / clicks : 0,
    misclickRate: clicks > 0 ? (clicks - hits) / clicks : 0,
    misclickAlong: misses.length > 0 ? misses.reduce((a, b) => a + b, 0) / misses.length : null,
  };
}
