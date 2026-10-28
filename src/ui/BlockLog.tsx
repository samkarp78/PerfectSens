import type { SessionRecord } from '../store/history';
import { fmt, fmtOpt } from './format';

/** Maps each A/B decision to the A/B step it was made after, without assuming how many blocks a look holds. */
function abDecisionAt(rec: SessionRecord): Map<number, string> {
  const abOrders = rec.steps.filter((s) => s.stage === 'ab').map((s) => s.order);
  const ds = rec.abDecisions;
  const m = new Map<number, string>();
  ds.forEach((d, i) => {
    const idx = ds.length === 2 && i === 0 ? abOrders.length / 2 - 1 : abOrders.length - 1;
    const order = abOrders[idx];
    if (order !== undefined) m.set(order, `Look ${d.look}: ${d.decision} (Δ ${fmt(d.delta, 3)}, SE ${fmt(d.se, 3)})`);
  });
  return m;
}

export function BlockLog({ rec }: { rec: SessionRecord }) {
  const decisions = abDecisionAt(rec);
  const dialins = rec.steps.filter((s) => s.stage === 'dialin');
  return (
    <details class="panel log">
      <summary>Block log</summary>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>#</th><th>Stage</th><th>cm/360</th><th>Flick TP</th><th>Switch TP</th><th>ToT</th><th>Gain S/M/B</th><th>Corrections</th>
              <th>Spread</th><th>Steering reason</th><th>A/B</th>
            </tr>
          </thead>
          <tbody>
            {rec.steps.map((s) => {
              const steer = s.stage === 'dialin' ? rec.steerLog[dialins.indexOf(s)] : undefined;
              return (
                <tr key={s.order}>
                  <td>{s.order + 1}</td>
                  <td>{s.stage}{s.arm ? ` (${s.arm})` : ''}</td>
                  <td>{fmt(s.cm360)}</td>
                  <td>{fmt(s.flick.tp)}</td>
                  <td>{s.switch ? fmt(s.switch.tp) : ''}</td>
                  <td>{fmt(s.tracking.tot, 3)}</td>
                  <td>{fmtOpt(s.flick.smallGain)} / {fmtOpt(s.flick.mediumGain)} / {fmtOpt(s.flick.bigGain)}</td>
                  <td>{fmt(s.flick.corrections)}</td>
                  <td>{fmt(s.flick.spreadRatio)}</td>
                  <td>{steer?.reason ?? ''}</td>
                  <td>{decisions.get(s.order) ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
