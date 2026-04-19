import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { buildRegistry } from "../registry.js"
import type { Signal } from "../signal.js"
import { aggregateTeamVector } from "../team-vector.js"

const StructuralSignal: Signal<{}, {}> = {
  id: "TEST-STRUCT",
  tier: 1,
  category: "architectural-drift",
  kind: "structural",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  inputs: [],
  compute: () => Effect.succeed({}),
  score: () => 1,
  diagnose: () => [],
}

const LegibilitySignal: Signal<{}, {}> = {
  id: "TEST-LEG",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  inputs: [],
  compute: () => Effect.succeed({}),
  score: () => 1,
  diagnose: () => [],
}

describe("aggregateTeamVector", () => {
  test("1-member edge case returns the member's vector", async () => {
    const registry = await Effect.runPromise(buildRegistry([StructuralSignal]))
    const result = aggregateTeamVector(
      {
        members: [
          {
            id: "alice",
            vector: {
              id: "alice-vector",
              domain: "typescript",
              signal_overrides: { "TEST-STRUCT": { weight: 1.4 } },
            },
          },
        ],
      },
      registry,
    )

    expect(result.vector.signal_overrides["TEST-STRUCT"]?.weight).toBe(1.4)
    expect(result.varianceBySignal["TEST-STRUCT"]?.variance).toBe(0)
  })

  test("defaults to max for structural and mean for legibility", async () => {
    const registry = await Effect.runPromise(buildRegistry([StructuralSignal, LegibilitySignal]))
    const result = aggregateTeamVector(
      {
        members: [
          {
            id: "alice",
            vector: {
              id: "alice",
              domain: "typescript",
              signal_overrides: {
                "TEST-STRUCT": { weight: 1.2 },
                "TEST-LEG": { weight: 0.8 },
              },
            },
          },
          {
            id: "bob",
            vector: {
              id: "bob",
              domain: "typescript",
              signal_overrides: {
                "TEST-STRUCT": { weight: 1.6 },
                "TEST-LEG": { weight: 1.4 },
              },
            },
          },
          {
            id: "carol",
            vector: {
              id: "carol",
              domain: "typescript",
              signal_overrides: {
                "TEST-STRUCT": { weight: 1.3 },
                "TEST-LEG": { weight: 1.0 },
              },
            },
          },
        ],
      },
      registry,
    )

    expect(result.vector.signal_overrides["TEST-STRUCT"]?.weight).toBe(1.6)
    expect(result.vector.signal_overrides["TEST-LEG"]?.weight).toBeCloseTo((0.8 + 1.4 + 1.0) / 3, 5)
    expect(result.varianceBySignal["TEST-STRUCT"]?.mode).toBe("max")
    expect(result.varianceBySignal["TEST-LEG"]?.mode).toBe("mean")
  })

  test("supports weighted voting for mean aggregation", async () => {
    const registry = await Effect.runPromise(buildRegistry([LegibilitySignal]))
    const result = aggregateTeamVector(
      {
        aggregationRules: { "TEST-LEG": "mean" },
        members: [
          {
            id: "junior",
            weight: 1,
            vector: {
              id: "junior",
              domain: "typescript",
              signal_overrides: { "TEST-LEG": { weight: 0.5 } },
            },
          },
          {
            id: "senior",
            weight: 3,
            vector: {
              id: "senior",
              domain: "typescript",
              signal_overrides: { "TEST-LEG": { weight: 1.5 } },
            },
          },
        ],
      },
      registry,
    )

    expect(result.vector.signal_overrides["TEST-LEG"]?.weight).toBeCloseTo(1.25, 5)
  })

  test("implements min and median aggregation modes", async () => {
    const registry = await Effect.runPromise(buildRegistry([LegibilitySignal, StructuralSignal]))
    const result = aggregateTeamVector(
      {
        aggregationRules: {
          "TEST-LEG": "median",
          "TEST-STRUCT": "min",
        },
        members: [
          {
            id: "a",
            vector: {
              id: "a",
              domain: "typescript",
              signal_overrides: {
                "TEST-LEG": { weight: 0.4 },
                "TEST-STRUCT": { weight: 1.4 },
              },
            },
          },
          {
            id: "b",
            vector: {
              id: "b",
              domain: "typescript",
              signal_overrides: {
                "TEST-LEG": { weight: 1.0 },
                "TEST-STRUCT": { weight: 1.2 },
              },
            },
          },
          {
            id: "c",
            vector: {
              id: "c",
              domain: "typescript",
              signal_overrides: {
                "TEST-LEG": { weight: 1.8 },
                "TEST-STRUCT": { weight: 1.6 },
              },
            },
          },
        ],
      },
      registry,
    )

    expect(result.varianceBySignal["TEST-LEG"]?.aggregatedWeight).toBe(1)
    expect(result.vector.signal_overrides["TEST-STRUCT"]?.weight).toBe(1.2)
  })
})
