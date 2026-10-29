import { describe, it, expect } from 'vitest';
import { finalsToCm360 } from '../../src/core/playalong/gameSens';
import type { PaResult } from '../../src/core/playalong/state';
import { feelFlagText, rangeText, spreadText, verdictText } from '../../src/ui/playAlongText';

const f = (n: number): number => finalsToCm360(n, 800);
const result = (o: Partial<PaResult>): PaResult => ({
  kind: 'change', recommendedCm360: f(30), recommendedGameSens: 30, rangeCm360: [f(37), f(32)], tieBrokenByFeel: false,
  feelFlags: [], h2h: null, findings: [], ...o,
});

describe('verdictText', () => {
  it('names the Finals number for each verdict', () => {
    expect(verdictText(result({}), 'finals', 800)).toBe('Change to 30');
    expect(verdictText(result({ kind: 'keep' }), 'finals', 800)).toBe('Keep your sens');
    expect(verdictText(result({ kind: 'none' }), 'finals', 800)).toBe('No clear winner — best guess 30, not confirmed');
    expect(verdictText(result({ kind: 'none', tieBrokenByFeel: true }), 'finals', 800)).toBe('No clear winner — 30 felt better (tie broken by feel)');
    expect(verdictText(result({ kind: 'bestGuess' }), 'finals', 800)).toBe('Best guess, not confirmed yet: 30');
  });
  it('uses cm/360 for other games', () => {
    expect(verdictText(result({ recommendedCm360: 28.04, recommendedGameSens: null }), 'other', 800)).toBe('Change to 28.0 cm/360');
  });
});

describe('rangeText', () => {
  it('shows whole Finals numbers low to high', () => {
    expect(rangeText([f(37), f(32)], 'finals', 800)).toBe('Likely between 32 and 37');
  });
  it('shows cm/360 for other games', () => {
    expect(rangeText([28.12, 33.0], 'other', 800)).toBe('Likely between 28.1 and 33.0 cm/360');
  });
  it('says so when there is no range yet', () => {
    expect(rangeText(null, 'finals', 800)).toBe('Not enough data for a range yet');
  });
});

describe('feelFlagText', () => {
  it('describes a repeated feel answer', () => {
    expect(feelFlagText({ cm360: f(30), feel: 'slow' }, 'finals', 800)).toBe('30 felt too slow both times');
    expect(feelFlagText({ cm360: 28, feel: 'fast' }, 'other', 800)).toBe('28.0 cm/360 felt too fast both times');
  });
});

describe('spreadText', () => {
  it('says plainly which sens perform about the same', () => {
    expect(spreadText([f(44), f(38)], 'finals', 800)).toBe('Anything from 38 to 44 performs about the same for you');
    expect(spreadText([28.12, 33.0], 'other', 800)).toBe('Anything from 28.1 to 33.0 cm/360 performs about the same for you');
  });
  it('a single sens reads as a clear answer', () => {
    expect(spreadText([f(40), f(40)], 'finals', 800)).toBe('40 is clearly your best');
  });
  it('says so when there is no range', () => {
    expect(spreadText(null, 'finals', 800)).toBe('Not enough data to say how sure this is yet');
  });
});
