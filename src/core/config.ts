export const defaultConfig = {
  flick: {
    distancesDeg: [6,8,10,12,14,15,17,18,20,21, 23,24,26,27,28,29,31,32,33,34, 37,40,43,46,49,52,55,58,62,66],
    adaptationTargets: 6, warmupTargets: 300, targetRadiusDeg: 1.5, timeoutMs: 4000,
    smallMaxDeg: 22, bigMinDeg: 35, directionSpreadDeg: 30, bounds: { yaw: 75, pitch: 30 },
  },
  tracking: { durationMs: 25000, leadInMs: 3000, directionSpreadDeg: 30, targetRadiusDeg: 1.5, segmentMs: { min: 300, max: 1200 },
    speedDegPerSec: { min: 25, max: 60 }, bounds: { yaw: 40, pitch: 10 }, gridHz: 120, minSpeedForLeadLag: 5 },
  submovement: { binMs: 5, smoothBins: 3, onsetDegPerSec: 30, endDegPerSec: 20, endHoldMs: 30, edgeBins: 1 },
  score: { flickWeight: 0.6, bootstrapSamples: 200, trackingSegmentMs: 1000, minWeDeg: 0.1, weFactor: 4.133, minTot: 0.01 },
  steer: { bracket: 0.15, finalStep: 0.04, limits: { min: 0.6, max: 1.6 },
    weights: { smallGain: 1, bigGain: 1, leadLag: 0.5, corrSpread: 0.5 },
    leadLagScaleDeg: 1, correctionsScale: 0.5, jumpScale: 0.15, deadband: 0.02, minSeparation: 0.01 },
  fit: { driftPriorSd: 0.03, familiarityPriorSd: 0.03, bootstrapSamples: 300, rangeFraction: 0.5, gridPoints: 101, minDistinctX: 4 },
  ab: { minEffect: 0.03, z: 2.0 },
  session: { dialinSteps: { default: 6, thorough: 10 }, warmupMs: 180000, maxRetries: 1,
    invalidTimeoutFraction: 0.3, invalidMinTot: 0.05 },
  diagnose: { spreadRatioMax: 1.0, correctionsMax: 1.0, smallGainMax: 1.08, bigGainMin: 0.92,
    refTp: 4.5, refTot: 0.5, imbalance: 0.15 },
  store: { keepRawSessions: 5 },
  sim: { sampleHz: 500 },
  geometry: { maxPitchDeg: 89 },
  setup: { dpi: { min: 100, max: 32000 }, cm360: { min: 5, max: 200 },
    fov: { horizontal: { min: 60, max: 130 }, vertical: { min: 40, max: 110 } } },
} as const;

export type Config = typeof defaultConfig;
