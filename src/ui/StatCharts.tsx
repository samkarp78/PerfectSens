import type { StepResult } from '../core/types';
import { STATS, statsBySens, type StatDef } from './statsBySens';

export interface StatChartsProps {
  steps: StepResult[];
  /** The player's starting sens, marked on every chart. */
  controlCm360: number;
  /** How a sens is labelled on the x axis (a game number or cm/360). */
  labelOf(cm360: number): string;
}

const W = 300, H = 132, PAD_X = 28, TOP = 26, BOTTOM = 30;
const HINT: Record<StatDef['better'], string> = { up: 'higher is better', down: 'lower is better', zero: 'closer to 0 is better' };
const SAME_TOL = 1e-6;

const fmt = (v: number, unit: string): string =>
  `${Math.abs(v) >= 100 ? Math.round(v) : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)}${unit === '°' || unit === '%' ? unit : ''}`;

function Chart({ def, rows, control, labelOf }: { def: StatDef; rows: ReturnType<typeof statsBySens>; control: number; labelOf(cm: number): string }) {
  const pts = rows.map((r, i) => ({ r, i, v: r.values[def.id] })).filter((p): p is typeof p & { v: number } => p.v !== null);
  const vals = pts.map((p) => p.v);
  let lo = Math.min(...vals, def.signed ? 0 : Infinity), hi = Math.max(...vals, def.signed ? 0 : -Infinity);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (hi === lo) { hi += 1; lo -= def.signed ? 1 : 0; }
  const x = (i: number): number => (rows.length === 1 ? W / 2 : PAD_X + (i * (W - 2 * PAD_X)) / (rows.length - 1));
  const y = (v: number): number => TOP + ((hi - v) * (H - TOP - BOTTOM)) / (hi - lo);
  return (
    <figure class="stat-chart">
      <figcaption><span>{def.label}{def.unit && def.unit !== '%' && def.unit !== '°' ? ` (${def.unit})` : ''}</span>
        <span class="muted"> · {HINT[def.better]}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${def.label} for each sens tested`}>
        {def.signed && <line class="stat-zero" x1={PAD_X / 2} x2={W - PAD_X / 2} y1={y(0)} y2={y(0)} />}
        {pts.length > 1 && <polyline class="stat-line" points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} />}
        {pts.map((p) => {
          const isControl = Math.abs(Math.log(p.r.cm360 / control)) < SAME_TOL;
          return (
            <g key={p.r.cm360}>
              <circle class={isControl ? 'stat-dot stat-dot-control' : 'stat-dot'} cx={x(p.i)} cy={y(p.v)} r={isControl ? 5 : 4} />
              <text class="stat-val" x={x(p.i)} y={y(p.v) - 9} text-anchor="middle">{fmt(p.v, def.unit)}</text>
            </g>
          );
        })}
        {rows.map((r, i) => (
          <text key={r.cm360} class="stat-axis" x={x(i)} y={H - 10} text-anchor="middle">{labelOf(r.cm360)}</text>
        ))}
      </svg>
    </figure>
  );
}

/** One small chart per stat (spec 19.5): every tested sens along the bottom, slowest on the left, the control ringed. */
export function StatCharts({ steps, controlCm360, labelOf }: StatChartsProps) {
  const rows = statsBySens(steps);
  if (rows.length === 0) return null;
  return (
    <section class="panel">
      <h2>Every stat at every sens</h2>
      <p class="legend">Slowest sens on the left, fastest on the right. The ringed dot is your starting sens.</p>
      <div class="stat-grid">
        {STATS.map((def) => <Chart key={def.id} def={def} rows={rows} control={controlCm360} labelOf={labelOf} />)}
      </div>
    </section>
  );
}
