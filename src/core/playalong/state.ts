import { decideAB, type AbBlock, type AbDecision } from '../ab';
import { configForPlayAlong, defaultConfig, type Config } from '../config';
import { diagnose, type Finding } from '../diagnose';
import { fitCurve, type FitPoint, type FitResult } from '../fit';
import { createRng, type Rng } from '../rng';
import type { ScoreBaseline } from '../score';
import { createSession, type SessionState } from '../session';
import type { FovType, Setup, StepResult } from '../types';
import { gameSensOf, sameSens, snapCm360, type GameId } from './gameSens';
import { choosePair, nextStep, type PairDecision } from './steer';

/** The player's answer to "How did that feel?". */
export type Feel = 'fast' | 'slow' | 'right';
export type PaPhase = 'waiting' | 'feel' | 'testing' | 'hourCheck' | 'finished';
export interface PaSetup { game: GameId; dpi: number; defaultCm360: number; padWidthCm: number; fov: number; fovType: FovType }
/** default: the night-1 opener; pair: a higher/lower test; h2h: the head-to-head; anchor: the default re-tested to open a later night. */
export type TestRole = 'default' | 'pair' | 'h2h' | 'anchor';
export interface QueueItem { cm360: number; role: TestRole }
export interface PaTest { id: string; night: number; indexInNight: number; cm360: number; role: TestRole; feel: Feel;
  awayMs: number; finishedAt: number; steps: StepResult[]; logS: number; se: number }
/** bestGuess ("I'm done" before the head-to-head) is not a change verdict and carries no false-change guarantee. */
export interface PaResult { kind: 'change' | 'keep' | 'none' | 'bestGuess'; recommendedCm360: number; recommendedGameSens: number | null;
  rangeCm360: [number, number] | null; tieBrokenByFeel: boolean; feelFlags: { cm360: number; feel: 'fast' | 'slow' }[];
  h2h: AbDecision | null; findings: Finding[] }
/** The whole search, saved between tests and nights. step: the step of the latest pair. logs: raw logs per test id. */
export interface PaState { version: 1; setup: PaSetup; seed: number; createdAt: number; phase: PaPhase;
  nights: { startedAt: number }[]; tests: PaTest[]; queue: QueueItem[]; step: number;
  h2h: { leaderCm360: number; testIds: string[] } | null; h2hTonight: number; waitingSince: number;
  pendingFeel: Feel | null; pendingAwayMs: number; steerLog: PairDecision[]; result: PaResult | null;
  logs: Record<string, SessionState['logs']> }

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
    version: 1, setup, seed, createdAt: now, phase: 'waiting', nights: [{ startedAt: now }], tests: [],
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

/** The fixed-mode session (lead-in + rounds) for the queue head. */
export function testSession(s: PaState, cfg: Config = defaultConfig): SessionState {
  const head = s.queue[0];
  if (!head) throw new Error('testSession: nothing queued');
  const { dpi, fov, fovType, padWidthCm } = s.setup;
  const setup: Setup = { dpi, cm360: head.cm360, inGameSens: null, fov, fovType, mode: 'default', padWidthCm };
  const seed = Math.floor(rootFork(s, `test-${s.tests.length}`).next() * SEED_RANGE);
  return createSession(setup, { seed, warmup: true, quickAbCm360: null,
    fixed: { rounds: cfg.playAlong.roundsPerTest, scoreBaseline: scoreBaseline(s) } }, configForPlayAlong(cfg));
}

export function abandonTest(s: PaState, now: number): PaState {
  if (s.phase !== 'testing' && s.phase !== 'feel') return s;
  return { ...s, phase: 'waiting', pendingFeel: null, waitingSince: now };
}

export function submitTest(s: PaState, done: SessionState, now: number, cfg: Config = defaultConfig): PaState {
  if (s.phase !== 'testing') throw new Error(`submitTest: phase is ${s.phase}`);
  if (!done.result || done.steps.length === 0) throw new Error('submitTest: the test block is not finished');
  const head = s.queue[0]!;
  const night = s.nights.length - 1;
  const id = `t${s.tests.length}`;
  const test: PaTest = {
    id, night, indexInNight: s.tests.filter((t) => t.night === night).length, cm360: head.cm360, role: head.role,
    feel: s.pendingFeel ?? 'right', awayMs: s.pendingAwayMs, finishedAt: now, steps: done.steps,
    logS: mean(done.steps.map((st) => st.score.logS)),
    se: Math.sqrt(done.steps.reduce((a, st) => a + st.score.se ** 2, 0)) / done.steps.length,
  };
  const h2h = s.h2h && head.role === 'h2h' ? { ...s.h2h, testIds: [...s.h2h.testIds, id] } : s.h2h;
  const next = plan({ ...s, tests: [...s.tests, test], queue: s.queue.slice(1), h2h, pendingFeel: null,
    logs: { ...s.logs, [id]: done.logs } }, cfg);
  if (next.phase === 'finished') return next;
  const hour = now - s.nights[s.nights.length - 1]!.startedAt >= cfg.playAlong.hourCheckMs;
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

function queuePair(s: PaState, center: number, step: number, cfg: Config): PaState | null {
  const d = choosePair({ game: s.setup.game, dpi: s.setup.dpi, defaultCm360: s.setup.defaultCm360, padWidthCm: s.setup.padWidthCm,
    centerCm360: center, step, testedCm360: s.tests.map((t) => t.cm360) }, cfg);
  if (d.exhausted) return null;
  const queue = shuffled(s, d.targets.map((cm360): QueueItem => ({ cm360, role: 'pair' })), `order-${s.tests.length}`);
  return { ...s, step, queue, steerLog: [...s.steerLog, d] };
}

function startH2h(s: PaState, cfg: Config): PaState {
  const lead = leader(s, cfg);
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
  if (s.step <= cfg.playAlong.minStep) return startH2h(s, cfg);
  return queuePair(s, leader(s, cfg), nextStep(s.step, cfg), cfg) ?? startH2h({ ...s, step: nextStep(s.step, cfg) }, cfg);
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

function bestGuess(s: PaState, fit: FitResult | null, cfg: Config): number {
  const range = fit?.range;
  if (!range) return leader(s, cfg);
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
    if (allRight(testsAt(s, lead)) && !allRight(testsAt(s, def))) { rec = lead; tieBrokenByFeel = true; }
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
  if (choice === 'done') return finish(s, 'bestGuess', null, cfg);
  return { ...s, phase: 'waiting', waitingSince: now };
}

/** Opens a new night: a pending head-to-head runs first; otherwise the default is re-tested first as the night's anchor.
 *  A best-guess result reopens the search straight into the head-to-head. */
export function startNight(s: PaState, now: number, cfg: Config = defaultConfig): PaState {
  if (s.result && s.result.kind !== 'bestGuess') throw new Error('startNight: the search is finished');
  const opened: PaState = { ...s, nights: [...s.nights, { startedAt: now }], h2hTonight: 0, phase: 'waiting', waitingSince: now,
    pendingFeel: null, result: null };
  if (s.result) {
    const next = startH2h(opened, cfg);
    return next.phase === 'finished' ? next : { ...next, phase: 'waiting', waitingSince: now };
  }
  // A head-to-head must be played within one night (night form would otherwise look like a difference): replay it in full.
  if (opened.queue[0]?.role === 'h2h') return startH2h({ ...opened, queue: [], h2hTonight: 0 }, cfg);
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
