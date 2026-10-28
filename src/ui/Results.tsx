import type { FitResult } from '../core/fit';
import type { SessionRecord } from '../store/history';
import { toCsv, toJson } from '../store/export';
import { BlockLog } from './BlockLog';
import { CurveChart } from './CurveChart';
import { download, fmt } from './format';

const TOP_FINDINGS = 2;
const CAVEAT = 'Your current sens has a familiarity advantage in this test, and we have not shown that results here transfer to your in-game performance.';

export interface ResultsProps { rec: SessionRecord; fit: FitResult | null; onAgain(): void; onHistory(): void }

function headline(rec: SessionRecord): string {
  const r = rec.result;
  if (r.verdict === 'change') return `Change to ${fmt(r.recommendedCm360)} cm/360`;
  if (r.verdict === 'keep') return 'Keep your current sens';
  return 'No clear winner — keep your current sens';
}

function notes(rec: SessionRecord): string[] {
  const { edge, lowConfidence } = rec.result;
  const dir = edge === 'faster' ? 'faster' : 'slower';
  if (lowConfidence && edge) return [`Low confidence — your best sens may be even ${dir} than we tested. Run again.`];
  if (edge) return [`Your best sens may be even ${dir} than we tested — run again to explore further.`];
  if (lowConfidence) return ['Low confidence — the results were noisy. Treat this as a rough guide.'];
  return [];
}

export function Results({ rec, fit, onAgain, onHistory }: ResultsProps) {
  const r = rec.result;
  return (
    <main class="page page-wide">
      <h1 class="title">{headline(rec)}</h1>
      {r.verdict === 'change' && (
        <p class="big">
          Multiplier ×{fmt(r.multiplier)}
          {r.newInGameSens !== null && <> · New in-game sens {fmt(r.newInGameSens)}</>}
        </p>
      )}
      {r.range && <p>Anything from {fmt(r.range[0])} to {fmt(r.range[1])} cm/360 performs the same for you.</p>}
      {notes(rec).map((n) => <p key={n} class="note">{n}</p>)}

      {r.findings.length > 0 && (
        <section class="panel">
          <h2>What to train</h2>
          <ul class="findings">
            {r.findings.slice(0, TOP_FINDINGS).map((f) => (
              <li key={f.id}>
                {f.label}
                <span class="muted"> Measured {fmt(f.value)} vs threshold {fmt(f.threshold)} (provisional threshold).</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p class="muted">{CAVEAT}</p>

      <section class="panel">
        <h2>Score against sensitivity</h2>
        <CurveChart steps={rec.steps} fit={fit} result={r} />
        <p class="legend"><span class="dot" /> tested · <span class="dot dot-ab" /> A/B · line = fitted curve · band = range · dashed = current</p>
      </section>

      <BlockLog rec={rec} />

      <div class="actions">
        <button type="button" class="btn" onClick={() => download(`bsf-${rec.id}.json`, toJson(rec), 'application/json')}>Export JSON</button>
        <button type="button" class="btn" onClick={() => download(`bsf-${rec.id}.csv`, toCsv(rec), 'text/csv')}>Export CSV</button>
        <button type="button" class="btn btn-primary" onClick={onAgain}>New test</button>
        <button type="button" class="btn" onClick={onHistory}>History</button>
      </div>
    </main>
  );
}
