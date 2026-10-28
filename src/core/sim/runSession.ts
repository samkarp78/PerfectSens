import { defaultConfig, type Config } from '../config';
import { createRng } from '../rng';
import { createSession, nextBlock, submitBlock, type SessionOptions, type SessionState } from '../session';
import type { BlockSpec, FlickBlockLog, Setup, SwitchBlockLog, TrackingBlockLog } from '../types';
import type { SimPlayer, SimState } from './player';
import { simulateBlock } from './simulate';

/** Plays a whole session with the simulated player; blocks are chained in time with `sim.blockGapMs` between them. */
export function runSimSession(setup: Setup, player: SimPlayer, opts: SessionOptions, cfg: Config = defaultConfig):
  { state: SessionState; blocks: { spec: BlockSpec; log: FlickBlockLog | SwitchBlockLog | TrackingBlockLog | null }[] } {
  const root = createRng(opts.seed);
  let state = createSession(setup, opts, cfg);
  let sim: SimState = { adaptedCm360: player.currentCm360, blocksDone: 0 };
  let t = 0;
  const blocks: { spec: BlockSpec; log: FlickBlockLog | SwitchBlockLog | TrackingBlockLog | null }[] = [];
  for (let spec = nextBlock(state); spec; spec = nextBlock(state)) {
    const r = simulateBlock(spec, setup, player, sim, root.fork(`sim-${blocks.length}`), cfg, t);
    sim = r.state;
    t = r.endT + cfg.sim.blockGapMs;
    const log = spec.kind === 'warmup' ? null : r.log;
    blocks.push({ spec, log });
    state = submitBlock(state, log);
  }
  return { state, blocks };
}
