import type { FitResult } from '../core/fit';
import type { SessionResult } from '../core/result';
import type { StepResult } from '../core/types';
import { fmt } from './format';

const W = 640, H = 300, PAD = { l: 52, r: 16, t: 14, b: 40 };
const CURVE_POINTS = 60;
const MARGIN = 0.06;
const PCT = 100;
const TICKS = 5;

export interface CurveChartProps { steps: StepResult[]; fit: FitResult | null; result: SessionResult }

export function CurveChart({ steps, fit, result }: CurveChartProps) {
  const cur = result.currentCm360;
  const xsAll = [...steps.map((s) => s.cm360), cur, ...(result.range ?? [])];
  const lx0 = Math.log(Math.min(...xsAll)) - MARGIN, lx1 = Math.log(Math.max(...xsAll)) + MARGIN;
  const x = (cm: number) => PAD.l + ((Math.log(cm) - lx0) / (lx1 - lx0)) * (W - PAD.l - PAD.r);

  const coef = fit?.coef ?? null;
  const curvePts: { cm: number; y: number }[] = [];
  if (coef) {
    for (let i = 0; i < CURVE_POINTS; i++) {
      const lx = lx0 + ((lx1 - lx0) * i) / (CURVE_POINTS - 1);
      const u = lx - Math.log(cur);
      curvePts.push({ cm: Math.exp(lx), y: (coef.a + coef.b * u + coef.c * u * u) * PCT });
    }
  }
  const ys = [...steps.map((s) => s.score.logS * PCT), ...curvePts.map((p) => p.y), 0];
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo || 1) * MARGIN;
  const ya = lo - pad, yb = hi + pad;
  const y = (v: number) => PAD.t + (1 - (v - ya) / (yb - ya)) * (H - PAD.t - PAD.b);

  const xTicks = Array.from({ length: TICKS }, (_, i) => Math.exp(lx0 + ((lx1 - lx0) * i) / (TICKS - 1)));
  const yTicks = Array.from({ length: TICKS }, (_, i) => ya + ((yb - ya) * i) / (TICKS - 1));

  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Score against sensitivity">
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <line class="chart-grid" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
          <text class="chart-tick" x={PAD.l - 6} y={y(v) + 4} text-anchor="end">{fmt(v, 1)}</text>
        </g>
      ))}
      {xTicks.map((v) => <text key={`x${v}`} class="chart-tick" x={x(v)} y={H - PAD.b + 16} text-anchor="middle">{fmt(v, 1)}</text>)}
      {result.range && (
        <rect class="chart-range" x={x(result.range[0])} width={x(result.range[1]) - x(result.range[0])} y={PAD.t} height={H - PAD.t - PAD.b} />
      )}
      <line class="chart-current" x1={x(cur)} x2={x(cur)} y1={PAD.t} y2={H - PAD.b} />
      <text class="chart-tick" x={x(cur)} y={PAD.t + 10} text-anchor="middle">current</text>
      {curvePts.length > 0 && <polyline class="chart-curve" fill="none" points={curvePts.map((p) => `${x(p.cm)},${y(p.y)}`).join(' ')} />}
      {steps.map((s) => (
        <circle key={s.order} class={s.stage === 'ab' ? 'chart-pt chart-pt-ab' : 'chart-pt'} cx={x(s.cm360)} cy={y(s.score.logS * PCT)} r={4.5}>
          <title>{`${fmt(s.cm360)} cm/360 (${s.stage}${s.arm ? ' ' + s.arm : ''}): ${fmt(s.score.logS * PCT)}%`}</title>
        </circle>
      ))}
      <text class="chart-axis" x={(PAD.l + W - PAD.r) / 2} y={H - 6} text-anchor="middle">cm/360 (log scale)</text>
      <text class="chart-axis" transform={`translate(12 ${(PAD.t + H - PAD.b) / 2}) rotate(-90)`} text-anchor="middle">score vs baseline (log %)</text>
    </svg>
  );
}
