import type { AbDecision } from './ab';
import type { Finding } from './diagnose';

export type Verdict = 'change' | 'keep' | 'none';
export interface SessionResult {
  verdict: Verdict; currentCm360: number; pickCm360: number; recommendedCm360: number;
  range: [number, number] | null; multiplier: number; newInGameSens: number | null; edge: 'faster' | 'slower' | null;
  lowConfidence: boolean; abSkipped: boolean; ab: AbDecision | null; findings: Finding[];
}

