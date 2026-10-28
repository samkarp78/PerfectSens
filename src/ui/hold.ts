/** Progress of a press-and-hold: downAt null when not pressed. Done once held for holdMs. */
export function holdProgress(downAt: number | null, now: number, holdMs: number): { fraction: number; done: boolean } {
  if (downAt === null) return { fraction: 0, done: false };
  const fraction = Math.min(1, Math.max(0, (now - downAt) / holdMs));
  return { fraction, done: fraction >= 1 };
}
