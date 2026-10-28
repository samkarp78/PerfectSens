import { useEffect, useState } from 'preact/hooks';
import type { History as HistoryStore, SessionSummary } from '../store/history';
import { fmt, fmtDate } from './format';

export const HISTORY_UNAVAILABLE = "History isn't available in this browser window.";
const MARGIN = 0.05;
const MIN_BAR_PCT = 0.8;
const PCT = 100;

export interface HistoryProps {
  history: HistoryStore | null;
  loading?: boolean;
  onBack(): void;
  onQuickAb(s: SessionSummary): void;
}

const VERDICT_TEXT = { change: 'Change', keep: 'Keep', none: 'No clear winner' } as const;
const spanOf = (s: SessionSummary): [number, number] => s.result.range ?? [s.result.recommendedCm360, s.result.recommendedCm360];

export function History({ history, loading = false, onBack, onQuickAb }: HistoryProps) {
  const [rows, setRows] = useState<SessionSummary[] | null>(null);

  useEffect(() => {
    let live = true;
    history?.list().then((r) => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [history]);

  const full = (rows ?? []).filter((r) => r.mode === 'full' && r.result.range);
  const overlap = full.length >= 2 && full[0]!.result.range![0] <= full[1]!.result.range![1] && full[1]!.result.range![0] <= full[0]!.result.range![1];

  let body;
  if (!history) body = loading ? <p class="muted">Loading…</p> : <p class="note">{HISTORY_UNAVAILABLE}</p>;
  else if (rows === null) body = <p class="muted">Loading…</p>;
  else if (rows.length === 0) body = <p class="muted">No sessions yet.</p>;
  else {
    const spans = rows.map(spanOf);
    const lo = Math.log(Math.min(...spans.map((s) => s[0]))) - MARGIN;
    const hi = Math.log(Math.max(...spans.map((s) => s[1]))) + MARGIN;
    const pos = (cm: number) => ((Math.log(cm) - lo) / (hi - lo || 1)) * PCT;
    body = (
      <>
        {full.length >= 2 && (
          <p class="muted">Your latest two ranges {overlap ? 'overlap, which suggests the result is repeatable' : "don't overlap, so the result may not be repeatable yet"}.</p>
        )}
        <ul class="history">
          {rows.map((s, i) => {
            const [a, b] = spans[i]!;
            return (
              <li key={s.id} class="history-row">
                <div class="history-head">
                  <span>{fmtDate(s.createdAt)}{s.mode === 'quickab' ? ' · quick A/B' : ''}</span>
                  <strong>{VERDICT_TEXT[s.result.verdict]}</strong>
                  <span>{fmt(s.result.recommendedCm360)} cm/360</span>
                  <span class="muted">{s.result.range ? `${fmt(a)} to ${fmt(b)}` : 'no range'}</span>
                </div>
                <div class="bar-track" aria-hidden="true">
                  <div class="bar" style={{ left: `${pos(a)}%`, width: `${Math.max(MIN_BAR_PCT, pos(b) - pos(a))}%` }} />
                </div>
                {s.mode === 'full' && s.result.verdict === 'change' && (
                  <button type="button" class="btn btn-small" onClick={() => onQuickAb(s)}>Quick A/B re-check</button>
                )}
              </li>
            );
          })}
        </ul>
        <p class="legend">Bars share one cm/360 axis (log scale), so overlap shows whether sessions agree.</p>
      </>
    );
  }

  return (
    <main class="page page-wide">
      <h1 class="title">History</h1>
      <section class="panel">{body}</section>
      <div class="actions"><button type="button" class="btn" onClick={onBack}>Back</button></div>
    </main>
  );
}
