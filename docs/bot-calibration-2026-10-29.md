# Bot calibration from real data (2026-10-29)

Plain summary for the user. The data is the fresh Default session (2026-10-29) plus the two most recent older sessions: 41 rounds, all starting from Finals 33 and testing about 25–38.

## What the real data shows

| Measure | How it changes as the sens changes | Notes |
|---|---|---|
| Overall score (grade) | **No measurable change** (slope 0.02 ± 0.13) | 25 and 38 scored the same within noise |
| First-move overshoot / undershoot | **No measurable change** (−0.02 ± 0.23) | Very noisy round to round (±0.16) |
| Tracking time on target | No measurable change | |
| Tracking ahead / behind | Always **~1.1° behind**; a little more behind on slower sens (weak) | The constant lag is normal reaction time |
| Tracking switching ahead / behind | Always **~0.5° behind**; clearly more behind on slower sens (−0.56 ± 0.23) | The strongest sens signal in the data |

In about 25–38, nothing in the test changed much with sens, except a bit of lag on slower sens.

## Bots tuned to match

"Realistic" bot settings: sweet-spot sharpness 0.3, shakiness 1.6, first-move variation 0.2, tracking delay 350 ms, tracking noise 10. They match the real round-to-round spread, the flat score curve and the ~1° tracking lag. The "sharp" bot is the same with sharpness 1.0, in case the real sweet spot is sharper than cold-switch Standard data shows. Both are saved in `tests/stats/scenarios.test.ts`.

## Bot tests with realistic bots (current Play-Along, 5 bots per scenario)

- **Realistic bots:** the system almost never found the best sens. Ranges came out 36–56% wide, and the answer was nearly always "keep your starting sens". It never wrongly said "change" for a bot that was already on its best sens.
- **Sharp bots:** a best sens far away (×0.6 or ×1.6) was found in most runs. Moderately off (×0.8 or ×1.25) was almost never confirmed.

## What this means

The search logic isn't the bottleneck. **The test doesn't currently show a measurable difference between sens for this player.** No search method can pick a sens the data can't tell apart. That includes the "first move lands right" idea, because overshoot doesn't vary measurably either.

There are two possible explanations:
1. **The player really performs about the same across this range,** in this test. Then the honest answer is "anything from X to Y performs the same; pick by feel".
2. **The test is too easy to show the difference.** Targets are 1.5° wide and flicks are 6–66°. In-game targets at range are much smaller, and big turns are bigger. A fast sens should hurt precision on small targets, and a slow sens should hurt big turns, but neither is stressed much here. Standard mode also switches sens cold, which blurs differences.

## Also found

The ahead/behind direction rule compares against zero, but every real player lags behind a moving target (~1° here). Against zero, "behind" always reads as "too slow", which biases toward faster sens. If direction stays, lag should be compared against the player's own average lag across all the sens tested in that search, not against zero and not against the starting sens.

## Possible next steps (decision for the user)

- **A. Make the test more sensitive:** smaller targets (closer to in-game head size) and some big turns. Then re-check, with one real session, whether score or overshoot starts to change with sens.
- **B. Accept the plateau:** when the data can't separate a range, say so plainly and let the feel answers ("too fast / too slow / about right") pick within it.
- **C. Both:** A first, then B as the fallback.
