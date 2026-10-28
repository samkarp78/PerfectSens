# Play-Along Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second mode that alternates real game matches with 3-minute in-app tests. It narrows the player's best sens across one or more nights and only says "change" after a head-to-head.

**Architecture:**
- A pure core state machine (`src/core/playalong/`) owns the search: queue, pairs, head-to-head, nights, feel, and the result.
- Each 3-minute test is an ordinary `SessionState` in a new `'fixed'` mode: a lead-in warm-up, then N rounds at one sens. This lets the existing `Run` screen, runners and measurement run it unchanged.
- The simulator drives the same state machine, and its stats gate (Task 6) runs before any UI work.

**Tech Stack:** TypeScript, Preact, three.js, Vitest, IndexedDB (fake-indexeddb in tests).

**Spec:** `docs/superpowers/specs/2026-10-27-blind-sens-finder-design.md` §18 (with §2, §6, §7, §8, §17 as context).

## Global Constraints

- **The Finals:** cm/360 = 914.4 ÷ (sens × DPI), and sens = 914.4 ÷ (cm/360 × DPI). Whole numbers only, minimum 1. There is no ruler check.
- **Other game:** cm/360 only, not snapped.
- **Test block:** a 15 s unscored lead-in (free flick targets at the test sens), then 3 rounds of the §17 four-part round, with no breaks inside.
- **Scores hidden:** no score, grade, streak or block total is shown during Play-Along. The block ends on "Test saved".
- **In-app names:** in-app screens call the test sens "Sens A", "Sens B", …. The real number appears only on the waiting screen.
- **I'm back:** a 1 s hold. A release before 1 s does nothing.
- **Feel question:** asked after I'm back and before the test: **Too fast / Too slow / About right**. Feel never steers the search, the fit or the A/B maths.
- **Pad measurement is required.** A target too slow for the pad moves to the slowest sens that fits (rounded to the side that fits). If that sens is already tested, or equals the pair's other side, that side is skipped.
- **Limits:** 0.6×–1.6× the default cm/360 (`steer.limits`).
- **Pair steps:** the first pair is ±20% (relative). Each next pair halves the step, down to 4%.
- **Hour check:** after the first test that finishes ≥ 50 min (3,000,000 ms) after the night's first waiting screen.
- **"Change"** needs pooled δ > ln(1.03) and δ > z·SE, and the head-to-head pair's own δ > 0. The target is null false change ≤ 1%.
- **"I'm done"** gives a "Best guess, not confirmed yet" result. It is not a change verdict.
- **Stale search:** a saved search older than 14 days asks whether to continue or start fresh.
- **Standard and Quick modes behave exactly as before.** All existing tests stay green.

## Review Focus

1. **Closing the tab mid-test:** on reload, the search resumes on the waiting screen for the same sens, and the incomplete test is discarded. *(Task 5 `abandonTest` test, plus the Task 7 round-trip test.)*
2. **A saved state must survive JSON:** `AbDecision.se` can be `Infinity`, and an Infinity saved to JSON comes back as `null`. Saved and loaded state must still decide the same way. *(Task 7 test.)*
3. **A low Finals sens (e.g. 3) or a tiny pad:** whole-number snapping and the pad cap run out of new numbers. The search must go to the head-to-head, never loop or test sens 0. *(Task 4 tests.)*
4. **The hour check lands between the two sens of a pair, then "Continue another night":** the next night runs the anchor (default) first, then the untested pair member. *(Task 5 test.)*
5. **Alt-tab while on the waiting or feel screen:** pointer lock isn't held there. The hold must be a real 1 s hold of the button, and a release cancels it. *(Task 8 `holdProgress` test.)*

---

### Task 0: Settle the existing uncommitted edits

The working tree already has uncommitted, finished-looking work: a "View results" button in History (`src/core/session.ts` `fitFromSteps`, `src/ui/App.tsx`, `src/ui/History.tsx`, `src/ui/styles.css`, `tests/core/session.test.ts`). Task 3 edits `session.ts` and Task 9 edits `History.tsx`.

- [ ] **Step 1:** Run `npm test`. Expected: all pass.
- [ ] **Step 2:** Ask the user whether to commit that work as its own commit (`feat(ui): view saved results from History`). Do not touch `docs/next-build-ideas.md`; it holds the user's own edits. Proceed only after the answer.

---

### Task 1: Game sens conversion and snapping

**Files:**
- Create: `src/core/playalong/gameSens.ts`
- Modify: `src/core/config.ts`: add the `playAlong` block below
- Test: `tests/core/playalong/gameSens.test.ts`

Config block, added to `defaultConfig`:
```ts
/** Play-Along mode (§18). */
playAlong: { roundsPerTest: 3, leadInMs: 15000, firstStep: 0.2, minStep: 0.04, hourCheckMs: 3_000_000, staleDays: 14,
  maxH2hPerNight: 2, h2hBlocksPerSide: 1, z: 2.5, nightPriorSd: 0.03, finalsK: 914.4, holdMs: 1000, testTimeScale: 0.25,
  sim: { matchMs: 600_000, familiarityShrink: 0.5, nightSd: 0.03, maxNights: 4 } },
```

**Interfaces:**
- Produces:
  - `type GameId = 'finals' | 'other'`
  - `finalsToCm360(sens: number, dpi: number, cfg?: Config): number`
  - `cm360ToFinals(cm360: number, dpi: number, cfg?: Config): number`: unrounded
  - `snapCm360(game: GameId, cm360: number, dpi: number, toward: 'nearest' | 'slower' | 'faster', cfg?: Config): number`: Finals rounds the sens (nearest / floor for slower, i.e. higher cm/360 / ceil for faster), clamped to ≥ 1, and returns that number's exact cm/360. Other returns `cm360` unchanged.
  - `gameSensOf(game: GameId, cm360: number, dpi: number, cfg?: Config): number | null`: the whole Finals number, or null for Other
  - `sameSens(game: GameId, a: number, b: number): boolean`: Finals compares the whole numbers at the setup DPI (callers pass cm/360 already snapped, so a relative difference < 1e-9 counts as equal); Other counts as equal within 0.5% relative.

- [ ] **Step 1: Write the failing tests**
```ts
expect(finalsToCm360(33, 800)).toBeCloseTo(34.6364, 4);
expect(finalsToCm360(16.5, 800)).toBeCloseTo(69.2727, 4);
expect(finalsToCm360(66, 800)).toBeCloseTo(17.3182, 4);
expect(cm360ToFinals(34.6364, 800)).toBeCloseTo(33, 3);
expect(gameSensOf('finals', 28, 800)).toBe(41);              // 40.82 → 41
expect(snapCm360('finals', 28, 800, 'nearest')).toBeCloseTo(finalsToCm360(41, 800), 9);
expect(snapCm360('finals', 28, 800, 'slower')).toBeCloseTo(finalsToCm360(40, 800), 9);  // floor sens = slower
expect(snapCm360('finals', 2000, 800, 'faster')).toBeCloseTo(finalsToCm360(1, 800), 9); // never below sens 1
expect(snapCm360('other', 28.37, 800, 'nearest')).toBe(28.37);
expect(gameSensOf('other', 28, 800)).toBeNull();
```
- [ ] **Step 2:** Run `npx vitest run tests/core/playalong/gameSens.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `gameSens.ts` and the config block.
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS, with the existing tests still passing (`tests/core/config.test.ts` may need the new key if it snapshots the config).
- [ ] **Step 5: Commit:** `feat(playalong): The Finals sens conversion and whole-number snapping`

---

### Task 2: Per-night offset in the fit

**Files:**
- Modify: `src/core/fit.ts`
- Test: `tests/core/fit.test.ts`

**Interfaces:**
- Produces:
  - `FitPoint` gains an optional `night?: number` (0-based).
  - `fitCurve` adds one offset column per night index > 0 *only when the points span two or more distinct nights*. Each column is a 0/1 indicator, with ridge prior sd `cfg.playAlong.nightPriorSd`. It's used in `solveModel` and the bootstrap alike; the peak and range still come from `a + b·u + c·u²`. `FitResult.coef` keeps its shape (night offsets aren't exposed).

- [ ] **Step 1: Write the failing tests**
  - `'points without night fit exactly as before'`: same points with and without `night: 0` give equal `coef` and `pickCm360`.
  - `'a night offset does not move the peak'`: take a synthetic quadratic (peak at ln 30) sampled on night 0, and the same x values on night 1 with y + 0.1. Expect `pickCm360` within 1% of 30. Without night labels, the same data must still give a finite pick (a sanity check, no tolerance).
- [ ] **Step 2:** Run `npx vitest run tests/core/fit.test.ts`. Expected: the second test FAILs.
- [ ] **Step 3:** Generalise `solveModel` to k = 5 + (nights − 1) columns.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(fit): optional per-night offset term`

---

### Task 3: `'fixed'` session mode (one sens, N rounds)

**Files:**
- Modify: `src/core/session.ts`, `src/core/config.ts` (add `configForPlayAlong`), `src/ui/runController.ts` (HUD text)
- Test: `tests/core/session.test.ts`, `tests/ui/runController.test.ts`

**Interfaces:**
- Produces:
  - `SessionOptions` gains `fixed?: { rounds: number; scoreBaseline: ScoreBaseline | null }`.
  - `SessionState.mode` becomes `'full' | 'quickab' | 'fixed'`.
  - **Fixed mode:**
    - The optional warm-up block runs at `setup.cm360` for `cfg.session.warmupMs`.
    - Then `rounds` steps, each with stage `'baseline'`, `idBase` `round-${i}` and `specIndex` i.
    - Each step is scored against `scoreBaseline`, or against its own first round when that's null (like the baseline now).
    - There's no fit, steering or A/B.
    - After the last round, `result` is `buildResult({ setup, fit: null, pickCm360: setup.cm360, ab: null, abSkipped: true, findings: [] })`. This is a placeholder that only marks the session finished; Play-Along reads `steps`.
    - `progress.stepIndex` = rounds done and `totalSteps` = rounds.
  - `configForPlayAlong(cfg?: Config): Config` in `config.ts`: `session.warmupMs = playAlong.leadInMs` and `session.breakEveryRounds = Number.MAX_SAFE_INTEGER` (single cast, as in `configForMode`).
  - `hudText(p: Progress, mode: SessionState['mode'] = 'full')`: for `'fixed'` it returns `` `Test · Round ${p.stepIndex + 1} of ${p.totalSteps} · ${part}` `` (`'Lead-in'` for the warm-up block). It never contains a sens value.

- [ ] **Step 1: Write the failing tests** (session.test.ts, driven by the existing sim helpers):
  - `'fixed mode plays a lead-in then N rounds at one sens and finishes'`: with `fixed: { rounds: 3, scoreBaseline: null }`, `warmup: true` and `configForPlayAlong()`, run with `runSimSession`. Expect 3 steps, every `cm360 === setup.cm360`, `result !== null`, `fit === null`, and the first block spec of kind `'warmup'`.
  - `'fixed mode scores against a supplied baseline'`: pass `scoreBaseline` = `{ tp: 1, switchTp: 1, tot: 1, dmg: 1 }`. Expect `steps[0].score.logS` ≠ 0 (with null it's 0 for the first round).
  - runController.test.ts: `hudText` for a fixed-mode progress gives `'Test · Round 2 of 3 · Flicks'`.
- [ ] **Step 2:** Run `npx vitest run tests/core/session.test.ts tests/ui/runController.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the branch in `createSession` / `planNext` / `submitBlock` (keep the baseline in a new internal `_scoreBaseline` field), plus `configForPlayAlong` and `hudText`. Make `runSimSession` pass `opts` through unchanged; it already does.
- [ ] **Step 4:** Run `npm test` and `npm run build`. Expected: PASS, with no type errors (`Run.tsx` passes `session.mode` to `hudText` through the controller).
- [ ] **Step 5: Commit:** `feat(session): fixed mode for Play-Along test blocks`

---

### Task 4: Pair steering

**Files:**
- Create: `src/core/playalong/steer.ts`
- Test: `tests/core/playalong/steer.test.ts`

**Interfaces:**
- Consumes: `snapCm360`, `sameSens` (Task 1); `maxTestCm360` (`src/core/steer.ts`).
- Produces:
```ts
export interface PairContext { game: GameId; dpi: number; defaultCm360: number; padWidthCm: number;
  centerCm360: number; step: number; testedCm360: number[] }
export interface PairDecision { targets: number[]; step: number; exhausted: boolean; reason: string }
export function choosePair(ctx: PairContext, cfg?: Config): PairDecision
export function nextStep(step: number, cfg?: Config): number   // max(minStep, step / 2)
```
- **Algorithm:**
  1. The raw sides are `center / (1 + step)` (faster) and `center × (1 + step)` (slower).
  2. Snap each side away from the centre (`'faster'` / `'slower'`).
  3. If a snapped side is already tested, equals the centre, or equals the other side, move it one whole number further outward. This applies to Finals only, and happens once.
  4. Clamp the slower side to `maxTestCm360(defaultCm360, padWidthCm)`, snapped `'faster'` (the side that fits), and the faster side to `steer.limits.min × default`, snapped `'slower'`.
  5. After clamping, drop any side that is tested or equal to the other side.
  6. `exhausted` = no targets left. `targets` keeps faster-then-slower order; the caller randomises the play order.
  7. `reason` names the clamp or skip applied.

- [ ] **Step 1: Write the failing tests**
  - `'first pair is ±20% snapped to whole Finals numbers'`: default sens 33 at 800 DPI, pad 60 cm, step 0.2, nothing tested. The targets map to Finals numbers **40** (faster: 33×1.2 = 39.6, ceil) and **27** (slower: 33/1.2 = 27.5, floor), checked via `gameSensOf`.
  - `'too slow for the pad moves to the slowest sens that fits'`: pad 20 cm (180° cap ≈ 36 cm/360 at a 0.9 fraction), default 30 cm/360, step 0.2. The slower target's cm/360 is ≤ `maxTestCm360(...)`, and its `reason` mentions the pad.
  - `'a clamped side already tested is skipped'`: same as above with that clamped value in `testedCm360`. Expect 1 target, the faster one.
  - `'low Finals sens never goes below 1 and exhausts'`: Finals default 2, `testedCm360` holds sens 1, 2 and 3. Expect `exhausted: true`.
  - `'other game is not snapped'`: game `'other'`, default 30. Targets ≈ 25 and 36 (within 1e-9).
  - `nextStep(0.2)` = 0.1, then 0.05, then 0.04, staying at 0.04.
- [ ] **Step 2:** Run `npx vitest run tests/core/playalong/steer.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(playalong): pair steering with snapping and pad cap`

---

### Task 5: Play-Along state machine

**Files:**
- Create: `src/core/playalong/state.ts`, `tests/helpers/paSteps.ts`
- Test: `tests/core/playalong/state.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `decideAB` (`ab.ts`); `diagnose`; `StepResult`; `ScoreBaseline`; `createSession`.
- Produces (all pure; `now` is ms since epoch, passed in):
```ts
export type Feel = 'fast' | 'slow' | 'right';
export type PaPhase = 'waiting' | 'feel' | 'testing' | 'hourCheck' | 'finished';
export interface PaSetup { game: GameId; dpi: number; defaultCm360: number; padWidthCm: number; fov: number; fovType: FovType }
export type TestRole = 'default' | 'pair' | 'h2h' | 'anchor';
export interface QueueItem { cm360: number; role: TestRole }
export interface PaTest { id: string; night: number; indexInNight: number; cm360: number; role: TestRole; feel: Feel;
  awayMs: number; finishedAt: number; steps: StepResult[]; logS: number; se: number }
export interface PaResult { kind: 'change' | 'keep' | 'none' | 'bestGuess'; recommendedCm360: number; recommendedGameSens: number | null;
  rangeCm360: [number, number] | null; tieBrokenByFeel: boolean; feelFlags: { cm360: number; feel: 'fast' | 'slow' }[];
  h2h: AbDecision | null; findings: Finding[] }
export interface PaState { version: 1; setup: PaSetup; seed: number; createdAt: number; phase: PaPhase;
  nights: { startedAt: number }[]; tests: PaTest[]; queue: QueueItem[]; step: number;
  h2h: { leaderCm360: number; testIds: string[] } | null; h2hTonight: number; waitingSince: number;
  pendingFeel: Feel | null; pendingAwayMs: number; steerLog: PairDecision[]; result: PaResult | null;
  logs: Record<string, SessionState['logs']> }   // raw logs per test id
export function createPlayAlong(setup: PaSetup, seed: number, now: number): PaState
export function currentTarget(s: PaState): { cm360: number; gameSens: number | null; label: string } | null
export function sensLabel(s: PaState, cm360: number): string     // 'Sens A', 'Sens B'… by first appearance (default = A)
export function markBack(s: PaState, now: number): PaState       // waiting → feel; records awayMs = now − waitingSince
export function answerFeel(s: PaState, feel: Feel): PaState       // feel → testing
export function testSession(s: PaState, cfg?: Config): SessionState  // fixed-mode session for the queue head
export function submitTest(s: PaState, done: SessionState, now: number, cfg?: Config): PaState
export function abandonTest(s: PaState, now: number): PaState    // testing/feel → waiting, same target, nothing recorded
export function answerHourCheck(s: PaState, choice: 'continue' | 'later' | 'done', now: number, cfg?: Config): PaState
export function startNight(s: PaState, now: number): PaState
export function isStale(s: PaState, now: number, cfg?: Config): boolean
export function paFit(s: PaState, cfg?: Config): FitResult | null
```
- **Rules,** each pinned by a test below:
  - **`testSession`:** the setup is `{ dpi, cm360: head.cm360, inGameSens: null, fov, fovType, mode: 'default', padWidthCm }`. The options are `fixed: { rounds: cfg.playAlong.roundsPerTest, scoreBaseline }` and `warmup: true`. The seed is forked from `s.seed` by test id. The config is `configForPlayAlong(cfg)`. `scoreBaseline` = the first round of the first test, or null for that first test.
  - **A test's score:** `logS` = mean of the steps' `score.logS`, and `se` = √(Σse²)/n. The fit point is `x = ln cm360`, `y = logS`, `se`, `t = indexInNight × playAlong.testTimeScale`, `isCurrent = sameSens(default)` and `night`. `paFit` is `fitCurve` over all tests, with x0 = ln default.
  - **After the first (default) test:** the queue is `choosePair` at centre = default, step = `firstStep`, in random order (forked rng).
  - **After a pair finishes (queue empty):**
    - If the last pair was played at `minStep`, or the next `choosePair` is `exhausted`, start the head-to-head.
    - Otherwise centre = the snapped fit pick when `paFit` is usable and not low-confidence, else the cm/360 of the best test by `logS`. Then `step = nextStep(step)` and queue the new pair.
  - **Head-to-head:**
    - The leader is the same centre rule as above.
    - If `sameSens(leader, default)`, finish with `keep`.
    - Otherwise queue `[leader, default]` in random order with role `'h2h'`, `h2hBlocksPerSide` each.
    - When both are done: pooled blocks = every test at the leader (`P`) and at the default (`C`). The decision is `decideAB(pooled, 2, cfgWithZ, h2hDelta)`, where `cfgWithZ` sets `ab.z = playAlong.z` and `h2hDelta` = the head-to-head tests' own leader − default logS mean.
    - `change` → finish `change`; `keep` → `keep`; `none` → feel tie-break (below).
    - Before finishing, recompute the leader with the head-to-head tests included. If it differs (not the same sens) and `h2hTonight < maxH2hPerNight`, run a new head-to-head instead.
  - **Feel tie-break:**
    - On `none`: if exactly one of leader/default has every feel answer `'right'`, recommend it with `tieBrokenByFeel: true`; else recommend default.
    - `bestGuess` (from "I'm done"): use the fit range's middle (the geometric mean of the ends) snapped `'nearest'`. If some tested sens inside the range was rated `'right'`, use the one nearest the fit pick instead. With no range, use the best test.
  - **`feelFlags`:** any cm/360 with ≥ 2 tests whose feel was `'fast'` (or `'slow'`) both times.
  - **Hour check:** after `submitTest`, if `now − nights[last].startedAt ≥ hourCheckMs` and the search isn't finished, the phase becomes `'hourCheck'`.
    - `continue` → `waiting`.
    - `later` → `waiting`, with nothing else changed (the next start calls `startNight`).
    - `done` → `finished` with `bestGuess`. The head-to-head can still be run later: `startNight` on a `bestGuess` state clears `result`, sets phase `waiting` and queues the head-to-head.
  - **`startNight`:** pushes a night and resets `h2hTonight`. Unless the queue head is an `'h2h'` item, it puts `{ cm360: default, role: 'anchor' }` at the front.
  - **Range shown:** `paFit(...).range`, or null.
  - **Findings:** `diagnose` over the steps of the tests at the recommended sens.

`tests/helpers/paSteps.ts`: `fakeDone(cm360: number, logS: number, se = 0.03, rounds = 3): SessionState`. It returns the minimal shape `submitTest` reads (`steps` built from `tests/helpers/summaries.ts` with `score: { logS, se }`, `logs` empty, a non-null `result`). Its cast is documented as test-only.

- [ ] **Step 1: Write the failing tests** (each one drives the state with `fakeDone`):
  - `'starts waiting on the default sens labelled Sens A'`
  - `'markBack then answerFeel moves to testing and the feel is stored on the test'`
  - `'after the default test, two pair targets are queued around the default'`
  - `'pair targets play in a random but seed-stable order'`
  - `'a pair at minStep leads to the head-to-head'`
  - `'leader equal to default finishes keep without a head-to-head'`
  - `'a clear head-to-head win gives change'`: the leader is +0.15 in every test, se 0.02.
  - `'a head-to-head loss in its own pair blocks change even if pooled is ahead'`
  - `'none with only the leader rated right is tie-broken by feel'`
  - `'feel never changes the queue'`: two states that differ only in feel answers have equal queues and steps.
  - `'hour check appears only after a test finishing past 50 min'`
  - `'later then startNight runs the anchor first, then the untested pair member'` (Review Focus 4)
  - `'done gives a labelled best guess at the range middle; startNight then queues the head-to-head'`
  - `'abandonTest returns to waiting on the same target and records nothing'` (Review Focus 1)
  - `'feel flag after two too-slow answers on one sens'`
  - `'isStale after 14 days'`
  - `'testSession plays the queue head with the fixed-mode lead-in'`: a real `createSession`; the first block is kind `'warmup'` at the head cm/360.
- [ ] **Step 2:** Run `npx vitest run tests/core/playalong/state.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `state.ts`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(playalong): search state machine with head-to-head, feel and nights`

---

### Task 6: Simulator driver and stats gate (GATE — runs before any UI)

**Files:**
- Modify: `src/core/sim/player.ts`: `SimState` gains an optional `form?: number` multiplier (default 1) applied in `performance`
- Create: `src/core/sim/runPlayAlong.ts`, `tests/stats/playAlong.test.ts`
- Modify: the spec, adding a new §18.13 "Build notes and measured rates"

**Interfaces:**
- Produces: `runPlayAlongSim(setup: PaSetup, player: SimPlayer, seed: number, cfg?: Config): { state: PaState; nights: number; testsPerNight: number[] }`
  - **The loop:** `createPlayAlong`, then for each queue head: advance `now` by `sim.matchMs`, `markBack`, `answerFeel` (`'right'`), then play `testSession` with `simulateBlock`. Before each test:
    - `adaptedCm360` = the test sens (the match warmed the player up);
    - `blocksDone` = 0 (fatigue resets);
    - `form` = the night's `exp(normal × sim.nightSd)`;
    - `familiarityBonus` × `sim.familiarityShrink` for every test after the first.
  - Advance `now` by each block's duration, then `submitTest`.
  - At `'hourCheck'` it answers `later` and calls `startNight` (a new form draw, `now` + 1 day), up to `sim.maxNights`. On the last allowed night it answers `done`.
- Existing sims are unchanged (`form` is absent, so it counts as 1).

- [ ] **Step 1: Write the stats tests**, following the `tests/stats/sim.ts` style with `report(...)` lines:
  - **`'null false change ≤ 1%'`:** 300 searches, flat player (curvature 0, familiarityBonus 0), Finals default 33 at 800 DPI with a 60 cm pad. The change rate is ≤ 0.01.
  - **`'convergence'`:** ≥ 80 of 100 searches with an optimum at u ∈ [0.75, 1.3] × default end with `|ln(recommended / optimal)| < ln 1.08`. Only for searches whose kind is `change`, or `bestGuess` when the optimum is ≥ 3% from the default. Report the change / keep / none / bestGuess counts.
  - **`'tests per night and nights to an answer'`:** report only, no assertion.
- [ ] **Step 2:** Run `npm run test:stats -- tests/stats/playAlong.test.ts`, in the background if it takes over 2 min.
- [ ] **Step 3: If a gate fails,** tune in this order, re-running after each change:
  1. `playAlong.z` (up to 3.0);
  2. `roundsPerTest` 3 → 4;
  3. `h2hBlocksPerSide` 1 → 2.

  Never relax the 1% bar. If all three are tried and a gate still fails, **stop and report the rates to the user** before any UI task.
- [ ] **Step 4:** Write the measured rates and any tuned values into the spec §18.13, as in §17.9.
- [ ] **Step 5: Commit:** `test(stats): Play-Along simulator gate and measured rates`

---

### Task 7: Saving the search and History records

**Files:**
- Create: `src/store/playAlongStore.ts`
- Modify: `src/store/history.ts`: bump `DB_VERSION` to 2, add a `'playalong'` object store in an upgrade that checks `oldVersion`, and add `mode: 'playalong'` plus an optional `playAlong` field
- Test: `tests/store/playAlongStore.test.ts`, `tests/store/history.test.ts`

**Interfaces:**
- Produces:
  - `openPlayAlongStore(): Promise<{ load(): Promise<PaState | null>; save(s: PaState): Promise<void>; clear(): Promise<void> } | null>`: a single key `'current'`. On save, `Infinity` values become the string `'Infinity'` and back on load (a JSON-safe replacer and reviver).
  - `SessionRecord.mode`: `'full' | 'quickab' | 'playalong'`. `SessionRecord.playAlong?: { setup: PaSetup; tests: PaTest[]; result: PaResult; nights: number }`.
  - `recordFromPlayAlong(s: PaState, now: Date, id: string): SessionRecord`:
    - `result` maps to a `SessionResult`: change→change, keep→keep, none/bestGuess→none, `recommendedCm360`, and `range` = `rangeCm360`.
    - `steps` = all test steps, and `raw` = `null`. Raw logs go to the raw store under the record id, merged per test, the same as `save` does for full sessions.

- [ ] **Step 1: Write the failing tests:**
  - `'save then load returns an equal state, including an Infinity se'` (Review Focus 2)
  - `'clear removes it'`
  - `'opening v2 keeps sessions saved under v1'`: with fake-indexeddb, open v1 with the old upgrade, save a record, then open through `openHistory` and `get` it.
  - `'recordFromPlayAlong maps bestGuess to none and keeps the range'`
- [ ] **Step 2:** Run `npx vitest run tests/store`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(store): save Play-Along searches and history records`

---

### Task 8: Play-Along screens

**Files:**
- Create:
  - `src/core/playalong/setup.ts`: `validatePaSetup`
  - `src/ui/hold.ts`: `holdProgress`
  - `src/ui/PlayAlongSetup.tsx`
  - `src/ui/PlayAlong.tsx`: the screen controller and its cards
- Modify:
  - `src/ui/Run.tsx`: a `hideScores?: boolean` prop
  - `src/ui/App.tsx`: the `'playalongSetup'` and `'playalong'` screens, continue/stale handling, and routing Calibrate back to Play-Along setup
  - `src/ui/Setup.tsx`: a "Play-Along mode" button, and "Continue your search (range X–Y)" when a saved search exists
  - `src/ui/styles.css`
- Test: `tests/core/playalong/setup.test.ts`, `tests/ui/hold.test.ts`

**Interfaces:**
- Produces:
  - `validatePaSetup(input): { ok: true; setup: PaSetup } | { ok: false; errors }`:
    - Finals requires a whole current sens ≥ 1 (converted with `finalsToCm360`); Other requires cm/360 within `setup.cm360` limits.
    - DPI and FOV use the same rules as `validateSetup`.
    - `padWidthCm` is **required**.
  - `holdProgress(downAt: number | null, now: number, holdMs: number): { fraction: number; done: boolean }`: null → `{0, false}`.
  - **`PlayAlong` props:** `{ state: PaState; prefs: Prefs; onChange(s: PaState): void; onFinished(s: PaState): void; onQuit(): void; onUnsupported(): void }`. It calls `onChange` after every transition; App saves through `playAlongStore`.
- **Screens:**
  - **Waiting:**
    - The game number in large text: "Type **40** into The Finals". For Other: "Set your game to **28.0 cm/360**", plus the ruler line "sliding the mouse 28.0 cm turns one full circle".
    - cm/360 underneath, "Play a match, then come back", "After this: a 3-minute test", and the night's elapsed time.
    - The **I'm back** hold button: a fill bar driven by `holdProgress`, with pointer down/up on the button. Leaving the button or releasing cancels.
    - A quit button.
  - **Feel:** "How did that feel?" with Too fast / Too slow / About right.
  - **Testing:** `<Run session={testSession(state)} hideScores … />`.
    - Its `onFinished` calls `submitTest` and shows a "Test saved" card.
    - Its `onQuit` calls `abandonTest`.
  - **Hour check:** "Your best The Finals sens is likely between **32 and 37**" (cm/360 underneath) and "Keep narrowing it down?", with three buttons for `answerHourCheck`.
  - **Finished:** calls `onFinished`.
- **App:**
  - On load it opens `playAlongStore`.
  - Setup's continue button calls `startNight` (after the stale prompt when `isStale`: Continue / Start fresh → `clear`).
  - On a finished search it saves `recordFromPlayAlong` to History and shows Play-Along results (Task 9). On a non-`bestGuess` finish it clears the store; it keeps the store after `bestGuess`.

- [ ] **Step 1: Write the failing tests:**
  - `holdProgress(null, 5, 1000)` → `{ fraction: 0, done: false }`; `(0, 500, 1000)` → 0.5 and not done; `(0, 1000, 1000)` → done (Review Focus 5).
  - `validatePaSetup`: Finals sens 33.5 is rejected; a missing pad is rejected; Finals 33 at 800 DPI gives `defaultCm360` ≈ 34.6364.
- [ ] **Step 2:** Run `npx vitest run tests/ui/hold.test.ts tests/core/playalong/setup.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the helpers, then the components.
- [ ] **Step 4:** Run `npm test` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Check in the browser:**
  - Use the `run` skill or the preview.
  - Walk Setup → Play-Along setup → Waiting → hold → Feel → Test (pointer lock needs a real click, so stop at the lead-in if it can't lock).
  - Confirm no score text appears.
  - Reload on the waiting screen and confirm it resumes.
  - Take a screenshot.
- [ ] **Step 6: Commit:** `feat(ui): Play-Along setup, waiting, feel, test and hour-check screens`

---

### Task 9: Play-Along results and History

**Files:**
- Create: `src/ui/PlayAlongResults.tsx`
- Modify: `src/ui/History.tsx` (playalong rows, and `onOpen` routing), `src/ui/App.tsx`
- Test: `tests/ui/playAlongText.test.ts` for the pure text helpers in `src/ui/playAlongText.ts`

**Interfaces:**
- Produces:
  - `verdictText(r: PaResult, game: GameId, dpi: number): string`. These strings are exact:
    - change → `Change to ${n}` (Finals) or `Change to ${cm} cm/360`;
    - keep → `Keep your sens`;
    - none → `No clear winner — keep your sens`, or with `tieBrokenByFeel`, `No clear winner — ${n} felt better (tie broken by feel)`;
    - bestGuess → `Best guess, not confirmed yet: ${n}`.
  - `rangeText(r, game, dpi)` → `Likely between 32 and 37` (Finals, whole numbers) or `Likely between 28.1 and 33.0 cm/360`.
  - `feelFlagText(flag, game, dpi)` → `${n} felt too slow both times`.
- **Results page:**
  - verdict, range, and every tested sens (game number, cm/360, night, feel answers);
  - feel flags, with the §18.7 wording for a disagreement;
  - findings (reuse the existing findings list);
  - for bestGuess: "Confirm it next time: Play-Along will run the head-to-head first";
  - export JSON (the existing `toJson` on the record).
- **History:** playalong rows show "Play-Along · <verdict>" and the View results button. The Quick A/B button stays for `mode === 'full'` only.

- [ ] **Step 1:** Write the failing tests for the three text helpers, covering every verdict kind and both games.
- [ ] **Step 2:** Run `npx vitest run tests/ui/playAlongText.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the helpers and the components.
- [ ] **Step 4:** Run `npm test` and `npm run build`. Expected: PASS.
- [ ] **Step 5:** Check in the browser: in dev, finish a search with a fake state (expose `?paresult=1`, as `?simresult=1` does, building it with `runPlayAlongSim`). Check the results page and the History row. Take a screenshot.
- [ ] **Step 6: Commit:** `feat(ui): Play-Along results and history`

---

### Task 10: Final review

- [ ] **Step 1:** Run `npm test`, `npm run build` and `npm run test:stats`. Expected: all pass, and the Play-Along rates match §18.13.
- [ ] **Step 2:** Dispatch one whole-branch review (most capable model) against the spec §18 and this plan's Review Focus. Fix Important findings, and list minor ones in a ledger `docs/superpowers/plans/2026-10-28-play-along-ledger.md`.
- [ ] **Step 3:** Commit the fixes and the ledger. Don't merge; the user play-tests first.
