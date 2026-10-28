# SDD ledger — plan: docs/superpowers/plans/2026-10-28-play-along.md

Spec: docs/superpowers/specs/2026-10-27-blind-sens-finder-design.md §18
Task 0: complete — user said build the View results work into this build; committed it with the plan.
Pre-flight:
- T3→T5: fixed-mode SessionState.steps + ScoreBaseline (score.ts) — consistent.
- T1→T4/T5: snapCm360/sameSens — sameSens compares already-snapped cm/360; consistent.
- T4 uses maxTestCm360 (also caps 1.6× and never below current) — consistent with §18.6.
- T5→T6: testSession returns SessionState whose setup feeds simulateBlock — consistent.
- T5 decideAB(look 2, look1Delta = h2h pair δ) gives "both" rule — consistent with §18.9.
Task 1: Ruling: Finals constant 914.4 in spec/plan was a unit slip; 360/(0.001·sens) counts → cm = 914400/(sens·DPI) (still 1143/sens at 800 DPI) — matches all three lookups — cost if wrong: none, tests pin the lookups
Task 1: complete (commits e2a1c5f..d5b6f6f, tests: npm test →              at least ~618ms faster with isolate: false — reuses workers across files instead of one per file)
Task 2: Ruling: test offset 0.05 (not 0.1) and labelled-beats-unlabelled check — the ridge prior (sd 0.03) partly shrinks a 0.1 offset (peak error 1.08%); 0.05 is a realistic night swing — cost if wrong: large night swings bias the peak slightly; sim gate (Task 6) measures it
Task 2: complete (commits d5b6f6f..aaaf1d0, tests: npm test →              at least ~573ms faster with isolate: false — reuses workers across files instead of one per file)
Task 3: complete (commits aaaf1d0..cf09ee4, tests: npm test →              at least ~890ms faster with isolate: false — reuses workers across files instead of one per file)
Task 4: Ruling: added test 'a snapped side already tested moves one whole number further out' (plan's low-sens case relies on the 0.6× limit clamp to exhaust) — pins the outward move — cost if wrong: none
Task 4: complete (commits cf09ee4..4de501c, tests: npm test →              at least ~2.74s faster with isolate: false — reuses workers across files instead of one per file)
Task 5: Ruling: added exported feelFlagsOf(tests, game) so the feel-flag rule is testable before a result exists; isStale counts 14 days from the last test (or creation) — 'older than 14 days' read as since last activity — cost if wrong: a search resumed on day 13 of inactivity after a long one isn't flagged
Task 5: complete (commits 4de501c..639447a, tests: npm test →              at least ~2.27s faster with isolate: false — reuses workers across files instead of one per file)
Task 7: Ruling: no JSON replacer — IndexedDB structured clone keeps Infinity; the round-trip test still pins it — cost if wrong: none (test covers it)
Task 7: Ruling: recordFromPlayAlong puts the merged raw logs in rec.raw (the existing save routes them to the raw store) instead of raw null + separate write — reuses save's raw handling and keep limit — cost if wrong: none
Task 7: Ruling: history test's store-name list now includes 'playalong' — expected by the v2 upgrade
Task 7: complete (commits 639447a..fe3cec7, tests: npm test →              at least ~4.24s faster with isolate: false — reuses workers across files instead of one per file)
Task 6: Ruling: first sim run gave null false change 5.3% (limit 1%). Cause: pooled leader-vs-default blocks (selection bias) and head-to-heads split across nights (night form). Decided: the verdict uses only the head-to-head's own same-night tests, and a split head-to-head is replayed in full next night — deviates from spec §18.9 'pooled comparison'; the spec's ≤1% anti-goal is binding — cost if wrong: less power (more 'no clear winner')
Task 6: complete (commits fe3cec7..0c064a8, tests: npm test →              at least ~4.62s faster with isolate: false — reuses workers across files instead of one per file)
Task 8: Ruling: Continue/stale prompt lives on the Play-Along setup screen (main Setup shows "Continue Play-Along") — one place for the saved search — cost if wrong: one extra click
Task 8: Ruling: added resume(s, now) + playAlong.sameNightMs 3 h — reopening mid-night (e.g. tab closed mid-test) must not start a new night (Review Focus 1); App calls resume instead of startNight — cost if wrong: a return after <3 h counts as the same night
Task 8: Ruling: the sim drops raw logs before submitTest (memory: the user's game lagged during sim runs)
Task 8/9: Ruling: Tasks 8 and 9 committed together — App wiring spans both — cost if wrong: coarser history
Task 8: browser check — waiting screen, 1 s hold (tap ignored), feel card, lead-in with no score/skip, reload resumes same night, ?paresult=1 results page; no console errors. Pointer-locked test play not exercised (needs a real click).
Task 8: complete (commits 0c064a8..4243b3d, tests: npx vitest run --exclude tests/stats/** --maxWorkers=2 →              at least ~2.53s faster with isolate: false — reuses workers across files instead of one per file)
Task 9: complete (committed with Task 8, see above; tests: tests/ui/playAlongText.test.ts 6/6)
Variants (200 null / 60 convergence): h2h2 z2.5 → null 1/200, change 12/60 (10 right), 4 nights; h2h1 z2.0 → null 2/200, change 15/60 (15 right), 3 nights; h2h2 z2.0 → null 3/200 (fails), change 16/60. Baseline h2h1 z2.5 → 0/300, change 14/100. Awaiting user choice.
User decision: keep h2h 1/side, z 2.5 (safest).
Final review: Opus (Fable out of credits). Critical 0, Important 4, Minor 7.
Final: fixed hour check repeating / mid-h2h — 'the hour check appears once per night', 'no hour check between the two head-to-head tests' RED→GREEN, suite 368/368
Final: fixed best-guess h2h on a different sens — 'confirming a best guess runs the head-to-head on the recommended sens' RED→GREEN
Final: fixed doubled anchor — 'a night opened but not played does not add a second anchor' RED→GREEN
Final: fixed History record data gap — 'an abandoned test is recorded as discarded', 'keeps steering decisions, night start times and discarded tests' RED→GREEN
Final: Ruling: re-graded Minor #1 (hold completes after focus loss) and #2 (History Back opens Standard results) to Important by effect; fixed without an automated test (no DOM test harness) — cost if wrong: untested UI paths
Final: Ruling: test 'head-to-head split' now uses resume after a day instead of the hour check (the hour check can no longer split a head-to-head)
Final: minor (deferred): IndexedDB v2 upgrade blocked by an old open tab silently disables saving (add onversionchange close / save-failed notice)
Final: minor (deferred): raw logs re-saved with the whole search on every change (several MB over nights)
Final: minor (deferred): 3 h resume window counts from waitingSince, not from the test start
Final: minor (deferred): a retried test replays the same targets (seed by tests.length)
Final: minor (deferred): early-load race can overwrite a search started before the saved one loads
Final: minor (deferred): hold button has no keyboard path
