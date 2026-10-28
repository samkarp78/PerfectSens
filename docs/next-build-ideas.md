# Next build: ideas backlog

## From the revision-2 play-test (in progress)

- **Bigger part timer:** large and readable at a glance, for example big numerals at top centre with a draining bar, instead of the small mono text.
- **Equal part lengths:** flicks, switching and tracking should feel the same length, about 17–18 s each, or 20 s each if the session can take the time. Tracking's lead-in should count as part of its slot, so all three slots match.
- **Transitions between parts:** a short handover cue so the switch isn't jarring.
  - A 1–2 s "Next: Switching" banner with a 3-2-1 tick, and a distinct chime for each part type.
  - The handover gap is unscored and identical for every sens.
- **Warm-up stays optional** (user decision 2026-10-28).
- **TOP PRIORITY — use switching's movement and misclick data in the measurement.** Revision 2 scores switching only as kill throughput. That is a gap.
  - Every switch (previous kill → next kill) should get the same analysis as a flick: target distance and class, first-move over/undershoot (gain) via submovement segmentation, corrections, time, and every click's position relative to the intended target. The intended target is the one killed next. Each click gives its along offset (over/undershoot) and its perp offset.
  - Feed it into:
    - The switching score: effective throughput with We from the click endpoint spread, so misclicks count.
    - Steering's over/undershoot signals, pooled with the flick gains by distance class (about twice the data per round).
    - Diagnosis: misclick rate, and overshoot or undershoot of misclicks.
  - SwitchRunner must log the aim at each click. Revision-2 exports have only the path, so clicks can be reconstructed from raw logs.
  - Also use the flick first-click along-offset mean (click over/undershoot bias), not only its spread.
  - Past sessions don't need reprocessing; only future ones matter (user decision).
- **Rule for every mode (user decision):** record all the data, then derive and use the full metric set. The spec lists each mode's data and metrics before it's built.
- **Full tracking data (currently only time on target and mean lead/lag are used):**
  - **Raw:** every mouse sample, every button press and release, the target position and velocity over time, and the target's direction-change times.
  - **Error:** mean, RMS and median distance, split along the motion (lead/lag) and across it (above/below the path).
  - **Speed matching:** crosshair speed ÷ target speed, the tracking version of over/undershoot. This is a steering signal.
  - **Direction changes:** reaction time after the target reverses, overshoot past the turn, and time to settle.
  - **Smoothness:** jitter and micro-corrections while on target.
  - **Losses:** times the target was lost, and time to reacquire it.
  - **Splits:**
    - by target speed band,
    - horizontal vs vertical (measure and diagnose only; never a separate vertical/horizontal sens output, since one sens in every direction is a fixed constraint),
    - first half vs second half (fatigue).
  - **Button:** held fraction, and releases while on target.
- **New part idea: tracking switching.** 3 moving targets, each with a small health pool (for example 0.6–0.8 s of held, on-target time). Hold the button and track one until it dies, then swap to the next.
  - Measures: acquisition onto a moving target (time, and first-move over/undershoot against where the target is), time on target while killing, lead/lag, kill time, and lost-target events.
  - Placement options:
    - **A fourth part** (all four equal, about 14 s each, round about 60 s, session about 12 min).
    - **Replace plain tracking** (keeps 3 parts, but loses the clean continuous-tracking lead/lag signal).
  - Must be identical in every round. Needs its own score term, sim model and stats re-check.
- **Misclicks: no game penalty, but they are data** (user decision). Misclicks shouldn't cost points or break streaks; they are recorded and used in the measurement only.
  - Flicks already use them, because the first click's position feeds the spread.
  - Switching should start using them too, as accuracy or spread in the switching score or diagnosis.
  - Open question: what breaks a streak (suggested: only a target that times out).
- **"Change by luck" should be as close to zero as possible.** It can't be exactly zero, because there's always some noise. Options:
  - A stricter A/B bar (z from 2.0 to about 2.5–3), at the cost of more "no clear winner" results.
  - Require the win to repeat (look 1 and look 2 both favour it).
  - Make the second A/B round mandatory before any "Change".
  - Re-check with the simulator: false change was 4.5%; the target is ≤1%.

Collected 2026-10-28 from the first real play-test. Nothing here is built yet.

## Make it feel like a game (top priority)

The first draft feels like a chore. All of these are safe for the measurement as long as they're identical for every sens tested.

- **Hit feedback:** a crisp hit sound, a pop/burst effect when a flick target is hit, and a subtle tick while the tracking target is held.
- **Visible score:** points per block and a big block total at the end ("Block score 8,420"). The player beats their own number; there's no comparison to the hidden sens.
- **Streaks and combos:** "×5 streak" for consecutive clean flicks. Points only; never changes the targets.
- **Auto-countdown between blocks:** a 3-2-1 that starts the next block, instead of clicking a card every time. Keep a way to pause.
- **A sense of a journey:** named stages ("Calibration", "Round 3 of 7", "Final Showdown" for the A/B) and a quick grade (S/A/B) after each block.
- **A rewarding end screen:** best block, total hits, accuracy, and personal bests saved in History.
- **Polish:** a brighter, less dark room; customisable crosshair (colour, size); optional light background music.

**Guardrails:**
- Never make targets harder as the session goes on (no faster or smaller targets with streaks). Difficulty must be the same in every block.
- Show the block score only at the end of the block, not live, to limit effort changes after a block that "feels bad".
- Sounds and effects must be identical in every block.

## Variety and fatigue (from the second play-test, 10-minute session)

Feedback: "still feels like a chore", and 10 minutes with no breaks of the same two tasks is very fatiguing.

- **Mix it up inside each round, not between rounds.** Every round contains the same set of short segments, for example about 15 s of flick waves, 15 s of target switching (several targets up at once, clear them in any order) and 15 s of tracking.
  - The mix must be identical in every round. The A/B's two sens land on different rounds, so rotating styles between rounds would give them different tasks and break the comparison.
  - Scoring: each segment type gets its own score, normalised to the baseline. The composite weights go in config. Switching is a new metric (time per kill, or throughput across switches) and needs its own measure and tests.
  - Each segment type needs its own short unscored lead-in, because switching tasks costs a moment of readjustment.
  - Re-run the simulator checks: shorter segments mean less data per type. The simulated player needs a switching model.
- **Round timer:** a countdown for the current round or segment, for example "0:32" near the top, alongside the session progress bar. Possibly a thin bar that drains under it, which turns orange in the last 5 s. Tracking counts down from the end of its lead-in. Show segment names once rounds have several parts ("Switching · 0:12").
- **Real breaks:** 15–20 s every 2–3 rounds that the player can end early. Show the stretch's score, grade and best streak, so the break feels like a milestone. Fatigue also biases later rounds, so this helps the data too.
- **Optional auto-continue:** a setting for the 3-2-1 countdown, so players can choose to always click to start instead.
- **A different look per stage** (baseline, dial-in, final showdown): purely visual and safe for the measurement.

## Session flow and search

- **Open decision: 4 or 5 hidden steps.** The 10-minute build uses 4, which gives about 76% re-run agreement in the simulator against an 80% bar. 5 steps gives about 80% for roughly 1 extra minute. The stats test-retest check is failing until this is decided.

- **Wide blind opening round (from the Low/Medium/High idea):** test three widely spaced sens, for example 0.6×, 1× and 1.6× current, in random order. Pick the best by measured score, without telling the player, then dial in from there. This keeps the idea blind. A player-chosen Low/Medium/High would bring back familiarity bias.
- **Wider first bracket** (PSA-style start wide, then narrow): about ±30% instead of ±15%. The first quick run hit the edge of its tested range. Re-run the simulator stats after changing this.
- **Same layout for both A/B arms:** give P and C identical target layouts so the only difference is the sens. Less noise, but watch for players recognising the pattern over 8 blocks.
- **Progress total jumps when the A/B adds a round** (18 → 26 in the play-test). Options: show the worst case from the start, show a range ("18–26"), show a "Close result — adding one more round" message, or turn off the extension in Quick mode.
- **Tracking difficulty ramp:** the current tracking (10–25°/s, 2° target) felt about right (67–81% on target). Only add a ramp if a later test wants it, and keep it identical across blocks.
- **"I don't know my sens" option at setup:** keep the typed cm/360 input for players who know it (more accurate). Add an "I don't know mine" choice that turns the warm-up into a slider round: free targets with a sens slider and the prompt "adjust until it feels like your game". The value they settle on becomes the starting ("current") sens.
  - Feel-matching is usually 10–20% off, so the familiarity correction and the "Keep your current sens" verdict mean less. Flag these sessions in the record, and have Results say so.
  - For these players the warm-up stops being optional.

## Results and advice

- **Re-tune the tracking-vs-flicking diagnosis.** Its reference value (refTot 0.5) was set for the old, harder tracking, so it now leans toward "train flicking". In the play-test the finding was 1.17 against a 1.15 threshold, which is essentially noise.
- **Play area calibration — remaining gaps** (the calibration, the 180°-fits-90%-of-pad cap on the slowest test sens, and the Results pad line were built in revision 2):
  - **Make pad measurement required** (user decision, 2026-10-28). Today it's optional, and when skipped there is no cap, so the app can test sens too slow for the pad. Every session should measure the pad before the rounds start.
  - **Warn when the current sens already doesn't fit.** The cap never goes slower than the current sens, so if a 180° at the current sens already needs more than 90% of the pad, the app tests it and the sens near it and says nothing. Show a warning at setup, and on Results say that their current sens is too slow for their pad.
  - It depends on the DPI being entered correctly. A mismatch would show up as an odd pad size, which is itself a useful check of the DPI.
- **"How did that feel?" rating (user approved, 2026-10-28):** after each round, ask for a 1–5 feel rating. Save it with the round, but never use it in scoring, steering or the verdict, so the test stays blind (the player still doesn't see which sens they played). Results compares feel with performance, e.g. "You liked 34 cm/360 best, but you played best at 28."
- **Possible (not approved yet): mouse-lift detection.** Flag a stop in movement partway through a big turn, which usually means the player ran out of pad and lifted the mouse. Record and diagnose only; it measures the "can't look behind me" complaint directly and pairs with the pad check.
- **Possible (not approved yet): reaction time as a fatigue check.** Time from target appearing to the first movement shouldn't depend on sens. If it slows over the session, suggest a break or weigh late rounds more cautiously. Not part of the score.
- **In-game conversion on Results (for everyone):** turn the recommended cm/360 into the number to type into their game, from their game and mouse DPI. Fallback without a lookup: a ruler check ("set your game sens so sliding the mouse 28 cm turns you exactly one full circle").
- **Gradual-change advice:** if the recommended change is more than about 10%, suggest moving halfway first, playing a week, then running Quick A/B from History. This follows the pros' "small steps, give it a week" habit.
- **Sens variation as a training tip** under "What to train". Optional.

## Notes from research (context, not tasks)

- **How pros pick a sens:** start from a typical value for the game, fit it to arm and pad, change in 5–10% steps, and stay on each for about a week.
- **The Finals:** no pro data found. Generic guidance is about 20–33 cm/360.
- **PSA (Perfect Sensitivity Approximation):** test about 0.5× and 1.5×, keep the better one, halve the gap, repeat 6–8 times. Its strength is the wide start. Its weakness is that each step is a single, unblinded trial judged by feel.
- **Aimlabs Mouselabs:** passive. It steers by over/undershoot and tracking speed match over up to 100 sessions. It's strong on data volume, but over/undershoot mostly reflects adaptation, and it never directly compares sens against each other.

## From the revision-3 play-test (2026-10-28)

- **Mouse / gear check:** report the mouse event rate and dropped or irregular events.
  - Show it on Results ("Mouse: 1000 Hz, steady"), and warn when the rate is under about 500 Hz or events are missing.
  - Also warn during the test (at the next break or between parts) as soon as it's detected.
  - Diagnosis only.
- **Part order:** flicks → tracking switching → switching → tracking, alternating clicking and holding parts. It must be the same in every round. Re-run the simulator checks.
- **Grades that explain themselves:** show the letter together with "+4% vs your calibration round" (or a rank and an improved/not-improved marker).
  - Add a note that most players improve during a session just from warming up, so "improved" doesn't mean the sens is better.
