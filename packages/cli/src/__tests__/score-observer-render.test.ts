import { describe, expect, test } from "bun:test"
import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import {
  observerViewCategoryLines,
  readinessSummaryLines,
} from "../score-observer-output.js"

const makeReadinessOutput = (overrides: {
  readonly score: number
  readonly pressure: number
  readonly status: "green" | "yellow" | "red" | "blocked" | "unknown" | "failed"
  readonly band?: "green" | "yellow" | "red"
  readonly applicable?: number
  readonly failed?: number
  readonly dominant?: "pnorm" | "local_poison" | "hard_gate"
  readonly bandMargin?: number
}): ObserverOutput =>
  ({
    readiness: {
      score: overrides.score,
      pressure: overrides.pressure,
      status: overrides.status,
      ...(overrides.band === undefined ? {} : { band: overrides.band }),
      aggregation: {
        strategy: "pressure-pnorm-local-max",
        p: 4,
        mean_pressure: overrides.pressure,
        pnorm_pressure: overrides.pressure,
        max_local_pressure: overrides.pressure,
        hard_gate_pressure: 0,
        hard_gate_score_cap: 0.2,
        local_warning_threshold: 0.4,
        local_poison_threshold: 0.75,
        local_warning_gain: 0.75,
        ...(overrides.dominant === undefined
          ? {}
          : { dominant_pressure_source: overrides.dominant }),
        ...(overrides.bandMargin === undefined
          ? {}
          : { band_margin: overrides.bandMargin }),
        applicable_signal_count: overrides.applicable ?? 5,
        ignored_signal_count: 0,
        failed_signal_count: overrides.failed ?? 0,
      },
      top_pressures: [],
    },
  }) as unknown as ObserverOutput

describe("readinessSummaryLines", () => {
  test("healthy headline names the pressure driver", () => {
    const lines = readinessSummaryLines(
      makeReadinessOutput({
        score: 0.91,
        pressure: 0.09,
        status: "green",
        band: "green",
        dominant: "pnorm",
        bandMargin: 0.06,
      }),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("0.91")
    expect(lines[0]).toContain("green / pressure=0.09 / driver=pnorm")
    // Margin is comfortable — no thin-margin note.
    expect(lines[0]).not.toContain("from yellow")
  })

  test("thin band margins are called out with the adjacent band", () => {
    const lines = readinessSummaryLines(
      makeReadinessOutput({
        score: 0.61,
        pressure: 0.39,
        status: "yellow",
        band: "yellow",
        dominant: "local_poison",
        bandMargin: 0.01,
      }),
    )
    expect(lines[0]).toContain("driver=local-poison")
    expect(lines[0]).toContain("(0.010 from red)")
  })

  test("failed status with measured signals renders degraded, not zero", () => {
    const lines = readinessSummaryLines(
      makeReadinessOutput({
        score: 0.84,
        pressure: 0.16,
        status: "failed",
        band: "yellow",
        applicable: 7,
        failed: 2,
      }),
    )
    expect(lines[0]).toContain("0.84")
    expect(lines[0]).toContain("degraded / band=yellow")
    expect(lines[0]).toContain("2 signals failed; score reflects measured signals")
    expect(lines[0]).not.toContain("green")
  })

  test("all signals failed renders n/a instead of a fabricated score", () => {
    const lines = readinessSummaryLines(
      makeReadinessOutput({
        score: 1,
        pressure: 0,
        status: "failed",
        applicable: 0,
        failed: 3,
      }),
    )
    expect(lines[0]).toContain("n/a")
    expect(lines[0]).toContain("no measured signals (3 signals failed to run)")
    expect(lines[0]).not.toContain("1.00")
  })
})

describe("observerViewCategoryLines", () => {
  test("pressure-shaped categories carry the marker", () => {
    const categories = Object.fromEntries(
      [
        "architectural-drift",
        "dependency-entropy",
        "abstraction-bloat",
        "legibility-decay",
        "generated-slop",
        "review-pain",
        "security-risk",
        "concurrency-safety",
        "behavior-preservation",
        "trust",
      ].map((category) => [
        category,
        {
          score: 0.8,
          signals: {},
          signalCount: 0,
          activeSignalIds: [],
        },
      ]),
    )
    const shaped = {
      ...categories["legibility-decay"],
      score: 0.45,
      aggregation: { shapedByPressure: true },
    }
    const output = {
      categories: { ...categories, "legibility-decay": shaped },
    } as unknown as ObserverOutput

    const lines = observerViewCategoryLines(output)
    const legibility = lines.find((line) => line.includes("0.45"))
    expect(legibility).toContain("◂ pressure")
    const unshaped = lines.filter((line) => line.includes("0.80"))
    for (const line of unshaped) {
      expect(line).not.toContain("◂ pressure")
    }
  })
})
