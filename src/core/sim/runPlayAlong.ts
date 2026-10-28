import { defaultConfig, type Config } from '../config';
import { answerFeel, answerHourCheck, createPlayAlong, markBack, startNight, submitTest, testSession,
  type PaSetup, type PaState } from '../playalong/state';
import { createRng } from '../rng';
import { nextBlock, submitBlock } from '../session';
import type { SimPlayer, SimState } from './player';
import { simulateBlock } from './simulate';

const DAY_MS = 86_400_000;

/**
 * Plays a whole Play-Along search with the simulated player. Each test follows a match on its sens, so the player is
 * adapted to it and fresh (no fatigue carried over); familiarity at the default shrinks after the first test, and each
 * night draws its own form. At each hour check it continues another night, up to sim.maxNights, then stops with "done".
 */
export function runPlayAlongSim(setup: PaSetup, player: SimPlayer, seed: number, cfg: Config = defaultConfig):
  { state: PaState; nights: number; testsPerNight: number[] } {
  const sc = cfg.playAlong.sim;
  const rng = createRng(seed).fork('playalong-sim');
  const warmedUp: SimPlayer = { ...player, familiarityBonus: player.familiarityBonus * sc.familiarityShrink };
  const formOf = (): number => Math.exp(rng.normal() * sc.nightSd);
  let s = createPlayAlong(setup, seed, 0, cfg);
  let now = 0, form = formOf();
  const testsPerNight = [0];

  while (s.phase !== 'finished') {
    if (s.phase === 'hourCheck') {
      if (testsPerNight.length >= sc.maxNights) { s = answerHourCheck(s, 'done', now, cfg); break; }
      now += DAY_MS;
      form = formOf();
      testsPerNight.push(0);
      s = startNight(answerHourCheck(s, 'later', now, cfg), now, cfg);
      continue;
    }
    now += sc.matchMs;
    s = answerFeel(markBack(s, now), 'right');
    let session = testSession(s, cfg);
    const p = s.tests.length === 0 ? player : warmedUp;
    let sim: SimState = { adaptedCm360: session.setup.cm360, blocksDone: 0, form };
    let t = now;
    for (let spec = nextBlock(session), i = 0; spec; spec = nextBlock(session), i++) {
      const r = simulateBlock(spec, session.setup, p, sim, rng.fork(`t${s.tests.length}-b${i}`), session._cfg, t);
      sim = { ...r.state, form };
      t = r.endT + cfg.sim.blockGapMs;
      session = submitBlock(session, spec.kind === 'warmup' ? null : r.log);
    }
    now = t;
    // The raw logs are only needed for saving; dropping them keeps long simulator runs light on memory.
    s = submitTest(s, { ...session, logs: { flick: [], switch: [], tracking: [], trackSwitch: [] } }, now, cfg);
    testsPerNight[testsPerNight.length - 1]! += 1;
  }
  return { state: s, nights: testsPerNight.length, testsPerNight };
}
