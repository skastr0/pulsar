import { describe, expect, test } from "bun:test"
import {
  BACKPRESSURE_OUTPUT_SEMANTICS,
  evaluateBackpressure,
  evaluateBackpressureTrend,
} from "../backpressure.js"
import { CATEGORIES, categoryRecord, type Category } from "../category.js"
import type { ReadinessOutput } from "../observer.js"
import type { TimeSeriesEntry } from "../time-series.js"
import { backpressureConfigOf, type PulsarVector } from "../vector.js"

type ScoreMap = Partial<Record<Category, number>>

const SIGNAL_ID_BY_CATEGORY: Record<Category, string> = {
  "architectural-drift": "A",
  "dependency-entropy": "D",
  "abstraction-bloat": "B",
  "legibility-decay": "L",
  "generated-slop": "H",
  "review-pain": "R",
  "security-risk": "S",
  "concurrency-safety": "C",
  "behavior-preservation": "P",
}

const meanScore = (scores: ScoreMap): number => {
  const values = Object.values(scores).filter(
    (value): value is number => value !== undefined,
  )
  if (values.length === 0) return 1
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const makeReadiness = (
  status: ReadinessOutput["status"],
  pressure: number,
): ReadinessOutput => ({
  score: 1 - pressure,
  pressure,
  status,
  ...(status === "green" || status === "yellow" || status === "red"
    ? { band: status }
    : {}),
  aggregation: {
    strategy: "pressure-pnorm-local-max",
    p: 12,
    mean_pressure: pressure,
    pnorm_pressure: pressure,
    max_local_pressure: pressure,
    failed_signal_pressure: status === "failed" ? 1 : 0,
    hard_gate_pressure: status === "blocked" ? 0.8 : 0,
    hard_gate_score_cap: 0.2,
    local_warning_threshold: 0.4,
    local_poison_threshold: 0.75,
    local_warning_gain: 0.75,
    applicable_signal_count: 1,
    ignored_signal_count: 0,
    failed_signal_count: status === "failed" ? 1 : 0,
  },
  top_pressures: [],
})

const makeEntry = (
  timestamp: string,
  scores: ScoreMap,
  readiness?: ReadinessOutput,
  hardGateStatus: "pass" | "fail" = "pass",
): TimeSeriesEntry => {
  const scoredCategories = CATEGORIES.filter(
    (category) => scores[category] !== undefined,
  )
  const minimumCategory = scoredCategories.reduce<Category | undefined>(
    (minimum, category) =>
      minimum === undefined || scores[category]! < scores[minimum]!
        ? category
        : minimum,
    undefined,
  )

  return {
    sha: timestamp,
    timestamp,
    source: "raw",
    observerOutput: {
      categories: categoryRecord((category) => {
        const score = scores[category]
        const signalId = SIGNAL_ID_BY_CATEGORY[category]
        const hasEvidence = score !== undefined
        return {
          score: score ?? 1,
          signals: hasEvidence ? { [signalId]: score } : {},
          signalCount: hasEvidence ? 1 : 0,
          ...(readiness !== undefined
            ? { applicableSignalCount: hasEvidence ? 1 : 0 }
            : {}),
          activeSignalIds: hasEvidence ? [signalId] : [],
        }
      }),
      minimum:
        minimumCategory === undefined
          ? undefined
          : {
              signal: SIGNAL_ID_BY_CATEGORY[minimumCategory],
              category: minimumCategory,
              score: scores[minimumCategory]!,
              detail: "detail",
            },
      weighted_mean: meanScore(scores),
      ...(readiness !== undefined ? { readiness } : {}),
      hard_gate_status: hardGateStatus,
      hard_gate_violations: [],
    },
    signalDiagnostics: {
      A: [{ severity: "warn", message: "reuse existing terms" }],
      H: [{ severity: "warn", message: "holdout" }],
    },
    inactiveSignals: [],
  }
}

describe("backpressure evidence qualification", () => {
  test("keeps evidenced legacy history green when current scores are high and stable", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", {
        "architectural-drift": 0.92,
        "generated-slop": 0.91,
      }),
      makeEntry("2026-04-05T10:00:00.000Z", {
        "architectural-drift": 0.93,
        "generated-slop": 0.92,
      }),
      makeEntry("2026-04-10T10:00:00.000Z", {
        "architectural-drift": 0.94,
        "generated-slop": 0.93,
      }),
    ]

    const output = evaluateBackpressure(entries, undefined)

    expect(output.backpressureSemantics).toBe(BACKPRESSURE_OUTPUT_SEMANTICS)
    expect(output.evidenceState).toBe("available")
    expect(output.evidenceObservationCount).toBe(3)
    expect(output.overall).toBe("green")
    expect(output.byCategory["architectural-drift"].level).toBe("green")
    expect(output.byCategory["review-pain"]).toMatchObject({
      level: "unavailable",
      evidenceState: "insufficient-evidence",
      evidenceReason: "no-category-evidence",
      observationCount: 0,
    })
  })

  test("returns yellow when an evidenced category falls below the green floor", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", {
        "architectural-drift": 0.9,
        "review-pain": 0.9,
      }),
      makeEntry("2026-04-10T10:00:00.000Z", {
        "architectural-drift": 0.78,
        "review-pain": 0.9,
      }),
    ]

    const output = evaluateBackpressure(entries, undefined)

    expect(output.overall).toBe("yellow")
    expect(output.byCategory["architectural-drift"].level).toBe("yellow")
  })

  test("returns red when an evidenced category falls below the red floor", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", { "architectural-drift": 0.7 }),
      makeEntry("2026-04-10T10:00:00.000Z", { "architectural-drift": 0.45 }),
    ]

    const output = evaluateBackpressure(entries, undefined)

    expect(output.overall).toBe("red")
    expect(output.byCategory["architectural-drift"].level).toBe("red")
  })

  test("uses readiness quality pressure when the observation is operationally usable", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", {
        "architectural-drift": 0.95,
        "generated-slop": 0.94,
      }),
      makeEntry(
        "2026-04-10T10:00:00.000Z",
        {
          "architectural-drift": 0.96,
          "generated-slop": 0.95,
        },
        makeReadiness("red", 0.9),
      ),
    ]

    const output = evaluateBackpressure(entries, undefined)

    expect(output.overall).toBe("red")
    expect(
      output.rationale.some((line) =>
        line.includes("Readiness pressure is 0.90 (red)"),
      ),
    ).toBe(true)
  })

  test("does not inherit prior green when the latest readiness is unknown", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", {
        "architectural-drift": 0.95,
        "generated-slop": 0.94,
      }),
      makeEntry(
        "2026-04-10T10:00:00.000Z",
        {
          "architectural-drift": 0.96,
          "generated-slop": 0.95,
        },
        makeReadiness("unknown", 0),
      ),
    ]

    const output = evaluateBackpressure(entries, undefined)

    expect(output).toMatchObject({
      overall: "unavailable",
      evidenceState: "insufficient-evidence",
      evidenceReason: "latest-readiness-unknown",
      observationCount: 2,
      evidenceObservationCount: 1,
    })
    expect(output.byCategory["architectural-drift"].level).toBe("unavailable")
    expect("currentScore" in output.byCategory["architectural-drift"]).toBe(false)
    expect("trajectorySlope" in output.byCategory["architectural-drift"]).toBe(
      false,
    )
    expect("goodhart" in output).toBe(false)
  })

  test("reports failed readiness as operational failure, not red quality", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", {
        "architectural-drift": 0.95,
        "generated-slop": 0.94,
      }),
      makeEntry(
        "2026-04-10T10:00:00.000Z",
        {
          "architectural-drift": 0.96,
          "generated-slop": 0.95,
        },
        makeReadiness("failed", 1),
      ),
    ]

    const output = evaluateBackpressure(entries, undefined)

    expect(output).toMatchObject({
      overall: "unavailable",
      evidenceState: "failed",
      evidenceReason: "latest-readiness-failed",
      observationCount: 2,
      evidenceObservationCount: 1,
    })
    expect(output.byCategory["architectural-drift"]).toMatchObject({
      level: "unavailable",
      evidenceState: "failed",
      observationCount: 1,
    })
    expect("currentScore" in output.byCategory["architectural-drift"]).toBe(false)
    expect("trajectorySlope" in output.byCategory["architectural-drift"]).toBe(
      false,
    )
  })

  test("returns unavailable for an empty series regardless of legacy empty default", () => {
    const vector: PulsarVector = {
      id: "empty-default-compatibility",
      domain: "typescript",
      signal_overrides: {},
      backpressure: {
        ...backpressureConfigOf(undefined),
        empty_series_level: "red",
      },
    }

    const output = evaluateBackpressure([], vector)

    expect(output).toMatchObject({
      overall: "unavailable",
      evidenceState: "insufficient-evidence",
      evidenceReason: "no-history",
      observationCount: 0,
      evidenceObservationCount: 0,
    })
    expect(output.rationale[0]).toContain("No score time series")
    expect("goodhart" in output).toBe(false)
    for (const category of CATEGORIES) {
      const categoryOutput = output.byCategory[category]
      expect(categoryOutput.level).toBe("unavailable")
      expect("currentScore" in categoryOutput).toBe(false)
      expect("trajectorySlope" in categoryOutput).toBe(false)
    }
  })

  test("exposes a first measured score without inventing a level or slope", () => {
    const output = evaluateBackpressure(
      [
        makeEntry("2026-04-01T10:00:00.000Z", {
          "architectural-drift": 0.82,
        }),
      ],
      undefined,
    )

    expect(output).toMatchObject({
      overall: "unavailable",
      evidenceState: "insufficient-evidence",
      evidenceReason: "first-observation",
      observationCount: 1,
      evidenceObservationCount: 1,
    })
    expect(output.byCategory["architectural-drift"]).toMatchObject({
      level: "unavailable",
      evidenceState: "insufficient-evidence",
      evidenceReason: "insufficient-category-history",
      currentScore: 0.82,
      observationCount: 1,
    })
    expect(
      "trajectorySlope" in output.byCategory["architectural-drift"],
    ).toBe(false)
  })

  test("excludes failed eras from the minimum two-observation trajectory", () => {
    const entries = [
      makeEntry(
        "2026-04-01T10:00:00.000Z",
        { "architectural-drift": 0.99 },
        makeReadiness("failed", 1),
      ),
      makeEntry("2026-04-10T10:00:00.000Z", { "architectural-drift": 0.8 }),
    ]

    const output = evaluateBackpressure(entries, undefined)

    expect(output).toMatchObject({
      overall: "unavailable",
      evidenceState: "insufficient-evidence",
      evidenceReason: "insufficient-history",
      observationCount: 2,
      evidenceObservationCount: 1,
    })
    expect(output.byCategory["architectural-drift"]).toMatchObject({
      currentScore: 0.8,
      observationCount: 1,
    })
  })

  test("does not invent a trajectory from duplicate timestamps", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", { "architectural-drift": 0.9 }),
      makeEntry("2026-04-01T10:00:00.000Z", { "architectural-drift": 0.91 }),
    ]

    const output = evaluateBackpressure(entries, undefined)

    expect(output).toMatchObject({
      overall: "unavailable",
      evidenceState: "insufficient-evidence",
      evidenceReason: "insufficient-category-history",
    })
    expect(output.byCategory["architectural-drift"]).toMatchObject({
      level: "unavailable",
      currentScore: 0.91,
      observationCount: 2,
    })
    expect(
      "trajectorySlope" in output.byCategory["architectural-drift"],
    ).toBe(false)
  })

  test("flags degrading trajectories before the score crosses a hard threshold", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", { "architectural-drift": 0.95 }),
      makeEntry("2026-04-05T10:00:00.000Z", { "architectural-drift": 0.88 }),
      makeEntry("2026-04-10T10:00:00.000Z", { "architectural-drift": 0.86 }),
    ]

    const output = evaluateBackpressure(entries, undefined)

    expect(
      output.byCategory["architectural-drift"].triggers.some((trigger) =>
        trigger.includes("degrading"),
      ),
    ).toBe(true)
  })

  test("separates evidenced category levels", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", {
        "architectural-drift": 0.93,
        "review-pain": 0.62,
      }),
      makeEntry("2026-04-10T10:00:00.000Z", {
        "architectural-drift": 0.94,
        "review-pain": 0.61,
      }),
    ]

    const output = evaluateBackpressure(entries, undefined)

    expect(output.byCategory["architectural-drift"].level).toBe("green")
    expect(output.byCategory["review-pain"].level).toBe("yellow")
  })

  test("trend entries omit weighted metrics until a quality verdict is earned", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", { "architectural-drift": 0.9 }),
      makeEntry("2026-04-10T10:00:00.000Z", { "architectural-drift": 0.92 }),
      makeEntry(
        "2026-04-12T10:00:00.000Z",
        { "architectural-drift": 0.93 },
        makeReadiness("failed", 1),
      ),
    ]

    const trend = evaluateBackpressureTrend(entries, undefined)

    expect(trend[0]).toMatchObject({
      overall: "unavailable",
      evidenceReason: "first-observation",
    })
    expect("weightedMean" in trend[0]!).toBe(false)
    expect(trend[1]).toMatchObject({
      overall: "green",
      evidenceState: "available",
      weightedMean: 0.92,
    })
    expect(trend[2]).toMatchObject({
      overall: "unavailable",
      evidenceState: "failed",
      evidenceReason: "latest-readiness-failed",
    })
    expect("weightedMean" in trend[2]!).toBe(false)
  })
})
