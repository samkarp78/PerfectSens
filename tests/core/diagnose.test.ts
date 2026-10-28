import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { diagnose } from '../../src/core/diagnose';
import type { FlickSummary } from '../../src/core/measure/flick';
import type { TrackingSummary } from '../../src/core/measure/tracking';

const flick = (o: Partial<FlickSummary> = {}): FlickSummary => ({
  tp: defaultConfig.diagnose.refTp, logTpSe: 0.01, smallGain: 1.0, mediumGain: 1.0, bigGain: 1.0, corrections: 0.5, weDeg: 1,
  spreadRatio: 0.8, timeoutFraction: 0, n: 30, ...o,
});
const track = (o: Partial<TrackingSummary> = {}): TrackingSummary => ({ tot: defaultConfig.diagnose.refTot, logTotSe: 0.01, leadLagDeg: 0, n: 1, ...o });
const cfg = defaultConfig;

describe('diagnose', () => {
  it('flags only spread when it alone is out of bounds', () => {
    const f = diagnose([flick({ spreadRatio: 1.4 })], [track()], cfg);
    expect(f).toHaveLength(1);
    expect(f[0]!.id).toBe('spread');
    expect(f[0]!.severity).toBeCloseTo(0.4, 6);
    expect(f[0]!.label).toBe('Landing spread — train precision on small static targets.');
  });
  it('returns [] when nothing is out of bounds', () => expect(diagnose([flick()], [track()], cfg)).toEqual([]));
  it('sorts by severity descending', () => {
    const f = diagnose([flick({ spreadRatio: 1.2, corrections: 2.0, smallGain: 1.1, bigGain: 0.5 })], [track()], cfg);
    const sev = f.map((x) => x.severity);
    expect([...sev].sort((a, b) => b - a)).toEqual(sev);
    expect(f.map((x) => x.id)).toEqual(['corrections', 'bigShort', 'spread', 'smallOvershoot']);
  });
  it('flags tracking weaker and flicking weaker with rel', () => {
    const ref = cfg.diagnose.refTot;
    const tw = diagnose([flick()], [track({ tot: 0.6 * ref })], cfg);
    expect(tw.map((x) => x.id)).toEqual(['trackingWeaker']);
    expect(tw[0]!.value).toBeCloseTo(0.6, 6);
    expect(tw[0]!.threshold).toBeCloseTo(0.85, 6);
    expect(tw[0]!.severity).toBeCloseTo(0.85 / 0.6 - 1, 6);
    const fw = diagnose([flick()], [track({ tot: 1.4 * ref })], cfg);
    expect(fw.map((x) => x.id)).toEqual(['flickingWeaker']);
    expect(fw[0]!.threshold).toBeCloseTo(1.15, 6);
    expect(fw[0]!.severity).toBeCloseTo(1.4 / 1.15 - 1, 6);
  });
  it('averages inputs and skips null gains', () => {
    const f = diagnose([flick({ smallGain: null, bigGain: 0.5 }), flick({ smallGain: null, bigGain: null })], [track()], cfg);
    expect(f.map((x) => x.id)).toEqual(['bigShort']);
    expect(f[0]!.value).toBeCloseTo(0.5, 6);
    expect(f[0]!.severity).toBeCloseTo(cfg.diagnose.bigGainMin / 0.5 - 1, 6);
  });
  it('handles empty inputs', () => {
    expect(diagnose([], [], cfg)).toEqual([]);
    expect(diagnose([], [track({ tot: 0.1 })], cfg)).toEqual([]);
    expect(diagnose([flick({ spreadRatio: 2 })], [], cfg).map((x) => x.id)).toEqual(['spread']);
  });
});
