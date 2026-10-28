import { gameSensOf, type GameId } from '../core/playalong/gameSens';
import type { PaResult } from '../core/playalong/state';

/** A sens as the player sets it: the whole Finals number, or cm/360 for other games. */
export function sensText(cm360: number, game: GameId, dpi: number): string {
  return game === 'finals' ? String(gameSensOf(game, cm360, dpi)) : `${cm360.toFixed(1)} cm/360`;
}

export function verdictText(r: PaResult, game: GameId, dpi: number): string {
  const n = sensText(r.recommendedCm360, game, dpi);
  switch (r.kind) {
    case 'change': return `Change to ${n}`;
    case 'keep': return 'Keep your sens';
    case 'none': return r.tieBrokenByFeel ? `No clear winner — ${n} felt better (tie broken by feel)` : 'No clear winner — keep your sens';
    case 'bestGuess': return `Best guess, not confirmed yet: ${n}`;
  }
}

/** The range low to high in the game's numbers (a Finals number falls as cm/360 rises). */
export function rangeText(range: [number, number] | null, game: GameId, dpi: number): string {
  if (!range) return 'Not enough data for a range yet';
  if (game === 'finals') {
    const [a, b] = range.map((cm) => gameSensOf(game, cm, dpi)!).sort((x, y) => x - y);
    return `Likely between ${a} and ${b}`;
  }
  const [a, b] = [...range].sort((x, y) => x - y);
  return `Likely between ${a!.toFixed(1)} and ${b!.toFixed(1)} cm/360`;
}

export function feelFlagText(flag: { cm360: number; feel: 'fast' | 'slow' }, game: GameId, dpi: number): string {
  return `${sensText(flag.cm360, game, dpi)} felt too ${flag.feel} both times`;
}
