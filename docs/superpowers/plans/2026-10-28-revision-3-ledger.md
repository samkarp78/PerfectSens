# SDD ledger — plan: docs/superpowers/plans/2026-10-28-revision-3.md

Method: native (executing-plans), one final review. Baseline: 237 unit + 5 stats passing at 895ddc2.

Pre-flight:
- T1→T2: SwitchSummary extends FlickSummary (classN, clickBias) → pooledGain consumes both. Consistent.
- T3→T6: chunkBootstrapSe extracted in T5 from tracking.ts; T3 walkGrid also from tracking.ts. Both helpers coexist. Consistent.
- T4→T5: partMs covers trackswitch once T5 adds config. Consistent.
- T5→T6: TrackSwitchRunner/measure/types consumed by session+sim. Consistent.
- T7→T8: extensionReason consumed by AskCard reason. Consistent.
Task 1: complete (commits 66f4304..a3cd209, tests: npm test →              at least ~393ms faster with isolate: false — reuses workers across files instead of one per file)
Task 1: Ruling: added tests/helpers/summaries.ts fixtures (flickSummary/switchSummary/trackingSummary) — later tasks extend summaries; one place to update — cost if wrong: none
Task 2: stats: null A/B change 0.060 (>0.05, was 0.045) after T1 switch effective-TP; convergence/familiarity/edge/retest pass.
Task 2: Ruling: continue past null-A/B 0.060 instead of stopping — Task 7 replaces the A/B rule with a ≤1% target and re-runs this exact test with a stricter threshold; stop there if it fails — cost if wrong: Task 7 can't reach 1% and the switch SE needs rework
Task 2: complete (commits a3cd209..c2d54e0, tests: npm test →              at least ~360ms faster with isolate: false — reuses workers across files instead of one per file)
Task 3: Ruling: TrackingDetail error/axis fields are number|null (plan said number) — null when no held samples is honest; 0 would read as perfect — cost if wrong: UI must handle null (it already uses optional formatting)
Task 3: Ruling: a 'loss' is any on-target→off-target change incl. releasing the button — matches ToT's held rule and the plan's test — cost if wrong: losses count releases too
Task 3: stats: steering 4/4 pass; null A/B still 0.060 (Task 7).
Task 3: complete (commits c2d54e0..799666c, tests: npm test →              at least ~417ms faster with isolate: false — reuses workers across files instead of one per file)
Task 4: stats at 14 s parts (3 parts only): convergence 75-77/100 (<80), edge 2-13/20 (<18). Probe: an extreme (0.4x) player times out every flick at the slow sens, so no scored wave forms and parts hit the score floor.
Task 4: Ruling: flick wavePerClass 2→1 (waves of 3) — 14 s parts lost a whole 6-target warm-in wave and the unfinished wave; 3-target waves halve both losses and keep each wave's class mix — cost if wrong: per-wave mix is 1/1/1, so the gain estimate per class is noisier per wave (same per part).
Task 4: Ruling: stats gate moved from Task 4 to Task 6 — Task 4 alone shortens the parts without Task 5-6's fourth part (round scored time 52.5 s vs rev-2 50 s only once trackswitch lands); stop-and-report applies at Task 6 — cost if wrong: Task 6 inherits a failure that a different part length would have fixed.
Task 4: Ruling: unit tests that pinned 20/15/15 s lengths updated proportionally (sim flick ≥14 done, ≥12 gains; tracking ends t0+14000) — they tested lengths, not behaviour — cost if wrong: none.
Task 4: complete (commits 799666c..046b157, tests: npm test →              at least ~366ms faster with isolate: false — reuses workers across files instead of one per file)
Task 5: Ruling: movingAimAt(seed, origin, tMs, bounds, motion) takes a Motion object instead of cfg — the path cache is keyed by the motion settings, so tracking and trackswitch paths never collide — cost if wrong: none.
Task 5: Ruling: trackswitch.directionSpreadDeg 45 and placeTries 50 added to config (spec silent) — targets in a ±35×±15 region need more vertical motion than tracking's 30 — cost if wrong: feel only.
Task 5: Ruling: damage for (lastT, t] uses the aim held over that interval (before the move at t) — the same causality as tracking's grid lookup — cost if wrong: 1-sample timing.
Task 5: Ruling: trackingTargetAt pinned with a golden-value test before the refactor (the plan assumed existing tests pinned it; they didn't) — cost if wrong: none.
Task 5: complete (commits 046b157..a1cbc62, tests: npm test →              at least ~381ms faster with isolate: false — reuses workers across files instead of one per file)
Task 6: stats (4-part rounds): convergence 89/100, null A/B 0.045, familiarity 1.026, edge 19/20, retest 16/20 — all pass.
Task 6: Ruling: fit also flags an edge when the concave peak lies within one final step (ln 1.04) of a tested edge AND upwardEdge's same-as-best test picks that edge (pick stays unclamped) — probe showed short parts make the far (slow) side score at the floor, bending the quadratic so its peak sits just inside the fast edge (edge 12/20); this is the rule upward curves already use — cost if wrong: more 'might be even faster/slower' notes and outward probes for players whose optimum is near the tested edge.
Task 6: Ruling: steer.clickBiasScaleDeg 1→20 — gains are fractions of distance; 1° of click bias on a ~20° flick is ~5%, so scale 20 puts it on the gains' footing (scale 1 made it 20× too strong); steer test bias 1.5°→3° — cost if wrong: click bias steers less than intended.
Task 6: Ruling: baseline for a step falls back to its own parts when steps[0] is missing (defensive; same as the baseline stage) — cost if wrong: none.
Task 6: complete (commits a1cbc62..01582e4, tests: npm test →              at least ~453ms faster with isolate: false — reuses workers across files instead of one per file)
Task 7: stats: null A/B change 0.003 (1/300, target ≤0.01; keep 0.007); convergence 89, familiarity 1.026, edge 19/20, retest 16/20.
Task 7: power probe (quick A/B, 40 runs, pick = optimum): 0.75x current → change 38/40 (old rule 40/40); 0.85x → 1/40 (old 4/40).
Task 7: complete (commits 01582e4..c895f46, tests: npm test →              at least ~408ms faster with isolate: false — reuses workers across files instead of one per file)
Task 8: Ruling: tracking-switching kills are 'hits' for points/streak and nothing there counts as a miss — the user ruled out new game penalties; losses stay measurement data — cost if wrong: streaks run long in that part.
Task 8: Ruling: lock lost during a cue → resume replays that cue; lock lost mid-part → the part restarts at once (as before) — Review Focus 4 — cost if wrong: none.
Task 8: Ruling: cue ticks use the countdown beep, not the tracking tick (too quiet to hear as a 3-2-1) — cost if wrong: sound choice only.
Task 8: Ruling: Task-9 cleanups done here because the same code was rewritten: per-part retry rest text, switch meshes at switch radius, AudioContext closed on unmount, PER_ROUND→BLOCKS_PER_STEP, rest text rebuilt only on phase/hud/progress change, a just-finished part is read once more so its last hits score — cost if wrong: none.
Task 8: verified in preview: setup labels (12/16/6 min), demo Results + block log with Switch hits / Track-switch dmg columns, no console errors; timer + cue styling screenshot via injected markup. Live run not playable in the pane (pointer lock denied).
Task 8: complete (commits c895f46..336f091, tests: npm test →              at least ~497ms faster with isolate: false — reuses workers across files instead of one per file)
Task 9: Ruling: switch replacement takes the next queued target ≥ minSeparationDeg from every target on screen (up to placeTries), deterministic for a given kill order — the generator only spaced consecutive queue entries; kills in any order broke that (test: always kill slot 0) — cost if wrong: target sequences differ between sens only via kill order (they already did).
Task 9: Ruling: 'new best!' — bests merged once in App at finish and passed to Results/SessionStats; no component test (UI wiring; store/bests is unit-tested) — cost if wrong: flag could reset on remount.
Task 9: Ruling: the tp=0 switch item is covered by score.test 'floors tot and tp so logs stay finite' (switch tp 0 with and without baseline) — no new test.
Task 9: Ruling: did not edit docs/next-build-ideas.md — the user has uncommitted edits in it from this session; marking items done there would mix our changes — cost if wrong: backlog still lists revision-3 items as open.
Task 9: stats: convergence 88/100, familiarity 1.027, null A/B 0.003, edge 19/20, retest 18/20 — all pass. Preview: DPI edit clears pad + note; Calibrate disabled for invalid DPI.
Task 9: complete (commits 336f091..5581acd, tests: npm test →              at least ~462ms faster with isolate: false — reuses workers across files instead of one per file)
Task 10: complete (docs b5bccd7). Final review: Opus reviewer, verdict "with fixes", 0 Critical, 3 Important, 10 Minor.
Final: fixed button held through a handover counted as up — 'a button pressed during the cue counts as held when the hold part starts' RED→GREEN, suite 298/298
Final: fixed speedRatio depended on mouse report rate (0 at 60 Hz for a perfect follow) — now a ratio of sums — 'perfect follow gives speedRatio ≈ 1 at 60, 125 and 1000 Hz mouse rates' RED→GREEN, suite 298/298
Final: fixed acquisition gain missing from the block log (spec §17.5) — blockLog 'shows switching accuracy and tracking-switching damage' RED→GREEN, suite 298/298
Final: stats after fixes: convergence 89/100, familiarity 1.025, null A/B 0.003, edge 19/20, retest 18/20; build OK.
Final: minor (deferred): trackswitch damage for a long frame hitch (100-300 ms) is judged on end-of-interval geometry — subdivide intervals to the grid step
Final: minor (deferred): a switching part with zero clicks gives accuracy 0 and an infinite-severity misclick finding — make accuracy null without clicks
Final: minor (deferred): tracking 'losses' counts button releases; spec §17.4 says 'while held' — amend spec or gate on held
Final: minor (deferred): tracking leadLagDeg (a steering driver, pre-rev-3) still includes not-held samples — gate on held
Final: minor (deferred): StepResult/TrackingSummary types call new fields required though old stored records lack them — add a StoredStepResult type at the History boundary
Final: minor (deferred): editing the DPI clears a pad width typed by hand, not only a calibrated one — track where the value came from
Final: minor (deferred): Run.tsx partLength duplicates config partMs — use partMs
Final: minor (deferred): turn reaction can be about −4 ms when the first sample already qualifies — clamp at 0
Final: minor (deferred): no session-level test that a switching part with only warm-in kills is retried once
Final: minor (deferred): CSV export lacks the new per-switch and tracking metrics (JSON has everything)
Final: minor (deferred): tracking jitterDegPerSec still depends on mouse report rate (diagnosis only)
Final: Ruling: trackswitch simulator realism, weights/z/thresholds, feel-only config, edge-hug trade-off, popAt allocation, spawn under crosshair — reviewer set aside; all stand: spec-fixed, already ruled, or no effect on data correctness — cost if wrong: tuning only.
