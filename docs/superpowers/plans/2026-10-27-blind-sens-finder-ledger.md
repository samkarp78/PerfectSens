# SDD ledger — plan: docs/superpowers/plans/2026-10-27-blind-sens-finder.md

Spec: docs/superpowers/specs/2026-10-27-blind-sens-finder-design.md
Branch: feature/blind-sens-finder (created from master 28e82dd)

Ruling: work on branch feature/blind-sens-finder in the main checkout, not a separate worktree — local-only repo in a OneDrive folder, no remote; a branch isolates master — cost if wrong: none beyond a branch switch.

## Pre-flight scan

| Tasks | Shared file/interface | Finding |
|---|---|---|
| T2,T3,T4,T9 | src/core/types.ts | additive only; T9 adds StepResult that references TrialMetrics/FlickSummary (T6), TrackingSummary/StepScore (T7) → circular module refs. Ruling below. |
| T3→T4 | makeFlickTargets, trackingTargetAt | consistent; both start aim at (0,0) |
| T4→T6 | FlickTrial, FlickBlockLog.path | consistent |
| T5→T6 | segmentSubmovements(path,tStart,tEnd,startAim,cfg) | consistent |
| T6,T7→T7 score | logTpSe, logTotSe | consistent |
| T8→T9 | FitResult.pickCm360/coef/usable/lowConfidence | consistent; slope needs u_center = ln(center) − ln(current), available from ctx.currentCm360 |
| T8,T10,T12 | ab.minEffect used by fit range, AB, skip rule | consistent |
| T11→T12 | simulateBlock, SimState | consistent |
| T12→T16 | progress.stepIndex/totalSteps vs HUD "Step 4 of 7" | conflict: T12 does not say whether recheck counts in totalSteps. Ruling below. |
| T12→T18 | steerLog ↔ dial-in steps | mapping unstated. Ruling below. |
| T12→T14 | SessionState.result/steps/logs | consistent |
| T10→T17 | SessionResult fields | consistent |
| T15→T16 | requestRawPointerLock, startCapture | consistent |

| Task | Self-consistency |
|---|---|
| T1 | ok (config values listed; tests match) |
| T2 | ok |
| T3 | ok (mirroring preserves distance, so the flat-distance test holds) |
| T4 | ok |
| T5 | ok |
| T6 | ok (4.966 / 4.357 checked by hand) |
| T7 | ok |
| T8 | ok |
| T9 | ok (stepSize(2,n)=bracket matches geometric start) |
| T10 | ok (33×0.9=29.7) |
| T11 | ok |
| T12 | ok, see progress ruling |
| T13 | ok |
| T14 | ok |
| T15 | ok |
| T16 | ok after ruling |
| T17 | no automated tests (UI only, logic tested elsewhere) — acceptable, manual check given |
| T18 | ok |
| T19 | ok |

Ruling: types.ts uses `import type` for TrialMetrics/FlickSummary/TrackingSummary/StepScore/FitResult etc. — type-only cycles are erased at compile time — cost if wrong: trivial refactor to move types.
Ruling: SessionState.progress.stepIndex is the 0-based position in the combined dial-in+recheck sequence and totalSteps = dial-in steps + 1 (7 default, 11 thorough); hudText shows stepIndex+1; recheck in default mode is position 3 → "Step 4 of 7" — matches the T16 HUD copy, keeps recheck hidden — cost if wrong: HUD numbering tweak.
Ruling: steerLog[i] is the SteerDecision that produced dial-in step i (bracket steps included) — needed by T18 demo captions — cost if wrong: caption lookup change.

## Progress
Task 1: minor (deferred): package.json npm-init leftovers (empty description/author, ISC, directories.doc); no "engines": {"node": ">=20"} (vite 8 needs ^20.19 || >=22.12); unquoted --exclude glob; rng test .sort() without comparator.
Task 1: complete (commits 28e82dd..76a8300, review clean; ⚠️ trailer verified by controller)
Ruling (T2 dispatch): setup validation ranges and the ±89 pitch clamp go in config.ts (`setup`, `geometry` keys) — global "no magic numbers in src/core" — cost if wrong: none. inGameSens null/undefined/'' → null.
Task 2: minor (deferred): alongPerp tested only at pitch 0 (no nonzero-pitch, negative-perp, from==to cases); whitespace-only inGameSens errors instead of null; Number() accepts "1e2"/"0x10".
Task 2: complete (commits 76a8300..ded3871, review clean; trailer verified)
Ruling (T3 dispatch): flat distance = sqrt(Δyaw²+Δpitch²); classify <22 small, >35 big; tracking direction spread → config tracking.directionSpreadDeg 30; makeFlickTargets throws for kind 'tracking' — cost if wrong: small test/impl tweak.
Task 3: minor (deferred): nextAim fallback can silently return an out-of-bounds aim if config changes; trackingTargetAt(Infinity) loops forever (no Number.isFinite guard); unbounded per-seed path cache; seed-sensitivity/determinism tests weak; no test that a reflection happens.
Task 3: complete (commits ded3871..62d728d, review clean)
Ruling (T4 dispatch): runners process timeouts up to s.t before applying a move/click; clicks/moves after done are ignored ({hit:false}); state.target null when done; warmup done when all targets are consumed or t ≥ t0+warmupMs — cost if wrong: small runner tweak.
Task 4: note: implementer skipped observing RED (tests written but implementation written before first run); warmup end leaves active trial with hitT null, timedOut false (acceptable: warmup is unscored).
Task 4: minor (deferred): warmup-end vs timeout ordering branch and warmup all-consumed path untested; log() returns live internal arrays; duplicated finished check in TrackingRunner.onMove; long constructor lines. (⚠️ applyMove immutability verified by controller: returns new object.)
Task 4: complete (commits 62d728d..53f53c8, review clean)
Ruling (T5 dispatch): bins aligned to tStart; a partial last bin is dropped; peakSpeed is the max smoothed speed in deg/s within the submovement; moving average at edges uses the available bins — cost if wrong: tiny segmentation shift.
Ruling: T5 onset back-up of floor(smoothBins/2) bins for from/t0 accepted — it compensates the onset-threshold lag so 'from' reflects the real start; the 0.3° test bound is the spec of record — cost if wrong: first-move gain slightly biased (<0.02).
Ruling (supersedes T5 back-up ruling): edge compensation must be symmetric and configurable — config submovement.edgeBins (default 1) extends both ends (from = pos[max(0,start−edgeBins)], to = pos[min(last,end+edgeBins)]); first-move endpoint drives over/undershoot so endpoint bias matters more than start — cost if wrong: small gain bias.
Task 5: fix round 1/5 (2 addressed, 0 open — asymmetric endpoint bias; wrong rationale; commits 9cd543e..f6f4f2d)
Task 5: minor (deferred): comment at submovements.ts:55 should say `to` is taken at end of bin end+edgeBins; two-move/jitter test breadth; one-bin spike counts as a submovement (may inflate corrections).
Task 5: complete (commits 53f53c8..f6f4f2d, review clean)
Ruling (T6 dispatch): ISO constant 4.133 → config score.weFactor; measureTrial window [spawnT, hitT ?? spawnT+timeoutMs], startAim = spawnAim; endAlong = alongPerp(spawnAim, target.aim, click.aim).along − distance, endPerp = .perp; corrections = submovements after the first within the window; bootstrap resamples scored trials with replacement (rng) — cost if wrong: metric tweak.
Task 6: minor (deferred): non-positive De / tp on pathological data can make ln(tp*) −Infinity → NaN logTpSe (clamp de or skip non-finite); tp=0 for zero scored trials (handled downstream by T7 ruling); weak ≥0 assertion at flick.test.ts:231.
Task 6: complete (commits f6f4f2d..6da37d3, review clean)
Ruling (T7 dispatch): stepScore floors tp at config score.minTp 0.01 (mirrors minTot) so ln never sees 0; tracking bootstrap segments = consecutive trackingSegmentMs chunks of the scored grid, resampled with replacement; lead/lag velocity from central difference of trackingTargetAt over one grid step — cost if wrong: small numeric change.
Task 7: minor (deferred): test borrows bootstrapSamples as a step size (tracking.test.ts:186); misleading lead-in comment; bare 2 in tracking.ts:74; no tests for null-baseline se, empty grid, bootstrap determinism.
Task 7: complete (commits 6da37d3..e6e4117, review clean)
Ruling (T8 dispatch): tested range [minU,maxU] = min/max of the points' u; bootstrap draws use the same model and ridge, and every draw (including ones with c ≥ 0) contributes its grid near-peak set via q's grid max; range is computed for usable non-lowConfidence fits including edge cases; ties in highest-y prefer the earliest point — cost if wrong: range width changes slightly.
Ruling: fitCurve([]) throwing is acceptable — the session always has a baseline point before fitting — cost if wrong: crash on empty fit (guard later).
Ruling: T8 drift test uses decoupled block order t=order[i]/6, order=[3,0,5,1,6,2,4] with 0.02<d<0.05; familiarity test adds 0.015<f<0.0295 — plan's literal t=i/6 makes drift unidentifiable; the spec wants these terms verified — cost if wrong: none (tests only).
Task 8: fix round 1/5 (2 addressed, 0 open — drift test on fp noise; familiarity test toothless; commits 1b5b7c3..a7ad132)
Task 8: minor (deferred): solve-null branch in fitCurve untested (defensive); absolute SINGULAR_TOLERANCE vs ~1e4 XᵀWX scale; combined boolean range assertion.
Task 8: complete (commits e6e4117..a7ad132, review clean)
Ruling (T9 dispatch): center fallback = highest score.logS among baseline + steps (ties earliest); "side of center last was on": last.cm360 > center → dir −1 (faster), else +1; slope uses u_center = ln(center/current) with fit.coef, 0 if no usable fit; StepResult.trials typed TrialMetrics[] — cost if wrong: exploration order differs slightly.
Task 9: minor (deferred): discount test doesn't prove corrections/spread term is undiscounted (no lead-lag discount case either); some reason texts unasserted; BRACKET_STEPS=2 constant in core.
Task 9: complete (commits a7ad132..b674df5, review clean; implementer's index-1 direction from steps[0] side accepted)
Ruling (T10 dispatch): diagnose averages skip null gains (a class absent everywhere → no finding); severity: '>' thresholds value/threshold−1, bigGain threshold/value−1, trackingWeaker (1−imbalance)/rel−1, flickingWeaker rel/(1+imbalance)−1; empty inputs → []; round2 = Math.round(x·100)/100 — cost if wrong: finding order changes.
User decision (2026-10-27): stop after Task 10 + its review. Next session: switch to native execution (superpowers:executing-plans), cheaper models for simple tasks, extra task reviews only on Tasks 11-13, one final whole-branch review. Reason: token cost.
Task 10: minor (deferred): Infinity severity when avg bigGain or tp is 0 (clamp or UI must tolerate); COIN_HALF local constant; balance test uses one seed.
Task 10: complete (commits b674df5..5b743ce, review clean)
PAUSED here by user decision. Resume at Task 11 in native mode.
User decision (later, 2026-10-27): usage resets in 40 min — resume subagent-driven as before, starting Task 11 (supersedes the native-mode pause).
Ruling (T11 dispatch): sim tuning constants (reaction 200±25 ms floor 120, 0.08 amplitude noise, 2° direction noise, 120+70·ID duration, 0.7r correction threshold, max 4 corrections, 60 ms pause, 110 ms correction, 0.15 correction noise, 40 ms click delay, 150 ms tracking delay, gain 6/s, 3°/s noise) go in config under `sim` — global no-magic-numbers — cost if wrong: none.
Task 11: minor (deferred): performance() reads defaultConfig familiarityTolLn instead of injected cfg; tracking noise i.i.d. per sample is negligible (tracking perf dependence comes from delay only); adaptation dynamics untested at default rate.
Task 11: note for T13: sim gain signals (small/big gain, lead/lag) point toward the adapted sens, not the optimum — only the score/fit see x*; familiarity only on exact cm360 == current; keep blocksDone flowing across blocks.
Task 11: complete (commits 5b743ce..9cf72be, review clean; implementer concerns a,c,d accepted)
Ruling: simulate.ts flick endT becomes max(lastEvent, runner finish time) — fixed inside Task 12 since runSimSession chains block t0s and must keep timestamps monotonic — cost if wrong: none.
Ruling (T12 dispatch): rng streams via createRng(opts.seed).fork(label): block seeds fork(specId); steering fork(`steer-${i}`); fits fork(`fit-${order}`); A/B order fork('ab'); summaries fork(`measure-${specId}`) — deterministic and independent of call order. submitBlock returns a new state (no mutation; structuredClone of plain data acceptable).
Ruling: T12 "8 or 12 A/B blocks" in the plan means A/B steps; specs are 0, 8 or 16 (4 or 8 flick+tracking steps) — plan arithmetic slip; spec says 4 → 8 blocks — cost if wrong: none.
Ruling: state.logs keeps rejected-retry logs too (full per-block log, spec §13) — cost if wrong: one-line filter.
Task 12: note for T13: default player (opt 0.88×current) picks spread 33.7–39.6 around opt 35.2 with current 40 (bias toward current?), A/B mostly 'none'.
Task 12: minor (deferred): simulate.ts finishTime fallback returns t0+warmupMs for any kind (should branch on warmup); progress in A/B/quickab carries stepIndex 0 (HUD must label by stage); SEED_RANGE local constant; `as unknown as Config` casts in tests; determinism test compares only result+specs.
Task 12: complete (commits 9cf72be..f030714, review clean; no session-level cause of bias toward current found — candidates: sim adaptation, flat curvature, fallback pick includes familiarity-boosted current points, 3% skip)
Ruling (T13 dispatch): if a stats test fails, the implementer may change src/core logic only with root-cause evidence (systematic-debugging), one change at a time, each recorded with before/after rates; test thresholds never loosen; ab.z may rise per plan. If still failing after reasonable effort → BLOCKED with measured rates (stop-condition: plan premise in question).
Ruling (T13 review): edge test true rate ~0.90 vs 18/20 bar → fix round 1 seeks algorithmic margin (runs that reach the 0.6×/1.6× limit should still flag edge); test-retest true rate ~0.83 vs 16/20 → accepted as-is with a test-file comment documenting measured pooled rates (default curvature 2 is deliberately flat; tightening would mean fitting the simulator) — cost if wrong: occasional red stats test after RNG-shifting changes. Spec §6 gets a one-line note: aim signals only nudge while the best guess is inside the tested range; at the edge, or when both neighbours are tested, steering walks outward by score.
Task 13: core changes (steer.ts walk-outward ×3, edge probe; fit.ts edge on upward fits + upwardEdge near-tie rule) root-caused; rates: convergence 92/100, null A/B 0.030 (z 2.0), familiarity 1.026, edge 20/20 (pooled 98/100 over 5 seed bases), retest 16/20 (pooled 0.83, accepted by ruling).
Task 13: fix round 1/5 (2 addressed, 0 open — lucky-seed edge/retest; log(exp) round trip; commits 5804dbf..8788dac)
Task 13: minor (deferred): unusable-fit fallback never sets edge; bestAt max over repeated edge tests biases ties; se > tolerance can create noise edge flags (low-confidence only); T17 results wording must handle lowConfidence + edge together.
Task 13: complete (commits f030714..8788dac, review clean)
Ruling (T14 dispatch): SessionRecord.raw is SessionState['logs']; id generation is the caller's (UI uses crypto.randomUUID); DB version 1; save() prunes raw on older records in the same transaction; list() reads summaries without raw by projecting fields — cost if wrong: small store tweak.
Ruling: T14 commit trailer says 'Claude Sonnet 5.5' (the implementing model) instead of Opus 5.5 — accurate attribution, no history rewrite — cost if wrong: cosmetic.
Task 14: minor (deferred): no onversionchange close handler; onerror/onblocked paths of openHistory untested; no re-save/older-createdAt prune tests; loadSetup returns unvalidated Partial (caller must merge over defaults).
Task 14: complete (commits 8788dac..559c3b0, review clean; controller ran npm test: 154/154)
Ruling (T15 dispatch): rawInput tests run in node with fake element/event objects (no jsdom); startCapture is not unit-tested (DOM wiring) but must remove all listeners on dispose; scene grid texture drawn with a 2D canvas created via document.createElement; scene visuals/colours are the implementer's call within "dark aim-trainer look" — cost if wrong: visual tweak.
Task 15: minor (deferred): startCapture untested (by controller ruling; reviewer suggests stub-document test); some inline scene literals (anisotropy, segments, roughness, lineWidth, sun pos) and duplicate material construction; sphereRadiusFor tan vs asin (1.5006°, negligible).
Task 15: complete (commits 559c3b0..f570111, review clean)
Ruling (T16 dispatch): Run.tsx props {session, onFinished(state), onUnsupported()}; lock result 'unsupported' → onUnsupported, 'denied' → stay on rest card with "Click again to lock the mouse."; hudText labels A/B and quickab blocks "Final check · Flick/Tracking" and baseline "Baseline · …"; warmup restText "Warm-up — free targets at your current sens, not scored."; manual browser check deferred to Task 17 when App mounts Run — cost if wrong: copy tweak.
Task 16: review found Critical: pointer lock never released after a block (rest card unclickable); Important: Skip keydown bubbles to card. Fix round 1 sent.
Task 16: fix round 1/5 (4 addressed, 0 open — pointer lock not released between blocks; Skip keydown bubbling; rAF disposed guard; onFinished at mount; commits b90bea8..ed7fa91)
Task 16: minor (deferred): no test for tracking finish via tick; hudText cm-leak assertion skips ≤2-char values.
Task 16: complete (commits f570111..ed7fa91, review clean)
Ruling (T17 dispatch): App 'demo' screen renders a placeholder until Task 18; ?simresult=1 only when import.meta.env.DEV; session seed Date.now() & 0x7fffffff, record id crypto.randomUUID(); loaded setup merged over defaults (dpi 800, cm360 34.29, inGameSens null, fov 103, horizontal, default) then validated; results copy for lowConfidence+edge: "Low confidence — your best sens may be even faster/slower than we tested. Run again."; manual browser check done by the controller after the implementer reports (subagents have no browser) — cost if wrong: copy tweak.
Task 17: controller browser check: setup renders + DPI 0 error shown; ?simresult=1 results render (verdict, range, finding, caveat, curve chart, block log, exports); history lists the session with range; Start → warm-up rest card; pointer lock denied in the in-app pane (expected, embedded) → "Click again to lock the mouse." shown; no console errors. Not verifiable here: actual 3D targets with raw lock (needs desktop Chrome, Task 19). Visual notes: room very dark/grid faint; "current" chart label overlaps a point; no explanation when A/B was skipped.
Ruling: T17 accepted implementer readings — Results takes a fit prop; quick A/B uses record.recommendedCm360 as current and record.currentCm360 as quickAbCm360; DEV-only simresult saves to history — cost if wrong: small UI change.
Task 17: minor (deferred): save failures swallowed silently; History flashes "not available" while openHistory pending; sync revokeObjectURL; key uses @internal _seed; warm-up checkbox resets after unsupported bounce; BlockLog look→step heuristic fragile.
Task 17: complete (commits ed7fa91..82ed64c, review clean)
Ruling (T18 dispatch): demo seed = YYYYMMDD integer of today; Demo replays clip logs by timestamp (flick: target = trial whose spawnT ≤ t < next spawn; tracking: trackingTargetAt(spec, t − t0)); demo results reuse <Results> with a "Demo results (simulated player)" heading and no history save; App 'demo' screen replaces the placeholder; controller does the mobile browser check — cost if wrong: demo polish.
Task 18: controller browser check at 375×812: demo plays in the 3D room (target + crosshair visible), captions readable, tap skips clips, dial-in caption shows steer reason with no values, "Skip to results" → "Demo results (simulated player)" results, no horizontal scroll, no console errors. Notes for final review: verdict "No clear winner — keep your current sens" shown next to a range (27.96–33.34) that excludes current — confusing copy; chart labels tiny at phone width.
Task 18: minor (deferred): aimAt/flickTargetAt playback helpers untested; runSimSession runs synchronously on demo open (no loading state); History Back from demo can show an older real result; steer-reason test uses `some`; blunt \d\s*cm regex.
Task 18: complete (commits 82ed64c..d1ce99e, review clean)
Ruling (T19 dispatch): implementer writes README and runs test/stats/build + `vite preview` smoke via curl (no browser); the controller does the dist browser check; the real-mouse session is the user's step, listed as pending in the final summary — cost if wrong: none.
Task 19: README (60 lines) + ship check: npm test 175/175, test:stats 5/5, build ok (596 kB chunk warning from three.js), vite preview serves relative assets (200).
Ruling: Task 19's separate task review is folded into the final whole-branch review (README-only diff; the user flagged token cost) — cost if wrong: README issues caught one step later.
Task 19: complete (commits d1ce99e..78d982e, reviewed in final review)
Final review (opus): ready with fixes — Important I1 (results wording misleads for keep/none; quickab headline), I2 (raw logs in main record too heavy at 1–8 kHz; silent save failure); fix-now minors M1 (late click lands on next target), M2 (NaN logTpSe), M3 (unquoted glob, engines), M4 (history loading flash), M5 (sync revoke), M6 (recheck identifiable via README/Setup copy). Optional M7–M11.
Ruling: final fix wave = I1, I2, M1–M6 plus M7 (quit link) and M8 (demo ends on a clear verdict); M9–M11 deferred — M7/M8 matter for the user's first real run and demo — cost if wrong: small extra diff.
Final fix wave: 1/1 (I1, I2, M1–M8 addressed; commits 78d982e..44727ce; npm test 182, stats 5/5, build ok). Ruling: demo optimalRatio 0.75 (0.8 ended on change only 2/7 dates) — cost if wrong: demo shows a bigger change than typical.
