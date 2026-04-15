import { describe, expect, test } from "bun:test"
import { Effect, Exit, Schema } from "effect"
import { buildRegistry } from "../registry.js"
import type { Signal } from "../signal.js"
import {
  decodeTasteVector,
  isActive,
  resolvedConfig,
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

describe("TasteVector", () => {
  test("decodes a well-formed vector", async () => {
    const raw = {
      id: "v1",
      domain: "typescript",
      signal_overrides: {
        "MOCK-01": { active: true, weight: 0.9, config: { threshold: 20 } },
      },
    }
    const vector = await Effect.runPromise(decodeTasteVector(raw))
    expect(vector.id).toBe("v1")
    expect(vector.signal_overrides["MOCK-01"]?.weight).toBe(0.9)
  })

  test("rejects weight outside 0..1", async () => {
    const raw = {
      id: "bad",
      domain: "typescript",
      signal_overrides: { "X": { weight: 1.5 } },
    }
    const exit = await Effect.runPromiseExit(decodeTasteVector(raw))
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

  test("weightOf defaults to 1", () => {
    expect(weightOf("MOCK-01", undefined)).toBe(1)
    const vector = {
      id: "v1",
      domain: "typescript",
      signal_overrides: { "MOCK-01": { weight: 0.3 } },
    }
    expect(weightOf("MOCK-01", vector)).toBe(0.3)
  })
})
