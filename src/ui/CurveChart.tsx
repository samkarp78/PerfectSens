import type { FitResult } from '../core/fit';
import type { SessionResult } from '../core/result';
import type { StepResult } from '../core/types';
import { fmt } from './format';

const W = 640, H = 300, PAD = { l: 52, r: 16, t: 22, b: 44 };
const CURVE_POINTS = 60;
const MARGIN = 0.06;
const PCT = 100;
const TARGET_TICKS = 5;
const NICE_STEPS = [1, 2, 2.5, 5, 10];
const LABEL_GAP = 48;

export interface CurveChartProps { steps: StepResult[]; fit: FitResult | null; result: SessionResult }

// Scores are stored as log ratios; show them as plain "% better/worse than your current sens".
const pctOf = (logS: number): number => (Math.exp(logS) - 1) * PCT;
const signed = (v: number): string => `${v > 0 ? '+' : ''}${fmt(v, 0)}%`;

// Round tick values (e.g. 30, 35, 40) that fall inside [lo, hi].
export function niceTicks(lo: number, hi: number, target = TARGET_TICKS): number[] {
  const raw = (hi - lo || 1) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = (NICE_STEPS.find((s) => s * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

export function CurveChart({ steps, fit, result }: CurveChartProps) {
  const cur = result.currentCm360;
  const peak = fit ? result.pickCm360 : null;
  const xsAll = [...steps.map((s) => s.cm360), cur, ...(result.range ?? [])];
  const lx0 = Math.log(Math.min(...xsAll)) - MARGIN, lx1 = Math.log(Math.max(...xsAll)) + MARGIN;
  // Faster (fewer cm/360) sits on the right, so "more sensitivity" reads left to right.
  const x = (cm: number) => PAD.l + ((lx1 - Math.log(cm)) / (lx1 - lx0)) * (W - PAD.l - PAD.r);

  const coef = fit?.coef ?? null;
  const curvePts: { cm: number; y: number }[] = [];
  if (coef) {
    for (let i = 0; i < CURVE_POINTS; i++) {
      const lx = lx0 + ((lx1 - lx0) * i) / (CURVE_POINTS - 1);
      const u = lx - Math.log(cur);
      curvePts.push({ cm: Math.exp(lx), y: pctOf(coef.a + coef.b * u + coef.c * u * u) });
    }
  }
  const ys = [...steps.map((s) => pctOf(s.score.logS)), ...curvePts.map((p) => p.y), 0];
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo || 1) * MARGIN;
  const ya = lo - pad, yb = hi + pad;
  const y = (v: number) => PAD.t + (1 - (v - ya) / (yb - ya)) * (H - PAD.t - PAD.b);

  const xTicks = niceTicks(Math.exp(lx0), Math.exp(lx1));
  const yTicks = niceTicks(ya, yb).filter((v) => v !== 0);
  const top = PAD.t, bottom = H - PAD.b, left = PAD.l, right = W - PAD.r;
  const peakClash = peak !== null && Math.abs(x(peak) - x(cur)) < LABEL_GAP;

  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Score against sensitivity">
      {result.range && (
        <>
          <rect class="chart-range" x={x(result.range[1])} width={x(result.range[0]) - x(result.range[1])} y={top} height={bottom - top} />
          <text class="chart-range-label" x={(x(result.range[0]) + x(result.range[1])) / 2} y={top - 8} text-anchor="middle">your best range</text>
        </>
      )}
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <line class="chart-grid" x1={left} x2={right} y1={y(v)} y2={y(v)} />
          <text class="chart-tick" x={left - 6} y={y(v) + 4} text-anchor="end">{signed(v)}</text>
        </g>
      ))}
      <line class="chart-zero" x1={left} x2={right} y1={y(0)} y2={y(0)} />
      <text class="chart-tick" x={left - 6} y={y(0) + 4} text-anchor="end">0%</text>
      {xTicks.map((v) => <text key={`x${v}`} class="chart-tick" x={x(v)} y={bottom + 16} text-anchor="middle">{fmt(v, 1)}</text>)}

      <line class="chart-current" x1={x(cur)} x2={x(cur)} y1={top} y2={bottom} />
      <text class="chart-marker-label" x={x(cur) - 4} y={bottom - 6} text-anchor="end">current</text>
      {peak !== null && (
        <>
          <line class="chart-peak" x1={x(peak)} x2={x(peak)} y1={top} y2={bottom} />
          <text class="chart-peak-label" x={x(peak) + 4} y={peakClash ? bottom - 20 : bottom - 6} text-anchor="start">{`best ${fmt(peak, 1)}`}</text>
        </>
      )}

      {curvePts.length > 0 && <polyline class="chart-curve" fill="none" points={curvePts.map((p) => `${x(p.cm)},${y(p.y)}`).join(' ')} />}
      {steps.map((s) => (
        <circle key={s.order} class={s.stage === 'ab' ? 'chart-pt chart-pt-ab' : 'chart-pt'} cx={x(s.cm360)} cy={y(pctOf(s.score.logS))} r={4.5}>
          <title>{`${fmt(s.cm360)} cm/360 (${s.stage}${s.arm ? ' ' + s.arm : ''}): ${signed(pctOf(s.score.logS))}`}</title>
        </circle>
      ))}

      <text class="chart-axis" x={left} y={H - 6} text-anchor="start">← slower</text>
      <text class="chart-axis" x={(left + right) / 2} y={H - 6} text-anchor="middle">sensitivity (cm/360)</text>
      <text class="chart-axis" x={right} y={H - 6} text-anchor="end">faster →</text>
      <text class="chart-axis" transform={`translate(12 ${(top + bottom) / 2}) rotate(-90)`} text-anchor="middle">score vs current sens</text>
    </svg>
  );
}
