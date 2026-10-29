/** The countdown overlay for the run screen. */

export function Countdown({ text, n }: { text: string; n: number }) {
  return (
    <div class="countdown" aria-live="assertive">
      <p class="rest-text">{text}</p>
      <p class="countdown-num">{n}</p>
      <p class="countdown-hint">Esc to pause</p>
    </div>
  );
}

