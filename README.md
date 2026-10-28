# Blind Sens Finder

A browser aim test that finds the mouse sensitivity that works best for you, using your own aim data.

It answers one question: **should I change my sens, or train something specific instead?**

At the end you get a recommended sensitivity (in cm per 360 degrees) with a range of values that scored about the same in the dial-in, a multiplier for your in-game sens (for example 0.90x turns 33 into 29.7), and a short "train this" diagnosis. The sensitivity values being tested are hidden from you until the results screen, so you cannot be biased by the numbers.

## How a session works

1. **Setup.** Enter your mouse DPI and current cm/360 (optionally your in-game sens and FOV). These are saved on your computer for next time.
2. **Warm-up (optional, recommended).** About 3 minutes of free targets at your current sens. Not scored.
3. **Baseline.** About 1 minute: a flicking block and a tracking block at your current sens.
4. **Dial-in steps.** 6 steps (10 in Thorough mode). Each uses a hidden sensitivity and takes about 1 minute: a few practice targets, 30 scored flicks, then 25 seconds of tracking. The test picks the next sens from how you did.
5. **Hidden re-check.** At an unannounced point, your current sens comes back, disguised as a normal step. It lets the test separate warm-up and fatigue effects from real differences.
6. **Blind A/B.** The test's pick versus your current sens, in a mirrored order (A B B A). If the result is unclear, it adds 4 more rounds. This is the final judge.
7. **Results.** Verdict (Change, Keep, or No clear winner), recommended sens and range, diagnosis, and a log of every block.

A typical session takes 14 to 16 minutes, at most about 19, plus the 3-minute warm-up. Thorough mode adds about 5 minutes. Esc pauses; the block you interrupted restarts when you resume.

## Requirements

- **Real test:** desktop Chrome or Edge. It needs raw mouse input (pointer lock with unadjusted movement), which other browsers do not offer. Other browsers are blocked from the real test with a message.
- **Demo:** works in any browser, including phones. A simulated player runs a short session with captions explaining each stage, and ends on the real results screen.

## Run it on your computer

You need Node.js 20.19 or newer (or 22.12+) installed.

```
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

## Run the tests

```
npm test            # fast unit tests
npm run test:stats  # slower statistical tests on the simulated player
```

## Build and deploy

```
npm run build
```

This creates a `dist/` folder. Upload the contents of `dist/` to any static host (GitHub Pages, Netlify, Cloudflare Pages, a plain web server). It uses relative paths, so it works from any folder or sub-address. No server code or database is needed. Your history is stored in your own browser.

To check the built site locally: `npx vite preview`.

## Honest caveats

- **Familiarity bias.** You are used to your current sens, which favours it. The test tries to correct for this, but the correction is partial.
- **Provisional numbers.** The scoring weights and the diagnosis thresholds are reasoned starting values, not proven ones. They all live in `src/core/config.ts` if you want to change them, and the results screen marks them as provisional.
- **Not proven in-game.** Doing better in this test does not guarantee better results in your game. Transfer has not been demonstrated.
- **Re-test after switching.** If you change your sens, play with it for 1 to 2 weeks, then run **Quick A/B** from the History screen. It compares your new sens with the old one once the familiarity advantage has worn off.
- **Results are noisy.** A single session is one data point. Sessions on different days should give overlapping ranges; History shows whether they do.
