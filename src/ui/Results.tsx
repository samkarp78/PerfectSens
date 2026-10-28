import { defaultConfig } from '../core/config';
import type { FitResult } from '../core/fit';
import type { SessionRecord } from '../store/history';
import { toCsv, toJson } from '../store/export';
import { BlockLog } from './BlockLog';
import { CurveChart } from './CurveChart';
import { SpreadChart } from './SpreadChart';
import { download, fmt } from './format';
import type { ScoreState } from './scoreKeeper';
import { SessionStats } from './SessionStats';
import type { Bests } from '../store/bests';

const TOP_FINDINGS = 2;
const CAVEAT = 'Your current sens has a familiarity advantage in this test, and we have not shown that results here transfer to your in-game performance.';

export interface ResultsProps { rec: SessionRecord; fit: FitResult | null; stats?: ScoreState | null; bests?: Bests | null; saveFailed?: boolean; onAgain(): void; onHistory(): void }
const SAVE_FAILED = "This session couldn't be saved to History.";
const PCT = 100;
const pct = (): number => Math.round(defaultConfig.ab.minEffect * PCT);

function headline(rec: SessionRecord): string {
  const r = rec.result;
  const quick = rec.mode === 'quickab';
  if (r.verdict === 'change') return quick ? `Switch back to ${fmt(r.pickCm360)} cm/360` : `Change to ${fmt(r.recommendedCm360)} cm/360`;
  if (r.verdict === 'keep') return quick ? 'Keep your new sens' : 'Keep your current sens';
  return quick ? 'No clear winner — keep your new sens' : 'No clear winner — keep your current sens';
}

function explainer(rec: SessionRecord): string | null {
  const r = rec.result;
  const P = fmt(r.pickCm360);
  const C = fmt(r.currentCm360);
  if (rec.mode === 'quickab') {
    if (r.verdict === 'change') return `In the blind A/B, your previous sens (${P}) beat your new one (${C}).`;
    if (r.verdict === 'keep') return `In the blind A/B, your new sens (${C}) beat your previous one (${P}).`;
    return `The blind A/B found no clear difference between your new ${C} and previous ${P} cm/360.`;
  }
  if (r.verdict === 'keep') {
    return r.abSkipped
      ? `The best sens we found (${P} cm/360) is within ${pct()}% of your current ${C} cm/360, so switching isn't worth it.`
      : `In the blind A/B, your current ${C} cm/360 beat the dial-in's pick (${P} cm/360).`;
  }
  if (r.verdict === 'none') {
    return `The dial-in leaned towards ${P} cm/360, but the blind A/B couldn't show it beats your current ${C} cm/360 by ${pct()}% or more. Run again another day, or try ${P} for a week and use Quick A/B.`;
  }
  return null;
}

function rangeLine(rec: SessionRecord): string | null {
  const r = rec.result;
  if (!r.range) return null;
  const [a, b] = r.range;
  let t = `In the dial-in, anything from ${fmt(a)} to ${fmt(b)} cm/360 scored within ${pct()}% of the best.`;
  if (r.verdict === 'change') return `${t} Any of these is a fine choice.`;
  if (r.currentCm360 < a || r.currentCm360 > b) {
    const judge = r.verdict === 'keep' ? 'favoured your current sens' : "didn't confirm a real difference";
    t += ` Your current sens was just outside that range, but the blind A/B, which is the final judge, ${judge}.`;
  } else {
    t += ' Your current sens is inside that range.';
  }
  return t;
}

function notes(rec: SessionRecord): string[] {
  const { edge, lowConfidence } = rec.result;
  const dir = edge === 'faster' ? 'faster' : 'slower';
  if (lowConfidence && edge) return [`Low confidence — your best sens may be even ${dir} than we tested. Run again.`];
  if (edge) return [`Your best sens may be even ${dir} than we tested — run again to explore further.`];
  if (lowConfidence) return ['Low confidence — the results were noisy. Treat this as a rough guide.'];
  return [];
}

/** How much of the measured play area a 180° turn uses at the recommended sens. */
function padLine(rec: SessionRecord): string | null {
  const pad = rec.setup.padWidthCm;
  if (!pad) return null;
  const half = rec.result.recommendedCm360 / 2;
  return `A 180° turn at ${fmt(rec.result.recommendedCm360)} cm/360 uses ${fmt(half)} cm of your ${fmt(pad)} cm play area.`;
}

export function Results({ rec, fit, stats = null, bests = null, saveFailed = false, onAgain, onHistory }: ResultsProps) {
  const r = rec.result;
  const why = explainer(rec);
  const range = rangeLine(rec);
  return (
    <main class="page page-wide">
      <h1 class="title">{headline(rec)}</h1>
      {why && <p>{why}</p>}
      {r.verdict === 'change' && (
        <p class="big">
          Multiplier ×{fmt(r.multiplier)}
          {r.newInGameSens !== null && <> · New in-game sens {fmt(r.newInGameSens)}</>}
        </p>
      )}
      {range && <p>{range}</p>}
      {padLine(rec) && <p>{padLine(rec)}</p>}
      {saveFailed && <p class="note">{SAVE_FAILED}</p>}
      {notes(rec).map((n) => <p key={n} class="note">{n}</p>)}

      {stats && bests && <SessionStats stats={stats} bests={bests} />}

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
        <p class="legend">Higher is better. <span class="dot" /> sens you tested · <span class="dot dot-ab" /> A/B check · line = trend across all rounds</p>
      </section>

      <section class="panel">
        <h2>Spread at each sensitivity</h2>
        <SpreadChart steps={rec.steps} current={r.currentCm360} />
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
