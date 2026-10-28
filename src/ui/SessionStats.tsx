import type { Bests } from '../store/bests';
import type { ScoreState } from './scoreKeeper';

/** End-of-session game stats with personal bests (display only; not part of the recommendation). */
export function SessionStats({ stats, bests }: { stats: ScoreState; bests: Bests }) {
  const acc = stats.shots > 0 ? Math.round((100 * stats.hits) / stats.shots) : null;
  return (
    <section class="panel">
      <h2>Your session</h2>
      <div class="break-stats">
        <div><span class="break-num">{stats.points.toLocaleString()}</span><span class="break-label">Points{bests.newPoints ? ' · new best!' : ''}</span></div>
        <div><span class="break-num">×{stats.bestStreak}</span><span class="break-label">Best streak{bests.newStreak ? ' · new best!' : ''}</span></div>
        {acc !== null && <div><span class="break-num">{acc}%</span><span class="break-label">Accuracy</span></div>}
      </div>
      <p class="field-hint">Personal bests: {bests.points.toLocaleString()} points · ×{bests.bestStreak} streak</p>
    </section>
  );
}
