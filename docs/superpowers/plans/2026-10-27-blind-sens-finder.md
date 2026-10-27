# Blind Sens Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static-site browser aim test that finds a player's best cm/360 from blind flick and tracking blocks, confirms it with an adaptive blind A/B, and diagnoses what to train.

**Architecture:** All measurement, scoring, steering, fitting, A/B and diagnosis logic lives in `src/core/` as pure TypeScript with no DOM or three.js imports. A pure session state machine consumes block logs and emits the next block spec. Block "runners" (also pure) turn raw mouse samples into block logs; the real mouse, the simulated player and the demo all feed the same runners. three.js renders, Preact runs the screens, and IndexedDB stores history.

**Tech Stack:** TypeScript (strict), Vite, Vitest, Preact (`@preact/preset-vite`), three.js, fake-indexeddb (tests only).

**Spec:** `docs/superpowers/specs/2026-10-27-blind-sens-finder-design.md`. Read it before starting any task.

## Global Constraints

- Raw input only: `requestPointerLock({ unadjustedMovement: true })`. One sensitivity in every direction.
- Sens entered as cm/360 + DPI. `degrees = counts × (2.54 / DPI) × (360 / cm360)`.
- Multiplier = `current_cm360 / recommended_cm360`; new in-game sens = `inGameSens × multiplier`, rounded to 2 decimals (33 × 0.90 → 29.7).
- Test sens values are never shown before the results screen: no cm/360 in the HUD, rest screens, captions or console.
- Browsers where the raw lock fails are blocked from the scored test, with the message: "Raw mouse input isn't supported in this browser. Use Chrome or Edge on desktop. The demo still works here."
- Every weight, threshold and schedule lives in `src/core/config.ts`. No magic numbers anywhere in `src/core/`.
- `src/core/**` must not import from `src/input`, `src/scene`, `src/ui` or `src/store`, nor from `three` or `preact`.
- Deterministic: all randomness comes from `src/core/rng.ts` with explicit seeds.
- Node ≥ 20. Static build output in `dist/`, with `base: './'` so it can be hosted from any path.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **AFK player or a target never hit:** each target times out after 4000 ms, and a block with >30% timeouts (or tracking time on target <5%) is re-run once. Tests: Task 4 (timeout), Task 12 (retry).
2. **Pointer lock lost mid-block (alt-tab, Esc):** the session pauses, the partial block is discarded, and that block restarts on resume. No partial data reaches the session. Test: Task 16.
3. **Zero landing spread (every click on the same point):** throughput must stay finite (`We` floored at `minWeDeg`). Test: Task 6.
4. **Bad setup input (DPI 0, cm/360 of 9999, empty FOV):** per-field errors, never a crash or NaN sens. Test: Task 2.
5. **IndexedDB unavailable (private window, blocked storage):** the session still runs, results still show, and history shows "History isn't available in this browser window." Tests: Task 14 (`openHistory` → null), Task 17 (manual).

---

## File Structure

```
index.html                     app shell
vite.config.ts                 Vite + Preact + Vitest config
.claude/launch.json            dev server for previews
src/main.tsx                   mounts <App/>
src/core/config.ts             defaultConfig + Config type
src/core/rng.ts                seeded RNG
src/core/types.ts              shared types
src/core/geometry.ts           counts→degrees, aims, FOV, along/perp projection
src/core/setup.ts              setup validation
src/core/blocks.ts             flick target generation, tracking path
src/core/run/flickRunner.ts    pure flick block runner
src/core/run/trackingRunner.ts pure tracking block runner
src/core/measure/submovements.ts
src/core/measure/flick.ts      per-trial metrics, throughput, flick summary
src/core/measure/tracking.ts   time on target, lead/lag, summary
src/core/score.ts              composite step score
src/core/linalg.ts             small linear solver
src/core/fit.ts                weighted ridge quadratic, bootstrap range, guards
src/core/steer.ts              next-sens choice
src/core/ab.ts                 A/B sequence + decision
src/core/diagnose.ts
src/core/result.ts             verdict, multiplier
src/core/session.ts            session state machine
src/core/sim/player.ts         SimPlayer model
src/core/sim/simulate.ts       drives runners with simulated input
src/core/sim/runSession.ts     full simulated session
src/input/rawInput.ts          pointer lock + event capture
src/scene/camera.ts            pure aim→camera helpers
src/scene/scene.ts             three.js room/targets
src/store/history.ts           IndexedDB history
src/store/export.ts            JSON/CSV export
src/store/setupStore.ts        remembered setup (localStorage)
src/ui/runController.ts        pure-ish run loop controller
src/ui/demoScript.ts           demo clip builder
src/ui/*.tsx, src/ui/styles.css screens
tests/core/**, tests/store/**, tests/ui/**, tests/stats/**
tests/helpers/paths.ts         synthetic path builders
```

---

### Task 1: Scaffold, config, RNG

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `.claude/launch.json`, `src/main.tsx`, `src/core/config.ts`, `src/core/rng.ts`
- Test: `tests/core/rng.test.ts`, `tests/core/config.test.ts`

**Interfaces:**
- Produces: `defaultConfig`, `type Config = typeof defaultConfig`; `createRng(seed: number): Rng` where `Rng = { next(): number; normal(): number; int(lo: number, hi: number): number; shuffle<T>(a: readonly T[]): T[]; fork(label: number | string): Rng }`.

- [ ] **Step 1: Check Node.** Run `node --version`. Expected: v20 or higher. If missing, stop and tell the user to install Node LTS from nodejs.org.
- [ ] **Step 2: Scaffold.** `npm init -y`; install `preact three`, and as dev deps `typescript vite vitest @preact/preset-vite @types/three fake-indexeddb`. Scripts: `"dev": "vite"`, `"build": "tsc --noEmit && vite build"`, `"test": "vitest run --exclude tests/stats/**"`, `"test:stats": "vitest run tests/stats"`. `tsconfig`: strict, `jsx: react-jsx`, `jsxImportSource: preact`, `moduleResolution: bundler`, `noUncheckedIndexedAccess: true`. `vite.config.ts`: preact plugin, `base: './'`, `test: { include: ['tests/**/*.test.ts'], testTimeout: 120000 }`. `.claude/launch.json`: a config named `dev` running `npm run dev` on port 5173. `.gitignore`: `node_modules`, `dist`. `index.html` + `src/main.tsx` render the text "Blind Sens Finder".
- [ ] **Step 3: Write failing tests**

```ts
// tests/core/rng.test.ts
test('same seed, same sequence', () => { const a = createRng(42), b = createRng(42); for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next()); });
test('next in [0,1)', () => { const r = createRng(1); for (let i = 0; i < 10000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); } });
test('normal ≈ N(0,1)', () => { const r = createRng(7); const xs = Array.from({ length: 20000 }, () => r.normal()); /* mean within ±0.03, sd within 1±0.03 */ });
test('int inclusive bounds', () => { /* 10000 draws of int(3,5) hit exactly {3,4,5} */ });
test('shuffle is a deterministic permutation and does not mutate', () => { /* sorted(shuffle(a)) equals sorted(a); same seed same order; input unchanged */ });
test('fork is deterministic and differs from parent', () => { /* createRng(1).fork('x').next() equals itself across calls; differs from createRng(1).next() */ });

// tests/core/config.test.ts
test('30 flick distances, 10 per class', () => {
  const d = defaultConfig.flick.distancesDeg;
  expect(d).toHaveLength(30);
  expect(d.filter(x => x < defaultConfig.flick.smallMaxDeg)).toHaveLength(10);
  expect(d.filter(x => x > defaultConfig.flick.bigMinDeg)).toHaveLength(10);
});
```

- [ ] **Step 4:** Run `npx vitest run tests/core`. Expected: FAIL (modules missing).
- [ ] **Step 5: Implement.** `rng.ts`: mulberry32 core; `normal` by Box–Muller; `fork` hashes the label into the current state without advancing the parent. `config.ts` exports exactly these values (`as const` objects; arrays readonly):

```ts
export const defaultConfig = {
  flick: {
    distancesDeg: [6,8,10,12,14,15,17,18,20,21, 23,24,26,27,28,29,31,32,33,34, 37,40,43,46,49,52,55,58,62,66],
    adaptationTargets: 6, warmupTargets: 300, targetRadiusDeg: 1.5, timeoutMs: 4000,
    smallMaxDeg: 22, bigMinDeg: 35, directionSpreadDeg: 30, bounds: { yaw: 75, pitch: 30 },
  },
  tracking: { durationMs: 25000, leadInMs: 3000, targetRadiusDeg: 1.5, segmentMs: { min: 300, max: 1200 },
    speedDegPerSec: { min: 25, max: 60 }, bounds: { yaw: 40, pitch: 10 }, gridHz: 120, minSpeedForLeadLag: 5 },
  submovement: { binMs: 5, smoothBins: 3, onsetDegPerSec: 30, endDegPerSec: 20, endHoldMs: 30 },
  score: { flickWeight: 0.6, bootstrapSamples: 200, trackingSegmentMs: 1000, minWeDeg: 0.1, minTot: 0.01 },
  steer: { bracket: 0.15, finalStep: 0.04, limits: { min: 0.6, max: 1.6 },
    weights: { smallGain: 1, bigGain: 1, leadLag: 0.5, corrSpread: 0.5 },
    leadLagScaleDeg: 1, correctionsScale: 0.5, jumpScale: 0.15, deadband: 0.02, minSeparation: 0.01 },
  fit: { driftPriorSd: 0.03, familiarityPriorSd: 0.03, bootstrapSamples: 300, rangeFraction: 0.5, gridPoints: 101, minDistinctX: 4 },
  ab: { minEffect: 0.03, z: 2.0 },
  session: { dialinSteps: { default: 6, thorough: 10 }, warmupMs: 180000, maxRetries: 1,
    invalidTimeoutFraction: 0.3, invalidMinTot: 0.05 },
  diagnose: { spreadRatioMax: 1.0, correctionsMax: 1.0, smallGainMax: 1.08, bigGainMin: 0.92,
    refTp: 4.5, refTot: 0.5, imbalance: 0.15 },
  store: { keepRawSessions: 5 },
  sim: { sampleHz: 500 },
} as const;
```

- [ ] **Step 6:** Run `npx vitest run tests/core`. Expected: PASS. Run `npm run build`. Expected: succeeds.
- [ ] **Step 7: Commit** `chore: scaffold project, config and seeded rng`.

---

### Task 2: Geometry and setup validation

**Files:**
- Create: `src/core/types.ts`, `src/core/geometry.ts`, `src/core/setup.ts`
- Test: `tests/core/geometry.test.ts`, `tests/core/setup.test.ts`

**Interfaces:**
- Produces, in `types.ts` (all later tasks import these):

```ts
export interface Aim { yaw: number; pitch: number }                 // degrees; +yaw right, +pitch up; yaw unwrapped
export interface MoveSample { t: number; dx: number; dy: number }   // raw counts, t in ms
export interface AimSample { t: number; yaw: number; pitch: number }
export type FovType = 'horizontal' | 'vertical';
export type Mode = 'default' | 'thorough';
export interface Setup { dpi: number; cm360: number; inGameSens: number | null; fov: number; fovType: FovType; mode: Mode }
```

- Produces, in `geometry.ts`: `degPerCount(dpi: number, cm360: number): number`; `applyMove(aim: Aim, dx: number, dy: number, dpc: number): Aim` (yaw += dx·dpc; pitch −= dy·dpc; pitch clamped to ±89); `aimToVec(aim: Aim): [number, number, number]` (yaw 0, pitch 0 → [0,0,−1]; yaw 90 → [1,0,0]; pitch 90 → [0,1,0]); `angleBetween(a: Aim, b: Aim): number`; `offsetAim(from: Aim, distanceDeg: number, directionDeg: number): Aim` (flat: yaw += D·cosθ, pitch += D·sinθ); `alongPerp(from: Aim, to: Aim, p: Aim): { along: number; perp: number }` (flat plane, measured from `from` along the unit vector `from→to`); `vfovDeg(fov: number, type: FovType, aspect: number): number`.
- Produces, in `setup.ts`: `validateSetup(input: Partial<Record<keyof Setup, unknown>>): { ok: true; setup: Setup } | { ok: false; errors: Partial<Record<keyof Setup, string>> }`.

- [ ] **Step 1: Write failing tests**

```ts
expect(degPerCount(800, 34.29)).toBeCloseTo(0.033333, 5);
expect(applyMove({ yaw: 0, pitch: 0 }, 300, 100, 0.1)).toEqual({ yaw: 30, pitch: -10 });
expect(applyMove({ yaw: 0, pitch: 85 }, 0, -100, 0.1).pitch).toBe(89);
expect(angleBetween({ yaw: 0, pitch: 0 }, { yaw: 90, pitch: 0 })).toBeCloseTo(90, 6);
expect(angleBetween({ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 45 })).toBeCloseTo(45, 6);
aimToVec({ yaw: 90, pitch: 0 }) ≈ [1, 0, 0];  aimToVec({ yaw: 0, pitch: 0 }) ≈ [0, 0, -1];
expect(alongPerp({yaw:0,pitch:0},{yaw:10,pitch:0},{yaw:11,pitch:0.5})).toEqual({ along: 11, perp: 0.5 });
expect(vfovDeg(103, 'horizontal', 16/9)).toBeCloseTo(70.53, 1);
expect(vfovDeg(70, 'vertical', 16/9)).toBe(70);
// setup
validateSetup({ dpi: 800, cm360: 34.29, inGameSens: null, fov: 103, fovType: 'horizontal', mode: 'default' }) → ok
validateSetup({ dpi: 0, ... }) → errors.dpi defined            // dpi integer 100–32000
validateSetup({ cm360: 9999, ... }) → errors.cm360 defined     // 5–200
validateSetup({ fov: '', ... }) → errors.fov defined            // horizontal 60–130, vertical 40–110
validateSetup({ inGameSens: -1, ... }) → errors.inGameSens      // null or > 0
validateSetup({ mode: 'fast', ... }) → errors.mode
validateSetup({ dpi: '1600', ... }) → ok with dpi === 1600     // numeric strings are accepted
```

- [ ] **Step 2:** Run `npx vitest run tests/core/geometry.test.ts tests/core/setup.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above. `alongPerp` scales yaw differences by `cos(mean pitch)` before projecting. Error strings are short human sentences (e.g. "DPI must be a whole number from 100 to 32000.").
- [ ] **Step 4:** Run the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): geometry and setup validation`.

---

### Task 3: Block content (flick targets, tracking path)

**Files:**
- Modify: `src/core/types.ts`
- Create: `src/core/blocks.ts`
- Test: `tests/core/blocks.test.ts`

**Interfaces:**
- Produces, added to `types.ts`:

```ts
export type Stage = 'warmup' | 'baseline' | 'dialin' | 'recheck' | 'ab';
export type BlockKind = 'warmup' | 'flick' | 'tracking';
export type Arm = 'P' | 'C';                        // pick / current
export type FlickClass = 'small' | 'medium' | 'big';
export interface BlockSpec { id: string; stage: Stage; kind: BlockKind; cm360: number; seed: number; stepIndex: number; arm: Arm | null }
export interface FlickTarget { index: number; aim: Aim; distance: number; cls: FlickClass; scored: boolean }
```

- Produces, in `blocks.ts`: `classify(distanceDeg: number, cfg: Config): FlickClass`; `makeFlickTargets(spec: BlockSpec, cfg: Config): FlickTarget[]` — starts from aim (0,0). For `flick`: `adaptationTargets` unscored targets (distances drawn from `distancesDeg` with the rng), then all 30 `distancesDeg` shuffled, scored. For `warmup`: `warmupTargets` unscored. Each target is `offsetAim(previous, D, θ)` with θ = 0° or 180° ± uniform(`directionSpreadDeg`). If the result is out of `bounds`, try mirroring horizontally, then vertically, then both, then θ = toward centre. `trackingTargetAt(spec: BlockSpec, tMs: number, cfg: Config): Aim` — the path starts at (0,0) and is made of constant-velocity segments (duration uniform in `segmentMs`, speed uniform in `speedDegPerSec`, direction mostly horizontal ±30°), reflecting at `tracking.bounds`. Segments are precomputed and cached per seed.

- [ ] **Step 1: Write failing tests**
  - `makeFlickTargets` for a flick spec returns 36 targets: the first 6 `scored: false`, then 30 `scored: true`, whose distances, sorted, equal `distancesDeg`, sorted.
  - Same spec, same targets; a different seed gives a different order.
  - Every target is within `flick.bounds`. For every target i ≥ 1, the flat distance from target i−1 equals `distance` (±1e-9), and for target 0 it's measured from (0,0).
  - `classify(21)` is 'small', `classify(22)` 'medium', `classify(35)` 'medium', `classify(36)` 'big'.
  - Warmup spec → 300 unscored targets.
  - `trackingTargetAt` is deterministic; positions 1 ms apart differ by < 0.1°; every point sampled at 10 ms over `leadInMs + durationMs` is within `tracking.bounds`; `trackingTargetAt(spec, 0)` is (0,0).
- [ ] **Step 2:** Run `npx vitest run tests/core/blocks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as described. The rng is `createRng(spec.seed)`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): standardized flick targets and tracking paths`.

---

### Task 4: Block runners

**Files:**
- Modify: `src/core/types.ts`
- Create: `src/core/run/flickRunner.ts`, `src/core/run/trackingRunner.ts`, `tests/helpers/paths.ts`
- Test: `tests/core/run/flickRunner.test.ts`, `tests/core/run/trackingRunner.test.ts`

**Interfaces:**
- Consumes: `makeFlickTargets`, `trackingTargetAt`, `applyMove`, `angleBetween`.
- Produces, added to `types.ts`:

```ts
export interface FlickClick { t: number; aim: Aim; hit: boolean }
export interface FlickTrial { target: FlickTarget; spawnT: number; spawnAim: Aim; clicks: FlickClick[]; hitT: number | null; timedOut: boolean }
export interface FlickBlockLog { spec: BlockSpec; t0: number; trials: FlickTrial[]; path: AimSample[] }
export interface TrackingBlockLog { spec: BlockSpec; t0: number; endT: number; path: AimSample[] }
```

- `class FlickRunner { constructor(spec: BlockSpec, dpc: number, cfg: Config, t0: number); onMove(s: MoveSample): void; onClick(t: number): { hit: boolean }; tick(t: number): void; readonly state: { aim: Aim; target: FlickTarget | null; trialIndex: number; total: number; done: boolean }; log(): FlickBlockLog }`. The aim starts at (0,0) and the first target spawns at `t0`. A hit means `angleBetween(aim, target.aim) ≤ flick.targetRadiusDeg`; on a hit the next target spawns at the click time. `onMove` and `tick` both apply the timeout (`t − spawnT ≥ timeoutMs` → `timedOut: true`, next target spawns at `spawnT + timeoutMs`). For warmup specs, `done` also becomes true at `t0 + session.warmupMs`.
- `class TrackingRunner { constructor(spec: BlockSpec, dpc: number, cfg: Config, t0: number); onMove(s: MoveSample): void; tick(t: number): void; readonly state: { aim: Aim; targetAim: Aim; onTarget: boolean; done: boolean }; log(): TrackingBlockLog }`. The aim starts at `trackingTargetAt(spec, 0)`, and `done` is true at `t0 + leadInMs + durationMs`.
- `tests/helpers/paths.ts`: `minJerkMoves(from: Aim, to: Aim, t0: number, durMs: number, hz: number, dpc: number): MoveSample[]` (integer counts with residual carry).

- [ ] **Step 1: Write failing tests**
  - Moving exactly onto target 0 (using `minJerkMoves`) and clicking gives `{hit: true}`; `trialIndex` becomes 1; trial 0 has `hitT` equal to the click time; trial 1 has `spawnT` equal to the click time and `spawnAim` equal to the aim at the click.
  - Clicking 5° away gives `{hit: false}`, a click recorded with `hit: false`, and the same target still active.
  - **Review Focus 1:** with no input, `tick(t0 + 4000)` marks trial 0 `timedOut`, and trial 1 has `spawnT === t0 + 4000`. Ticking through 36 × 4000 ms makes `done` true, with every trial timed out.
  - After 36 hits, `done` is true and `log().trials.length === 36`.
  - Each `onMove` call appends exactly one `AimSample` to the path.
  - Tracking: `done` is false at `t0 + 27999` and true at `t0 + 28000`. With the aim kept on the target path, `state.onTarget` is true.
- [ ] **Step 2:** Run `npx vitest run tests/core/run`. Expected: FAIL.
- [ ] **Step 3: Implement** the runners as specified.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): pure flick and tracking block runners`.

---

### Task 5: Submovement segmentation

**Files:**
- Create: `src/core/measure/submovements.ts`
- Test: `tests/core/measure/submovements.test.ts`

**Interfaces:**
- Produces: `interface Submovement { t0: number; t1: number; from: Aim; to: Aim; peakSpeed: number }`; `segmentSubmovements(path: AimSample[], tStart: number, tEnd: number, startAim: Aim, cfg: Config): Submovement[]`.

Algorithm (configured by `submovement`): divide [tStart, tEnd] into `binMs` bins. A bin's position is the last path sample at or before its end time (or `startAim` if there is none). Speed is the `angleBetween` of consecutive bin positions divided by `binMs`, in deg/s, smoothed by a centred moving average of `smoothBins`. A submovement starts at the first bin whose speed exceeds `onsetDegPerSec`, and ends at the first bin of a run of at least `endHoldMs / binMs` bins below `endDegPerSec`. `from` and `to` are the positions at its start and end. A movement still running at `tEnd` ends at `tEnd`.

- [ ] **Step 1: Write failing tests** using `tests/helpers/paths.ts` (aim samples at 1000 Hz built by applying `minJerkMoves`):
  - One 20° move over 200 ms → 1 submovement; `from` within 0.3° of the start and `to` within 0.3° of the end.
  - Two 10° moves separated by an 80 ms hold → 2 submovements.
  - Jitter of ±0.01° per sample → 0 submovements.
  - A move whose speed dips to 25 deg/s for 20 ms mid-way → 1 submovement.
  - Empty path → [].
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement** as described.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): submovement segmentation`.

---

### Task 6: Flick metrics and throughput

**Files:**
- Create: `src/core/measure/flick.ts`
- Test: `tests/core/measure/flick.test.ts`

**Interfaces:**
- Consumes: `segmentSubmovements`, `alongPerp`, `angleBetween`, `Rng`.
- Produces:

```ts
export interface TrialMetrics { index: number; cls: FlickClass; distance: number; mtMs: number; firstGain: number | null;
  corrections: number; endAlong: number | null; endPerp: number | null; hit: boolean; timedOut: boolean; scored: boolean }
export interface FlickSummary { tp: number; logTpSe: number; smallGain: number | null; mediumGain: number | null; bigGain: number | null;
  corrections: number; weDeg: number; spreadRatio: number; timeoutFraction: number; n: number }
export function measureTrial(trial: FlickTrial, path: AimSample[], cfg: Config): TrialMetrics;
export function throughput(trials: TrialMetrics[], cfg: Config): { tp: number; weDeg: number };
export function summarizeFlick(trials: TrialMetrics[], cfg: Config, rng: Rng): FlickSummary;
```

Definitions:
- `distance` = `angleBetween(spawnAim, target.aim)`.
- `mtMs` = `hitT − spawnT`, or `timeoutMs` if timed out.
- `firstGain` = `alongPerp(spawnAim, target.aim, firstSub.to).along / distance`, using the first submovement in [spawnT, hitT ?? spawnT + timeoutMs]. Null if there is none.
- `corrections` = number of submovements after the first.
- `endAlong` / `endPerp` = the first click's position relative to the target centre, on the spawn→target axis. Null if there was no click.

`throughput` uses scored trials only: `We = max(4.133 × sampleSD(endAlong over trials with a click), minWeDeg)`, `De = mean(distance + endAlong)`, `MT = mean(mtMs)/1000` over all scored trials, `TP = log2(De/We + 1) / MT`. `summarizeFlick` also computes `logTpSe` as the SD of `ln tp` over `bootstrapSamples` resamples of the scored trials, the class means of `firstGain` (null if the class is empty), `spreadRatio = weDeg / (2 × targetRadiusDeg)`, and `timeoutFraction`.

- [ ] **Step 1: Write failing tests**
  - Ten scored trials with distance 20, `mtMs` 500, `endAlong` alternating +1/−1 → `throughput(...).tp` ≈ 4.966 (2 dp) and `weDeg` ≈ 4.357 (2 dp).
  - **Review Focus 3:** ten trials with `endAlong = 0` → `weDeg === minWeDeg` and `tp` finite.
  - `measureTrial` on a path that overshoots a 20° target to 22°, then corrects back and clicks on target → `firstGain` ≈ 1.10 (±0.03), `corrections === 1`, `hit === true`.
  - A timed-out trial with no clicks → `mtMs === 4000` and `endAlong === null`, and `throughput` still works.
  - Unscored trials are ignored by `throughput`.
  - `summarizeFlick` gives the same `logTpSe` for the same seed, and `logTpSe > 0` for noisy data.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement** as defined.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): flick trial metrics and effective throughput`.

---

### Task 7: Tracking metrics and composite score

**Files:**
- Create: `src/core/measure/tracking.ts`, `src/core/score.ts`
- Test: `tests/core/measure/tracking.test.ts`, `tests/core/score.test.ts`

**Interfaces:**
- Produces: `interface TrackingSummary { tot: number; logTotSe: number; leadLagDeg: number; n: number }`; `measureTracking(log: TrackingBlockLog, cfg: Config, rng: Rng): TrackingSummary`; `interface StepScore { logS: number; se: number }`; `stepScore(flick: FlickSummary, tracking: TrackingSummary, baseline: { tp: number; tot: number } | null, cfg: Config): StepScore`.

Tracking: evaluate on a `gridHz` grid from `t0 + leadInMs` to `endT`. The crosshair position is the last path sample at or before t (or the start aim). A grid point counts as on target if `angleBetween ≤ tracking.targetRadiusDeg`. `tot` is the on-target fraction. `leadLagDeg` is the mean signed error (crosshair − target) projected on the target's velocity direction, over grid points where the target is moving faster than `minSpeedForLeadLag`. `logTotSe` is the SD of `ln(max(tot*, minTot))` over bootstrap resamples of `trackingSegmentMs` segments.

Score: `logS = w·ln(tp/b.tp) + (1−w)·ln(max(tot, minTot)/b.tot)`, with `w = score.flickWeight`. When `baseline` is null, the raw logs are used in place of the ratios. `se = sqrt(w²·logTpSe² + (1−w)²·logTotSe²)`.

- [ ] **Step 1: Write failing tests**
  - Crosshair path equal to the target path → `tot === 1` and `leadLagDeg` ≈ 0 (±0.05).
  - Crosshair = target delayed by 100 ms → `leadLagDeg < 0`, and its size is within 30% of mean speed × 0.1 s.
  - Crosshair parked 20° away → `tot === 0`, and `logTotSe` is finite.
  - Samples during the lead-in don't affect `tot`. (On target only during the lead-in → `tot === 0`.)
  - `stepScore` with flick and tracking equal to the baseline → `logS === 0`. With TP 10% above baseline and ToT equal → `logS` ≈ 0.6·ln 1.1 = 0.0572. With `logTpSe = 0.05` and `logTotSe = 0.1` → `se` ≈ sqrt(0.36·0.0025 + 0.16·0.01) = 0.05.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement** as defined.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): tracking metrics and composite score`.

---

### Task 8: Curve fit

**Files:**
- Create: `src/core/linalg.ts`, `src/core/fit.ts`
- Test: `tests/core/linalg.test.ts`, `tests/core/fit.test.ts`

**Interfaces:**
- Produces: `solve(A: number[][], b: number[]): number[] | null` (Gaussian elimination with partial pivoting; returns null if a pivot's magnitude is < 1e-12).

```ts
export interface FitPoint { x: number; y: number; se: number; t: number; isCurrent: boolean }   // x = ln(cm360), t in [0,1]
export interface FitResult { usable: boolean; coef: { a: number; b: number; c: number; d: number; f: number } | null;
  pickCm360: number; range: [number, number] | null; edge: 'faster' | 'slower' | null; lowConfidence: boolean }
export function fitCurve(points: FitPoint[], x0: number, cfg: Config, rng: Rng): FitResult;
```

Model: `y = a + b·u + c·u² + d·t + f·isCurrent`, with `u = x − x0`. Weighted least squares with weights `1/se²`, plus ridge penalties `d²/driftPriorSd²` and `f²/familiarityPriorSd²` added to the normal-equation diagonal for d and f.
- **Unusable** (fewer than `minDistinctX` distinct x values, rounded to 1e-6, or `solve` returns null) → `usable: false`, pick = the cm360 of the highest-y point, `lowConfidence: true`, `range: null`.
- **c ≥ 0** → `usable: true`, `lowConfidence: true`, pick = the cm360 of the highest-y point, `range: null`.
- **Otherwise** `u* = −b/(2c)`. If `u* > maxU`, pick `maxU` with `edge: 'slower'` (higher cm/360 is slower). If `u* < minU`, pick `minU` with `edge: 'faster'`. Then `pickCm360 = exp(x0 + u*)`.
- **Range:** parametric bootstrap, drawing `y' = y + se·normal()` `bootstrapSamples` times and refitting each draw. On `gridPoints` evenly spaced over [minU, maxU], a grid u is "near peak" in a draw if `q(u) ≥ max(q) − ln(1 + ab.minEffect)`, where `q = a + b·u + c·u²`. The range is the cm360 of the smallest and largest u that are near peak in at least `rangeFraction` of the draws. (Note: this resamples block scores from their target-bootstrap SEs, which equals the spec's target resampling to first order and is much cheaper.)

- [ ] **Step 1: Write failing tests**
  - `solve([[2,0],[0,4]],[2,8])` → [1,2]; `solve([[1,2],[2,4]],[1,2])` → null.
  - Seven points at u = −0.2…0.2 with `y = −2(u − 0.1)²`, se 0.01, t = i/6, isCurrent at u = 0 → `coef.c` ≈ −2 (±0.05), `pickCm360` within 0.5% of `exp(x0 + 0.1)`, `edge` null, and `range` containing the pick.
  - Same data with the peak at u = 0.5 → `edge === 'slower'` and `pickCm360` ≈ `exp(x0 + 0.2)`. With the peak at u = −0.5 → `edge === 'faster'`.
  - `y = +2u²` → `lowConfidence` with the pick at the best point.
  - Only 3 distinct x values → `usable === false`.
  - Familiarity: the first dataset with +0.03 added to two current points (t = 0 and t = 0.5) → pick within 5% of `exp(x0 + 0.1)`.
  - Drift: adding `+0.05·t` to every y → `coef.d > 0`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement** as defined.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): weighted ridge quadratic fit with bootstrap range`.

---

### Task 9: Steering

**Files:**
- Modify: `src/core/types.ts`
- Create: `src/core/steer.ts`
- Test: `tests/core/steer.test.ts`

**Interfaces:**
- Produces, added to `types.ts`:

```ts
export interface StepResult { order: number; stage: Exclude<Stage, 'warmup'>; arm: Arm | null; cm360: number;
  trials: TrialMetrics[]; flick: FlickSummary; tracking: TrackingSummary; score: StepScore }
```

- In `steer.ts`:

```ts
export interface SteerContext { currentCm360: number; baseline: StepResult; steps: StepResult[]; fit: FitResult | null;
  stepIndex: number; totalSteps: number; rng: Rng }      // steps: all non-baseline steps so far, in order
export interface SteerDecision { cm360: number; direction: 'slower' | 'faster'; stepSize: number; signal: number; reason: string }
export function stepSize(stepIndex: number, totalSteps: number, cfg: Config): number;
export function chooseNext(ctx: SteerContext, cfg: Config): SteerDecision;
```

Algorithm (`dir` = +1 means slower, i.e. a higher cm/360):
- **`stepSize`:** `bracket` for index 0–1, then geometric from `bracket` to `finalStep` across indices 2…n−1.
- **Index 0:** `dir = rng.next() < 0.5 ? +1 : −1`. **Index 1:** the opposite of index 0's direction. In both cases `cm360 = current·(1+bracket)^dir` and the reason is "Bracketing: testing a slower/faster sens".
- **Index ≥ 2:**
  - `center = fit && fit.usable && !fit.lowConfidence ? fit.pickCm360 : (highest-score step).cm360`.
  - `last` = the latest entry of `steps`. `prev` = the step before it, or the baseline.
  - `disc = exp(−|ln(last.cm360/prev.cm360)| / jumpScale)`.
  - `s = disc·(wS·Δ(smallGain) + wB·Δ(bigGain) + wL·Δ(leadLagDeg)/leadLagScaleDeg) + wC·sign(slope)·max(0, Δ(corrections)/correctionsScale + Δ(spreadRatio))`. Each Δ is `last − baseline`; null gains count as 0. `slope` is the fit's `b + 2c·u_center` (0 if there is no usable fit).
  - If `|s| < deadband`, `dir` is the opposite of the side of `center` that `last` was on. Otherwise `dir = sign(s)`.
  - `cm360 = center·(1+stepSize)^dir`, clamped to `[limits.min, limits.max]·current`. If that's within `minSeparation` (relative) of any tested cm360, flip `dir` once and recompute.
  - The reason names the main driver, e.g. "Small flicks overshot more than baseline → testing slower".

- [ ] **Step 1: Write failing tests** (build StepResults with a small factory in the test file)
  - Index 0 and index 1 land on opposite sides of current, each ±15%. The same rng seed gives the same order.
  - Small-flick overshoot (`smallGain` = baseline + 0.15) → `direction 'slower'` and cm360 > center.
  - Big-flick undershoot (`bigGain` = baseline − 0.15) → `'faster'`.
  - Signals within the deadband → the opposite side of center from `last`.
  - Center at 1.58×current with direction slower → `cm360 ≤ 1.6×current`.
  - Next value coinciding with a tested value → the flip happens.
  - The same Δ signals after a bigger preceding jump → a smaller `|signal|`.
  - `stepSize(2,6) === 0.15`, `stepSize(5,6)` ≈ 0.04, and the sizes are strictly decreasing.
  - `reason` is non-empty and contains no digits followed by "cm" (no sens values leak into reasons).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement** as defined.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): steering for the next hidden sens`.

---

### Task 10: A/B decision, diagnosis, result

**Files:**
- Create: `src/core/ab.ts`, `src/core/diagnose.ts`, `src/core/result.ts`
- Test: `tests/core/ab.test.ts`, `tests/core/diagnose.test.ts`, `tests/core/result.test.ts`

**Interfaces:**

```ts
// ab.ts
export interface AbBlock { arm: Arm; logS: number; se: number }
export interface AbDecision { decision: 'change' | 'keep' | 'none' | 'continue'; delta: number; se: number; look: 1 | 2 }
export function abSequence(rng: Rng): Arm[];                 // ['P','C','C','P'] or ['C','P','P','C']
export function extendSequence(first: Arm[]): Arm[];         // swap labels: ABBA → BAAB
export function decideAB(blocks: AbBlock[], look: 1 | 2, cfg: Config): AbDecision;
// diagnose.ts
export type FindingId = 'spread' | 'corrections' | 'smallOvershoot' | 'bigShort' | 'trackingWeaker' | 'flickingWeaker';
export interface Finding { id: FindingId; label: string; value: number; threshold: number; severity: number }
export function diagnose(flick: FlickSummary[], tracking: TrackingSummary[], cfg: Config): Finding[];
// result.ts
export type Verdict = 'change' | 'keep' | 'none';
export interface SessionResult { verdict: Verdict; currentCm360: number; pickCm360: number; recommendedCm360: number;
  range: [number, number] | null; multiplier: number; newInGameSens: number | null; edge: 'faster' | 'slower' | null;
  lowConfidence: boolean; abSkipped: boolean; ab: AbDecision | null; findings: Finding[] }
export function buildResult(args: { setup: Setup; fit: FitResult | null; pickCm360: number; ab: AbDecision | null;
  abSkipped: boolean; findings: Finding[] }): SessionResult;
```

Rules:
- **`decideAB`:** `delta = mean(logS of P) − mean(logS of C)`, `se = sqrt(Σse_P²/n_P² + Σse_C²/n_C²)`, `m = ln(1 + minEffect)`. Apply in order: `delta > m && delta > z·se` → change; `delta < 0 && −delta > z·se` → keep; `delta + z·se < m` → none; otherwise `look === 1 ? 'continue' : 'none'`.
- **`diagnose`:** average each metric over its inputs. A finding is emitted only when its threshold is crossed: `spreadRatio > spreadRatioMax`; `corrections > correctionsMax`; `smallGain > smallGainMax`; `bigGain < bigGainMin`; then `rel = (tot/refTot)/(tp/refTp)`, where `rel < 1 − imbalance` → trackingWeaker and `rel > 1 + imbalance` → flickingWeaker. `severity` is how far past the threshold, as a ratio (≥ 0). Results are sorted by severity, descending. Labels, verbatim:
  - spread: "Landing spread — train precision on small static targets."
  - corrections: "Micro-corrections — train first flicks that land without adjusting."
  - smallOvershoot: "Small flicks overshoot — train short-range control."
  - bigShort: "Big flicks fall short — train committing fully to long flicks."
  - trackingWeaker: "Tracking is behind your flicking — train tracking."
  - flickingWeaker: "Flicking is behind your tracking — train flicking."
- **`buildResult`:** `abSkipped` → verdict 'keep'; `ab.decision === 'change'` → 'change'; 'keep' → 'keep'; otherwise 'none'. `recommendedCm360` is `pickCm360` for 'change' and current otherwise. `multiplier = round2(current/recommended)`; `newInGameSens = inGameSens === null ? null : round2(inGameSens·current/recommended)`.

- [ ] **Step 1: Write failing tests**
  - `abSequence` is one of the two patterns. `[...s, ...extendSequence(s)]` has equal sums of positions for P and C.
  - P blocks logS 0.08 and C blocks 0, all se 0.01 → change. P −0.08 → keep. delta 0.005, se 0.005 → none. delta 0.03, se 0.02 → `continue` at look 1 and `none` at look 2.
  - Diagnose with spreadRatio 1.4 and everything else in bounds → exactly one finding, `spread`, with severity ≈ 0.4. Nothing out of bounds → []. Several findings come back sorted by severity.
  - `buildResult`: current 30, pick 33.333, change, inGameSens 33 → multiplier 0.9 and newInGameSens 29.7. abSkipped → keep, recommended = current, multiplier 1. `none` → recommended = current.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement** as defined.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): adaptive A/B rule, diagnosis and verdict`.

---

### Task 11: Simulated player

**Files:**
- Create: `src/core/sim/player.ts`, `src/core/sim/simulate.ts`
- Test: `tests/core/sim/simulate.test.ts`

**Interfaces:**

```ts
export interface SimPlayer { optimalCm360: number; currentCm360: number; curvature: number; familiarityBonus: number;
  adaptationRate: number; gainExponent: number; motorNoise: number; driftPerBlock: number }
export interface SimState { adaptedCm360: number; blocksDone: number }
export function defaultSimPlayer(currentCm360: number, overrides?: Partial<SimPlayer>): SimPlayer;
  // defaults: optimal = current·0.88, curvature 2, familiarityBonus 0.02, adaptationRate 0.15, gainExponent 1, motorNoise 1, driftPerBlock 0.002
export function performance(player: SimPlayer, cm360: number, state: SimState): number;
  // exp(−curvature·(ln cm360 − ln optimal)²) · (|ln(cm360/current)| < 1e-9 ? 1+familiarityBonus : 1) · (1 + driftPerBlock·blocksDone)
export function simulateBlock(spec: BlockSpec, setup: Setup, player: SimPlayer, state: SimState, rng: Rng, cfg: Config, t0: number):
  { log: FlickBlockLog | TrackingBlockLog; state: SimState; endT: number };
```

Movement model (perf = `performance(...)`; `k = motorNoise / perf`). Output is integer-count `MoveSample`s at `sim.sampleHz` (residual carried), fed into the real `FlickRunner` / `TrackingRunner`.
- **Flick, per target:** a reaction of `max(120, 200 + 25·normal)` ms. The first move is a minimum-jerk motion toward the target. Its amplitude is `D · (adapted/test)^gainExponent · (1 + 0.08·k·normal)`, its direction error is `2°·k·normal`, and its duration is `(120 + 70·log2(D/(2r) + 1)) / perf` ms. While the error is above 0.7·r, up to 4 corrections follow, each after a 60 ms pause: amplitude = error · (1 + 0.15·k·normal), duration `110/perf` ms. The click comes 40 ms after the last move. A miss triggers another correction cycle. After each target, `ln adapted += adaptationRate · (ln test − ln adapted)`.
- **Tracking:** at each sample, crosshair velocity = `(adapted/test)^gainExponent` × (the target velocity from 150/perf ms ago + 6·(target − aim)) + `k·3°/s` noise. Adaptation is updated once per second of tracking.

- [ ] **Step 1: Write failing tests**
  - Flick block at test = adapted = optimal → ≥ 34 of 36 trials hit, 0 timeouts, and mean `firstGain` of the scored trials (via `measureTrial`) within 1 ± 0.05.
  - `adaptedCm360 = 1.2·test` → the small and big class `firstGain` means are both > 1.1.
  - Averaged over 10 seeds, `summarizeFlick(...).tp` at optimal > tp at 1.4·optimal, and tracking `tot` at optimal > tot at 1.4·optimal.
  - Same seed → an identical log.
  - A simulated tracking block ends at `t0 + 28000`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement** as defined.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): simulated player driving the real runners`.

---

### Task 12: Session state machine

**Files:**
- Create: `src/core/session.ts`, `src/core/sim/runSession.ts`
- Test: `tests/core/session.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:

```ts
export interface SessionOptions { seed: number; warmup: boolean; quickAbCm360: number | null }
export interface SessionState { readonly setup: Setup; readonly mode: 'full' | 'quickab'; readonly steps: StepResult[];
  readonly fit: FitResult | null; readonly steerLog: SteerDecision[]; readonly abDecisions: AbDecision[];
  readonly logs: { flick: FlickBlockLog[]; tracking: TrackingBlockLog[] }; readonly result: SessionResult | null;
  readonly progress: { stage: Stage; stepIndex: number; totalSteps: number; kind: BlockKind } | null /* for the HUD */ ;
  /* plus private fields */ }
export function createSession(setup: Setup, opts: SessionOptions, cfg?: Config): SessionState;
export function nextBlock(s: SessionState): BlockSpec | null;               // null once result is set
export function submitBlock(s: SessionState, log: FlickBlockLog | TrackingBlockLog | null): SessionState;  // null only for warmup; returns a new state
// runSession.ts
export function runSimSession(setup: Setup, player: SimPlayer, opts: SessionOptions, cfg?: Config):
  { state: SessionState; blocks: { spec: BlockSpec; log: FlickBlockLog | TrackingBlockLog | null }[] };
```

Sequence rules:
- **Order of blocks:** `[warmup] → baseline(flick, tracking) → dial-in steps 0…n−1`. Each step is a flick block then a tracking block at a `chooseNext` sens. The recheck step (at current sens) comes after dial-in step `floor(n/2) − 1`.
- **Fit:** refit after every completed step, using every step except A/B ones. `x = ln cm360`, `y = score.logS`, `t = order/(count−1)`, `isCurrent` for baseline and recheck.
- **Scoring:** step scores are computed against the baseline step's tp and tot. The baseline itself scores logS = 0, with its own se.
- **After dial-in:** `pick = fit.pickCm360`. If `|ln(pick/current)| < ln(1 + ab.minEffect)`, skip the A/B.
- **A/B:** otherwise run `abSequence`. Each arm is a flick+tracking step with `stage 'ab'`. Run `decideAB` look 1 after 4 blocks. On `continue`, run `extendSequence` and then look 2.
- **Diagnosis** uses the steps at the recommended sens: the A/B steps for that arm, or the baseline and recheck if the A/B was skipped.
- **Retry (Review Focus 1):** a flick log with `timeoutFraction > invalidTimeoutFraction`, or a tracking `tot < invalidMinTot`, is not accepted. `nextBlock` then returns the same spec again, at most `maxRetries` times, after which it's accepted.
- **Quick A/B mode** (`quickAbCm360` set): only the A/B steps, with P = quickAbCm360, C = setup.cm360, no 3% skip, and scores relative to a null baseline.
- **Seeds:** `fork(blockId)` of the session rng. Spec ids are unique, e.g. `"dialin-2-flick"`; a retry reuses the id.

- [ ] **Step 1: Write failing tests**
  - Default mode, no warmup: the stage/kind sequence up to the A/B is exactly baseline·F, baseline·T, then dial-in 0,1,2 (F,T each), recheck (F,T), dial-in 3,4,5 (F,T each). Baseline and recheck specs have `cm360 === setup.cm360`.
  - Thorough mode → 10 dial-in steps, with the recheck after step 4.
  - Warmup on → the first spec is `kind 'warmup'`; `submitBlock(s, null)` advances.
  - Submitting a flick log that is all timeouts → `nextBlock` returns the same spec id. Submitting the same invalid log again → it's accepted and the sequence moves on.
  - `runSimSession` with the default player completes: `result` is non-null; there are 8 or 12 A/B blocks (or 0 with `abSkipped`); `logs.flick.length` equals the number of flick specs.
  - `runSimSession` with `optimalCm360 = current` and `curvature 6` → `abSkipped === true` and verdict 'keep', in at least 8 of 10 seeds.
  - Quick A/B: the first spec has stage 'ab'; no baseline or dial-in specs appear.
  - `submitBlock` doesn't mutate its input state.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement** as defined.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): session state machine and simulated sessions`.

---

### Task 13: Statistical validation with the simulator

**Files:**
- Create: `tests/stats/convergence.test.ts`, `tests/stats/abNull.test.ts`
- Modify (only if calibration requires it): `src/core/config.ts` (`ab.z`)

**Interfaces:**
- Consumes: `runSimSession`, `defaultSimPlayer`.

- [ ] **Step 1: Write the tests** (fixed seeds; setup dpi 800, cm360 34.29, fov 103 horizontal, mode default)
  - **Convergence:** 100 runs with `optimalCm360 = current × u`, u uniform in [0.75, 1.3]. At least 80 runs have `|ln(pickCm360 / optimalCm360)| < ln 1.08`.
  - **Null A/B:** 200 quick-A/B runs with `curvature 0`, `familiarityBonus 0`, `quickAbCm360 = 1.1 × current`. The fraction of verdict 'change' is ≤ 0.05.
  - **Familiarity:** 50 runs with `familiarityBonus 0.04` and `optimal = 0.85 × current`. The median of `pick/optimal` is within [0.94, 1.06].
  - **Edge:** 20 runs with `optimal = 0.4 × current`. At least 18 have `edge === 'faster'`.
  - **Test-retest sanity:** 20 pairs of runs with the same player and different seeds. In at least 16 pairs, both picks are within ±10% of each other.
- [ ] **Step 2:** Run `npm run test:stats`. Expected: PASS. Also record the observed rates in the commit message.
- [ ] **Step 3: Calibrate if needed.** If the null A/B false-change rate is above 0.05, raise `ab.z` in steps of 0.1 until it passes. If convergence fails, use superpowers:systematic-debugging on the steering and fit before changing any thresholds. Don't loosen the test thresholds.
- [ ] **Step 4:** Run `npm test && npm run test:stats`. Expected: PASS.
- [ ] **Step 5: Commit** `test(stats): simulator validation of steering, fit and A/B rule`.

---

### Task 14: History, export, setup memory

**Files:**
- Create: `src/store/history.ts`, `src/store/export.ts`, `src/store/setupStore.ts`
- Test: `tests/store/history.test.ts`, `tests/store/export.test.ts`

**Interfaces:**

```ts
export interface SessionRecord { id: string; createdAt: string; mode: 'full' | 'quickab'; setup: Setup; result: SessionResult;
  steps: StepResult[]; steerLog: SteerDecision[]; abDecisions: AbDecision[]; raw: SessionState['logs'] | null }
export interface SessionSummary { id: string; createdAt: string; mode: 'full' | 'quickab'; setup: Setup; result: SessionResult }
export interface History { save(rec: SessionRecord): Promise<void>; list(): Promise<SessionSummary[]> /* newest first */; get(id: string): Promise<SessionRecord | null> }
export function openHistory(cfg?: Config): Promise<History | null>;  // null if indexedDB is missing or open() fails
export function recordFromSession(s: SessionState, now: Date, id: string): SessionRecord;
export function toJson(rec: SessionRecord): string;
export function toCsv(rec: SessionRecord): string;
export function loadSetup(): Partial<Setup> | null; export function saveSetup(s: Setup): void;   // localStorage 'bsf.setup', try/catch
```

`save` keeps `raw` only on the `store.keepRawSessions` newest records and sets it to null on older ones. The CSV header, verbatim:
`session_id,stage,step,arm,cm360,trial,class,distance_deg,mt_ms,first_gain,corrections,end_along_deg,end_perp_deg,hit,timed_out,scored`
There is one row per trial of every step, and nulls are written as empty fields.

- [ ] **Step 1: Write failing tests** (`import 'fake-indexeddb/auto'`; build records from `runSimSession`)
  - Save 3 records → `list()` returns them newest first, without a `raw` field.
  - Save 7 → only the 5 newest have non-null `raw` via `get`.
  - **Review Focus 5:** with `globalThis.indexedDB` undefined, `openHistory()` resolves to null and doesn't throw.
  - The CSV's first line equals the header; the row count equals the total number of trials across steps; null `first_gain` gives an empty field.
  - `JSON.parse(toJson(rec))` deep-equals `rec`.
  - `loadSetup()` returns null when localStorage throws.
- [ ] **Step 2:** Run `npx vitest run tests/store`. Expected: FAIL.
- [ ] **Step 3: Implement** with plain IndexedDB (database `bsf`, store `sessions`, keyPath `id`, index on `createdAt`).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(store): session history, export and setup memory`.

---

### Task 15: Raw input and 3D scene

**Files:**
- Create: `src/input/rawInput.ts`, `src/scene/camera.ts`, `src/scene/scene.ts`
- Test: `tests/input/rawInput.test.ts`, `tests/scene/camera.test.ts`

**Interfaces:**

```ts
// rawInput.ts
export type LockResult = 'raw' | 'unsupported' | 'denied';
export function requestRawPointerLock(el: { requestPointerLock(opts?: unknown): unknown }): Promise<LockResult>;
export function samplesFromEvent(e: { timeStamp: number; movementX: number; movementY: number; getCoalescedEvents?(): unknown[] }): MoveSample[];
export function startCapture(target: Document, onMove: (s: MoveSample) => void, onClick: (t: number) => void, onLockLost: () => void): () => void;
// camera.ts
export function aimToEuler(aim: Aim): { x: number; y: number; order: 'YXZ' };    // x = pitch rad, y = −yaw rad
export function targetPosition(aim: Aim, distance: number): [number, number, number];
export function sphereRadiusFor(angularRadiusDeg: number, distance: number): number;  // distance·tan(r)
// scene.ts
export interface SceneApi { setAim(a: Aim): void; setFlickTarget(a: Aim | null): void; setTrackingTarget(a: Aim | null, onTarget: boolean): void;
  resize(w: number, h: number): void; render(): void; dispose(): void }
export function createScene(canvas: HTMLCanvasElement, opts: { fov: number; fovType: FovType; targetRadiusDeg: number }): SceneApi;
```

- **`requestRawPointerLock`:** calls `requestPointerLock({ unadjustedMovement: true })`. A returned promise that resolves → 'raw'. A rejection with `name === 'NotSupportedError'` → 'unsupported', and any other rejection → 'denied'. A non-promise return (the legacy API can't guarantee raw input) → 'unsupported'.
- **`startCapture`:** uses `pointerrawupdate` if `'onpointerrawupdate' in window`, else `pointermove`. Clicks come from `mousedown` with button 0. `pointerlockchange` to unlocked → `onLockLost`.
- **`samplesFromEvent`:** expands coalesced events when present, otherwise uses the event itself.
- **Scene:** a room box of half-size 30 with grid-textured walls (a `CanvasTexture`), ambient + directional light, targets as `MeshStandardMaterial` spheres at distance 20, and the tracking target tinted brighter while on target. `PerspectiveCamera` fov = `vfovDeg(fov, fovType, aspect)`, recomputed on `resize`. The crosshair is a DOM overlay (Task 16), not part of the scene.

- [ ] **Step 1: Write failing tests**
  - Fake element whose `requestPointerLock` returns `Promise.resolve()` → 'raw'. Rejecting with `{name:'NotSupportedError'}` → 'unsupported'. Rejecting with `{name:'SecurityError'}` → 'denied'. Returning `undefined` → 'unsupported'.
  - `samplesFromEvent` with 3 coalesced events → 3 samples with their own timestamps; without `getCoalescedEvents` → 1 sample.
  - `targetPosition({yaw:90,pitch:0}, 20)` ≈ [20,0,0]. `aimToEuler({yaw:90,pitch:10})` → y ≈ −π/2 and x ≈ 0.1745. `sphereRadiusFor(1.5, 20)` ≈ 0.5237.
- [ ] **Step 2:** Run `npx vitest run tests/input tests/scene`. Expected: FAIL.
- [ ] **Step 3: Implement** all three files.
- [ ] **Step 4:** Run the tests. Expected: PASS. Run `npm run build`. Expected: succeeds.
- [ ] **Step 5: Commit** `feat: raw pointer-lock input and three.js scene`.

---

### Task 16: Run controller and run screen

**Files:**
- Create: `src/ui/runController.ts`, `src/ui/Run.tsx`, `src/ui/styles.css`
- Test: `tests/ui/runController.test.ts`

**Interfaces:**

```ts
export type RunPhase = 'rest' | 'running' | 'paused' | 'finished';
export interface RunController { readonly phase: RunPhase; readonly session: SessionState; readonly hud: string; readonly restText: string;
  begin(t: number): void; onMove(s: MoveSample): void; onClick(t: number): void; tick(t: number): void;
  onLockLost(): void; skipWarmup(): void; readonly runner: FlickRunner | TrackingRunner | null }
export function createRunController(session: SessionState, cfg?: Config): RunController;
export function hudText(progress: NonNullable<SessionState['progress']>): string;
```

- **`begin`** creates a runner for `nextBlock(session)` with `degPerCount(setup.dpi, spec.cm360)`.
- When the runner reports `done`, its log goes to `submitBlock` and the phase becomes 'rest' (or 'finished' once a result exists).
- **`onLockLost` while running:** the runner is discarded and the phase becomes 'paused'. The next `begin` starts the same spec fresh.
- **`hudText` copy:** "Warm-up", "Baseline · Flick", "Step 3 of 7 · Tracking", "Final check · Flick" (for the A/B). The recheck is numbered as a normal step, so the displayed total is dial-in steps + 1 (7 in default mode, 11 on Thorough) and the recheck isn't revealed. Never any cm/360 value.
- **`restText`** is the rest-screen instruction for the next block: "Next: flicks — click each target as fast as you can." / "Next: tracking — keep the crosshair on the moving target." / warm-up text.
- **`Run.tsx`:** a full-screen canvas, the crosshair overlay, the HUD in the top-left, and a rest card ("Click to start"; the click calls `requestRawPointerLock` then `begin`). The pause card reads "Paused — this block will restart." A `requestAnimationFrame` loop calls `tick(performance.now())` and the scene setters. In warm-up, a "Skip warm-up" button is shown on the rest card.
- **Styles:** a dark aim-trainer look (near-black background, one accent colour, a monospace HUD).

- [ ] **Step 1: Write failing tests** (drive with `runSimSession`'s `blocks` logs, or build moves with `tests/helpers/paths.ts`)
  - **Review Focus 2:** begin → a few moves → `onLockLost()` → `phase 'paused'`, and `session.steps` is unchanged. `begin` again → the runner is a fresh instance on the same spec id with an empty path.
  - After completing a flick runner's targets, the phase is 'rest' and `nextBlock(session)` is the tracking spec.
  - `hudText` never contains `cm` or the cm360 digits for any spec in a simulated session; the recheck step shows "Step 4 of 7".
- [ ] **Step 2:** Run `npx vitest run tests/ui/runController.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the controller, then `Run.tsx`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): run controller and run screen`.

---

### Task 17: App shell, setup, results, log, history

**Files:**
- Create: `src/ui/App.tsx`, `src/ui/Setup.tsx`, `src/ui/Results.tsx`, `src/ui/CurveChart.tsx`, `src/ui/BlockLog.tsx`, `src/ui/History.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `validateSetup`, `loadSetup/saveSetup`, `createSession`, `openHistory`, `recordFromSession`, `toJson/toCsv`, `Run`.
- App screens: `'setup' | 'run' | 'results' | 'history' | 'demo'`.

Behaviour:
- **Setup** shows fields with per-field error text from `validateSetup`, a warm-up checkbox (default on, labelled "Warm up first (recommended, 3 min)"), mode radio buttons, and Start. If the lock result is 'unsupported', it shows the Global Constraints message and a "Try the demo" button.
- **Results** shows:
  - The verdict headline: "Change to X cm/360", "Keep your current sens" or "No clear winner — keep your current sens".
  - The multiplier and new in-game sens, the range text "Anything from A to B cm/360 performs the same for you", and edge/low-confidence notes.
  - The top 2 findings, each with its value and threshold, marked "(provisional threshold)".
  - The familiarity and in-game-transfer caveat.
  - `CurveChart`: an SVG with a log-scale x axis in cm/360 and logS% on y; tested steps as points, the fitted curve, the range band, the current sens marked, and A/B points in a second colour.
  - `BlockLog`: an expandable table per step (stage, cm360, TP, ToT, gains, corrections, spread, steer reason, A/B decisions).
  - Export JSON and Export CSV buttons (Blob download).
- **History** lists sessions (date, verdict, recommended, range), drawing ranges as horizontal bars on a shared cm/360 axis so overlap shows test-retest agreement. On a 'change' session it offers "Quick A/B re-check", which starts a quick-A/B session with `setup.cm360` = the user's current setting and `quickAbCm360` = that record's previous current sens. If `openHistory()` returned null, it shows "History isn't available in this browser window." (Review Focus 5) and the session flow still works.
- The completed session is saved via `history.save(recordFromSession(...))` when history is available.

- [ ] **Step 1:** Implement the components (the logic they call is already tested).
- [ ] **Step 2:** Run `npm run build`. Expected: succeeds with no type errors.
- [ ] **Step 3: Manual check** with the browser pane (`preview_start` name `dev`):
  - Invalid DPI shows the error text.
  - A valid setup reaches the rest card.
  - Open `/?simresult=1` (a dev-only query that renders Results from a `runSimSession` run). All results sections render, both exports download, and History lists the session.
  - Reload, and the setup is pre-filled.
- [ ] **Step 4: Commit** `feat(ui): setup, results, block log and history screens`.

---

### Task 18: Demo mode

**Files:**
- Create: `src/ui/demoScript.ts`, `src/ui/Demo.tsx`
- Test: `tests/ui/demoScript.test.ts`

**Interfaces:**

```ts
export interface DemoClip { caption: string; spec: BlockSpec; log: FlickBlockLog | TrackingBlockLog; fromT: number; toT: number; speed: number }
export function buildDemoScript(run: ReturnType<typeof runSimSession>, cfg?: Config): DemoClip[];
```

- **Script:** a simulated session with setup dpi 800, cm360 34.29, fov 103 horizontal; player `defaultSimPlayer(34.29)`; seed from the date.
- **Clips:** baseline flick (the first 8 scored trials), baseline tracking (6 s), dial-in steps 0 and 2 (8 trials each), one tracking excerpt, and one A/B flick excerpt. Each runs at 1.5× speed and each is ≤ 20 s of playback.
- **Captions** explain the stage. Dial-in captions include that step's steer `reason`, with values still hidden. Between clips, a "Fast-forwarding through the remaining steps" caption.
- **`Demo.tsx`** replays each clip's `path` and trial spawns into the scene by timestamp, works with touch (tap to skip to the next clip), has no pointer lock, and ends on `Results` for the simulated session, labelled "Demo results (simulated player)". The layout works at 375 px width.

- [ ] **Step 1: Write failing tests**
  - Every clip has a non-empty caption.
  - At least one dial-in clip's caption contains its steer reason.
  - `(toT − fromT)/speed ≤ 20000` for every clip.
  - No caption contains "cm/360" followed by a number.
- [ ] **Step 2:** Run `npx vitest run tests/ui/demoScript.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4:** Run the tests. Expected: PASS. **Manual check:** in the browser pane at the mobile preset (375×812), the demo plays, the captions are readable, and it reaches the results.
- [ ] **Step 5: Commit** `feat(ui): phone-friendly simulated demo with captions`.

---

### Task 19: Ship check

**Files:**
- Create: `README.md` (what it is, how to run, how to deploy `dist/` to any static host, the measurement caveats)

- [ ] **Step 1:** Run `npm test && npm run test:stats && npm run build`. Expected: all pass, and `dist/` exists.
- [ ] **Step 2:** Run `npx vite preview`, open it in the browser pane, and check that the built site loads from `dist/` with relative paths. The setup screen works, and the demo plays.
- [ ] **Step 3: Manual real-mouse check** (the user does this on desktop Chrome). Play one full session. Confirm:
  - The raw lock succeeds.
  - No sens value is visible before the results.
  - Esc pauses and the block restarts.
  - The session length is within the spec's ~14–19 min (+3 for warm-up).
  - The results and export look right.
  - Record any issues as follow-ups.
- [ ] **Step 4: Commit** `docs: README and ship check`.
