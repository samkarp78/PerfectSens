import './styles.css';
import { sameSens } from '../core/playalong/gameSens';
import type { PaTest } from '../core/playalong/state';
import type { SessionRecord } from '../store/history';
import { toJson } from '../store/export';
import { download, fmt } from './format';
import { feelFlagText, sensText, spreadText, verdictText } from './playAlongText';
import { gameSensOf } from '../core/playalong/gameSens';
import { StatCharts } from './StatCharts';

const TOP_FINDINGS = 2;
const FEEL_TEXT = { fast: 'too fast', slow: 'too slow', right: 'about right' } as const;
const CAVEAT = 'Each sens was tested after a real match on it. A "change" is only given after a head-to-head against your own sens on the same night.';

export interface PlayAlongResultsProps { rec: SessionRecord; onAgain(): void; onHistory(): void }

export function PlayAlongResults({ rec, onAgain, onHistory }: PlayAlongResultsProps) {
  const pa = rec.playAlong!;
  const { game, dpi, defaultCm360 } = pa.setup;
  const r = pa.result;
  // One row per tested sens, in the order first tested.
  const bySens: PaTest[][] = [];
  for (const t of pa.tests) {
    const row = bySens.find((ts) => sameSens(game, ts[0]!.cm360, t.cm360));
    if (row) row.push(t); else bySens.push([t]);
  }
  return (
    <main class="page">
      <p class="pa-label">{pa.setup.quick ? 'Quick try · not a real answer' : <>Play-Along · {pa.nights.length} night{pa.nights.length === 1 ? '' : 's'}</>}</p>
      <h1 class="title">{verdictText(r, game, dpi)}</h1>
      <p class="lede">{spreadText(r.rangeCm360, game, dpi)}.{game === 'finals' && <> Recommended: {fmt(r.recommendedCm360)} cm/360.</>}</p>
      {r.kind === 'bestGuess' && !pa.setup.quick && (
        <div class="notice"><p>Confirm it next time: Play-Along will start with a head-to-head between this sens and your own.</p></div>
      )}
      {r.feelFlags.length > 0 && (
        <section class="panel">
          <h2>How it felt</h2>
          <ul class="findings">
            {r.feelFlags.map((f) => <li key={`${f.cm360}-${f.feel}`}>{feelFlagText(f, game, dpi)}.
              {sameSens(game, f.cm360, r.recommendedCm360) && <span class="muted"> You played well on it, but it didn't feel right. Consider a step toward your own sens and give it a week.</span>}</li>)}
          </ul>
        </section>
      )}
      <section class="panel">
        <h2>Sens you tested</h2>
        <table class="pa-table">
          <thead><tr><th>Sens</th><th>cm/360</th><th>Nights</th><th>Felt</th></tr></thead>
          <tbody>
            {bySens.map((ts) => (
              <tr key={ts[0]!.id}>
                <td>{sensText(ts[0]!.cm360, game, dpi)}{sameSens(game, ts[0]!.cm360, defaultCm360) ? ' (yours)' : ''}</td>
                <td>{fmt(ts[0]!.cm360)}</td>
                <td>{[...new Set(ts.map((t) => t.night + 1))].join(', ')}</td>
                <td>{ts.map((t) => FEEL_TEXT[t.feel]).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <StatCharts steps={pa.tests.flatMap((t) => t.steps)} controlCm360={defaultCm360}
        labelOf={(cm) => (game === 'finals' ? String(gameSensOf(game, cm, dpi)) : cm.toFixed(1))} />
      {r.findings.length > 0 && (
        <section class="panel">
          <h2>What to train</h2>
          <ul class="findings">
            {r.findings.slice(0, TOP_FINDINGS).map((f) => (
              <li key={f.id}>{f.label}<span class="muted"> Measured {fmt(f.value)} vs threshold {fmt(f.threshold)} (provisional threshold).</span></li>
            ))}
          </ul>
        </section>
      )}
      <p class="muted">{CAVEAT}</p>
      <div class="actions">
        <button type="button" class="btn" onClick={() => download(`bsf-${rec.id}.json`, toJson(rec), 'application/json')}>Export JSON</button>
        <button type="button" class="btn btn-primary" onClick={onAgain}>Done</button>
        <button type="button" class="btn" onClick={onHistory}>History</button>
      </div>
    </main>
  );
}
