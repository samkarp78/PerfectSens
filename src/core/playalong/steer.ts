import { defaultConfig, type Config } from '../config';
import { maxTestCm360 } from '../steer';
import { cm360ToFinals, finalsToCm360, sameSens, snapCm360, type GameId } from './gameSens';

/** Inputs for one higher/lower pair. testedCm360: every sens tested so far (the centre included). */
export interface PairContext { game: GameId; dpi: number; defaultCm360: number; padWidthCm: number;
  centerCm360: number; step: number; testedCm360: number[] }
/** targets: faster side first, then slower (the caller randomises the play order); exhausted when none are left. */
export interface PairDecision { targets: number[]; step: number; exhausted: boolean; reason: string }

type Side = 'faster' | 'slower';

/** The next pair's step: half the last one, down to playAlong.minStep. */
export function nextStep(step: number, cfg: Config = defaultConfig): number {
  return Math.max(cfg.playAlong.minStep, step / 2);
}

export function choosePair(ctx: PairContext, cfg: Config = defaultConfig): PairDecision {
  const { game, dpi, centerCm360: center, step } = ctx;
  const same = (a: number, b: number): boolean => sameSens(game, a, b);
  const used = (v: number): boolean => same(v, center) || ctx.testedCm360.some((t) => same(v, t));
  const slowest = maxTestCm360(ctx.defaultCm360, ctx.padWidthCm, cfg);
  const padCapped = 2 * cfg.pad.turnFraction * ctx.padWidthCm < cfg.steer.limits.max * ctx.defaultCm360;
  const fastest = cfg.steer.limits.min * ctx.defaultCm360;
  const notes: string[] = [];

  const pick = (side: Side): number | null => {
    const raw = side === 'faster' ? center / (1 + step) : center * (1 + step);
    let v = snapCm360(game, raw, dpi, side, cfg);
    if (game === 'finals' && used(v)) {
      const n = Math.round(cm360ToFinals(v, dpi, cfg)) + (side === 'faster' ? 1 : -1);
      v = finalsToCm360(Math.max(1, n), dpi, cfg);
      notes.push(`${side}: moved one number out`);
    }
    if (side === 'slower' && v > slowest) {
      v = snapCm360(game, slowest, dpi, 'faster', cfg);
      notes.push(padCapped ? 'slower: capped by the pad' : 'slower: capped by the limit');
    }
    if (side === 'faster' && v < fastest) {
      v = snapCm360(game, fastest, dpi, 'slower', cfg);
      notes.push('faster: capped by the limit');
    }
    if (used(v)) { notes.push(`${side}: skipped (already tested)`); return null; }
    return v;
  };

  const faster = pick('faster');
  let slower = pick('slower');
  if (faster !== null && slower !== null && same(faster, slower)) { slower = null; notes.push('slower: skipped (same as faster)'); }
  const targets = [faster, slower].filter((v): v is number => v !== null);
  return { targets, step, exhausted: targets.length === 0, reason: notes.length ? notes.join('; ') : `±${Math.round(step * 100)}%` };
}
