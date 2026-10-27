import type { AbDecision } from './ab';
import type { Finding } from './diagnose';
import type { FitResult } from './fit';
import type { Setup } from './types';

export type Verdict = 'change' | 'keep' | 'none';
export interface SessionResult {
  verdict: Verdict; currentCm360: number; pickCm360: number; recommendedCm360: number;
  range: [number, number] | null; multiplier: number; newInGameSens: number | null; edge: 'faster' | 'slower' | null;
  lowConfidence: boolean; abSkipped: boolean; ab: AbDecision | null; findings: Finding[];
}

const DECIMAL_SCALE = 100;
const round2 = (x: number): number => Math.round(x * DECIMAL_SCALE) / DECIMAL_SCALE;

export function buildResult(args: {
  setup: Setup; fit: FitResult | null; pickCm360: number; ab: AbDecision | null; abSkipped: boolean; findings: Finding[];
}): SessionResult {
  const { setup, fit, pickCm360, ab, abSkipped, findings } = args;
  const current = setup.cm360;
  const verdict: Verdict = abSkipped ? 'keep' : ab?.decision === 'change' ? 'change' : ab?.decision === 'keep' ? 'keep' : 'none';
  const recommended = verdict === 'change' ? pickCm360 : current;
  const ratio = current / recommended;
  return {
    verdict, currentCm360: current, pickCm360, recommendedCm360: recommended,
    range: fit?.range ?? null,
    multiplier: round2(ratio),
    newInGameSens: setup.inGameSens === null ? null : round2(setup.inGameSens * ratio),
    edge: fit?.edge ?? null,
    lowConfidence: fit?.lowConfidence ?? false,
    abSkipped, ab, findings,
  };
}
