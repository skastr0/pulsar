import { Schema } from "effect"
import { clampWeight } from "./proposal-utils.js"

export const RevealedPreferenceOutcome = Schema.Literal("accepted", "revised", "reverted")
export type RevealedPreferenceOutcome = typeof RevealedPreferenceOutcome.Type

export const RevealedPreferenceSample = Schema.Struct({
  id: Schema.String,
  outcome: RevealedPreferenceOutcome,
  signal_scores: Schema.Record({ key: Schema.String, value: Schema.Number }),
  confidence: Schema.optionalWith(Schema.Number.pipe(Schema.between(0, 1)), {
    default: () => 1,
  }),
})
export type RevealedPreferenceSample = typeof RevealedPreferenceSample.Type

export interface RevealedPreferenceResult {
  readonly algorithm: "pairwise" | "frequency" | "prior-adjusted"
  readonly sampleCount: number
  readonly comparedPairs: number
  readonly weights: Readonly<Record<string, number>>
  readonly support: Readonly<Record<string, number>>
}

export const MINIMUM_REVEALED_PREFERENCE_SAMPLES = 24 as const

export const inferRevealedPreferencePairwise = (
  samples: ReadonlyArray<RevealedPreferenceSample>,
  prior: Readonly<Record<string, number>> = {},
): RevealedPreferenceResult => {
  const accepted = samples.filter((sample) => sample.outcome === "accepted")
  const rejected = samples.filter((sample) => sample.outcome !== "accepted")
  const signalIds = collectSignalIds(samples)
  const evidence = new Map<string, { signed: number; magnitude: number }>()

  for (const kept of accepted) {
    for (const discarded of rejected) {
      const pairConfidence = kept.confidence * discarded.confidence
      for (const signalId of signalIds) {
        const keptScore = kept.signal_scores[signalId] ?? 0
        const discardedScore = discarded.signal_scores[signalId] ?? 0
        const diff = keptScore - discardedScore
        if (Math.abs(diff) < 0.05) continue

        const entry = evidence.get(signalId) ?? { signed: 0, magnitude: 0 }
        entry.signed += diff * pairConfidence
        entry.magnitude += Math.abs(diff) * pairConfidence
        evidence.set(signalId, entry)
      }
    }
  }

  return {
    algorithm: "pairwise",
    sampleCount: samples.length,
    comparedPairs: accepted.length * rejected.length,
    weights: materializeWeights(signalIds, evidence, prior, 0.6),
    support: materializeSupport(signalIds, evidence),
  }
}

export const inferRevealedPreferenceFrequency = (
  samples: ReadonlyArray<RevealedPreferenceSample>,
  prior: Readonly<Record<string, number>> = {},
): RevealedPreferenceResult => {
  const accepted = samples.filter((sample) => sample.outcome === "accepted")
  const rejected = samples.filter((sample) => sample.outcome !== "accepted")
  const signalIds = collectSignalIds(samples)
  const evidence = new Map<string, { signed: number; magnitude: number }>()

  for (const signalId of signalIds) {
    const acceptedMean = average(
      accepted.map((sample) => (sample.signal_scores[signalId] ?? 0) * sample.confidence),
    )
    const rejectedMean = average(
      rejected.map((sample) => (sample.signal_scores[signalId] ?? 0) * sample.confidence),
    )
    const diff = acceptedMean - rejectedMean
    evidence.set(signalId, {
      signed: diff,
      magnitude: Math.abs(diff),
    })
  }

  return {
    algorithm: "frequency",
    sampleCount: samples.length,
    comparedPairs: accepted.length * rejected.length,
    weights: materializeWeights(signalIds, evidence, prior, 0.45),
    support: materializeSupport(signalIds, evidence),
  }
}

export const inferRevealedPreferencePriorAdjusted = (
  samples: ReadonlyArray<RevealedPreferenceSample>,
  prior: Readonly<Record<string, number>> = {},
): RevealedPreferenceResult => {
  const pairwise = inferRevealedPreferencePairwise(samples, prior)
  const blend = Math.min(1, samples.length / MINIMUM_REVEALED_PREFERENCE_SAMPLES)
  const weights = Object.fromEntries(
    Object.keys(pairwise.weights).map((signalId) => {
      const priorWeight = prior[signalId] ?? 1
      const observed = pairwise.weights[signalId] ?? 1
      return [signalId, clampWeight(priorWeight + (observed - priorWeight) * blend)]
    }),
  )

  return {
    algorithm: "prior-adjusted",
    sampleCount: samples.length,
    comparedPairs: pairwise.comparedPairs,
    weights,
    support: pairwise.support,
  }
}

const collectSignalIds = (samples: ReadonlyArray<RevealedPreferenceSample>): Array<string> =>
  [...new Set(samples.flatMap((sample) => Object.keys(sample.signal_scores)))].sort((left, right) =>
    left.localeCompare(right),
  )

const materializeWeights = (
  signalIds: ReadonlyArray<string>,
  evidence: ReadonlyMap<string, { signed: number; magnitude: number }>,
  prior: Readonly<Record<string, number>>,
  multiplier: number,
): Readonly<Record<string, number>> =>
  Object.fromEntries(
    signalIds.map((signalId) => {
      const entry = evidence.get(signalId)
      const priorWeight = prior[signalId] ?? 1
      if (entry === undefined || entry.magnitude === 0) {
        return [signalId, clampWeight(priorWeight)]
      }

      const normalized = entry.signed / entry.magnitude
      return [signalId, clampWeight(priorWeight + normalized * multiplier)]
    }),
  )

const materializeSupport = (
  signalIds: ReadonlyArray<string>,
  evidence: ReadonlyMap<string, { signed: number; magnitude: number }>,
): Readonly<Record<string, number>> =>
  Object.fromEntries(
    signalIds.map((signalId) => {
      const entry = evidence.get(signalId)
      if (entry === undefined || entry.magnitude === 0) return [signalId, 0]
      return [signalId, Number((entry.signed / entry.magnitude).toFixed(3))]
    }),
  )

const average = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
