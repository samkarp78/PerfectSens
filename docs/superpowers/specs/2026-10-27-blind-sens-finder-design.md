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
| Warm-up (optional, recommended) | Free targets at current sens, unscored | 3 min |
| Baseline | Current sens: flick block + tracking block | ~1¼ min |
| Dial-in steps (6 / Thorough 10) | Hidden sens each: ~6 unscored adaptation targets, 30 scored flicks, 25 s scored tracking | ~1¼ min each |
| Hidden re-check | Current sens again, disguised as a normal step, inserted at the midpoint of the dial-in | ~1¼ min |
| A/B | Pick vs current, blind, adaptive ABBA → +BAAB | 4–9 min |
| Results | Verdict, recommendation, diagnosis, logs | — |

Typical total ~14–16 min, worst case ~19 min, plus warm-up. Thorough adds ~5 min.

**Block content is standardized.** Every flick block uses the same fixed set of 30 target distances (a fixed mix of small <22°, medium, and big >35° flicks), shuffled in order and direction from a seeded RNG. Every tracking block draws from the same set of movement patterns. Differences between blocks then reflect the sens, not the layout.

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
