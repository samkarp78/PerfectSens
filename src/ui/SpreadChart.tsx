import { defaultConfig } from '../core/config';
import type { StepResult } from '../core/types';
import { fmt } from './format';

const W = 640, H = 190, PAD = { l: 52, r: 16, t: 14, b: 30 };
const DOT_R = 2.5;
const JITTER = 0.28;
const CLAMP = 0.97;
const MIN_SPAN_DEG = 3;
const TICK_HALF = 0.32;

export interface SpreadColumn {
  cm360: number;
  /** Final-click offset along the flick (deg; + = overshoot). */
  landings: number[];
  /** Mean crosshair lead (+) or lag (−) behind a moving target (deg), and its along-axis RMS; null without tracking. */
  lead: number | null; leadRms: number | null;
}

const mean = (xs: number[]): number | null => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** One column per tested sensitivity (repeat visits pooled), slowest first. */
export function spreadColumns(steps: StepResult[]): SpreadColumn[] {
  const byCm = new Map<string, StepResult[]>();
  for (const s of steps) {
    const k = fmt(s.cm360);
    byCm.set(k, [...(byCm.get(k) ?? []), s]);
  }
  return [...byCm.values()]
    .map((group) => {
      const leads = group.flatMap((s) => [
        ...(s.tracking.n > 0 ? [s.tracking.leadLagDeg] : []),
        ...(s.trackSwitch.n > 0 && s.trackSwitch.leadLagDeg !== null ? [s.trackSwitch.leadLagDeg] : []),
      ]);
      const rms = group.flatMap((s) => (s.tracking.n > 0 && s.tracking.detail.alongRms !== null ? [s.tracking.detail.alongRms] : []));
      return {
        cm360: group[0]!.cm360,
        landings: group.flatMap((s) => s.trials.filter((t) => t.scored && t.endAlong !== null).map((t) => t.endAlong!)),
        lead: mean(leads), leadRms: mean(rms),
      };
    })
    .sort((a, b) => b.cm360 - a.cm360);
}

// Deterministic jitter so dots in a column don't stack on one line.
const jitter = (i: number): number => (((i * 0.6180339887) % 1) - 0.5) * 2 * JITTER;

interface StripProps {
  cols: SpreadColumn[]; current: number; label: string; up: string; down: string;
  span: number; zone: number | null; children: (cx: (i: number) => number, y: (v: number) => number, colW: number) => preact.ComponentChildren;
}

function Strip({ cols, current, label, up, down, span, zone, children }: StripProps) {
  const colW = (W - PAD.l - PAD.r) / cols.length;
  const cx = (i: number) => PAD.l + colW * (i + 0.5);
  const y = (v: number) => PAD.t + (1 - (Math.max(-span * CLAMP, Math.min(span * CLAMP, v)) + span) / (2 * span)) * (H - PAD.t - PAD.b);
  const curI = cols.findIndex((c) => fmt(c.cm360) === fmt(current));
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {curI >= 0 && <rect class="chart-col-current" x={cx(curI) - colW / 2} width={colW} y={PAD.t} height={H - PAD.t - PAD.b} />}
      {zone !== null && <rect class="chart-range" x={PAD.l} width={W - PAD.l - PAD.r} y={y(zone)} height={y(-zone) - y(zone)} />}
      <line class="chart-zero" x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} />
      <text class="chart-tick" x={PAD.l - 6} y={PAD.t + 10} text-anchor="end">{up}</text>
      <text class="chart-tick" x={PAD.l - 6} y={y(0) + 4} text-anchor="end">0°</text>
      <text class="chart-tick" x={PAD.l - 6} y={H - PAD.b - 2} text-anchor="end">{down}</text>
      {cols.map((c, i) => (
        <text key={c.cm360} class={i === curI ? 'chart-marker-label' : 'chart-tick'} x={cx(i)} y={H - PAD.b + 16} text-anchor="middle">
          {i === curI ? `${fmt(c.cm360, 1)}*` : fmt(c.cm360, 1)}
        </text>
      ))}
      {children(cx, y, colW)}
      <text class="chart-axis" x={PAD.l} y={H - 2} text-anchor="start">← slower</text>
      <text class="chart-axis" x={W - PAD.r} y={H - 2} text-anchor="end">faster →</text>
    </svg>
  );
}

export function SpreadChart({ steps, current }: { steps: StepResult[]; current: number }) {
  const cols = spreadColumns(steps);
  if (cols.length === 0) return null;
  const radius = defaultConfig.flick.targetRadiusDeg;

  const allLand = cols.flatMap((c) => c.landings);
  const landSpan = Math.max(MIN_SPAN_DEG, ...allLand.map(Math.abs).sort((a, b) => a - b).slice(0, Math.ceil(allLand.length * 0.95)));
  const hasTracking = cols.some((c) => c.lead !== null);
  const leadSpan = Math.max(1, ...cols.map((c) => Math.abs(c.lead ?? 0) + (c.leadRms ?? 0)));

  return (
    <>
      {allLand.length > 0 && (
        <>
          <h3 class="chart-sub">Flicks: where each click landed</h3>
          <Strip cols={cols} current={current} label="Flick landing spread by sensitivity" up="over" down="short" span={landSpan} zone={radius}>
            {(cx, y, colW) => cols.map((c, i) => (
              <g key={c.cm360}>
                {c.landings.map((v, j) => <circle key={j} class="chart-pt-small" cx={cx(i) + jitter(j) * colW} cy={y(v)} r={DOT_R} />)}
                {c.landings.length > 0 && (
                  <line class="chart-mean" x1={cx(i) - colW * TICK_HALF} x2={cx(i) + colW * TICK_HALF} y1={y(mean(c.landings)!)} y2={y(mean(c.landings)!)}>
                    <title>{`${fmt(c.cm360)} cm/360: average ${fmt(mean(c.landings)!, 1)}° ${mean(c.landings)! >= 0 ? 'over' : 'short'} (${c.landings.length} flicks)`}</title>
                  </line>
                )}
              </g>
            ))}
          </Strip>
          <p class="legend">Band = the target. Dots above it overshot, below it stopped short. Tight column = consistent. Bar = average. * = current sens.</p>
        </>
      )}
      {hasTracking && (
        <>
          <h3 class="chart-sub">Tracking: ahead of or behind the target</h3>
          <Strip cols={cols} current={current} label="Tracking lead and lag by sensitivity" up="ahead" down="behind" span={leadSpan} zone={null}>
            {(cx, y) => cols.map((c, i) => c.lead !== null && (
              <g key={c.cm360}>
                {c.leadRms !== null && <line class="chart-whisker" x1={cx(i)} x2={cx(i)} y1={y(c.lead + c.leadRms)} y2={y(c.lead - c.leadRms)} />}
                <circle class="chart-pt chart-pt-ab" cx={cx(i)} cy={y(c.lead)} r={4.5}>
                  <title>{`${fmt(c.cm360)} cm/360: ${fmt(Math.abs(c.lead), 2)}° ${c.lead >= 0 ? 'ahead' : 'behind'} on average`}</title>
                </circle>
              </g>
            ))}
          </Strip>
          <p class="legend">Dot = average lead or lag. Line = how much it wandered. Closer to 0° with a shorter line is better.</p>
        </>
      )}
    </>
  );
}
