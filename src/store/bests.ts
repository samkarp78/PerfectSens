/** Personal bests for the display-only game score, kept in this browser. */
export interface Bests { points: number; bestStreak: number; newPoints: boolean; newStreak: boolean }

const KEY = 'bsf.bests';

/** Merges a finished session's score into the stored bests and says which records it set. */
export function recordBests(s: { points: number; bestStreak: number }): Bests {
  let prev = { points: 0, bestStreak: 0 };
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v.points === 'number' && typeof v.bestStreak === 'number') prev = v;
  } catch { /* storage unavailable: compare against nothing */ }
  const next = { points: Math.max(prev.points, s.points), bestStreak: Math.max(prev.bestStreak, s.bestStreak) };
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(next)); } catch { /* keep going without saving */ }
  return { ...next, newPoints: s.points > prev.points, newStreak: s.bestStreak > prev.bestStreak };
}
