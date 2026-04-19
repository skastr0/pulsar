import { describe, expect, test } from "bun:test"
import { Effect, Exit, Schema } from "effect"
import type { AnySignal, Signal } from "../signal.js"
import { buildRegistry, MAX_COMPOSITION_DEPTH } from "../registry.js"

/**
 * MOCK-01 — a trivial leaf signal used to prove the Signal interface
 * roundtrips through the registry. It is NOT a real signal.
 */
const MockLeafConfig = Schema.Struct({
  penalty: Schema.Number,
})
type MockLeafConfig = typeof MockLeafConfig.Type

const MockLeaf: Signal<MockLeafConfig, { readonly count: number }> = {
  id: "MOCK-01",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: MockLeafConfig,
  defaultConfig: { penalty: 0.1 },
  inputs: [],
  compute: (_config, _inputs) => Effect.succeed({ count: 3 }),
  score: (out) => Math.max(0, 1 - out.count * 0.1),
  diagnose: () => [],
}

/**
 * MOCK-02 — a compound (Tier 1.5) signal that declares MOCK-01 as input.
 */
const MockCompound: Signal<{}, { readonly total: number }> = {
  id: "MOCK-02",
  tier: 1.5,
  category: "review-pain",
  kind: "compound",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  inputs: [{ id: "MOCK-01" }],
  compute: (_config, inputs) =>
    Effect.sync(() => {
      const leaf = inputs.get("MOCK-01") as { count: number } | undefined
      return { total: (leaf?.count ?? 0) * 2 }
    }),
  score: (out) => Math.max(0, 1 - out.total * 0.05),
  diagnose: () => [],
}

describe("Registry", () => {
  test("builds with a single leaf signal", async () => {
    const registry = await Effect.runPromise(buildRegistry([MockLeaf]))
    expect(registry.byId.size).toBe(1)
    expect(registry.has("MOCK-01")).toBe(true)
    expect(registry.sorted[0]?.id).toBe("MOCK-01")
  })

  test("derives enforcement from tier and kind", async () => {
    const registry = await Effect.runPromise(buildRegistry([MockLeaf]))
    const resolved = registry.byId.get("MOCK-01")
    expect(resolved?.enforcement).toEqual(["soft-warning", "trend"])
  })

  test("topologically sorts compound signals after their inputs", async () => {
    const registry = await Effect.runPromise(buildRegistry([MockCompound, MockLeaf]))
    expect(registry.sorted.map((s) => s.id)).toEqual(["MOCK-01", "MOCK-02"])
  })

  test("coalesces repeated registration of the same signal instance", async () => {
    const registry = await Effect.runPromise(buildRegistry([MockLeaf, MockLeaf]))
    expect(registry.byId.size).toBe(1)
    expect(registry.sorted.map((signal) => signal.id)).toEqual(["MOCK-01"])
  })

  test("rejects duplicate ids", async () => {
    const exit = await Effect.runPromiseExit(
      buildRegistry([MockLeaf, { ...MockLeaf }] as ReadonlyArray<AnySignal>),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = exit.cause._tag === "Fail" ? exit.cause.error : null
      expect((err as any)?._tag).toBe("DuplicateSignalIdError")
    }
  })

  test("rejects missing dependencies", async () => {
    const exit = await Effect.runPromiseExit(buildRegistry([MockCompound]))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = exit.cause._tag === "Fail" ? exit.cause.error : null
      expect((err as any)?._tag).toBe("MissingDependencyError")
    }
  })

  test("allows optional dependencies to be absent", async () => {
    const OptionalCompound: AnySignal = {
      ...MockCompound,
      id: "MOCK-OPTIONAL",
      inputs: [{ id: "DOES-NOT-EXIST", optional: true }],
    }

    const registry = await Effect.runPromise(buildRegistry([OptionalCompound]))
    expect(registry.sorted.map((signal) => signal.id)).toEqual(["MOCK-OPTIONAL"])
  })

  test("rejects cycles", async () => {
    const A: AnySignal = {
      id: "A",
      tier: 1,
      category: "legibility-decay",
      kind: "legibility",
      configSchema: Schema.Struct({}),
      defaultConfig: {},
      inputs: [{ id: "B" }],
      compute: () => Effect.succeed({}),
      score: () => 1,
      diagnose: () => [],
    }
    const B: AnySignal = { ...A, id: "B", inputs: [{ id: "A" }] }
    const exit = await Effect.runPromiseExit(buildRegistry([A, B]))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = exit.cause._tag === "Fail" ? exit.cause.error : null
      expect((err as any)?._tag).toBe("CycleDetectedError")
    }
  })

  test(`rejects composition deeper than ${MAX_COMPOSITION_DEPTH}`, async () => {
    const leaf: AnySignal = { ...MockLeaf, id: "L" }
    const mid: AnySignal = { ...MockCompound, id: "M", inputs: [{ id: "L" }] }
    const top: AnySignal = { ...MockCompound, id: "T", inputs: [{ id: "M" }] }
    const exit = await Effect.runPromiseExit(buildRegistry([leaf, mid, top]))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = exit.cause._tag === "Fail" ? exit.cause.error : null
      expect((err as any)?._tag).toBe("CompositionTooDeepError")
    }
  })
})
