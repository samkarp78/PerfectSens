export const defaultConfig = {
  flick: {
    distancesDeg: [6,8,10,12,14,15,17,18,20,21, 23,24,26,27,28,29,31,32,33,34, 37,40,43,46,49,52,55,58,62,66],
    // Flick blocks run for blockMs in waves: wavePerClass small + medium + big targets, roughly small→big (order jittered).
    // Wave 0 is unscored warm-in; only complete waves are scored, so every scored wave has the same class mix.
    blockMs: 20000, wavePerClass: 2, waveOrderJitter: 0.15, maxBlockTargets: 240,
    warmupTargets: 300, targetRadiusDeg: 1.5, timeoutMs: 4000,
    smallMaxDeg: 22, bigMinDeg: 35, directionSpreadDeg: 30, bounds: { yaw: 75, pitch: 30 },
  },
  tracking: { durationMs: 15000, leadInMs: 2000, directionSpreadDeg: 30, targetRadiusDeg: 2, segmentMs: { min: 700, max: 2000 },
    speedDegPerSec: { min: 10, max: 25 }, bounds: { yaw: 40, pitch: 10 }, gridHz: 120, minSpeedForLeadLag: 5 },
  /** Target switching: `active` static targets up at once; hitting one replaces it at a seeded spot in the forward region.
   *  The first `warmKills` kills are unscored warm-in. */
  switch: { blockMs: 15000, active: 3, targetRadiusDeg: 1.5, region: { yaw: 35, pitch: 15 }, minSeparationDeg: 8, warmKills: 2,
    maxTargets: 200 },
  submovement: { binMs: 5, smoothBins: 3, onsetDegPerSec: 30, endDegPerSec: 20, endHoldMs: 30, edgeBins: 1 },
  /** Composite score weights for the three round parts (sum to 1). */
  score: { weights: { flick: 0.4, switch: 0.3, tracking: 0.3 }, bootstrapSamples: 200, trackingSegmentMs: 1000, minWeDeg: 0.1, weFactor: 4.133, minTot: 0.01, minTp: 0.01 },
  steer: { bracket: 0.15, finalStep: 0.04, limits: { min: 0.6, max: 1.6 },
    weights: { smallGain: 1, bigGain: 1, leadLag: 0.5, corrSpread: 0.5, clickBias: 0.5 },
    leadLagScaleDeg: 1, clickBiasScaleDeg: 1, correctionsScale: 0.5, jumpScale: 0.15, deadband: 0.02, minSeparation: 0.01 },
  fit: { driftPriorSd: 0.03, familiarityPriorSd: 0.03, bootstrapSamples: 300, rangeFraction: 0.5, gridPoints: 101, minDistinctX: 4 },
  ab: { minEffect: 0.03, z: 2.0 },
  session: { dialinSteps: { default: 5, thorough: 8, quick: 3 }, warmupMs: 60000, maxRetries: 1, breakEveryRounds: 3,
    invalidTimeoutFraction: 0.3, invalidMinTot: 0.05 },
  diagnose: { spreadRatioMax: 1.0, correctionsMax: 1.0, smallGainMax: 1.08, bigGainMin: 0.8,
    refTp: 5, refTot: 0.7, imbalance: 0.15, minSwitchAccuracy: 0.8 }, // provisional, re-tuned from the play-tests (waves bias big flicks short)
  /** Play area: the slowest test sens must let a 180° turn fit within this fraction of the measured pad width. */
  pad: { turnFraction: 0.9 },
  store: { keepRawSessions: 5 },
  demo: { player: { optimalRatio: 0.75 } },
  /** Quick test mode (about 5 min, for trying the tool out): shorter blocks; too little data for a reliable answer. */
  quick: { distancesDeg: [8,12,17,21, 23,27,31,34, 40,49,58,66], flickBlockMs: 10000, wavePerClass: 2, switchBlockMs: 8000, trackingDurationMs: 8000, trackingLeadInMs: 1000 },
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
  } as unknown as Config;
}
