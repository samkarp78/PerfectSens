import type { FlickTrial, SwitchBlockLog } from '../core/types';

/** Display-only points. They never feed the measurement and are the same for every sens. */
export const POINTS = {
  hit: 100,
  /** Up to 100 extra points for fast hits, nothing past 1 s. */
  speedBonus: (ms: number): number => Math.max(0, 100 - ms / 10),
  /** Streak multiplier: +10% per hit in a row, capped at ×2. */
  multiplier: (streak: number): number => 1 + Math.min(streak, 10) * 0.1,
  trackPerSecond: 100,
};

/** Grade thresholds on a stretch's mean score vs the calibration round (log ratio). */
const GRADES: [number, string][] = [[0.06, 'S'], [0.02, 'A'], [-0.02, 'B'], [-0.06, 'C']];
export function gradeFor(logS: number): string {
  for (const [min, g] of GRADES) if (logS >= min) return g;
  return 'D';
}

export interface ScoreState { points: number; streak: number; bestStreak: number; hits: number; shots: number }
export interface Stretch { points: number; bestStreak: number; hits: number; shots: number }
export interface ScoreKeeper {
  readonly state: ScoreState;
  hit(ms: number): void;
  miss(): void;
  track(dtMs: number, onTarget: boolean): void;
  /** The totals since the previous call (one stretch between breaks), then starts a new stretch. */
  stretch(): Stretch;
}

export function createScoreKeeper(): ScoreKeeper {
  const s: ScoreState = { points: 0, streak: 0, bestStreak: 0, hits: 0, shots: 0 };
  let mark = { points: 0, hits: 0, shots: 0 };
  let stretchBest = 0;
  return {
    get state() { return { ...s }; },
    hit(ms) {
      s.points += Math.round((POINTS.hit + POINTS.speedBonus(ms)) * POINTS.multiplier(s.streak));
      s.streak++; s.hits++; s.shots++;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      stretchBest = Math.max(stretchBest, s.streak);
    },
    miss() { s.streak = 0; s.shots++; },
    track(dtMs, onTarget) { if (onTarget) s.points += Math.round((POINTS.trackPerSecond * dtMs) / 1000); },
    stretch() {
      const out = { points: s.points - mark.points, bestStreak: stretchBest, hits: s.hits - mark.hits, shots: s.shots - mark.shots };
      mark = { points: s.points, hits: s.hits, shots: s.shots };
      stretchBest = s.streak;
      return out;
    },
  };
}

export interface ShotEvent { hit: boolean; ms: number }

/** Hits and misses from flick trials resolved since index `from` (misclicks and timeouts are misses). */
export function flickEvents(trials: readonly FlickTrial[], from: number): { events: ShotEvent[]; next: number } {
  const events: ShotEvent[] = [];
  let i = from;
  for (; i < trials.length; i++) {
    const t = trials[i]!;
    if (t.hitT === null && !t.timedOut) break;
    for (const c of t.clicks) if (!c.hit) events.push({ hit: false, ms: 0 });
    events.push(t.hitT !== null ? { hit: true, ms: t.hitT - t.spawnT } : { hit: false, ms: 0 });
  }
  return { events, next: i };
}

/** Hits (with the time since the previous kill) and misses from switching clicks since index `from`. */
export function switchEvents(log: Pick<SwitchBlockLog, 't0' | 'kills' | 'clicks'>, from: number): { events: ShotEvent[]; next: number } {
  const events: ShotEvent[] = [];
  let kill = log.clicks.slice(0, from).filter((c) => c.hit).length;
  for (let i = from; i < log.clicks.length; i++) {
    const c = log.clicks[i]!;
    if (!c.hit) { events.push({ hit: false, ms: 0 }); continue; }
    const prev = kill === 0 ? log.t0 : log.kills[kill - 1]!.t;
    events.push({ hit: true, ms: log.kills[kill]!.t - prev });
    kill++;
  }
  return { events, next: log.clicks.length };
}
