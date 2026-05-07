import { describe, expect, test } from "bun:test"
import { evaluateBackpressure } from "../backpressure.js"
import type { ReadinessOutput } from "../observer.js"
import type { TimeSeriesEntry } from "../time-series.js"

const meanScore = (scores: Partial<Record<string, number>>): number => {
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
    failed_signal_count: 0,
  },
  top_pressures: [],
})

const makeEntry = (
  timestamp: string,
  scores: Partial<Record<string, number>>,
  readiness?: ReadinessOutput,
): TimeSeriesEntry => ({
  sha: timestamp,
  timestamp,
  source: "raw",
  observerOutput: {
    categories: {
      "architectural-drift": {
        score: scores["architectural-drift"] ?? 1,
        signals: { A: scores["architectural-drift"] ?? 1 },
      },
      "dependency-entropy": { score: scores["dependency-entropy"] ?? 1, signals: {} },
      "abstraction-bloat": { score: scores["abstraction-bloat"] ?? 1, signals: {} },
      "legibility-decay": { score: scores["legibility-decay"] ?? 1, signals: {} },
      "generated-slop": { score: scores["generated-slop"] ?? 1, signals: { H: scores["generated-slop"] ?? 1 } },
      "review-pain": { score: scores["review-pain"] ?? 1, signals: {} },
    },
    minimum: {
      signal: "A",
      category: "architectural-drift",
      score: scores["architectural-drift"] ?? 1,
      detail: "detail",
    },
    weighted_mean: meanScore(scores),
    ...(readiness !== undefined ? { readiness } : {}),
    hard_gate_status: "pass",
    hard_gate_violations: [],
  },
  signalDiagnostics: {
    A: [{ severity: "warn", message: "reuse existing terms" }],
    H: [{ severity: "warn", message: "holdout" }],
  },
  inactiveSignals: [],
})

describe("backpressure thresholds", () => {
  test("returns green when current scores are high and stable", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", { "architectural-drift": 0.92, "generated-slop": 0.91 }),
      makeEntry("2026-04-05T10:00:00.000Z", { "architectural-drift": 0.93, "generated-slop": 0.92 }),
      makeEntry("2026-04-10T10:00:00.000Z", { "architectural-drift": 0.94, "generated-slop": 0.93 }),
    ]
    const output = evaluateBackpressure(entries, undefined)
    expect(output.overall).toBe("green")
    expect(output.byCategory["architectural-drift"].level).toBe("green")
  })

  test("returns yellow when a category falls below the green floor", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", { "architectural-drift": 0.9, "review-pain": 0.9 }),
      makeEntry("2026-04-10T10:00:00.000Z", { "architectural-drift": 0.78, "review-pain": 0.9 }),
    ]
    const output = evaluateBackpressure(entries, undefined)
    expect(output.overall).toBe("yellow")
    expect(output.byCategory["architectural-drift"].level).toBe("yellow")
  })

  test("returns red when a category falls below the red floor", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", { "architectural-drift": 0.7 }),
      makeEntry("2026-04-10T10:00:00.000Z", { "architectural-drift": 0.45 }),
    ]
    const output = evaluateBackpressure(entries, undefined)
    expect(output.overall).toBe("red")
    expect(output.byCategory["architectural-drift"].level).toBe("red")
  })

  test("returns red when readiness reports blocking pressure even if category means are high", () => {
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
    expect(output.rationale.some((line) => line.includes("Readiness pressure is 0.90 (red)"))).toBe(true)
  })

  test("does not downgrade repo health for zero-pressure unknown readiness", () => {
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

    expect(output.overall).toBe("green")
    expect(output.rationale.some((line) => line.includes("Readiness pressure is 0.00 (unknown)"))).toBe(false)
  })

  test("returns red when readiness reports signal execution failure", () => {
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

    expect(output.overall).toBe("red")
    expect(output.rationale.some((line) => line.includes("Readiness pressure is 1.00 (failed)"))).toBe(true)
  })

  test("uses cautious defaults for an empty series", () => {
    const output = evaluateBackpressure([], undefined)
    expect(output.overall).toBe("yellow")
    expect(output.rationale[0]).toContain("No score time series")
  })

  test("flags degrading trajectories even before the score crosses a hard threshold", () => {
    const entries = [
      makeEntry("2026-04-01T10:00:00.000Z", { "architectural-drift": 0.95 }),
      makeEntry("2026-04-05T10:00:00.000Z", { "architectural-drift": 0.88 }),
      makeEntry("2026-04-10T10:00:00.000Z", { "architectural-drift": 0.86 }),
    ]
    const output = evaluateBackpressure(entries, undefined)
    expect(output.byCategory["architectural-drift"].triggers.some((trigger) => trigger.includes("degrading"))).toBe(true)
  })

  test("separates category states", () => {
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
})
