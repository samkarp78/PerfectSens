# Next build: ideas backlog

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

## Results and advice

- **Re-tune the tracking-vs-flicking diagnosis.** Its reference value (refTot 0.5) was set for the old, harder tracking, so it now leans toward "train flicking". In the play-test the finding was 1.17 against a 1.15 threshold, which is essentially noise.
- **Play area calibration:** measure the mousepad instead of asking for it.
  - With the mouse locked, the player slides from the far left of their pad to the far right (and optionally top to bottom). The raw counts ÷ DPI × 2.54 give the usable width in cm, with no ruler needed.
  - Repeat 2–3 times and take the smallest.
  - Uses:
    - Cap the slowest test sens so a comfortable turn (e.g. 180°) fits the pad.
    - Warn if the player's current sens already doesn't fit.
    - Show it on results ("a 180° turn uses 17 cm of your 40 cm pad").
  - It depends on the DPI being entered correctly. A mismatch would show up as an odd pad size, which is itself a useful check of the DPI.
- **Gradual-change advice:** if the recommended change is more than about 10%, suggest moving halfway first, playing a week, then running Quick A/B from History. This follows the pros' "small steps, give it a week" habit.
- **Sens variation as a training tip** under "What to train". Optional.

## Notes from research (context, not tasks)

- **How pros pick a sens:** start from a typical value for the game, fit it to arm and pad, change in 5–10% steps, and stay on each for about a week.
- **The Finals:** no pro data found. Generic guidance is about 20–33 cm/360.
- **PSA (Perfect Sensitivity Approximation):** test about 0.5× and 1.5×, keep the better one, halve the gap, repeat 6–8 times. Its strength is the wide start. Its weakness is that each step is a single, unblinded trial judged by feel.
- **Aimlabs Mouselabs:** passive. It steers by over/undershoot and tracking speed match over up to 100 sessions. It's strong on data volume, but over/undershoot mostly reflects adaptation, and it never directly compares sens against each other.
