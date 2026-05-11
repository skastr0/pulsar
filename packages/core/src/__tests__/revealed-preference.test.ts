import { describe, expect, test } from "bun:test"
import {
  MINIMUM_REVEALED_PREFERENCE_SAMPLES,
  inferRevealedPreferenceFrequency,
  inferRevealedPreferencePairwise,
  inferRevealedPreferencePriorAdjusted,
  type RevealedPreferenceSample,
} from "../elicitation.js"

describe("revealed preference bootstrap prototypes", () => {
  const samples: ReadonlyArray<RevealedPreferenceSample> = [
    {
      id: "accepted-1",
      outcome: "accepted",
      signal_scores: { "TS-LD-01": 0.9, "TS-RP-02": 0.4, "TS-SL-03": 0.95 },
      confidence: 1,
    },
    {
      id: "accepted-2",
      outcome: "accepted",
      signal_scores: { "TS-LD-01": 0.85, "TS-RP-02": 0.45, "TS-SL-03": 0.9 },
      confidence: 1,
    },
    {
      id: "reverted-1",
      outcome: "reverted",
      signal_scores: { "TS-LD-01": 0.4, "TS-RP-02": 0.9, "TS-SL-03": 0.55 },
      confidence: 1,
    },
    {
      id: "revised-1",
      outcome: "revised",
      signal_scores: { "TS-LD-01": 0.45, "TS-RP-02": 0.8, "TS-SL-03": 0.6 },
      confidence: 0.8,
    },
  ]

  test("pairwise prototype prefers signals that track accepted outcomes", () => {
    const result = inferRevealedPreferencePairwise(samples)
    expect(result.algorithm).toBe("pairwise")
    expect(result.comparedPairs).toBe(4)
    expect(result.weights["TS-LD-01"]).toBeGreaterThan(1)
    expect(result.weights["TS-RP-02"]).toBeLessThan(1)
  })

  test("frequency prototype produces the same directionality", () => {
    const result = inferRevealedPreferenceFrequency(samples)
    expect(result.weights["TS-LD-01"]).toBeGreaterThan(1)
    expect(result.weights["TS-RP-02"]).toBeLessThan(1)
  })

  test("prior-adjusted prototype stays close to the prior when sample count is small", () => {
    const prior = { "TS-LD-01": 1.3, "TS-RP-02": 0.7 }
    const result = inferRevealedPreferencePriorAdjusted(samples, prior)
    expect(result.weights["TS-LD-01"]).toBeLessThanOrEqual(1.4)
    expect(result.weights["TS-LD-01"]).toBeGreaterThan(1.2)
    expect(samples.length).toBeLessThan(MINIMUM_REVEALED_PREFERENCE_SAMPLES)
  })
})
