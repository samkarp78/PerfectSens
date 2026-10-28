/** Small synthesised sound effects (Web Audio; no audio files). Display only: identical for every sens. */
export interface Sounds {
  hit(streak: number): void;
  miss(): void;
  /** Quiet tick while the tracking target is held; rate-limited by the caller. */
  tick(): void;
  countdown(final: boolean): void;
  setEnabled(on: boolean): void;
}

const VOLUME = 0.18;

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
    countdown(final) { note(final ? 880 : 440, final ? 220 : 120, 'sine', 0.8); },
    setEnabled(v) { on = v; },
  };
}
