import { beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultSimPlayer } from '../../src/core/sim/player';
import { runSimSession } from '../../src/core/sim/runSession';
import type { Setup } from '../../src/core/types';
import { recordFromSession, type SessionRecord } from '../../src/store/history';
import { toCsv, toJson } from '../../src/store/export';

const setup: Setup = { dpi: 800, cm360: 34.29, inGameSens: null, fov: 103, fovType: 'horizontal', mode: 'default' };
const HEADER = 'session_id,stage,step,arm,cm360,trial,class,distance_deg,mt_ms,first_gain,corrections,end_along_deg,end_perp_deg,hit,timed_out,scored';
let rec: SessionRecord;

beforeAll(() => {
  const { state } = runSimSession(setup, defaultSimPlayer(34.29), { seed: 7, warmup: false, quickAbCm360: null });
  rec = recordFromSession(state, new Date('2026-10-27T10:00:00Z'), 'sess-1');
});

describe('toCsv', () => {
  it('starts with the header and has one row per trial', () => {
    const lines = toCsv(rec).trimEnd().split('\n');
    expect(lines[0]).toBe(HEADER);
    const total = rec.steps.reduce((n, s) => n + s.trials.length, 0);
    expect(total).toBeGreaterThan(0);
    expect(lines.length - 1).toBe(total);
  });

  it('writes null first_gain as an empty field and uses step order, empty arm', () => {
    const base = rec.steps[0]!;
    const trial = { ...base.trials[0]!, firstGain: null };
    const r: SessionRecord = { ...rec, steps: [{ ...base, arm: null, order: 3, trials: [trial] }] };
    const cols = toCsv(r).trimEnd().split('\n')[1]!.split(',');
    expect(cols[0]).toBe('sess-1');
    expect(cols[2]).toBe('3');
    expect(cols[3]).toBe('');
    expect(cols[9]).toBe('');
    expect(['true', 'false']).toContain(cols[13]);
  });

  it('quotes fields with commas or quotes per RFC 4180', () => {
    const r: SessionRecord = { ...rec, id: 'a,"b"', steps: [{ ...rec.steps[0]!, trials: [rec.steps[0]!.trials[0]!] }] };
    expect(toCsv(r).split('\n')[1]!.startsWith('"a,""b""",')).toBe(true);
  });
});

describe('toJson', () => {
  it('round-trips', () => {
    expect(JSON.parse(toJson(rec))).toEqual(rec);
  });
});

