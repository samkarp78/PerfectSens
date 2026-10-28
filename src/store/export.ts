import type { SessionRecord } from './history';

const HEADER = ['session_id', 'stage', 'step', 'arm', 'cm360', 'trial', 'class', 'distance_deg', 'mt_ms', 'first_gain',
  'corrections', 'end_along_deg', 'end_perp_deg', 'hit', 'timed_out', 'scored'];

export function toJson(rec: SessionRecord): string {
  return JSON.stringify(rec);
}

const field = (v: string | number | boolean | null): string => {
  if (v === null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per trial of every step; nulls are empty fields. */
export function toCsv(rec: SessionRecord): string {
  const rows: string[] = [HEADER.join(',')];
  for (const st of rec.steps) {
    for (const t of st.trials) {
      rows.push([rec.id, st.stage, st.order, st.arm, st.cm360, t.index, t.cls, t.distance, t.mtMs, t.firstGain,
        t.corrections, t.endAlong, t.endPerp, t.hit, t.timedOut, t.scored].map(field).join(','));
    }
  }
  return rows.join('\n') + '\n';
}
