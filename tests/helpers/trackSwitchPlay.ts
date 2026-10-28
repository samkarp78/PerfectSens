import type { Config } from '../../src/core/config';
import { angleBetween } from '../../src/core/geometry';
import { TrackSwitchRunner } from '../../src/core/run/trackSwitchRunner';
import type { BlockSpec, TrackSwitchBlockLog } from '../../src/core/types';

/** A scripted player: holds the button from `pressAt`, and `gapMs` after each kill (or the start) snaps onto the nearest
 *  target and follows it exactly, 1 ms steps. Returns the runner's log. */
export function playTrackSwitch(spec: BlockSpec, cfg: Config, opts: { dpc?: number; gapMs?: number; press?: boolean } = {}): TrackSwitchBlockLog {
  const dpc = opts.dpc ?? 0.001, gap = opts.gapMs ?? 100;
  const t0 = 1000;
  const r = new TrackSwitchRunner(spec, dpc, cfg, t0);
  if (opts.press !== false) r.onPress(t0);
  let lastKill = t0, kills = 0, slot: number | null = null;
  for (let t = t0 + 1; !r.state.done; t++) {
    if (r.state.kills !== kills) { kills = r.state.kills; lastKill = t; slot = null; }
    if (t - lastKill >= gap) {
      const ts = r.state.targets;
      if (slot === null) slot = ts.reduce((b, x, i) => (angleBetween(r.state.aim, x.aim) < angleBetween(r.state.aim, ts[b]!.aim) ? i : b), 0);
      const goal = ts[slot]!.aim, aim = r.state.aim;
      r.onMove({ t, dx: Math.round((goal.yaw - aim.yaw) / dpc), dy: Math.round(-(goal.pitch - aim.pitch) / dpc) });
    } else r.tick(t);
  }
  return r.log();
}
