import type { Stretch } from './scoreKeeper';

/** Overlay cards for the run screen: rest/pause, break, the A/B question and the countdown. */

const EXTEND_TEXT = {
  close: 'Close result — play 4 more rounds (about 4 min) for a firmer answer?',
  ahead: 'Your new sens is ahead — play 4 more rounds (about 4 min) to confirm it?',
} as const;

export function Countdown({ text, n }: { text: string; n: number }) {
  return (
    <div class="countdown" aria-live="assertive">
      <p class="rest-text">{text}</p>
      <p class="countdown-num">{n}</p>
      <p class="countdown-hint">Esc to pause</p>
    </div>
  );
}

/** reason: why the session asks — 'ahead' when the first round favoured the new sens (a change needs both rounds). */
export function AskCard({ reason, onAnswer }: { reason: 'ahead' | 'close'; onAnswer(accept: boolean): void }) {
  return (
    <div class="rest-overlay">
      <div class="rest-card rest-ask">
        <p class="rest-text">{EXTEND_TEXT[reason]}</p>
        <div class="ask-buttons">
          <button type="button" class="btn btn-primary" onClick={() => onAnswer(true)}>Play 4 more</button>
          <button type="button" class="btn" onClick={() => onAnswer(false)}>Finish now</button>
        </div>
      </div>
    </div>
  );
}

/** grade is null when there is no calibration round to compare against (Quick A/B). */
export interface BreakStats extends Stretch { grade: string | null }

export function BreakCard({ stats, onContinue }: { stats: BreakStats | null; onContinue(): void }) {
  const acc = stats && stats.shots > 0 ? Math.round((100 * stats.hits) / stats.shots) : null;
  return (
    <div class="break-body" role="button" tabIndex={0} onClick={onContinue}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) onContinue(); }}>
      <p class="break-title">Break</p>
      {stats && (
        <div class="break-stats">
          {stats.grade && <div><span class="break-grade">{stats.grade}</span><span class="break-label">Grade</span></div>}
          <div><span class="break-num">{stats.points.toLocaleString()}</span><span class="break-label">Points</span></div>
          <div><span class="break-num">×{stats.bestStreak}</span><span class="break-label">Best streak</span></div>
          {acc !== null && <div><span class="break-num">{acc}%</span><span class="break-label">Accuracy</span></div>}
        </div>
      )}
      <p class="rest-text">Shake out your hand. Click to continue when you're ready.</p>
    </div>
  );
}
