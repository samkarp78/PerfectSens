import type { PartKind } from '../core/config';

/** Small synthesised sound effects (Web Audio; no audio files). Display only: identical for every sens. */
export interface Sounds {
  hit(streak: number): void;
  miss(): void;
  /** Quiet tick while the tracking target is held; rate-limited by the caller. */
  tick(): void;
  /** n: seconds left (5…1), so the beeps rise toward zero; omitted for an uncounted beep. */
  countdown(final: boolean, n?: number | null): void;
  /** A short two-note chime that starts each part; one pitch per part kind. */
  chime(kind: PartKind): void;
  setEnabled(on: boolean): void;
  /** Releases the audio context (when the run screen closes). */
  close(): void;
}

const VOLUME = 0.18;
/** Countdown beeps rise two semitones per second toward zero; the last second is longer, the go beep an octave up. */
const COUNT_BASE_HZ = 440;
const COUNT_FROM = 5;
const SEMITONE = 2 ** (1 / 12);
const COUNT_STEP_SEMITONES = 2;

/** The tone for a countdown beep: n = seconds left (5…1), or null for an uncounted beep; final = the "go" beep. */
export function countdownTone(n: number | null, final: boolean): { hz: number; ms: number } {
  if (final) return { hz: 2 * COUNT_BASE_HZ, ms: 220 };
  if (n === null) return { hz: COUNT_BASE_HZ, ms: 120 };
  const steps = Math.max(0, COUNT_FROM - n);
  return { hz: COUNT_BASE_HZ * SEMITONE ** (COUNT_STEP_SEMITONES * steps), ms: n === 1 ? 200 : 110 };
}
const CHIME_HZ: Record<PartKind, number> = { flick: 523, switch: 659, tracking: 784, trackswitch: 988 };
const CHIME_GAP_MS = 90;
const FIFTH = 1.5;

export function createSounds(enabled: boolean): Sounds {
  let on = enabled;
  let ctx: AudioContext | null = null;
  const audio = (): AudioContext | null => {
    if (!on) return null;
    try {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    } catch { return null; }
  };
  /** One enveloped oscillator note. */
  const note = (freq: number, ms: number, type: OscillatorType, gain: number, slideTo?: number) => {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + ms / 1000);
    g.gain.setValueAtTime(gain * VOLUME, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(g).connect(a.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
  };
  return {
    hit(streak) {
      note(660 + Math.min(streak, 10) * 40, 90, 'triangle', 1, 990 + Math.min(streak, 10) * 40);
      if (streak > 0 && streak % 5 === 0) setTimeout(() => note(1320, 140, 'sine', 0.7), 70);
    },
    miss() { note(180, 120, 'sawtooth', 0.35, 120); },
    tick() { note(1800, 25, 'square', 0.12); },
    countdown(final, n = null) { const t = countdownTone(n, final); note(t.hz, t.ms, 'sine', 0.8); },
    chime(kind) {
      const f = CHIME_HZ[kind];
      note(f, 120, 'sine', 0.7);
      setTimeout(() => note(f * FIFTH, 180, 'sine', 0.6), CHIME_GAP_MS);
    },
    setEnabled(v) { on = v; },
    close() { if (ctx) void ctx.close(); ctx = null; on = false; },
  };
}
