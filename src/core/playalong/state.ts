import { decideAB, type AbBlock, type AbDecision } from '../ab';
import { configForPlayAlong, defaultConfig, type Config } from '../config';
import { diagnose, type Finding } from '../diagnose';
import { fitCurve, type FitPoint, type FitResult } from '../fit';
import { createRng, type Rng } from '../rng';
import type { ScoreBaseline } from '../score';
import { createSession, type SessionState } from '../session';
import type { FovType, Setup, StepResult } from '../types';
import { gameSensOf, sameSens, snapCm360, type GameId } from './gameSens';
import { directionInputs, directionSignal, partGrades, testGrade, type Direction, type PartGrades } from './grade';
import { choosePair, nextStep, type PairDecision } from './steer';

/** The player's answer to "How did that feel?". */
export type Feel = 'fast' | 'slow' | 'right';
export type PaPhase = 'waiting' | 'feel' | 'testing' | 'hourCheck' | 'finished';
/** quick: a quick try (a short demo of the flow), never saved and never a real answer. sitting: the one-sitting test,
 *  Play-Along without the matches (one round per test, tests back to back). */
export interface PaSetup { game: GameId; dpi: number; defaultCm360: number; padWidthCm: number; fov: number; fovType: FovType; quick?: boolean; sitting?: boolean }
/** default: the night-1 opener; pair: a higher/lower test; h2h: the head-to-head; anchor: the default re-tested to open a later night. */
export type TestRole = 'default' | 'pair' | 'h2h' | 'anchor';
export interface QueueItem { cm360: number; role: TestRole }
export interface PaTest { id: string; night: number; indexInNight: number; cm360: number; role: TestRole; feel: Feel;
  awayMs: number; finishedAt: number; steps: StepResult[]; logS: number; se: number; parts: PartGrades; direction: Direction }
/** bestGuess ("I'm done" before the head-to-head) is not a change verdict and carries no false-change guarantee. */
export interface PaResult { kind: 'change' | 'keep' | 'none' | 'bestGuess'; recommendedCm360: number; recommendedGameSens: number | null;
  rangeCm360: [number, number] | null; tieBrokenByFeel: boolean; feelFlags: { cm360: number; feel: 'fast' | 'slow' }[];
  h2h: AbDecision | null; findings: Finding[] }
/** A test that was started but not finished (the player quit or closed the app); nothing of it is scored. */
export interface DiscardedTest { cm360: number; night: number; at: number; phase: 'feel' | 'testing' }
/** The whole search, saved between tests and nights. step: the step of the latest pair. logs: raw logs per test id.
 *  hourCheckedNight: the night whose hour check was already answered (searches saved before it existed lack the field,
 *  as they lack discarded). */
export interface PaState { version: 2; setup: PaSetup; seed: number; createdAt: number; phase: PaPhase;
  nights: { startedAt: number }[]; tests: PaTest[]; queue: QueueItem[]; step: number;
  h2h: { leaderCm360: number; testIds: string[] } | null; h2hTonight: number; waitingSince: number;
  pendingFeel: Feel | null; pendingAwayMs: number; steerLog: PairDecision[]; result: PaResult | null;
  logs: Record<string, SessionState['logs']>; hourCheckedNight?: number; discarded?: DiscardedTest[] }

const SEED_RANGE = 2 ** 31;
const DAY_MS = 86_400_000;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const COIN_HALF = 0.5;

const rootFork = (s: PaState, label: string): Rng => createRng(s.seed).fork(label);
const same = (s: PaState, a: number, b: number): boolean => sameSens(s.setup.game, a, b);
const testsAt = (s: PaState, cm: number): PaTest[] => s.tests.filter((t) => same(s, t.cm360, cm));
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function createPlayAlong(setup: PaSetup, seed: number, now: number, cfg: Config = defaultConfig): PaState {
  return {
    version: 2, setup, seed, createdAt: now, phase: 'waiting', nights: [{ startedAt: now }], tests: [],
    queue: [{ cm360: setup.defaultCm360, role: 'default' }], step: cfg.playAlong.firstStep, h2h: null, h2hTonight: 0,
    waitingSince: now, pendingFeel: null, pendingAwayMs: 0, steerLog: [], result: null, logs: {},
  };
}

/** 'Sens A', 'Sens B', … by first appearance (tests, then the queue); the default is A. */
export function sensLabel(s: PaState, cm360: number): string {
  const seen: number[] = [];
  for (const cm of [s.setup.defaultCm360, ...s.tests.map((t) => t.cm360), ...s.queue.map((q) => q.cm360)]) {
    if (!seen.some((x) => same(s, x, cm))) seen.push(cm);
  }
  const i = seen.findIndex((x) => same(s, x, cm360));
  const n = i < 0 ? seen.length : i;
  return `Sens ${n < LETTERS.length ? LETTERS[n] : n + 1}`;
}

export function currentTarget(s: PaState): { cm360: number; gameSens: number | null; label: string } | null {
  const head = s.queue[0];
  if (!head || s.phase === 'finished') return null;
  return { cm360: head.cm360, gameSens: gameSensOf(s.setup.game, head.cm360, s.setup.dpi), label: sensLabel(s, head.cm360) };
}

export function markBack(s: PaState, now: number): PaState {
  if (s.phase !== 'waiting') throw new Error(`markBack: phase is ${s.phase}`);
  return { ...s, phase: 'feel', pendingAwayMs: now - s.waitingSince };
}

export function answerFeel(s: PaState, feel: Feel): PaState {
  if (s.phase !== 'feel') throw new Error(`answerFeel: phase is ${s.phase}`);
  return { ...s, phase: 'testing', pendingFeel: feel };
}

function scoreBaseline(s: PaState): ScoreBaseline | null {
  const st = s.tests[0]?.steps[0];
  return st ? { tp: st.flick.tp, switchTp: st.switch.tp, tot: st.tracking.tot, dmg: st.trackSwitch.dmg } : null;
}

/** The settings a search runs with: a quick try swaps in its short tests (one round, short lead-in, small counts). */
function paConfig(s: PaState, cfg: Config): Config {
  if (s.setup.sitting) return { ...cfg, playAlong: { ...cfg.playAlong, roundsPerTest: 1 } } as unknown as Config;
  if (!s.setup.quick) return cfg;
  const q = cfg.playAlong.quick;
  return { ...cfg, playAlong: { ...cfg.playAlong, roundsPerTest: 1, partMs: q.trackingMs,
    counts: { ...cfg.playAlong.counts, ...q.counts } } } as unknown as Config; // the literal-typed config can't express other values
}

/** The fixed-mode session (lead-in + rounds) for the queue head. */
export function testSession(s: PaState, base: Config = defaultConfig): SessionState {
  const cfg = paConfig(s, base);
  const head = s.queue[0];
  if (!head) throw new Error('testSession: nothing queued');
  const { dpi, fov, fovType, padWidthCm } = s.setup;
  const setup: Setup = { dpi, cm360: head.cm360, inGameSens: null, fov, fovType, mode: 'default', padWidthCm };
  // sameTargets: one seed for every test, so every sens is measured on the identical target list.
  const seed = Math.floor(rootFork(s, cfg.playAlong.sameTargets ? 'test' : `test-${s.tests.length}`).next() * SEED_RANGE);
  // No lead-in: the first wave of flicks (and the first switching kills) are the uncounted warm-up.
  return createSession(setup, { seed, warmup: false, rounds: cfg.playAlong.roundsPerTest, scoreBaseline: scoreBaseline(s) },
    configForPlayAlong(cfg));
}

export function abandonTest(s: PaState, now: number): PaState {
  if (s.phase !== 'testing' && s.phase !== 'feel') return s;
  const head = s.queue[0]!;
  const discarded: DiscardedTest = { cm360: head.cm360, night: s.nights.length - 1, at: now, phase: s.phase };
  return { ...s, phase: 'waiting', pendingFeel: null, waitingSince: now, discarded: [...(s.discarded ?? []), discarded] };
}

export function submitTest(s: PaState, done: SessionState, now: number, cfg: Config = defaultConfig): PaState {
  if (s.phase !== 'testing') throw new Error(`submitTest: phase is ${s.phase}`);
  if (!done.done || done.steps.length === 0) throw new Error('submitTest: the test block is not finished');
  const head = s.queue[0]!;
  const night = s.nights.length - 1;
  const id = `t${s.tests.length}`;
  // The grade is against the control's first test (the first test of the search, on the starting sens).
  const parts = partGrades(done, cfg);
  const grade = testGrade(parts, s.tests[0]?.parts ?? parts);
  const test: PaTest = {
    id, night, indexInNight: s.tests.filter((t) => t.night === night).length, cm360: head.cm360, role: head.role,
    feel: s.pendingFeel ?? 'right', awayMs: s.pendingAwayMs, finishedAt: now, steps: done.steps,
    logS: grade.logS, se: grade.se, parts, direction: directionSignal(directionInputs(done, cfg), cfg),
  };
  const h2h = s.h2h && head.role === 'h2h' ? { ...s.h2h, testIds: [...s.h2h.testIds, id] } : s.h2h;
  const tests = relativeDirections([...s.tests, test], cfg);
  const next = plan({ ...s, tests, queue: s.queue.slice(1), h2h, pendingFeel: null,
    logs: { ...s.logs, [id]: done.logs } }, cfg);
  if (next.phase === 'finished') return next;
  // A quick try and the one-sitting test give their answer after a set number of tests.
  const cap = s.setup.quick ? cfg.playAlong.quick.tests : s.setup.sitting ? cfg.playAlong.sitting.tests : Infinity;
  if (next.tests.length >= cap) return finish({ ...next, queue: [] }, 'bestGuess', null, cfg);
  // Once per night, and never between the two tests of a head-to-head.
  const hour = now - s.nights[night]!.startedAt >= cfg.playAlong.hourCheckMs && s.hourCheckedNight !== night
    && next.queue[0]?.role !== 'h2h';
  return { ...next, phase: hour ? 'hourCheck' : 'waiting', waitingSince: now };
}

export function paFit(s: PaState, cfg: Config = defaultConfig): FitResult | null {
  if (s.tests.length === 0) return null;
  const points: FitPoint[] = s.tests.map((t) => ({
    x: Math.log(t.cm360), y: t.logS, se: t.se, t: t.indexInNight * cfg.playAlong.testTimeScale,
    isCurrent: same(s, t.cm360, s.setup.defaultCm360), night: t.night,
  }));
  return fitCurve(points, Math.log(s.setup.defaultCm360), cfg, rootFork(s, `fit-${s.tests.length}`));
}

/** The current best sens: the snapped fit pick when the fit is trustworthy, else the best-scoring test. */
function leader(s: PaState, cfg: Config): number {
  const fit = paFit(s, cfg);
  if (fit && fit.usable && !fit.lowConfidence) return snapCm360(s.setup.game, fit.pickCm360, s.setup.dpi, 'nearest', cfg);
  let best = s.tests[0]!;
  for (const t of s.tests) if (t.logS > best.logS) best = t;
  return best.cm360;
}

function shuffled<T>(s: PaState, items: T[], label: string): T[] {
  return rootFork(s, label).next() < COIN_HALF ? items : [...items].reverse();
}

/**
 * Direction (spec 19.2): the centre's latest test says which way to go. Overshooting or running ahead (too fast) moves
 * the centre half a step slower (a higher cm/360); undershooting or trailing, half a step faster.
 */
/** Each test keeps its raw lag measurements, but its direction (dir, signal) is judged against the player's own average
 *  lag across the search, recomputed as tests are added. */
function relativeDirections(tests: PaTest[], cfg: Config): PaTest[] {
  const avgOf = (key: 'leadDeg' | 'tsLeadDeg'): number => {
    const v = tests.map((t) => t.direction[key]).filter((x): x is number => x !== null);
    return v.length === 0 ? 0 : mean(v);
  };
  const lead = avgOf('leadDeg'), ts = avgOf('tsLeadDeg');
  return tests.map((t) => {
    const d = t.direction;
    const rel = directionSignal({ overshoot: d.overshoot, leadDeg: d.leadDeg === null ? null : d.leadDeg - lead,
      tsLeadDeg: d.tsLeadDeg === null ? null : d.tsLeadDeg - ts }, cfg);
    return { ...t, direction: { ...d, signal: rel.signal, dir: rel.dir } };
  });
}

export function directionNudge(s: PaState, center: number, step: number = s.step, cfg: Config = defaultConfig): { cm360: number; reason: string } {
  const at = testsAt(s, center);
  const raw = at[at.length - 1]?.direction;
  if (!raw) return { cm360: center, reason: '' };
  // Everyone trails a moving target a little; lag only counts beyond this player's own average across the search.
  const avgOf = (key: 'leadDeg' | 'tsLeadDeg'): number => {
    const v = s.tests.map((t) => t.direction[key]).filter((x): x is number => x !== null);
    return v.length === 0 ? 0 : mean(v);
  };
  const d = directionSignal({
    overshoot: raw.overshoot,
    leadDeg: raw.leadDeg === null ? null : raw.leadDeg - avgOf('leadDeg'),
    tsLeadDeg: raw.tsLeadDeg === null ? null : raw.tsLeadDeg - avgOf('tsLeadDeg'),
  }, cfg);
  if (d.dir === 'none') return { cm360: center, reason: '' };
  const k = d.dir === 'lower' ? 1 : -1;
  const why = d.dir === 'lower' ? 'Overshooting or running ahead on the best sens' : 'Undershooting or trailing on the best sens';
  return { cm360: center * (1 + step / 2) ** k, reason: `${why} → centre moved ${d.dir === 'lower' ? 'slower' : 'faster'}` };
}

function queuePair(s: PaState, center: number, step: number, cfg: Config, note = '', allowRetest = false): PaState | null {  const d = choosePair({ game: s.setup.game, dpi: s.setup.dpi, defaultCm360: s.setup.defaultCm360, padWidthCm: s.setup.padWidthCm,    centerCm360: center, step, testedCm360: s.tests.map((t) => t.cm360), allowRetest }, cfg);
  if (d.exhausted) return null;
  const queue = shuffled(s, d.targets.map((cm360): QueueItem => ({ cm360, role: 'pair' })), `order-${s.tests.length}`);
  return { ...s, step, queue, steerLog: [...s.steerLog, note ? { ...d, reason: `${note}; ${d.reason}` } : d] };
}

/** leadCm360: the sens to confirm (a best guess's recommendation); the current leader when omitted. */
function startH2h(s: PaState, cfg: Config, leadCm360?: number): PaState {
  const lead = leadCm360 ?? leader(s, cfg);
  if (same(s, lead, s.setup.defaultCm360)) return finish(s, 'keep', null, cfg);
  const per = cfg.playAlong.h2hBlocksPerSide;
  const items: QueueItem[] = [];
  for (let i = 0; i < per; i++) items.push({ cm360: lead, role: 'h2h' }, { cm360: s.setup.defaultCm360, role: 'h2h' });
  const queue = shuffled(s, items, `h2h-${s.tests.length}`);
  return { ...s, queue, h2h: { leaderCm360: lead, testIds: [] }, h2hTonight: s.h2hTonight + 1 };
}

function decideH2h(s: PaState, cfg: Config): PaState {
  const h = s.h2h!;
  const def = s.setup.defaultCm360;
  // Only the head-to-head's own fresh, same-night tests decide: earlier tests of the leader are why it was chosen
  // (selection bias), and tests from other nights carry that night's form.
  const own = s.tests.filter((t) => h.testIds.includes(t.id));
  const blocks: AbBlock[] = own.map((t): AbBlock => ({ arm: same(s, t.cm360, def) ? 'C' : 'P', logS: t.logS, se: t.se }));
  const side = (cm: number): number => mean(own.filter((t) => same(s, t.cm360, cm)).map((t) => t.logS));
  const h2hDelta = side(h.leaderCm360) - side(def);
  const decision = decideAB(blocks, 2, { ...cfg, ab: { ...cfg.ab, z: cfg.playAlong.z } } as Config, h2hDelta);
  const now = leader(s, cfg);
  if (!same(s, now, h.leaderCm360) && !same(s, now, def) && s.h2hTonight < cfg.playAlong.maxH2hPerNight) return startH2h(s, cfg);
  return finish(s, decision.decision === 'change' ? 'change' : decision.decision === 'keep' ? 'keep' : 'none', decision, cfg);
}

/** What comes next once the queue is empty. */
function plan(s: PaState, cfg: Config): PaState {
  if (s.queue.length > 0) return s;
  const last = s.tests[s.tests.length - 1]!;
  if (last.role === 'h2h' && s.h2h) return decideH2h(s, cfg);
  const pairsPlayed = s.tests.some((t) => t.role === 'pair');
  if (!pairsPlayed) return queuePair(s, s.setup.defaultCm360, cfg.playAlong.firstStep, cfg) ?? startH2h(s, cfg);
  // Edge rule: if the best sens so far is the fastest or slowest tested, keep the step and walk on outward.
  const lead = leader(s, cfg);
  const tested = s.tests.map((t) => t.cm360);
  const atEdge = same(s, lead, Math.min(...tested)) || same(s, lead, Math.max(...tested));
  if (!atEdge && s.step <= cfg.playAlong.minStep) {
    // At the smallest step: run the final check once the range is tight (about ±5%); until then keep testing next to
    // the best, re-testing nearby sens for more data. The player can stop any night at the hour check.
    const range = paFit(s, cfg)?.range;
    if (range && Math.max(...range) / Math.min(...range) - 1 <= cfg.playAlong.tightRange) return startH2h(s, cfg);
    return queuePair(s, lead, s.step, cfg, 'Range still wide: testing next to the best', true) ?? startH2h(s, cfg);
  }
  const step = atEdge ? s.step : nextStep(s.step, cfg);
  const nudge = directionNudge(s, lead, step, cfg);
  return queuePair(s, nudge.cm360, step, cfg, nudge.reason) ?? startH2h({ ...s, step }, cfg);
}

const allRight = (ts: PaTest[]): boolean => ts.length > 0 && ts.every((t) => t.feel === 'right');

/** Sens that felt too fast (or too slow) on two or more separate matches. */
export function feelFlagsOf(tests: PaTest[], game: GameId): { cm360: number; feel: 'fast' | 'slow' }[] {
  const flags: { cm360: number; feel: 'fast' | 'slow' }[] = [];
  for (const t of tests) {
    if (t.feel === 'right' || flags.some((f) => sameSens(game, f.cm360, t.cm360) && f.feel === t.feel)) continue;
    const n = tests.filter((u) => sameSens(game, u.cm360, t.cm360) && u.feel === t.feel).length;
    if (n >= 2) flags.push({ cm360: t.cm360, feel: t.feel });
  }
  return flags;
}

/** Without a range: the best-scoring test, but among the tests within noise of it, one that felt 'About right' wins. */
function nearTiePick(s: PaState, cfg: Config): number {
  const best = s.tests.reduce((a, t) => (t.logS > a.logS ? t : a));
  const tied = s.tests.filter((t) => t.logS >= best.logS - Math.hypot(best.se, t.se) && allRight(testsAt(s, t.cm360)));
  if (tied.length === 0) return leader(s, cfg);
  return tied.reduce((a, t) => (t.logS > a.logS ? t : a)).cm360;
}

function bestGuess(s: PaState, fit: FitResult | null, cfg: Config): number {
  const range = fit?.range;
  if (!range) return nearTiePick(s, cfg);
  const [lo, hi] = range;
  const inRange = s.tests.filter((t) => t.cm360 >= lo && t.cm360 <= hi && allRight(testsAt(s, t.cm360)));
  if (inRange.length > 0) {
    const pick = fit!.pickCm360;
    return inRange.reduce((a, t) => (Math.abs(Math.log(t.cm360 / pick)) < Math.abs(Math.log(a.cm360 / pick)) ? t : a)).cm360;
  }
  return snapCm360(s.setup.game, Math.sqrt(lo * hi), s.setup.dpi, 'nearest', cfg);
}

function finish(s: PaState, kind: PaResult['kind'], h2h: AbDecision | null, cfg: Config): PaState {
  const def = s.setup.defaultCm360;
  const fit = paFit(s, cfg);
  let rec = def;
  let tieBrokenByFeel = false;
  if (kind === 'change') rec = s.h2h!.leaderCm360;
  else if (kind === 'none' && s.h2h) {
    const lead = s.h2h.leaderCm360;
    // No clear winner: show the best guess (labelled not confirmed); a feel tie-break picks the leader instead.
    if (allRight(testsAt(s, lead)) && !allRight(testsAt(s, def))) { rec = lead; tieBrokenByFeel = true; } else rec = bestGuess(s, fit, cfg);
  } else if (kind === 'bestGuess') rec = bestGuess(s, fit, cfg);
  const at = testsAt(s, rec).flatMap((t) => t.steps);
  const findings = diagnose(at.map((st) => st.flick), at.map((st) => st.tracking), cfg, at.map((st) => st.switch));
  const result: PaResult = {
    kind, recommendedCm360: rec, recommendedGameSens: gameSensOf(s.setup.game, rec, s.setup.dpi, cfg),
    rangeCm360: fit?.range ?? null, tieBrokenByFeel, feelFlags: feelFlagsOf(s.tests, s.setup.game), h2h, findings,
  };
  return { ...s, phase: 'finished', queue: kind === 'bestGuess' ? [] : s.queue, result };
}

export function answerHourCheck(s: PaState, choice: 'continue' | 'later' | 'done', now: number, cfg: Config = defaultConfig): PaState {
  if (s.phase !== 'hourCheck') throw new Error(`answerHourCheck: phase is ${s.phase}`);
  const answered = { ...s, hourCheckedNight: s.nights.length - 1 };
  if (choice === 'done') return finish(answered, 'bestGuess', null, cfg);
  return { ...answered, phase: 'waiting', waitingSince: now };
}

/** Opens a new night: a pending head-to-head runs first; otherwise the default is re-tested first as the night's anchor.
 *  A best-guess result reopens the search straight into the head-to-head. */
export function startNight(s: PaState, now: number, cfg: Config = defaultConfig): PaState {
  if (s.result && s.result.kind !== 'bestGuess') throw new Error('startNight: the search is finished');
  const opened: PaState = { ...s, nights: [...s.nights, { startedAt: now }], h2hTonight: 0, phase: 'waiting', waitingSince: now,
    pendingFeel: null, result: null };
  if (s.result) {
    // Confirm the sens the best guess named; if that is the default, the answer is simply keep.
    const next = startH2h({ ...opened, queue: [] }, cfg, s.result.recommendedCm360);
    return next.phase === 'finished' ? next : { ...next, phase: 'waiting', waitingSince: now };
  }
  // A head-to-head must be played within one night (night form would otherwise look like a difference): replay it in full.
  if (opened.queue[0]?.role === 'h2h') return startH2h({ ...opened, queue: [], h2hTonight: 0 }, cfg, s.h2h?.leaderCm360);
  // A night opened but never played already starts with its anchor.
  if (opened.queue[0]?.role === 'anchor') return opened;
  return { ...opened, queue: [{ cm360: s.setup.defaultCm360, role: 'anchor' }, ...opened.queue] };
}

/** Reopening a saved search: within playAlong.sameNightMs of the last activity it carries on the same night (an
 *  interrupted test goes back to its waiting screen); after that, or from a best guess, a new night starts. */
export function resume(s: PaState, now: number, cfg: Config = defaultConfig): PaState {
  const lastActivity = Math.max(s.waitingSince, s.tests[s.tests.length - 1]?.finishedAt ?? s.createdAt);
  if (s.result || now - lastActivity >= cfg.playAlong.sameNightMs) return startNight(s, now, cfg);
  return s.phase === 'testing' || s.phase === 'feel' ? abandonTest(s, now) : s;
}

export function isStale(s: PaState, now: number, cfg: Config = defaultConfig): boolean {
  const last = s.tests[s.tests.length - 1]?.finishedAt ?? s.createdAt;
  return now - last > cfg.playAlong.staleDays * DAY_MS;
}
