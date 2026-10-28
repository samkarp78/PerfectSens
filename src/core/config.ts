export const defaultConfig = {
  flick: {
    distancesDeg: [6,8,10,12,14,15,17,18,20,21, 23,24,26,27,28,29,31,32,33,34, 37,40,43,46,49,52,55,58,62,66],
    // Flick blocks run for blockMs in waves: wavePerClass small + medium + big targets, roughly small→big (order jittered).
    // Wave 0 is unscored warm-in (unless warmWave is false); only complete waves are scored, so every scored wave has the
    // same class mix.
    blockMs: 14000, wavePerClass: 1, waveOrderJitter: 0.15, maxBlockTargets: 240, warmWave: true as boolean,
    warmupTargets: 300, targetRadiusDeg: 1.5, timeoutMs: 4000,
    smallMaxDeg: 22, bigMinDeg: 35, directionSpreadDeg: 30, bounds: { yaw: 75, pitch: 30 },
  },
  tracking: { durationMs: 12000, leadInMs: 2000, directionSpreadDeg: 30, targetRadiusDeg: 2, segmentMs: { min: 700, max: 2000 },
    speedDegPerSec: { min: 10, max: 25 }, bounds: { yaw: 40, pitch: 10 }, gridHz: 120, minSpeedForLeadLag: 5,
    /** Turn metrics: a segment change of more than turnMinDeg; reaction = crosshair speed along the new direction reaching
     *  turnReactFraction of target speed; settled = within the radius for settleMs. */
    turnMinDeg: 90, turnReactFraction: 0.5, settleMs: 100 },
  /** Target switching: `active` static targets up at once; hitting one replaces it at a seeded spot in the forward region.
   *  The first `warmKills` kills are unscored warm-in. */
  switch: { blockMs: 14000, active: 3, targetRadiusDeg: 1.5, region: { yaw: 35, pitch: 15 }, minSeparationDeg: 8, warmKills: 2,
    maxTargets: 200, placeTries: 50 },
  /** Tracking switching: `active` moving targets; holding the button on one deals damage until healthMs of damage kills it,
   *  then the next seeded target spawns. The first leadInMs is unscored. */
  trackswitch: { blockMs: 14000, leadInMs: 1500, active: 3, targetRadiusDeg: 2, healthMs: 700, region: { yaw: 35, pitch: 15 },
    speedDegPerSec: { min: 10, max: 25 }, segmentMs: { min: 700, max: 2000 }, directionSpreadDeg: 45, minSeparationDeg: 8,
    maxTargets: 200, placeTries: 50 },
  /** Every part of a round has the same length (partMs); between parts a cueMs handover with ticks cueTickMs apart. */
  round: { cueMs: 1800, cueTickMs: 600 },
  submovement: { binMs: 5, smoothBins: 3, onsetDegPerSec: 30, endDegPerSec: 20, endHoldMs: 30, edgeBins: 1 },
  /** Composite score weights for the four round parts (sum to 1). */
  score: { weights: { flick: 0.3, switch: 0.25, tracking: 0.25, trackswitch: 0.2 }, bootstrapSamples: 200, trackingSegmentMs: 1000, minWeDeg: 0.1, weFactor: 4.133,
    /** Stray first clicks (far outside the rest) are left out of the spread: beyond max(sds robust SDs, minDeg) of the median. */
    stray: { sds: 3, minDeg: 3 }, minTot: 0.01, minTp: 0.01 },
  steer: { bracket: 0.15, finalStep: 0.04, limits: { min: 0.6, max: 1.6 },
    weights: { smallGain: 1, bigGain: 1, leadLag: 0.5, corrSpread: 0.5, clickBias: 0.5, speedMatch: 0.5 },
    leadLagScaleDeg: 1, clickBiasScaleDeg: 20, correctionsScale: 0.5, jumpScale: 0.15, deadband: 0.02, minSeparation: 0.01 },
  fit: { driftPriorSd: 0.03, familiarityPriorSd: 0.03, bootstrapSamples: 300, rangeFraction: 0.5, gridPoints: 101, minDistinctX: 4 },
  /** A/B: 'change' needs both rounds and delta > z·SE (target false change ≤ 1%). */
  ab: { minEffect: 0.03, z: 2.5 },
  session: { dialinSteps: { default: 5, thorough: 8, quick: 3 }, warmupMs: 60000, maxRetries: 1, breakEveryRounds: 3,
    invalidTimeoutFraction: 0.3, invalidMinTot: 0.05, invalidMinDmg: 0.05 },
  diagnose: { spreadRatioMax: 1.0, correctionsMax: 1.0, smallGainMax: 1.08, bigGainMin: 0.8,
    refTp: 5, refTot: 0.7, imbalance: 0.15, minSwitchAccuracy: 0.8,
    verticalRatioMax: 1.5, turnReactionMaxMs: 300 }, // provisional, re-tuned from the play-tests (waves bias big flicks short)
  /** Play area: the slowest test sens must let a 180° turn fit within this fraction of the measured pad width. */
  pad: { turnFraction: 0.9 },
  store: { keepRawSessions: 5 },
  /** Play-Along mode (§18): real game matches between short tests. finalsK: The Finals cm/360 = finalsK / (sens × DPI). */
  playAlong: { roundsPerTest: 2, partMs: 20000, leadInMs: 15000, firstStep: 0.2, minStep: 0.04, hourCheckMs: 3_000_000, staleDays: 14,
    maxH2hPerNight: 2, h2hBlocksPerSide: 1, z: 2.5, nightPriorSd: 0.03, finalsK: 914_400, holdMs: 1000, testTimeScale: 0.25, sameNightMs: 10_800_000,
    /** The grade (spec 19.1): per-item costs. Direction (19.2): ideal first-move gains by distance class and signal scales. */
    grade: { correctionCost: 0.1, missCost: 0.2, maxGainCost: 1 },
    direction: { idealGain: { small: 1, medium: 0.97, big: 0.93 }, gainScale: 0.1, leadScaleDeg: 1, threshold: 0.5 },
    sim: { matchMs: 600_000, familiarityShrink: 0.5, nightSd: 0.03, maxNights: 4 } },
  demo: { player: { optimalRatio: 0.75 } },
  /** Quick test mode (about 5 min, for trying the tool out): shorter blocks; too little data for a reliable answer. */
  quick: { distancesDeg: [8,12,17,21, 23,27,31,34, 40,49,58,66], flickBlockMs: 8000, wavePerClass: 1, switchBlockMs: 8000, trackingDurationMs: 7000, trackingLeadInMs: 1000,
    trackswitchBlockMs: 8000, trackswitchLeadInMs: 1000 },
  sim: { sampleHz: 500, blockGapMs: 1000,
    player: { optimalRatio: 0.88, curvature: 2, familiarityBonus: 0.02, adaptationRate: 0.15, gainExponent: 1, motorNoise: 1,
      driftPerBlock: 0.002, familiarityTolLn: 1e-9 },
    reactionMs: { mean: 200, sd: 25, min: 120 }, switchReactionMs: 150, amplitudeNoise: 0.08, directionNoiseDeg: 2,
    durationMs: { base: 120, slope: 70 }, correctionThreshold: 0.7, maxCorrections: 4, correctionPauseMs: 60,
    correctionDurationMs: 110, correctionNoise: 0.15, clickDelayMs: 40,
    trackingDelayMs: 150, trackingErrorGain: 6, trackingNoiseDegPerSec: 3, trackingAdaptMs: 1000 },
  geometry: { maxPitchDeg: 89 },
  setup: { dpi: { min: 100, max: 32000 }, cm360: { min: 5, max: 200 }, padWidthCm: { min: 10, max: 200 },
    fov: { horizontal: { min: 60, max: 130 }, vertical: { min: 40, max: 110 } } },
} as const;

export type Config = typeof defaultConfig;

/** The parts of a round, in order. */
export const PART_KINDS = ['flick', 'switch', 'tracking', 'trackswitch'] as const;
export type PartKind = (typeof PART_KINDS)[number];

/** A part's whole slot (ms), unscored lead-in included. */
export function partMs(kind: PartKind, cfg: Config): number {
  if (kind === 'flick') return cfg.flick.blockMs;
  if (kind === 'switch') return cfg.switch.blockMs;
  if (kind === 'trackswitch') return cfg.trackswitch.blockMs;
  return cfg.tracking.leadInMs + cfg.tracking.durationMs;
}

/** The config a Play-Along test block runs with: the warm-up is the short lead-in, there are no breaks, every part is
 *  playAlong.partMs long, and flicks score from the first wave (the match and the lead-in already warmed the player up). */
export function configForPlayAlong(cfg: Config = defaultConfig): Config {
  const ms = cfg.playAlong.partMs;
  return {
    ...cfg,
    flick: { ...cfg.flick, blockMs: ms, warmWave: false },
    switch: { ...cfg.switch, blockMs: ms },
    tracking: { ...cfg.tracking, durationMs: ms - cfg.tracking.leadInMs },
    trackswitch: { ...cfg.trackswitch, blockMs: ms },
    session: { ...cfg.session, warmupMs: cfg.playAlong.leadInMs, breakEveryRounds: Number.MAX_SAFE_INTEGER },
  } as unknown as Config;
}

/** The config a session in this mode runs with: quick mode swaps in the shorter block sizes. */
export function configForMode(mode: 'default' | 'thorough' | 'quick', cfg: Config = defaultConfig): Config {
  if (mode !== 'quick') return cfg;
  const q = cfg.quick;
  // The literal-typed config can't express a shorter distance list, hence the single cast.
  return {
    ...cfg,
    flick: { ...cfg.flick, distancesDeg: q.distancesDeg, blockMs: q.flickBlockMs, wavePerClass: q.wavePerClass },
    switch: { ...cfg.switch, blockMs: q.switchBlockMs },
    tracking: { ...cfg.tracking, durationMs: q.trackingDurationMs, leadInMs: q.trackingLeadInMs },
    trackswitch: { ...cfg.trackswitch, blockMs: q.trackswitchBlockMs, leadInMs: q.trackswitchLeadInMs },
  } as unknown as Config;
}
