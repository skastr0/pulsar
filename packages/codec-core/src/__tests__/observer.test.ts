import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { buildRegistry } from "../registry.js"
import { observe, ObserverOutput as ObserverOutputSchema, toObserverJson, type ObserverOutput } from "../observer.js"
import type { Category } from "../category.js"
import type { Diagnostic } from "../diagnostic.js"
import {
  SignalComputeError,
  type SignalError,
} from "../errors.js"
import type { AnySignal, Signal } from "../signal.js"

/**
 * Tiny leaf-signal factory. Every test builds its own tree of signals
 * so the observer's aggregation math is exercised against known scores.
 */
interface LeafOpts {
  readonly id: string
  readonly tier?: 1 | 1.5 | 2 | 3
  readonly kind?: "structural" | "legibility" | "compound"
  readonly category: Category
  readonly score: number
  readonly diagnostics?: ReadonlyArray<Diagnostic>
  readonly fail?: boolean
  readonly metadata?: {
    readonly effectiveConfidence?: number
    readonly baseConfidence?: number
    readonly computedAt?: string
    readonly stale?: boolean
  }
}

const makeLeaf = (opts: LeafOpts): Signal<{}, { readonly n: number }, never> => ({
  id: opts.id,
  tier: opts.tier ?? 1,
  category: opts.category,
  kind: opts.kind ?? "legibility",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  inputs: [],
  compute: () => {
    if (opts.fail) {
      return Effect.fail(
        new SignalComputeError({
          signalId: opts.id,
          message: "boom",
        }),
      ) as Effect.Effect<{ readonly n: number }, SignalError>
    }
    return Effect.succeed({ n: 1 })
  },
  score: () => opts.score,
  diagnose: () => opts.diagnostics ?? [],
  ...(opts.metadata !== undefined
    ? {
        outputMetadata: () => opts.metadata,
      }
    : {}),
})

describe("Observer — category aggregation", () => {
  test("taste-weighted mean of two signals in one category (AC-2)", async () => {
    const a = makeLeaf({ id: "TEST-A", category: "legibility-decay", score: 0.9 })
    const b = makeLeaf({ id: "TEST-B", category: "legibility-decay", score: 0.6 })

    const result = await run([a, b], {
      id: "v1",
      domain: "typescript",
      signal_overrides: {
        "TEST-A": { active: true, weight: 1 },
        "TEST-B": { active: true, weight: 0.5 },
      },
    })

    // (1 * 0.9 + 0.5 * 0.6) / (1 + 0.5) = 1.2 / 1.5 = 0.8
    expect(result.categories["legibility-decay"].score).toBeCloseTo(0.8, 5)
    expect(result.categories["legibility-decay"].signalCount).toBe(2)
    expect(result.categories["legibility-decay"].signals).toEqual({
      "TEST-A": 0.9,
      "TEST-B": 0.6,
    })
  })

  test("generated-slop score keeps the weakest active signal visible", async () => {
    const a = makeLeaf({ id: "TS-SL-LOW", category: "generated-slop", score: 0.2 })
    const b = makeLeaf({ id: "TS-SL-HIGH", category: "generated-slop", score: 1 })

    const result = await run([a, b])

    // Raw mean would be 0.6. Generated-slop blends the aggregate with
    // the weakest active signal so a smoking-gun slop signal is not
    // averaged away by unrelated clean checks.
    expect(result.categories["generated-slop"].score).toBeCloseTo(0.46, 5)
  })

  test("dependency-entropy score keeps the weakest active signal visible", async () => {
    const a = makeLeaf({ id: "TS-DE-LOW", category: "dependency-entropy", score: 0 })
    const b = makeLeaf({ id: "TS-DE-HIGH", category: "dependency-entropy", score: 1 })

    const result = await run([a, b])

    expect(result.categories["dependency-entropy"].score).toBeCloseTo(0.325, 5)
  })

  test("empty category scores 1 and is excluded from weightedMean (AC-3)", async () => {
    const a = makeLeaf({ id: "TEST-A", category: "legibility-decay", score: 0.8 })
    const b = makeLeaf({ id: "TEST-B", category: "generated-slop", score: 0.6 })

    const result = await run([a, b])
    // architectural-drift, dependency-entropy, abstraction-bloat, review-pain
    // are all empty → score 1, signalCount 0.
    for (const cat of [
      "architectural-drift",
      "dependency-entropy",
      "abstraction-bloat",
      "review-pain",
    ] as const) {
      expect(result.categories[cat].score).toBe(1)
      expect(result.categories[cat].signalCount).toBe(0)
      expect(result.categories[cat].activeSignalIds).toEqual([])
    }
    // generated-slop has only one signal, so its shaped score is still 0.6.
    // weighted_mean should be the count-weighted average of ONLY the two
    // populated categories (each count 1): (0.8 * 1 + 0.6 * 1) / 2 = 0.7.
    expect(result.weighted_mean).toBeCloseTo(0.7, 5)
  })

  test("count-weighted mean across categories (AC-5)", async () => {
    // 2 signals in one category, 1 in another → the denser category has
    // double weight in the overall mean.
    const a = makeLeaf({ id: "TEST-A", category: "legibility-decay", score: 0.5 })
    const b = makeLeaf({ id: "TEST-B", category: "legibility-decay", score: 0.5 })
    const c = makeLeaf({ id: "TEST-C", category: "review-pain", score: 1.0 })

    const result = await run([a, b, c])
    // category scores: legibility-decay = 0.5, review-pain = 1.0
    // weighted_mean = (0.5 * 2 + 1.0 * 1) / 3 = 2 / 3 ≈ 0.6667
    expect(result.weighted_mean).toBeCloseTo(2 / 3, 5)
  })

  test("uses language-group mean when TS and Rust share a category", async () => {
    const tsA = makeLeaf({ id: "TS-LOW", category: "legibility-decay", score: 0.2 })
    const tsB = makeLeaf({ id: "TS-MID", category: "legibility-decay", score: 0.4 })
    const rs = makeLeaf({ id: "RS-HIGH", category: "legibility-decay", score: 1 })

    const result = await run([tsA, tsB, rs])
    expect(result.categories["legibility-decay"].score).toBeCloseTo(0.65, 5)
    expect(result.categories["legibility-decay"].normalization?.strategy).toBe(
      "language-group-mean",
    )
    expect(result.categories["legibility-decay"].normalization?.groups.rust).toEqual({
      score: 1,
      signals: ["RS-HIGH"],
      signalCount: 1,
    })
    expect(
      result.categories["legibility-decay"].normalization?.groups.typescript?.score,
    ).toBeCloseTo(0.3, 5)
  })

  test("default and shared groups do not trigger language normalization alone", async () => {
    const ts = makeLeaf({ id: "TS-SL-LOW", category: "generated-slop", score: 0.5 })
    const defaultSignal = makeLeaf({
      id: "PROJECT-POLICY",
      category: "generated-slop",
      score: 1,
    })
    const shared = makeLeaf({ id: "SHARED-05", category: "generated-slop", score: 1 })

    const result = await run([ts, defaultSignal, shared])

    const category = result.categories["generated-slop"]
    expect(category.normalization).toBeUndefined()
    expect(category.aggregation?.strategy).toBe("weighted-mean")
    expect(category.aggregation?.rawScore).toBeCloseTo(5 / 6, 5)
    expect(category.score).toBeCloseTo((5 / 6) * 0.65 + 0.5 * 0.35, 5)
  })
})

describe("Observer — minimum dimension", () => {
  test("identifies the lowest-score signal across categories (AC-4)", async () => {
    const a = makeLeaf({
      id: "TEST-A",
      category: "legibility-decay",
      score: 0.9,
      diagnostics: [{ severity: "info", message: "A is fine" }],
    })
    const b = makeLeaf({
      id: "TEST-B",
      category: "generated-slop",
      score: 0.2,
      diagnostics: [
        { severity: "warn", message: "B needs work" },
        { severity: "info", message: "second detail" },
      ],
    })

    const result = await run([a, b])
    expect(result.minimum).toBeDefined()
    expect(result.minimum!.signal).toBe("TEST-B")
    expect(result.minimum!.category).toBe("generated-slop")
    expect(result.minimum!.score).toBe(0.2)
    expect(result.minimum!.detail).toBe("B needs work; second detail")
  })

  test("ties resolve by CATEGORIES order", async () => {
    // legibility-decay comes before generated-slop in CATEGORIES.
    const a = makeLeaf({
      id: "Z-LEG",
      category: "legibility-decay",
      score: 0.5,
      diagnostics: [{ severity: "warn", message: "legibility loses tie break" }],
    })
    const b = makeLeaf({
      id: "A-SLOP",
      category: "generated-slop",
      score: 0.5,
      diagnostics: [{ severity: "warn", message: "slop is later in order" }],
    })

    const result = await run([a, b])
    expect(result.minimum!.signal).toBe("Z-LEG")
    expect(result.minimum!.category).toBe("legibility-decay")
  })

  test("ties within a category break by signal id alphabetically", async () => {
    const a = makeLeaf({
      id: "TEST-Z",
      category: "legibility-decay",
      score: 0.5,
      diagnostics: [{ severity: "warn", message: "z" }],
    })
    const b = makeLeaf({
      id: "TEST-A",
      category: "legibility-decay",
      score: 0.5,
      diagnostics: [{ severity: "warn", message: "a" }],
    })

    const result = await run([a, b])
    expect(result.minimum!.signal).toBe("TEST-A")
  })

  test("minimum is undefined for an empty registry", async () => {
    const result = await run([])
    expect(result.minimum).toBeUndefined()
    expect(result.weighted_mean).toBe(1)
    expect(result.hard_gate_status).toBe("pass")
  })

  test("minimum is undefined when every signal is inactive (AC-4)", async () => {
    const a = makeLeaf({ id: "TEST-A", category: "legibility-decay", score: 0.5 })
    const result = await run([a], {
      id: "v1",
      domain: "typescript",
      signal_overrides: { "TEST-A": { active: false } },
    })
    expect(result.minimum).toBeUndefined()
    expect(result.inactiveSignals).toEqual(["TEST-A"])
  })
})

describe("Observer — hard gate routing (AC-6)", () => {
  test("block-severity on a hard-gate-tier signal fails the gate", async () => {
    // Tier 1 + structural kind → enforcement includes "hard-gate".
    const a = makeLeaf({
      id: "TEST-STRUCT",
      category: "architectural-drift",
      kind: "structural",
      tier: 1,
      score: 0.5,
      diagnostics: [
        { severity: "block", message: "boundary violated: src/a → src/b" },
      ],
    })

    const result = await run([a])
    expect(result.hard_gate_status).toBe("fail")
    expect(result.hard_gate_violations.length).toBe(1)
    expect(result.hard_gate_violations[0]!.signalId).toBe("TEST-STRUCT")
    expect(result.hard_gate_violations[0]!.category).toBe("architectural-drift")
    expect(result.hard_gate_violations[0]!.diagnostic.severity).toBe("block")
  })

  test("collects every block diagnostic from a hard-gate signal", async () => {
    const a = makeLeaf({
      id: "TEST-STRUCT",
      category: "architectural-drift",
      kind: "structural",
      tier: 1,
      score: 0.3,
      diagnostics: [
        { severity: "block", message: "cycle one" },
        { severity: "info", message: "extra context" },
        { severity: "block", message: "cycle two" },
      ],
    })

    const result = await run([a])
    expect(result.hard_gate_status).toBe("fail")
    expect(result.hard_gate_violations).toHaveLength(2)
    expect(result.hard_gate_violations.map((violation) => violation.diagnostic.message)).toEqual([
      "cycle one",
      "cycle two",
    ])
  })

  test("weight does not affect hard gate (signal at weight 0.1 still fails)", async () => {
    const a = makeLeaf({
      id: "TEST-STRUCT",
      category: "architectural-drift",
      kind: "structural",
      tier: 1,
      score: 0.5,
      diagnostics: [{ severity: "block", message: "cycle detected" }],
    })
    const result = await run([a], {
      id: "v1",
      domain: "typescript",
      signal_overrides: { "TEST-STRUCT": { active: true, weight: 0.1 } },
    })
    expect(result.hard_gate_status).toBe("fail")
    expect(result.hard_gate_violations.length).toBe(1)
  })

  test("warn on a hard-gate-tier signal does not fail the gate", async () => {
    const a = makeLeaf({
      id: "TEST-STRUCT",
      category: "architectural-drift",
      kind: "structural",
      tier: 1,
      score: 0.8,
      diagnostics: [{ severity: "warn", message: "looks suspicious" }],
    })
    const result = await run([a])
    expect(result.hard_gate_status).toBe("pass")
    expect(result.hard_gate_violations).toEqual([])
  })

  test("block on a signal without hard-gate enforcement does not fail the gate", async () => {
    // Tier 1 + legibility kind → enforcement is soft-warning + trend,
    // no hard-gate. Even if it emits block (which it shouldn't in practice),
    // the observer respects the enforcement ceiling.
    const a = makeLeaf({
      id: "TEST-LEG",
      category: "legibility-decay",
      kind: "legibility",
      tier: 1,
      score: 0.2,
      diagnostics: [{ severity: "block", message: "shouldn't block" }],
    })
    const result = await run([a])
    expect(result.hard_gate_status).toBe("pass")
    expect(result.hard_gate_violations).toEqual([])
  })
})

describe("Observer — inactive signal handling (AC-7)", () => {
  test("inactive signals are excluded from aggregation but listed", async () => {
    const active = makeLeaf({
      id: "TEST-ACTIVE",
      category: "legibility-decay",
      score: 0.8,
    })
    const inactive = makeLeaf({
      id: "TEST-INACTIVE",
      category: "legibility-decay",
      score: 0.1,
    })

    const result = await run([active, inactive], {
      id: "v1",
      domain: "typescript",
      signal_overrides: { "TEST-INACTIVE": { active: false } },
    })

    expect(result.inactiveSignals).toEqual(["TEST-INACTIVE"])
    expect(result.categories["legibility-decay"].signalCount).toBe(1)
    expect(result.categories["legibility-decay"].signals).toEqual({
      "TEST-ACTIVE": 0.8,
    })
    expect(result.categories["legibility-decay"].score).toBeCloseTo(0.8, 5)
    // The inactive low-score signal doesn't claim minimum, since only
    // the active 0.8 score is in play.
    expect(result.minimum!.signal).toBe("TEST-ACTIVE")
  })
})

describe("Observer — compute failure isolation (AC-8)", () => {
  test("a failing signal surfaces as a warn diagnostic with score 0", async () => {
    const ok = makeLeaf({ id: "TEST-OK", category: "legibility-decay", score: 0.9 })
    const bad = makeLeaf({
      id: "TEST-BAD",
      category: "legibility-decay",
      score: 0.5,
      fail: true,
    })

    const result = await run([ok, bad])
    const badResult = result.signalResults.get("TEST-BAD")
    expect(badResult).toBeDefined()
    expect(badResult!.score).toBe(0)
    expect(badResult!.diagnostics.length).toBeGreaterThanOrEqual(1)
    expect(badResult!.diagnostics[0]!.severity).toBe("warn")
    expect(badResult!.diagnostics[0]!.message).toContain("TEST-BAD")
    expect(badResult!.diagnostics[0]!.message).toContain("failed")

    // OK signal still ran.
    expect(result.signalResults.get("TEST-OK")?.score).toBe(0.9)

    // Category score is the weighted mean of (0.9, 0.0) = 0.45 with
    // default weight 1 for both.
    expect(result.categories["legibility-decay"].score).toBeCloseTo(0.45, 5)
  })
})

describe("Observer — signal metadata", () => {
  test("surfaces tier-3 effective confidence in output metadata", async () => {
    const tier3 = makeLeaf({
      id: "LLM-LD-01",
      tier: 3,
      category: "legibility-decay",
      score: 0.7,
      metadata: {
        effectiveConfidence: 0.42,
        baseConfidence: 0.9,
        computedAt: "2026-04-19T00:00:00.000Z",
        stale: true,
      },
    })

    const result = await run([tier3])
    expect(result.signalMetadata?.["LLM-LD-01"]?.effectiveConfidence).toBe(0.42)
    const json = toObserverJson(result)
    expect(json.signal_metadata?.["LLM-LD-01"]?.stale).toBe(true)
  })
})

describe("Observer — JSON output shape (AC-10)", () => {
  test("categories object contains every category even when empty", async () => {
    const a = makeLeaf({ id: "TEST-A", category: "legibility-decay", score: 0.7 })
    const result = await run([a])

    // Matches the shape in ARCHITECTURE.md §Score Output — all six
    // categories are keys, even those with zero active signals.
    expect(Object.keys(result.categories).sort()).toEqual([
      "abstraction-bloat",
      "architectural-drift",
      "dependency-entropy",
      "generated-slop",
      "legibility-decay",
      "review-pain",
    ])
    for (const cat of Object.values(result.categories)) {
      expect(typeof cat.score).toBe("number")
      expect(typeof cat.signals).toBe("object")
      expect(Array.isArray(cat.activeSignalIds)).toBe(true)
    }
    expect(typeof result.weighted_mean).toBe("number")
    expect(["pass", "fail"]).toContain(result.hard_gate_status)
    expect(Array.isArray(result.hard_gate_violations)).toBe(true)
  })

  test("schema encode/decode round-trips the canonical JSON shape", async () => {
    const a = makeLeaf({
      id: "TEST-A",
      category: "legibility-decay",
      score: 0.7,
      diagnostics: [{ severity: "info", message: "stable naming" }],
    })

    const result = await run([a])
    const publicJson = toObserverJson(result)
    const encoded = Schema.encodeSync(ObserverOutputSchema)(publicJson)
    const roundTripJson = JSON.parse(JSON.stringify(encoded))
    const decoded = Schema.decodeUnknownSync(ObserverOutputSchema)(roundTripJson)

    expect(decoded).toEqual(publicJson)
    expect(decoded).toMatchObject({
      categories: {
        "architectural-drift": { score: 1, signals: {} },
        "dependency-entropy": { score: 1, signals: {} },
        "abstraction-bloat": { score: 1, signals: {} },
        "legibility-decay": {
          score: 0.7,
          signals: { "TEST-A": 0.7 },
          aggregation: {
            strategy: "weighted-mean",
            rawScore: 0.7,
            aggregateScore: 0.7,
            lowestSignalScore: 0.7,
            finalScore: 0.7,
            shapedByLowestSignal: false,
            weightTotal: 1,
            weights: { "TEST-A": 1 },
          },
        },
        "generated-slop": { score: 1, signals: {} },
        "review-pain": { score: 1, signals: {} },
      },
      minimum: {
        signal: "TEST-A",
        category: "legibility-decay",
        score: 0.7,
        detail: "stable naming",
      },
      weighted_mean: 0.7,
      hard_gate_status: "pass",
      hard_gate_violations: [],
    })
    expect(decoded.categories["generated-slop"].aggregation?.shapedByLowestSignal).toBe(true)
  })

  test("optional runtime profile records per-signal attribution in public JSON", async () => {
    const a = makeLeaf({ id: "TEST-A", category: "legibility-decay", score: 0.7 })
    const b = makeLeaf({ id: "TEST-B", category: "generated-slop", score: 0.4 })

    const program = Effect.gen(function* () {
      const registry = yield* buildRegistry([a, b])
      return yield* observe(registry, undefined, { profile: true })
    })
    const result = await Effect.runPromise(program as Effect.Effect<ObserverOutput, unknown, never>)
    const publicJson = toObserverJson(result)
    const decoded = Schema.decodeUnknownSync(ObserverOutputSchema)(publicJson)

    expect(result.runtimeProfile?.totalMs).toBeGreaterThanOrEqual(0)
    expect(result.runtimeProfile?.signals["TEST-A"]?.score).toBe(0.7)
    expect(result.runtimeProfile?.signals["TEST-B"]?.diagnostics).toBe(0)
    expect(decoded.runtime_profile?.signals["TEST-A"]?.duration_ms).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// helper to run observe() against a list of signals with no vector or a
// provided vector. The signals here are pure Effect.succeed — no external
// layer required — so we don't need to provide any environment.
// ---------------------------------------------------------------------------

const run = async (
  signals: ReadonlyArray<AnySignal>,
  vector?: {
    id: string
    domain: string
    signal_overrides: Record<
      string,
      { active?: boolean; weight?: number; config?: Record<string, unknown> }
    >
  },
): Promise<ObserverOutput> => {
  const program = Effect.gen(function* () {
    const registry = yield* buildRegistry(signals)
    return yield* observe(registry, vector)
  })
  return Effect.runPromise(program as Effect.Effect<ObserverOutput, unknown, never>)
}
