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
- **Summary:** kills, and the means of acquisition time, acquisition gain, kill time, losses, lead/lag and held fraction.

Acquisition gain is recorded and used in diagnosis, but not in steering, because moving targets confound it.

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
