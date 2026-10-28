# Blind Sens Finder — Design Spec

Date: 2026-10-27
Status: Draft for review

## 1. Purpose

A browser aim test that finds a player's best mouse sensitivity from their own aim data and answers: *should I change my sens, or train something specific?*

Output: a recommended cm/360 (with a range it's indistinguishable from), an in-game sens multiplier, and a diagnosis. Test sens values are hidden from the player until results.

Look and feel: a browser 3D aim trainer in the style of aiming.pro — simple 3D room, sphere targets, crosshair, minimal HUD.

## 2. Fixed constraints

- Raw input only: Pointer Lock with `unadjustedMovement: true`. One sensitivity in every direction; no per-axis/per-direction tuning.
- Sens entered as cm/360 + mouse DPI. No per-game sens conversion tables.
- Output: recommended cm/360 + in-game multiplier = `current_cm360 / recommended_cm360` (e.g. 0.90× turns 33 into 29.7).
- Full session under 30 min; typical target ~15 min plus optional warm-up.
- Static site. Desktop (Chromium) for the scored test; any browser, including phones, for the demo.
- Browsers without `unadjustedMovement` support are blocked from the scored test with a message recommending Chrome or Edge. The demo still runs.

## 3. Setup

Stored locally and pre-filled next time:

| Field | Notes |
|---|---|
| Mouse DPI | required |
| Current cm/360 | required |
| Current in-game sens | optional; if given, results show the new in-game number |
| FOV value + type | horizontal or vertical; default 103 horizontal. Converted using the screen's aspect ratio. |
| Mode | Default (6 dial-in steps) or Thorough (10) |

Input conversion: `degrees = counts × (2.54 / DPI) × (360 / cm360)`. Movement is read from raw pointer events (`pointerrawupdate` where available, coalesced events otherwise) and timestamped with `event.timeStamp`, so dropped frames don't distort the data.

## 4. Session flow

| Stage | Content | Time |
|---|---|---|
| Warm-up (optional, recommended) | Free targets at current sens, unscored | 1 min |
| Baseline | Current sens: one round | ~1 min |
| Dial-in steps (4 / Thorough 8 / Quick 3) | Hidden sens each: one round | ~1 min each |
| Hidden re-check | Current sens again, disguised as a normal step, inserted at the midpoint of the dial-in | ~1 min |
| A/B | Pick vs current, blind, ABBA; if look 1 is borderline the player chooses whether to add BAAB | 4 min (+4) |
| Results | Verdict, recommendation, diagnosis, logs | — |

Typical total ~10 min plus warm-up; ~14 min if the player takes the extra A/B round. Thorough adds ~4 min.

**Rounds (revised 2026-10-28 after the first play-test).** A round is a 40 s flick block followed immediately by a 15 s tracking block (2 s unscored lead-in, scored only while the mouse button is held). Between rounds the mouse stays locked and a 3-2-1 countdown starts the next one; Esc pauses.

**Block content is standardized.** Flick targets come in waves of 4 small + 4 medium + 4 big flicks drawn from the fixed set of 30 distances, ordered roughly small→big (order jittered), each in a random direction from a seeded RNG. Wave 0 is unscored warm-in for the new sens, and only complete waves are scored, so every scored wave has the same class mix. Every tracking block draws from the same set of movement patterns. Differences between blocks then reflect the sens, not the layout.

**Breaks and pausing.** A short rest screen appears between blocks. Esc (or losing pointer lock) pauses; the interrupted block restarts on resume.

## 5. Measurement

### 5.1 Per flick target
- **Time to hit** — spawn to the click that hits.
- **First move** — endpoint of the first ballistic submovement (velocity falls below a config threshold). Gain = distance traveled along the target direction / target distance. >1 overshoot, <1 undershoot. Grouped by distance class.
- **Corrections** — number of submovements after the first, before the hit.
- **Click positions** — all click positions relative to target centre, including misses.

### 5.2 Per tracking block
- **Time on target** — fraction of scored time the crosshair is on the target.
- **Lead/lag** — mean signed error along the target's direction of motion (positive = ahead).

### 5.3 Score
- **Flick score: effective throughput** (ISO 9241-9): `TP = log2(D / We + 1) / MT`, with `We = 4.133 × SD` of click endpoints along the movement axis. This combines speed and spread; corrections are captured through MT.
- **Tracking score:** time on target.
- **Composite:** `log S = w·log(TP / TP_baseline) + (1−w)·log(ToT / ToT_baseline)`, with `w = 0.6` by default.
- Over/undershoot, corrections, spread and lead/lag are **not** in the score. They feed steering (§6) and diagnosis (§8).
- Each block's score has a **noise estimate** from bootstrapping its individual targets / tracking segments.

## 6. Steering (choosing the next sens)

Sens is handled as `x = ln(cm360)`; step sizes are relative.

1. **Bracket first.** Steps 1–2 test roughly ±15% around current, one each side, in random order.
2. **Then aim at the best guess.** The centre for the next probe is the current fit's peak (§7), or the best tested value if the fit isn't usable yet.
3. **Nudge direction from the aim signals**, each measured relative to the player's own baseline values:
   - small-flick overshoot ↑ → slower (higher cm/360)
   - big-flick undershoot ↑ → faster
   - tracking lag → faster; lead → slower
   - corrections or spread ↑ → follow the sign of the fit's slope
   Each signal has a config weight. Signals from a block are down-weighted in proportion to the size of the sens jump that preceded it, because over/undershoot right after a switch partly reflects adaptation to the previous sens.
   Aim signals nudge direction only while the best guess is inside the tested range; at the tested edge, or when both neighbours are already tested, steering walks outward, past the better-scoring side first.
4. **Step size shrinks** from ±15% to ±4% over the dial-in (config schedule).
5. **Limits:** tests stay within 0.6×–1.6× current cm/360 (config).
6. **Logging:** every steering decision records its inputs and reason in the block log.

## 7. Fitting (picking the winner)

Model, over all scored blocks (baseline, dial-in, re-check):

`log S_b = a + b·x_b + c·x_b² + d·t_b + f·[b is at current sens] + ε_b`

- `t_b` = block order (drift: warm-up/fatigue). `f` = familiarity bonus.
- Weighted by each block's inverse noise variance.
- **`d` and `f` are shrunk toward 0** (ridge penalty, strength in config) so they can't absorb real differences with only a few current-sens blocks. The blind A/B remains the final judge.
- **Pick** = argmax of `a + b·x + c·x²` within the tested range.
- **Range** = bootstrap (resample targets within blocks, refit) → set of x within the 3% minimum effect of the peak in ≥ a config fraction of resamples. Reported as "anything from A to B cm/360 performs the same for you".

**Guard rails:**
- Peak at or beyond the tested edge → pick the best tested edge, flag "you may want even faster/slower; run again".
- `c ≥ 0` (flat or upward curve) or too few points → pick best tested block, mark low confidence.
- Pick within 3% of current → skip the A/B, verdict Keep.

## 8. A/B and verdict

**A/B.** Pick (P) vs current (C), both hidden. Order is ABBA or BAAB, chosen at random. Each block opens with adaptation targets, then the standard flick and tracking content.

Effect `δ = mean log S(P) − mean log S(C)`, SE from target-level bootstrap.

- **Look 1 (after 4 blocks):**
  - `δ > ln(1.03)` and `δ > z·SE` → **Change** (stop)
  - `δ < 0` and `|δ| > z·SE` → **Keep** (stop)
  - upper bound `δ + z·SE < ln(1.03)` → **No clear winner** (stop, futility)
  - otherwise → add 4 more blocks in the reverse order (ABBA → BAAB), then **look 2**
- **Look 2 (8 blocks):** same win/lose rules; otherwise **No clear winner**. If current wins or nothing is clear, keep current.
- `z` defaults to 2.0 and is **calibrated with the simulator** so a no-real-difference player gets a false "Change" ≤ 5% of the time across both looks.

**Verdict outputs:**
- **Change** — recommended cm/360, range, multiplier, new in-game sens if known.
- **Keep** — current sens won, or the pick is within 3% of current.
- **No clear winner** — keep current; the diagnosis suggests what to train instead.

Results always state that the familiarity bias favours the current sens, and that transfer to in-game performance has not been proven.

## 9. Diagnosis

Computed from the blocks at the final sens: the A/B blocks at the recommended (or kept) sens, or the baseline and re-check blocks if the A/B was skipped. Each item shows the measured value next to its config threshold:

| Finding | Signal |
|---|---|
| Landing spread | `We` relative to target size above threshold |
| Micro-corrections | mean corrections per target above threshold |
| Small-flick overshoot | small-class first-move gain above threshold |
| Big flicks short | big-class first-move gain below threshold |
| Tracking vs flicking | tracking score relative to flick score vs a config reference ratio |

The verdict comes first ("change" or "keep"), then the top 1–2 findings as "train this". All thresholds are config values and are marked in the UI as provisional.

## 10. Validation features

- **Simulator tests** (§12) validate the algorithm against a planted optimum.
- **Test-retest:** history shows whether the ranges from sessions on different days overlap.
- **Quick A/B mode:** a standalone A/B between the current sens and any earlier recommendation, intended for 1–2 weeks after switching, once the familiarity bias has flipped. It reuses the A/B module.

## 11. Simulated player and demo

The simulator produces the same raw movement and click streams a real mouse would, and they go through the same measurement pipeline.

Player parameters: optimal cm/360 `x*`, curvature (how much performance drops off the optimum), familiarity bonus at current sens, adaptation rate (how quickly first-move gain settles after a switch), motor noise, drift over the session, and RNG seed.

- First-move gain ≈ `(adapted_cm360 / test_cm360)^k` + noise; `adapted_cm360` moves toward the test sens at the adaptation rate each target.
- Performance multiplier = `exp(−curv · (ln x − ln x*)²)` × familiarity × drift.

**Demo mode** (phone-friendly, no pointer lock): a simulated player runs a compressed session in the 3D scene, with captions explaining each stage ("hidden sens 3 of 6 — overshooting small flicks, so next test is slower"), and ends on the real results screen.

## 12. Architecture

**Stack:** TypeScript, Vite (static build), Vitest (tests), three.js (3D scene), Preact (menus, results, history), hand-drawn SVG charts, IndexedDB (history).

```
src/
  core/          pure TS, no DOM, no three.js — fully unit-tested
    config.ts    all weights, thresholds, schedules
    rng.ts       seeded RNG
    geometry.ts  counts→degrees, FOV conversion, projection math
    measure/     submovement segmentation, per-target metrics, throughput, tracking metrics
    score.ts     composite score + block bootstrap noise
    steer.ts     next-sens selection + reason
    fit.ts       weighted ridge quadratic + bootstrap range + guards
    ab.ts        adaptive ABBA/BAAB decision
    diagnose.ts
    session.ts   session state machine (pure: events in → next block spec out)
    sim/         simulated player
  input/         pointer lock, raw-input capability check, event capture
  scene/         three.js room, targets, crosshair
  ui/            Preact screens: setup, run, pause, results, log, history, demo
  store/         IndexedDB history + export
```

Rule: `core/` never imports from the other folders. `session.ts` is a pure state machine, so a complete session can be run in tests using simulator data alone.

## 13. History and logs

- **Per session (IndexedDB):** setup, verdict, pick, range, every block's summary, every target's record, and the steering decisions with their reasons. The raw movement stream is kept for the 5 most recent sessions only, to limit storage.
- **Results view:** charts the score-vs-sens curve with the tested points and the range. Includes an expandable per-block log.
- **History view:** past sessions over time, with test-retest range overlap.
- **Export:** JSON (full session, including raw stream if kept) and CSV (per-target table).

## 14. Testing

- **Unit tests** for every `core/` module, with deterministic seeds.
- **Simulator statistical tests** (fixed seeds, many runs):
  - Convergence: with moderate noise, ≥ 80% of sim runs pick within ±8% of the planted optimum.
  - Null A/B: when pick and current perform identically, false "Change" ≤ 5%.
  - Familiarity: a planted familiarity bonus doesn't move the pick by more than a config tolerance.
  - Guards: an optimum outside 0.6–1.6× triggers the edge flag.
- **Full-session test:** run `session.ts` end-to-end with the simulator.
- **Manual check:** play one real session in Chrome on desktop; run the demo on a phone.

## 15. Out of scope

Per-game sens conversion tables, per-axis tuning, accounts or cloud sync, leaderboards, and non-Chromium raw input.

## 16. Revision 2 — game feel, variety, breaks, play area (2026-10-28)

Driven by two play-tests: the 10-minute session "still feels like a chore", 10 minutes without breaks of the same two tasks is fatiguing, and there was no per-part timer.

**Rounds are three parts, the same in every round** (fair across sens, since the A/B arms land on different rounds):
1. **Flicks:** 20 s of waves of 2 small + 2 medium + 2 big flicks, jittered small→big. Wave 0 is unscored warm-in; only complete waves are scored.
2. **Switching (new):** 15 s with 3 static targets up at once; hitting one replaces it with a new one at a seeded random spot in a forward region. The first 2 kills are unscored warm-in. Score: switch throughput = Σ log2(D/(2r)+1) / Σ kill interval over scored kills, where D is the angular distance from the aim at the previous kill to the killed target. The bootstrap is over kills.
3. **Tracking:** 2 s lead-in, then 15 s, scored only while the button is held.

**Composite score:** log S = 0.4·ln(flick tp ratio) + 0.3·ln(switch tp ratio) + 0.3·ln(tracking ratio), with ratios relative to the baseline round. The weights live in config.

**Dial-in:** 5 hidden steps (Thorough 8, Quick 3). Session: baseline + 5 + re-check + 4 A/B rounds = 11 rounds of about 55 s, plus breaks: about 11 min.

**Pacing:**
- A timer shows the current part ("Switching · 0:12").
- Every 3 rounds there's a break screen with that stretch's points, grade and best streak; the player clicks to continue.
- Between other rounds a 3-2-1 countdown runs while the mouse stays locked. A setting can turn that off, so every round starts with a click.

**Game feel (display only; never changes targets or difficulty):**
- Synthesised sounds (hit, miss, streak, tracking tick, countdown) with an on/off setting.
- A pop effect on hits.
- Live points and a streak multiplier.
- A grade per stretch.
- Stage names: "Calibration" (baseline), "Round N of M" (dial-in and re-check), "Final Showdown" (A/B).
- End-screen stats and personal bests in browser storage.
- A brighter room.
- Grades compare against the player's own baseline round, so they don't reveal which sens is being tested.

**Play-area calibration:**
- Optional, from setup. With raw lock, the player clicks at the far left of the pad and then at the far right, twice; the smaller span wins. That gives padWidthCm = counts / DPI × 2.54.
- Stored on the setup (`padWidthCm`).
- Steering caps the slowest test sens so a 180° turn fits within `pad.turnFraction` (0.9) of the pad: cm360 ≤ 2 · 0.9 · padWidthCm.
- Setup warns if the current sens already doesn't fit, and Results shows how much of the pad a 180° turn uses.

**Re-tuned diagnosis references (provisional, from one player):** refTp 5, refTot 0.7, bigGainMin 0.8 (waves bias big flicks short).

## 17. Revision 3 — full data, four equal parts, cues, stricter change (2026-10-28)

Driven by the third play-test:
- Switching was scored only by kill throughput. Its misclicks and over/undershoot were ignored, and click positions weren't even logged.
- The parts felt uneven, and the changes between them were jarring.
- The timer was hard to read.
- "Change by luck" (4.5% in the simulator) was too high.

**Rule for every part:** record all the raw data: mouse samples, button presses and releases, every click with its aim, and the target state over time. Derive the full metric set from it, and feed the relevant metrics into scoring, steering and diagnosis. Horizontal vs vertical figures are measured and diagnosed only; there is never a per-axis sens output. Past sessions are not reprocessed.

### 17.1 Rounds: four equal parts

Each round runs the same four parts in this order: **flicks → switching → tracking → tracking switching (new)**. Each part is **14 s** (quick mode: 8 s). Any unscored lead-in or warm-in counts *inside* its part's 14 s:
- Tracking: 2 s lead-in + 12 s scored (quick: 1 + 7).
- Tracking switching: 1.5 s lead-in + 12.5 s scored (quick: 1 + 7).

Between parts there's a **1.8 s handover cue**: a "Next: Switching" banner with a 3-2-1 tick, 600 ms apart. The mouse stays locked and input is ignored. The cue is unscored and identical for every sens. Each part starts with its own short chime.

A round is about 61 s. The default session (11 rounds plus breaks) is about 12 min, or about 16 min if the confirmation A/B round runs (§17.6).

### 17.2 Flicks (adds click bias)

The recorded data is unchanged: targets, spawn time and aim, every click with its aim, and the aim path.

New metrics:
- `clickBias`: the mean first-click along offset in degrees (+ means overshoot at the click).
- `classN`: the number of scored trials per distance class, so gains can be pooled.

Click bias is a steering driver: a positive change from baseline steers slower.

### 17.3 Switching (full flick-style analysis)

**Data:**
- Every click: `{t, aim, hit}`.
- Every kill: `{t, target, from}`, where `from` is the aim at the previous kill.
- The aim path.

**Per switch** (previous kill → this kill; the intended target is the one killed next):
- Distance D from `from` to the target, and its class (small/medium/big, with the same thresholds as flicks).
- First-move gain, from submovement segmentation starting at the previous kill time.
- Corrections.
- Interval (ms).
- The first click's along and perp offsets relative to the from→target line. A first click that misses is a misclick, and its offset is that misclick's over/undershoot.
- Click count and misclick count.

**Summary (`SwitchSummary`):**
- **Effective throughput**, with the same formula as flicks:
  - We = 4.133·SD(first-click along), floored at minWeDeg.
  - De = mean(D + along).
  - MT = mean interval.

  Misclicks widen the spread and lower the score. The bootstrap is over scored switches.
- Per-class gains and `classN`.
- `corrections` and `clickBias`.
- `accuracy` (hits/clicks), `misclickRate`, and `misclickAlong`: the mean along offset of missed clicks, where + means overshooting misses.
- `kills` and `n`.

The first 2 kills are warm-in. A switch still in progress when the part ends is not scored.

**Steering:** small, medium and big gains are pooled with the flick gains, weighted by `classN`.

### 17.4 Tracking (full metrics)

**Data:**
- Mouse path and holds.
- The target path, reproducible from the seed (position and velocity at any time).
- Segment change times.

**Metrics,** over the scored window on the 120 Hz grid:
- `tot` and its SE (the score term, unchanged).
- **Error:**
  - distance: mean, RMS and median;
  - along the motion (lead/lag): mean and RMS;
  - across the motion: mean and RMS.
- **`speedRatio`:** the median of crosshair speed projected on the target's direction ÷ target speed, while the button is held and the target moves faster than the minimum speed. This is tracking's version of over/undershoot and a **steering driver**: a ratio above 1 steers slower.
- **Turns:** for each segment change with a direction change over 90°:
  - reaction time, until the crosshair speed along the new direction exceeds 50% of target speed;
  - overshoot past the target along the old direction;
  - settle time, until the error stays within the radius for 100 ms.

  The summary uses the means.
- **`jitterDegPerSec`:** the RMS of (crosshair velocity − target velocity) while on target.
- **`losses`:** on→off transitions while held, plus the mean reacquire time.
- **Splits:**
  - ToT for slow vs fast targets, split at the midpoint of the speed range;
  - error RMS on the yaw axis vs the pitch axis (cos-scaled), for diagnosis only;
  - ToT for the first half vs the second half.
- **Button:** held fraction, and releases while on target.

### 17.5 Tracking switching (new part)

**Task:**
- 3 moving targets (radius 2°), each on its own seeded path. They move like tracking targets at 10–25 °/s, reflected inside the switching region (±35° yaw, ±15° pitch).
- Holding the button with the crosshair on a target damages it. Each target has **0.7 s** of health.
- A killed target is replaced at once by the next seeded target.

**Data:**
- Mouse path and holds.
- Every target: `{index, seed, origin, spawnT, killT}`, from which its position at any time can be reproduced.
- Kill events with the aim at the kill.

**Metrics:**
- **Score term `dmg`:** the fraction of scored time spent dealing damage. Its SE comes from a bootstrap over 1 s chunks, as for tracking ToT. It captures acquisition speed, losses and staying on target.
- **Per kill:**
  - acquisition time (previous kill → first damage on this target);
  - first-move gain, against the target's position at the end of the first submovement;
  - kill time;
  - lost-target events and reacquire time;
  - lead/lag while damaging.
- **Summary:** kills, and the means of acquisition time, acquisition gain, kill time, losses, reacquire time, lead/lag and held fraction.

Acquisition gain is recorded and shown in the block log, but not used in steering, because moving targets confound it.

**Composite score:**

log S = 0.3·ln(flick tp) + 0.25·ln(switch tp) + 0.25·ln(tracking ToT) + 0.2·ln(trackswitch dmg)

Each term is relative to the baseline round, and the SEs combine in quadrature.

A part is invalid (retried once) if it has 0 kills or dmg < 0.05.

### 17.6 Stricter "change" rule

The target is a false change rate of **≤ 1%** with the simulator's flat player.
- z rises from 2.0 to **2.5**.
- **"Change" needs both A/B rounds:**
  - Look 1 can only return keep, none or continue; a result that would have been a change becomes continue.
  - Look 2 (all 8 rounds) returns change only if δ > ln(1.03), δ > z·SE, and look 1's δ was also positive.
- When the first round favours the new sens, the ask card says "Your new sens is ahead — play 4 more rounds to confirm it?". Declining gives "no clear winner".

### 17.7 Diagnosis additions (training advice only)

These thresholds are provisional and live in config:
- **Switching misclicks:** accuracy below 80% gives "train clicking only when on target". The advice says whether the misses mostly overshoot or undershoot.
- **Vertical tracking weaker:** pitch error RMS ÷ yaw error RMS above 1.5 gives "train vertical tracking".
- **Slow turn reaction:** a mean turn reaction above 300 ms gives "train reacting to direction changes".

### 17.8 UI

- **Big part timer:** the part name sits above large numerals at top centre, with a draining bar that turns orange in the last 5 s. Lead-ins show "get ready".
- The handover cue (§17.1) and the per-part chimes.
- **Tracking-switching rendering:** health rings on the targets, a damage tick and a kill pop. The off-screen arrow points to the nearest target.
- **Ask card:** the wording depends on why it is asking (§17.6).
- **Mode labels:** Default about 12 min, Thorough about 16 min, Quick about 6 min.

### 17.9 Build notes and measured rates (2026-10-28)

**Simulator rates:**

| Check | Rate |
|---|---|
| Convergence | 88/100 |
| Familiarity (median pick/optimal) | 1.027 |
| Edge | 19/20 |
| Test-retest | 18/20 |
| Null false change | 0.3% (1/300; keep 1%) |

**Power** (quick A/B, 40 runs, pick = optimum), new rule vs old:
- At 0.75× current: change 38/40, vs 40/40 before.
- At 0.85×: 1/40, vs 4/40 before.

**Changes made during the build:**
- **Flick waves:** 1 target per class (waves of 3). With 14 s parts, 6-target waves lost too much to warm-in and unfinished waves.
- **Edge flag:** the fit also flags an edge when its peak lies within one final step of a tested edge that performs the same as the best point. Short parts make the far side score at the floor, which bends the quadratic early.
- **Click-bias scale:** click bias steers per 20°, which puts a 1° bias on a typical flick on the same footing as a 5% gain difference.

### 17.10 After the first revision-3 play-test (2026-10-28)

**Stray clicks:** one click far from the rest (e.g. clicking as a target appears, 28° short of a 30° flick) dominated the end-point SD. That single click cut a round's flick or switching throughput by half or more, and it skewed the calibration round that every later round is compared with.

- The end-point spread (We) and the click bias now leave out *stray* first clicks: those further than max(3 robust SDs (1.4826·MAD), 3°) from the median along offset (`score.stray`).
- Stray clicks still count as misses, in accuracy, in the misclick stats and in the time taken.
- Re-scoring the play-test with this rule:
  - switching throughput was steady across rounds (5.7–7.7 instead of 2.5–7.7);
  - the false "slower is better" dial-in trend went away;
  - the A/B stayed "no clear winner", with current about 4% ahead.

**End-of-part countdown beeps:** a beep as each part's time left crosses 5, 4, 3, 2 and 1 s. It is sound only: the timer display is unchanged, and nothing is drawn near the centre of the screen.

## 18. Play-Along mode (2026-10-28)

### 18.1 Why

Standard mode puts every new sens in front of the player cold. An unfamiliar sens scores worse just from novelty, which biases results toward the current sens. Fifteen minutes of straight testing also feels like a chore and tires the player, so the late rounds give worse data.

Play-Along alternates real game matches with short in-app tests. The player plays a match (e.g. a TDM in The Finals) on a sens, alt-tabs back to the browser, and tests that sens straight away, already warmed up on it in their real game.

**Goals:**
- Every sens is tested after a real game match on it.
- Short test blocks with game breaks in between, so it never feels like a chore.
- A useful answer in about an hour: a range, or a single number if it's already sure.
- The search can continue on another night.

**Non-goals:**
- Replacing Standard or Quick mode. They stay unchanged as the fast options.
- Measuring anything inside the game. The app never reads game data; the match is only warm-up and feel.
- ADS or scope sens. Only hip-fire is used.

**Anti-goals,** which would make this a failure even if it works:
- Telling the player to change sens on luck. The false change target stays ≤ 1%, as in §17.6.
- Interrupting the player mid-match, or forcing them to remember numbers between the game and the app.
- Feel overriding the data.

### 18.2 Constraints

- Everything in §2, with one deliberate exception: Play-Along has a built-in **The Finals** conversion (§18.4).
- The app runs in a browser while the game is open. The player alt-tabs between them, so pointer lock is lost on every switch.
- **Pad measurement is required** in Play-Along (from the backlog's "make pad measurement required"). The revision-2 cap applies: no test sens may need more than 90% of the pad for a 180°.
- Scored-test content, scoring and data are exactly the §17 four-part round, so Play-Along data means the same as Standard data.

### 18.3 The loop

1. **Setup:** game (The Finals or Other), DPI, current sens (as a whole The Finals number, or cm/360 for Other), and pad measurement.
2. **Match on the default sens.** A waiting screen says "Play a match on **33**, then come back". The player alt-tabs and plays.
3. **Return:** the player holds **I'm back** for 1 s. A stray click can't trigger it. Then comes the feel question (§18.7), then a click to lock the mouse.
4. **Test** (§18.5) at that sens.
5. **The app picks a pair,** one lower and one higher (§18.6). It shows one of them, chosen at random, on the waiting screen as the number to type into the game.
6. **Match, return, feel, test** for that sens, then the same for the other one.
7. **Next pair,** narrower and centred on the current best (§18.6). Repeat 5–6.
8. **Hour check** (§18.8): show the range and ask whether to continue.
9. **Before any "change" verdict**, the head-to-head (§18.9).

The waiting screen always shows the number to type in large text (with cm/360 underneath), so the player never has to remember it. It also shows what's next ("After this: a 3-minute test") and the night's elapsed time.

### 18.4 Games and the sens number

- **The Finals (built in):**
  - Hip-fire yaw is 0.001° per count per sens point, so cm/360 = 914,400 ÷ (sens × DPI) and sens = 914,400 ÷ (cm/360 × DPI).
  - Source: three mouse-sensitivity.com lookups at 800 DPI (33 → 34.6364, 16.5 → 69.2727, 66 → 17.3182 cm/360), all exactly on this line. The constant ships as is, with no in-game ruler check (user decision).
  - **Whole numbers only.** The Finals has no decimal sens, so every test sens is a whole number, and the app uses that number's exact cm/360. Ranges are shown in whole numbers.
- **Other game:** the player enters cm/360. The waiting screen shows the cm/360 plus a ruler check ("set your game sens so sliding the mouse 30.0 cm turns you exactly one full circle"). Steering is not limited to whole numbers.
- Adding more games later is a constant per game, not a new design.

### 18.5 The test block

- A **15 s unscored lead-in** of free flick targets at the test sens, to readjust after the switch from the game.
- Then **3 rounds** of the §17 four-part round (about 3 min), with the handover cues and chimes, and no breaks inside the block.
- Scores, grades and streak results are **hidden** until the night's range or verdict is shown. The block ends on a neutral "Test saved" card. The player knows the number in Play-Along, so seeing each sens's score would undo what blinding is left (user decision: keep hidden).
- In-app screens call the sens "Sens A", "Sens B" and so on. The real number appears only on the waiting screen.
- Esc or losing pointer lock pauses. An interrupted part restarts on resume, as now. If the player leaves mid-block, the incomplete block is discarded and that sens's test is redone after the next match.
- The block length (3 min, 3 rounds) is provisional. The simulator check (§18.11) confirms it before the build is final.

### 18.6 Steering and fitting

- §7's usability test and its fallback (best tested block) carry over unchanged. The per-night offset is only added once there are blocks from two or more nights. *(My call.)*
- The fit is §7's model over every Play-Along test block, with a **per-night offset** (ridge-shrunk like `d` and `f`) so nights with a different day form can be pooled. `t_b` is block order within the night. The familiarity term `f` stays, because the default sens is still the most familiar one, even if the match warm-up shrinks it.
- **First pair:** about ±20% around the default sens. *(My call: wider than Standard's ±15%, because Play-Along has fewer steps.)*
- **Each next pair:** centred on the fit's peak (or the best tested sens while the fit isn't usable), with the step about halved each time. The aim-signal nudges from §6 still apply.
- **Snapping (The Finals):** each target is rounded to a whole number. If it lands on a number already tested, or both sides land on the same number, move one whole number outward. If no new whole number is left inside the range, the range has stopped narrowing.
- The §6 limits (0.6×–1.6× current) apply.
- **Pad cap:** a target too slow for the pad (180° over 90% of the pad) is automatically moved to the slowest sens that fits, rounded to the side that fits (user decision). If that sens is already tested, or is the other side of the pair, that side is skipped and the step tests only the faster side.
- The **range** is §7's bootstrap range, shown in the game's numbers ("between 32 and 37") with cm/360 underneath.

### 18.7 Feel question

- After each **I'm back** and before the test, the app asks "How did that feel?" with three answers: **Too fast / Too slow / About right**. It replaces the 1–5 rating in this mode.
- Feel is saved with the test block and **never steers** the search, the fit or the A/B maths.
- **Feel breaks ties:**
  - When choosing the single recommended number inside a final range, prefer the "About right" sens nearest the fit's peak. With none, use the peak.
  - When the head-to-head is "no clear winner" and only one of the two felt "About right", Results recommends that one and labels it "tie broken by feel".
- **Disagreement flag:** if a sens gets "Too slow" (or "Too fast") on two separate matches, Results says so next to the numbers. For example: "You played best at 30, but it felt too slow both times. Consider 32 and give it a week."

### 18.8 Hour check and continuing

- After the first test that finishes past **50 minutes** of night time (counted from the first waiting screen, matches included), the app shows the current range and asks **"Keep narrowing it down?"**:
  - **Keep going tonight:** the next match and test.
  - **Continue another night:** everything is saved, and the next Play-Along start offers "Continue your search (range 32–37)".
  - **I'm done:** it shows the middle of the range as the number to play on (feel tie-break per §18.7), labelled **"Best guess, not confirmed yet"**, and saves it in History as a range result (user decision). A best guess is not a "change" verdict, and the ≤ 1% guarantee doesn't apply to it. Results says this, and offers to run the head-to-head next time to confirm it.
- It never interrupts mid-step; the check only appears between steps.
- **Early finish:** if the range has stopped narrowing (§18.6), the app goes straight to the head-to-head (§18.9). The head-to-head's verdict is the single answer (the leader for "change", the default for "keep"), and the night then finishes without the hour check.
- **Saving:** progress is saved after every completed test, in the same local storage as History. A search older than 14 days asks whether to continue or start fresh. *(My call.)*
- **Starting a continued night:** if the head-to-head is pending, it runs first. Otherwise the night's first test is at the default sens, to anchor the per-night offset.

### 18.9 Head-to-head before "change"

- Before the app ever recommends changing, the current leader and the default sens each get one more match plus test, in random order.
- **"Change"** needs both of these:
  - the pooled comparison over all of those two sens's blocks clears §8's rules (δ > ln(1.03) and δ > z·SE);
  - the head-to-head's own pair of blocks also favours the leader.

  This is the Play-Along version of §17.6's "both A/B rounds". The exact z is calibrated in the simulator for **≤ 1% false change**.
- Otherwise: **Keep** if the default wins, or **No clear winner** (then the feel tie-break of §18.7 may apply, labelled).
- If the hour check comes first, the head-to-head is the first thing next night.
- **The leader is the default sens:** no head-to-head is needed, and the verdict is **Keep**.
- **The head-to-head blocks count in the pooled fit.** If they make a different sens the leader, that sens gets its own head-to-head against the default. There's at most one more per night; after that, the hour check runs. *(My call.)*
- **If the simulator can't reach ≤ 1%** at 3 or 4 rounds, the head-to-head grows to two blocks per side before anything else changes. The guarantee is never weakened, and every inconclusive result stays "keep current". *(My call.)* The simulator check runs early in the build, as a gate rather than a final check.

### 18.10 Data recorded

Everything the §17 parts record, for every block, plus:
- night index, wall-clock times, and time away (waiting-screen duration) before each test;
- game, DPI, and the in-game number and cm/360 of each test;
- the feel answer;
- pair, step size and snapping decisions, with reasons (as §6's steering log);
- lead-in data (recorded, not scored);
- interrupted and discarded blocks.

Results and History get a Play-Along view: each tested sens in game numbers with its feel answers and nights, the range, the head-to-head, the verdict and the diagnosis (§9, from the blocks at the final sens).

### 18.11 Validation

The simulated player gets a Play-Along model: a smaller novelty penalty after a match, a random night-to-night form offset, and per-test fatigue that resets after each match. Before the build is final, the simulator must show:
- null false change ≤ 1%, with z tuned if needed;
- whether 3 rounds per test is enough, or whether 4 is needed, to reach Standard-like convergence within two nights;
- typical tests per night and nights to a single answer.

Rates go in a build-notes subsection, as in §17.9.

### 18.12 Left to the builder

- Screen layouts and wording for the waiting screen, the hold button (1 s fill), the feel question and the hour-check card, in the existing style.
- Storage format for the saved search.
- The step-halving schedule details and the aim-nudge weights, within §18.6.

### 18.13 Build notes and measured rates (2026-10-28)

**Change during the build:** the first simulator run gave a null false change of **5.3%**. Two things caused it:
- The pooled comparison included the leader's earlier tests, which are the reason it was chosen (selection bias).
- Head-to-heads were sometimes split across nights, so night form showed up as a difference.

Now:
- Only the head-to-head's own same-night tests decide "change", with the §8 rule at z = 2.5. Earlier tests still steer and fit.
- A head-to-head split by the hour check is replayed in full the next night.

**Simulator rates** (3 rounds per test, 1 head-to-head test per side, up to 4 nights):

| Check | Rate |
|---|---|
| Null false change | **0/300** (keep 54, none 246) |
| Convergence (optimum 0.75–1.3× default) | 14/14 change answers within ±8%; kinds: change 14, none 83, keep 3 |
| Effort | median 3 nights, median 4 tests per night |

Power is low. Most searches with a real optimum end with "no clear winner", because one 3-minute test per side is a small head-to-head.

### 18.14 After the first Play-Along play-test (2026-10-28)

- **Test block:** 2 rounds of **20 s parts** (tracking: 2 s lead-in + 18 s), replacing 3 rounds of 14 s parts. About the same total time, with fewer handovers.
- **Flicks score from the first wave** in Play-Along (`flick.warmWave: false`), because the match and the 15 s lead-in already warm the player up. Switching's first 2 kills and the tracking lead-ins stay unscored, because those are about measurement, not warm-up.
- **The lead-in (and the Standard warm-up)** now has hit sounds and pops, with no points.
- **Countdown beeps rise** two semitones per second toward zero; the last second is longer, and the "go" beep is an octave up. This applies to every mode.
- The §18.13 rates were measured with 3 × 14 s; they need re-measuring with 2 × 20 s.

## 19. Play-Along, simplified: one grade, direction, control (2026-10-28)

The user found §18's mix of a weighted score plus a separate aim-signal nudge too convoluted. Play-Along now runs on three plain ideas. The goal is a sens where the **first movement lands close, quickly, with few corrections**.

### 19.1 The grade: how good was this sens?

One number per test. Each part is scored per item, so its noise is just the spread of its items: SE = sd/√n.

- **Flicks and switching**, per target or switch:
  - q = −ln(time to hit, s) − |ln(first-move gain ÷ ideal gain for its distance class)| − 0.1 × corrections − 0.2 × misclicks.
  - The gain term is capped at 1, and a missing first move counts as 1.
  - Overshoot and undershoot cost the same.
- **Tracking:** ln(time on target), with its existing chunk-bootstrap SE.
- **Tracking switching**, per kill:
  - q = −ln(lock-on time + kill time, s) − |ln(lock-on first-move gain)|.
  - The lock-on gain is measured against where the target was at the end of that movement.

Each part's mean is taken over all items in the test (both rounds), and compared with the same part in the control's first test. The **test grade** is the plain average of the four part differences (equal weights). Its SE is √(ΣSE²)/4.

### 19.2 Direction: up or down?

These are measured against the normal human pattern, never against the player's own sens. The ideal first-move gain is **1.00 for small flicks, 0.97 for medium and 0.93 for big** (provisional, in config). People land slightly short on long moves on purpose.

- Overshoot: the mean of ln(gain ÷ ideal) over flick and switch items. + means too fast.
- Tracking ahead/behind: the mean lead/lag in degrees. + (ahead) means too fast.
- Tracking switching ahead/behind: the same, while dealing damage.

**Signal** = the average of overshoot ÷ 0.10 and each lead/lag ÷ 1°.
- Above +0.5 → test **lower** (slower).
- Below −0.5 → test **higher** (faster).
- Otherwise neutral.

### 19.3 The search

1. The first pair is ±20% around the control.
2. After that, the centre is the best-graded sens: the snapped fit pick when the fit is usable, else the best test.
3. The best sens's latest direction shifts the centre half a step that way.
4. The next pair is half as far apart, down to 4%.
5. Then the **final check**: the best sens vs the control on the same night, decided on grade by the §17.6/§18.9 rule.

The §18 aim-signal nudge (`aimDrivers` against the default sens) is removed from Play-Along. Standard mode is unchanged for now.

### 19.4 The control

The player's starting sens is a **control** only. It is the ruler that grades are shown against ("+6% vs your sens"), and the opponent in the final check. It never steers, and it is never treated as correct.

### 19.5 End screen: every stat across every sens

Both Play-Along and Standard results get small charts, one per stat. Each chart has the tested sens along the bottom, each sens's value as a dot, and the control marked. The stats are:
- first-move landing (% of distance, with the ideal line);
- corrections per target;
- time to hit;
- misclick rate;
- time on target;
- tracking ahead/behind;
- tracking-switching lock-on time;
- tracking-switching ahead/behind.

A user decision to keep in mind: the final check's 1% false-change guarantee must hold with the new grade (simulator re-check, run only when the user isn't gaming).

### 19.6 Measured rates (2026-10-28)

These are for 2 rounds of 20 s parts, the spec-19 grade and direction, 1 final-check test per side, z = 2.5 and up to 4 nights.

| Check | Rate |
|---|---|
| Null false change | **1/300 (0.3%)**: keep 64, none 235 |
| Convergence (optimum 0.75–1.3× the control) | 21/21 change answers within ±8%; kinds: change 21, none 73, keep 6 (up from 14 change with the §18 score) |
| Effort | median 3 nights, median 4 tests per night |

### 19.7 Reaching a far-away best (2026-10-28)

Scenario runs showed the search stopping short (start 30 with best 50 ended at 45; start 50 with best 30 ended at 33). Two simple rules fix that:

- **Edge rule:** if the best sens so far is the fastest or slowest one tested, the next pair keeps the same step instead of narrowing, so the search walks on outward.
- **Wider limits:** Play-Along tests from **0.5× to 2×** the starting cm/360 (`playAlong.limits`), and never slower than the pad allows. Standard keeps 0.6×–1.6×.

Re-run (5 simulated players each, up to 6 nights):

| Start → best | Before | After |
|---|---|---|
| 30 → 50 | change to 45 (5/5) | change to 48–49 (5/5), in 4 nights |
| 50 → 30 | change to 33–34 (5/5) | change to 31–33 (5/5) |
| 33 → 40 | change 1/5, others none | change 2/5 (39–40), others none, range 34–48 |
| 33 → 33 | keep 4/5, none 1/5 | unchanged |
