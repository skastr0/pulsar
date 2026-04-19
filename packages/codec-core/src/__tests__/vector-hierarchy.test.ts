import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { buildRegistry } from "../registry.js"
import type { Signal } from "../signal.js"
import { resolveVectorHierarchy } from "../vector-hierarchy.js"

const WeightSignal: Signal<{}, {}> = {
  id: "TEST-WEIGHT",
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

const ThresholdSignal: Signal<{ max_complexity: number }, {}> = {
  id: "TEST-THRESHOLD",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: Schema.Struct({ max_complexity: Schema.Number }),
  defaultConfig: { max_complexity: 20 },
  configDirections: { max_complexity: "higher-is-looser" },
  inputs: [],
  compute: () => Effect.succeed({}),
  score: () => 1,
  diagnose: () => [],
}

describe("resolveVectorHierarchy", () => {
  test("single-level hierarchy returns the personal vector", async () => {
    const registry = await Effect.runPromise(buildRegistry([WeightSignal]))
    const result = resolveVectorHierarchy(
      {
        id: "personal",
        domain: "typescript",
        signal_overrides: { "TEST-WEIGHT": { weight: 1.2 } },
      },
      undefined,
      undefined,
      undefined,
      { registry },
    )

    expect(result.effective.signal_overrides["TEST-WEIGHT"]?.weight).toBe(1.2)
    expect(result.rejectedOverrides).toEqual([])
    expect(result.provenance["TEST-WEIGHT"]).toBe("personal")
  })

  test("accepts tighter child weight overrides", async () => {
    const registry = await Effect.runPromise(buildRegistry([WeightSignal]))
    const result = resolveVectorHierarchy(
      {
        id: "personal",
        domain: "typescript",
        signal_overrides: { "TEST-WEIGHT": { weight: 1 } },
      },
      undefined,
      {
        id: "project",
        domain: "typescript",
        signal_overrides: { "TEST-WEIGHT": { weight: 1.4 } },
      },
      undefined,
      { registry },
    )

    expect(result.effective.signal_overrides["TEST-WEIGHT"]?.weight).toBe(1.4)
    expect(result.rejectedOverrides).toEqual([])
    expect(result.provenance["TEST-WEIGHT"]).toBe("project")
  })

  test("rejects looser child weight overrides", async () => {
    const registry = await Effect.runPromise(buildRegistry([WeightSignal]))
    const result = resolveVectorHierarchy(
      {
        id: "personal",
        domain: "typescript",
        signal_overrides: { "TEST-WEIGHT": { weight: 1.5 } },
      },
      undefined,
      {
        id: "project",
        domain: "typescript",
        signal_overrides: { "TEST-WEIGHT": { weight: 1.1 } },
      },
      undefined,
      { registry },
    )

    expect(result.effective.signal_overrides["TEST-WEIGHT"]?.weight).toBe(1.5)
    expect(result.rejectedOverrides).toHaveLength(1)
    expect(result.rejectedOverrides[0]?.level).toBe("project")
  })

  test("resolves four levels and records rejected task loosening", async () => {
    const registry = await Effect.runPromise(buildRegistry([WeightSignal]))
    const result = resolveVectorHierarchy(
      {
        id: "personal",
        domain: "typescript",
        signal_overrides: { "TEST-WEIGHT": { weight: 1 } },
      },
      {
        id: "team",
        domain: "typescript",
        signal_overrides: { "TEST-WEIGHT": { weight: 1.2, active: false } },
      },
      {
        id: "project",
        domain: "typescript",
        signal_overrides: { "TEST-WEIGHT": { weight: 1.4 } },
      },
      {
        id: "task",
        domain: "typescript",
        signal_overrides: { "TEST-WEIGHT": { weight: 1.3, active: true } },
      },
      { registry },
    )

    expect(result.effective.signal_overrides["TEST-WEIGHT"]?.weight).toBe(1.4)
    expect(result.effective.signal_overrides["TEST-WEIGHT"]?.active).toBe(false)
    expect(result.rejectedOverrides).toHaveLength(2)
    expect(result.provenance["TEST-WEIGHT"]).toBe("project")
  })

  test("honors config direction metadata for threshold comparisons", async () => {
    const registry = await Effect.runPromise(buildRegistry([ThresholdSignal]))
    const result = resolveVectorHierarchy(
      {
        id: "personal",
        domain: "typescript",
        signal_overrides: {},
      },
      undefined,
      {
        id: "project",
        domain: "typescript",
        signal_overrides: {
          "TEST-THRESHOLD": { config: { max_complexity: 15 } },
        },
      },
      {
        id: "task",
        domain: "typescript",
        signal_overrides: {
          "TEST-THRESHOLD": { config: { max_complexity: 25 } },
        },
      },
      { registry },
    )

    expect(result.effective.signal_overrides["TEST-THRESHOLD"]?.config).toEqual({
      max_complexity: 15,
    })
    expect(result.rejectedOverrides).toHaveLength(1)
    expect(result.rejectedOverrides[0]?.reason).toContain("higher-is-looser")
  })
})
