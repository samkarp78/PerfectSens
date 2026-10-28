# SDD ledger — plan: docs/superpowers/plans/2026-10-28-revision-2.md
Executor: inline (executing-plans), branch feature/blind-sens-finder, base fa1b6c0
Pre-flight: tasks chain through config/types (T1) → runner (T2) → measure (T3) → session (T4) → sim (T6) → UI (T7-T12); no conflicts found.
Ruling: middle-stage HUD label is "Dial-in N of 6" instead of the spec's "Round N of M" — the overall progress counter already says "Round x / ~11", two different round numbers would confuse — cost if wrong: copy tweak.
Ruling: Setup.padWidthCm is optional (`padWidthCm?: number | null`) — avoids churn in every Setup literal; validateSetup always returns it (null when blank) — cost if wrong: none.
Ruling: sim switching uses a 150 ms reaction (config sim.switchReactionMs) since the next target is already visible — cost if wrong: switching tp scale in the sim.
Tasks 1–4 + controller chaining: complete (npm test 219/219).
Tasks 5–6: complete (pad cap in steering; sim switching; stats 5/5; pooled: retest 84/100, convergence 86/100, null false change 9/200)
Tasks 7–12: complete (ScoreKeeper/grades, breaks + restPhase, runner endsAt, scene switch targets + pop + brighter room, sounds, Run.tsx rewrite + RunCards, prefs, calibration screen, fit warning, results session stats + personal bests + pad line, block log switch column). npm test 235/235, stats 5/5, build ok. Browser: setup, calibration screen, fit warning, sim results checked; live rounds/breaks/sounds need real Chrome (pointer lock).
Ruling: grades compare a stretch's mean score against the calibration round (S ≥ +6%, A ≥ +2%, B ≥ −2%, C ≥ −6%, else D) — reveals nothing about the hidden sens values — cost if wrong: grade feel.
Ruling: live points and streak are shown during play (relaxing the earlier "score only at block end" guardrail) — game feel was the top complaint; the effect is symmetric across sens — cost if wrong: slight effort shifts after a bad part.
Ruling: breaks need a click to continue (no auto-resume) — pointer lock can only be re-acquired from a click — cost if wrong: none.
Final review (opus): ready with fixes; no Critical.
Final: fixed bracket steps repeating current when the pad cap equals current — test "both bracket steps test faster, distinct sens values" RED→GREEN, suite 237/237
Final: fixed late/missed flick misclick feedback — test "reports a misclick on the target that is still up" RED→GREEN, suite 237/237
Final: fixed break grade in Quick A/B (hidden; no calibration round) — UI, build verified
Final: fixed stale setup draft after calibration (cleared on start / quick A/B) — UI, build verified
Final: fixed (re-graded Minor→Important, user-visible) calibration accepting a ~0 cm slip pass — pass re-prompted below setup.padWidthCm.min — UI, build verified
Final: fixed (re-graded Minor→Important, user-visible) countdown flash/beep with auto-continue off — UI, build verified
Final: minor (deferred): Calibrate measures with 800 DPI when the DPI field is invalid; DPI edited after calibrating leaves the width stale
Final: minor (deferred): makeSwitchTargets separation only checks queue neighbours (on-screen overlap possible); tries=50 literal in core
Final: minor (deferred): switch-only retry shows the round rest text
Final: minor (deferred): switch meshes use the flick radius (equal today)
Final: minor (deferred): AudioContext never closed across sessions
Final: minor (deferred): frame-loop micro-costs (switchEvents slice, double log(), sort per frame, restText per raw event)
Final: minor (deferred): last-frame points of a part dropped when the runner changes
Final: minor (deferred): PER_ROUND duplicates BLOCKS_PER_STEP; store/bests imports a ui type
Final: minor (deferred): "new best!" label resets when Results remounts
Final: minor (deferred): accepted switch part with tp=0 after retry adds a −1.7 outlier (AFK only)
Final: Ruling: switching accuracy is measured but not scored (spam-clicking is free) — matches spec §16; flagged to the user as a design question — cost if wrong: a sens-dependent sweeping strategy could skew switching scores
Final: Ruling: no switching clip in the demo — spec §16 is silent on the demo — cost if wrong: demo shows 2 of 3 parts
