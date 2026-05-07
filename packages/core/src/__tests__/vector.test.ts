import { describe, expect, test } from "bun:test"
import { Effect, Exit, Schema } from "effect"
import { buildRegistry } from "../registry.js"
import type { Signal } from "../signal.js"
import {
  aiAssistedModeEnabled,
  backpressureConfigOf,
  categoryAggregationConfigOf,
  decodePulsarVector,
  diffTimeIntegrationEnabled,
  explainAiAssistedMode,
  isActive,
  readinessConfigOf,
  reviewThresholdOf,
  resolvedConfig,
  timeSeriesConfigOf,
  validateVectorAgainstRegistry,
  weightOf,
} from "../vector.js"

const LeafConfig = Schema.Struct({ threshold: Schema.Number })
type LeafConfig = typeof LeafConfig.Type

const Leaf: Signal<LeafConfig, { count: number }> = {
  id: "MOCK-01",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: LeafConfig,
  defaultConfig: { threshold: 10 },
  inputs: [],
  compute: () => Effect.succeed({ count: 0 }),
  score: () => 1,
  diagnose: () => [],
}

describe("PulsarVector", () => {
  test("decodes a well-formed vector", async () => {
    const raw = {
      id: "v1",
      domain: "typescript",
      description: "Explicitly favors annotations and explicit AI-assisted review pressure.",
      signal_overrides: {
        "MOCK-01": { active: true, weight: 1.4, config: { threshold: 20 } },
      },
      review_routing: {
        score_thresholds: {
          "api-design-reviewer": 0.7,
        },
      },
      observer: {
        diffTimeIntegration: false,
        readiness: {
          p_norm: 8,
          local_poison_threshold: 0.7,
        },
        category_aggregation: {
          p_norm: 6,
          local_warning_threshold: 0.35,
        },
        timeSeries: {
          enabled: true,
          compaction_threshold: 2048,
          raw_retention_days: 45,
        },
      },
      backpressure: {
        trajectory_days: 21,
        thresholds: {
          green_min_score: 0.9,
          yellow_min_score: 0.65,
          red_min_dimension: 0.45,
          degrading_window_drop: 0.12,
        },
        goodhart: {
          holdout_ratio: 0.3,
          rotation_period_days: 5,
          max_visible_holdout_gap: 0.09,
          max_velocity_excess: 0.11,
          min_history_points: 5,
        },
      },
      modes: {
        ai_assisted: true,
      },
      provenance: [
        {
          source: "preset",
          recorded_at: "2026-04-19T00:00:00.000Z",
          summary: "Applied strict-type-safety preset",
          preset_id: "strict-type-safety",
          evidence: [
            {
              kind: "preset",
              summary: "Preset rationale",
              signal_ids: ["MOCK-01"],
            },
          ],
        },
      ],
    }
    const vector = await Effect.runPromise(decodePulsarVector(raw))
    expect(vector.id).toBe("v1")
    expect(vector.description).toContain("Explicitly favors annotations")
    expect(vector.signal_overrides["MOCK-01"]?.weight).toBe(1.4)
    expect(vector.review_routing?.score_thresholds["api-design-reviewer"]).toBe(0.7)
    expect(vector.observer?.diffTimeIntegration).toBe(false)
    expect(vector.observer?.readiness?.p_norm).toBe(8)
    expect(readinessConfigOf(vector).local_poison_threshold).toBe(0.7)
    expect(categoryAggregationConfigOf(vector).p_norm).toBe(6)
    expect(categoryAggregationConfigOf(vector).local_warning_threshold).toBe(0.35)
    expect(vector.observer?.timeSeries?.enabled).toBe(true)
    expect(vector.backpressure?.trajectory_days).toBe(21)
    expect(vector.modes?.ai_assisted).toBe(true)
    expect(vector.provenance?.[0]?.source).toBe("preset")
  })

  test("rejects weight outside 0..2", async () => {
    const raw = {
      id: "bad",
      domain: "typescript",
      signal_overrides: { X: { weight: 2.5 } },
    }
    const exit = await Effect.runPromiseExit(decodePulsarVector(raw))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("validateVectorAgainstRegistry rejects unknown signal id", async () => {
    const registry = await Effect.runPromise(buildRegistry([Leaf]))
    const vector = {
      id: "v1",
      domain: "typescript",
      signal_overrides: { "DOES-NOT-EXIST": {} },
    }
    const exit = await Effect.runPromiseExit(validateVectorAgainstRegistry(vector, registry))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = exit.cause._tag === "Fail" ? exit.cause.error : null
      expect((err as any)?._tag).toBe("UnknownSignalIdError")
    }
  })

  test("resolvedConfig merges overrides into defaultConfig", () => {
    const vector = {
      id: "v1",
      domain: "typescript",
      signal_overrides: { "MOCK-01": { config: { threshold: 50 } } },
    }
    expect(resolvedConfig("MOCK-01", Leaf.defaultConfig, vector)).toEqual({ threshold: 50 })
    expect(resolvedConfig("MOCK-01", Leaf.defaultConfig, undefined)).toEqual({ threshold: 10 })
    expect(resolvedConfig("MOCK-02", Leaf.defaultConfig, vector)).toEqual({ threshold: 10 })
  })

  test("isActive defaults to true when not overridden", () => {
    expect(isActive("MOCK-01", undefined)).toBe(true)
    const vector = {
      id: "v1",
      domain: "typescript",
      signal_overrides: { "MOCK-01": { active: false } },
    }
    expect(isActive("MOCK-01", vector)).toBe(false)
    expect(isActive("OTHER", vector)).toBe(true)
  })

  test("weightOf defaults to 1 and supports stronger-than-default emphasis", () => {
    expect(weightOf("MOCK-01", undefined)).toBe(1)
    const vector = {
      id: "v1",
      domain: "typescript",
      signal_overrides: { "MOCK-01": { weight: 1.3 } },
    }
    expect(weightOf("MOCK-01", vector)).toBe(1.3)
  })

  test("reviewThresholdOf falls back to defaults when unspecified", () => {
    expect(reviewThresholdOf("api-design-reviewer", undefined, 0.6)).toBe(0.6)

    const vector = {
      id: "v1",
      domain: "typescript",
      signal_overrides: {},
      review_routing: {
        score_thresholds: {
          "api-design-reviewer": 0.75,
        },
      },
    }

    expect(reviewThresholdOf("api-design-reviewer", vector, 0.6)).toBe(0.75)
  })

  test("diffTimeIntegrationEnabled defaults to true", () => {
    expect(diffTimeIntegrationEnabled(undefined)).toBe(true)
    expect(
      diffTimeIntegrationEnabled({
        id: "v1",
        domain: "typescript",
        signal_overrides: {},
        observer: { diffTimeIntegration: false },
      }),
    ).toBe(false)
  })

  test("readinessConfigOf returns explicit operational defaults", () => {
    expect(readinessConfigOf(undefined)).toEqual({
      p_norm: 12,
      local_warning_threshold: 0.4,
      local_poison_threshold: 0.75,
      local_warning_gain: 0.75,
      hard_gate_score_cap: 0.2,
      green_max_pressure: 0.15,
      red_min_pressure: 0.4,
      top_pressures: 10,
    })
  })

  test("categoryAggregationConfigOf returns explicit mixer defaults", () => {
    expect(categoryAggregationConfigOf(undefined)).toEqual({
      p_norm: 12,
      local_warning_threshold: 0.4,
      local_poison_threshold: 0.75,
      local_warning_gain: 0.75,
    })
  })

  test("timeSeriesConfigOf merges time-series defaults", () => {
    expect(timeSeriesConfigOf(undefined)).toEqual({
      enabled: false,
      compaction_threshold: 10_000,
      raw_retention_days: 90,
    })
    expect(
      timeSeriesConfigOf({
        id: "v1",
        domain: "typescript",
        signal_overrides: {},
        observer: { diffTimeIntegration: true, timeSeries: { enabled: true, compaction_threshold: 5000, raw_retention_days: 30 } },
      }),
    ).toEqual({
      enabled: true,
      compaction_threshold: 5000,
      raw_retention_days: 30,
    })
  })

  test("backpressureConfigOf returns explicit defaults", () => {
    expect(backpressureConfigOf(undefined).trajectory_days).toBe(14)
    expect(backpressureConfigOf(undefined).goodhart.rotation_period_days).toBe(7)
    expect(
      backpressureConfigOf({
        id: "v1",
        domain: "typescript",
        signal_overrides: {},
        backpressure: {
          trajectory_days: 30,
          empty_series_level: "yellow",
          thresholds: {
            green_min_score: 0.9,
            yellow_min_score: 0.7,
            red_min_dimension: 0.5,
            degrading_window_drop: 0.2,
          },
          goodhart: {
            holdout_ratio: 0.4,
            rotation_period_days: 9,
            max_visible_holdout_gap: 0.1,
            max_velocity_excess: 0.15,
            min_history_points: 6,
          },
        },
      }).thresholds.green_min_score,
    ).toBe(0.9)
  })

  test("aiAssistedModeEnabled defaults to false", () => {
    expect(aiAssistedModeEnabled(undefined)).toBe(false)
    expect(
      aiAssistedModeEnabled({
        id: "v1",
        domain: "typescript",
        signal_overrides: {},
        modes: { ai_assisted: true },
      }),
    ).toBe(true)
  })

  test("explainAiAssistedMode reports why tighter thresholds are active", () => {
    expect(explainAiAssistedMode(undefined).active).toBe(false)

    const explanation = explainAiAssistedMode({
      id: "v1",
      domain: "typescript",
      signal_overrides: {},
      modes: { ai_assisted: true },
      provenance: [
        {
          source: "ai-assisted-detection",
          recorded_at: "2026-04-19T00:00:00.000Z",
          summary: "Accepted AI-assisted detection proposal",
        },
      ],
    })

    expect(explanation.active).toBe(true)
    expect(explanation.source).toBe("proposal")
    expect(explanation.summary).toContain("accepted AI-assisted detection proposal")
    expect(explanation.overrideHint).toContain("vector.modes.ai_assisted")
  })
})
