import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { buildRegistry } from "../registry.js"
import { observe, ObserverOutput as ObserverOutputSchema, toObserverJson, type ObserverOutput } from "../observer.js"
import {
  CalibrationContextTag,
  activateProjectModule,
  makeResolvedCalibrationContext,
} from "../calibration.js"
import type { Category } from "../category.js"
import type { Diagnostic } from "../diagnostic.js"
import {
  SignalComputeError,
  type SignalError,
} from "../errors.js"
import type { SignalFactorLedger } from "../signal-factor-model.js"
import type { AnySignal, Signal, SignalApplicability } from "../signal.js"

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
    readonly applicability?: SignalApplicability
  }
  readonly factorLedger?: SignalFactorLedger
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
  ...(opts.factorLedger !== undefined
    ? {
        factorLedger: () => opts.factorLedger,
      }
    : {}),
  ...(opts.metadata !== undefined
    ? {
        outputMetadata: () => opts.metadata,
      }
    : {}),
})

describe("Observer — category aggregation", () => {
  test("category score preserves local pressure while retaining weighted mean metadata", async () => {
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

    const category = result.categories["legibility-decay"]

    // Weighted mean remains visible as the evidence average:
    // (1 * 0.9 + 0.5 * 0.6) / (1 + 0.5) = 0.8.
    expect(category.aggregation?.aggregateScore).toBeCloseTo(0.8, 5)
    // Public category health is pressure-shaped so the 0.6 local signal is not averaged away.
    expect(category.score).toBeCloseTo(0.6349940944697947, 5)
    expect(category.aggregation?.shapedByPressure).toBe(true)
    expect(category.signalCount).toBe(2)
    expect(category.signals).toEqual({
      "TEST-A": 0.9,
      "TEST-B": 0.6,
    })
  })

  test("generated-slop score keeps the weakest active signal visible through generic pressure", async () => {
    const a = makeLeaf({ id: "TS-SL-LOW", category: "generated-slop", score: 0.2 })
    const b = makeLeaf({ id: "TS-SL-HIGH", category: "generated-slop", score: 1 })

    const result = await run([a, b])

    // Raw mean would be 0.6. Generic local-poison pressure keeps the
    // smoking-gun slop signal visible instead of averaging it away.
    expect(result.categories["generated-slop"].aggregation?.aggregateScore).toBeCloseTo(0.6, 5)
    expect(result.categories["generated-slop"].score).toBeCloseTo(0.2, 5)
  })

  test("dependency-entropy score keeps the weakest active signal visible through generic pressure", async () => {
    const a = makeLeaf({ id: "TS-DE-LOW", category: "dependency-entropy", score: 0 })
    const b = makeLeaf({ id: "TS-DE-HIGH", category: "dependency-entropy", score: 1 })

    const result = await run([a, b])

    expect(result.categories["dependency-entropy"].aggregation?.aggregateScore).toBeCloseTo(0.5, 5)
    expect(result.categories["dependency-entropy"].score).toBe(0)
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
    expect(result.categories["legibility-decay"].score).toBeCloseTo(0.2, 5)
    expect(result.categories["legibility-decay"].aggregation?.aggregateScore).toBeCloseTo(0.65, 5)
    expect(
      result.categories["legibility-decay"].aggregation?.pressure.maxLocalPressure,
    ).toBeCloseTo(0.8, 5)
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
    expect(category.score).toBeCloseTo(0.543742622619753, 5)
    expect(category.aggregation?.shapedByPressure).toBe(true)
  })

  test("polyglot category pressure keeps per-signal local failures visible", async () => {
    const tsBad = makeLeaf({
      id: "TS-BAD",
      category: "legibility-decay",
      score: 0.1,
    })
    const tsClean = makeLeaf({
      id: "TS-CLEAN",
      category: "legibility-decay",
      score: 1,
    })
    const rsClean = makeLeaf({
      id: "RS-CLEAN",
      category: "legibility-decay",
      score: 1,
    })

    const result = await run([tsBad, tsClean, rsClean])
    const category = result.categories["legibility-decay"]

    expect(category.normalization?.strategy).toBe("language-group-mean")
    expect(category.aggregation?.aggregateScore).toBeCloseTo(0.775, 5)
    expect(category.aggregation?.pressure.maxLocalPressure).toBeCloseTo(0.9, 5)
    expect(category.score).toBeCloseTo(0.1, 5)
  })

  test("category pressure honors low-confidence applicable signals", async () => {
    const exploratory = makeLeaf({
      id: "LLM-LOW",
      tier: 3,
      category: "legibility-decay",
      score: 0.1,
      metadata: { applicability: "applicable", effectiveConfidence: 0.2 },
    })
    const deterministic = makeLeaf({
      id: "TS-HIGH",
      tier: 1,
      category: "legibility-decay",
      score: 1,
    })

    const result = await run([exploratory, deterministic])
    const category = result.categories["legibility-decay"]

    expect(category.signals["LLM-LOW"]).toBe(0.1)
    expect(category.aggregation?.aggregateScore).toBeCloseTo(0.91, 5)
    expect(category.aggregation?.pressure.maxLocalPressure).toBeCloseTo(0.18, 5)
    expect(category.score).toBeGreaterThan(0.8)
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

  test("tier-3 AI-classified facts cannot hard-gate even with block diagnostics", async () => {
    const a = makeLeaf({
      id: "AI-FACT-ARCHITECTURAL-ROLE",
      category: "architectural-drift",
      kind: "structural",
      tier: 3,
      score: 0.1,
      diagnostics: [{ severity: "block", message: "AI label says this boundary is suspect" }],
      metadata: {
        effectiveConfidence: 0.8,
        baseConfidence: 0.9,
        computedAt: "2026-05-16T00:00:00.000Z",
      },
    })

    const result = await run([a])

    expect(result.hard_gate_status).toBe("pass")
    expect(result.hard_gate_violations).toEqual([])
    expect(result.signalMetadata?.["AI-FACT-ARCHITECTURAL-ROLE"]?.effectiveConfidence)
      .toBe(0.8)
  })
})

describe("Observer — readiness pressure", () => {
  test("keeps serious applicable defects visible beside weighted_mean", async () => {
    const poison = makeLeaf({
      id: "TEST-POISON",
      category: "abstraction-bloat",
      score: 0.1,
    })
    const cleanSignals = Array.from({ length: 9 }, (_, index) =>
      makeLeaf({
        id: `TEST-CLEAN-${index}`,
        category: "legibility-decay",
        score: 1,
      }),
    )

    const result = await run([poison, ...cleanSignals])

    expect(result.weighted_mean).toBeCloseTo(0.91, 5)
    expect(result.readiness?.score).toBeCloseTo(0.1, 5)
    expect(result.readiness?.status).toBe("red")
    expect(result.readiness?.top_pressures[0]).toMatchObject({
      signal_id: "TEST-POISON",
      category: "abstraction-bloat",
      raw_pressure: 0.9,
      effective_pressure: 0.9,
      applicability: "applicable",
    })
  })

  test("hard-gate failures cap readiness independently of vector weight", async () => {
    const structural = makeLeaf({
      id: "TEST-STRUCT",
      category: "architectural-drift",
      kind: "structural",
      tier: 1,
      score: 0.9,
      diagnostics: [{ severity: "block", message: "boundary violated" }],
    })

    const result = await run([structural], {
      id: "v1",
      domain: "typescript",
      signal_overrides: { "TEST-STRUCT": { active: true, weight: 0.1 } },
    })

    expect(result.hard_gate_status).toBe("fail")
    expect(result.readiness?.status).toBe("blocked")
    expect(result.readiness?.score).toBeLessThanOrEqual(0.2)
    expect(result.readiness?.aggregation.hard_gate_pressure).toBeCloseTo(0.8, 5)
  })

  test("compute failures are visible as execution failure but not category evidence", async () => {
    const bad = makeLeaf({
      id: "TEST-BAD",
      category: "legibility-decay",
      score: 0.5,
      fail: true,
    })

    const result = await run([bad])

    expect(result.signalResults.get("TEST-BAD")?.score).toBe(0)
    expect(result.categories["legibility-decay"].applicableSignalCount).toBe(0)
    expect(result.categories["legibility-decay"].score).toBe(1)
    expect(result.minimum).toBeUndefined()
    expect(result.readiness?.score).toBe(0)
    expect(result.readiness?.status).toBe("failed")
    expect(result.readiness?.aggregation.failed_signal_pressure).toBe(1)
    expect(result.readiness?.aggregation.failed_signal_count).toBe(1)
    expect(result.readiness?.top_pressures[0]).toMatchObject({
      signal_id: "TEST-BAD",
      raw_pressure: 1,
      effective_pressure: 0,
      applicability: "failed",
    })
  })

  test("compute failures force failed readiness even beside clean evidence", async () => {
    const ok = makeLeaf({ id: "TEST-OK", category: "legibility-decay", score: 1 })
    const bad = makeLeaf({
      id: "TEST-BAD",
      category: "legibility-decay",
      score: 0.5,
      fail: true,
    })

    const result = await run([ok, bad])

    expect(result.readiness?.score).toBe(0)
    expect(result.readiness?.status).toBe("failed")
    expect(result.readiness?.aggregation.applicable_signal_count).toBe(1)
    expect(result.readiness?.aggregation.failed_signal_count).toBe(1)
    expect(result.readiness?.aggregation.failed_signal_pressure).toBe(1)
    expect(result.readiness?.top_pressures[0]).toMatchObject({
      signal_id: "TEST-BAD",
      raw_pressure: 1,
      effective_pressure: 0,
      applicability: "failed",
    })
  })

  test("non-applicable and insufficient-evidence signals are visible but ignored by aggregate pressure", async () => {
    const applicable = makeLeaf({
      id: "TEST-APPLICABLE",
      category: "legibility-decay",
      score: 0.8,
    })
    const notApplicable = makeLeaf({
      id: "TEST-NOT-APPLICABLE",
      category: "legibility-decay",
      score: 0,
      metadata: { applicability: "not_applicable" },
    })
    const insufficient = makeLeaf({
      id: "TEST-INSUFFICIENT",
      category: "generated-slop",
      score: 0,
      metadata: { applicability: "insufficient_evidence" },
    })

    const result = await run([applicable, notApplicable, insufficient])

    expect(result.categories["legibility-decay"].signalCount).toBe(2)
    expect(result.categories["legibility-decay"].applicableSignalCount).toBe(1)
    expect(result.categories["legibility-decay"].score).toBeCloseTo(0.8, 5)
    expect(result.categories["generated-slop"].signalCount).toBe(1)
    expect(result.categories["generated-slop"].applicableSignalCount).toBe(0)
    expect(result.categories["generated-slop"].score).toBe(1)
    expect(result.weighted_mean).toBeCloseTo(0.8, 5)
    expect(result.minimum?.signal).toBe("TEST-APPLICABLE")
    expect(result.readiness?.aggregation.applicable_signal_count).toBe(1)
    expect(result.readiness?.aggregation.ignored_signal_count).toBe(2)
    expect(result.readiness?.aggregation.failed_signal_count).toBe(0)
    expect(result.readiness?.score).toBeCloseTo(0.8, 5)

    const notApplicablePressure = result.readiness?.top_pressures.find(
      (pressure) => pressure.signal_id === "TEST-NOT-APPLICABLE",
    )
    expect(notApplicablePressure).toMatchObject({
      raw_pressure: 1,
      effective_pressure: 0,
      confidence: 0,
      applicability: "not_applicable",
    })

    const insufficientPressure = result.readiness?.top_pressures.find(
      (pressure) => pressure.signal_id === "TEST-INSUFFICIENT",
    )
    expect(insufficientPressure).toMatchObject({
      raw_pressure: 1,
      effective_pressure: 0,
      confidence: 0,
      applicability: "insufficient_evidence",
    })
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

    // The failed signal stays visible in diagnostics and signal results,
    // but it is not evidence about the repo's code quality.
    expect(result.categories["legibility-decay"].score).toBeCloseTo(0.9, 5)
    expect(result.categories["legibility-decay"].applicableSignalCount).toBe(1)
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
      observer_semantics: "applicability-aware-readiness-v1",
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
            shapedByPressure: false,
            pressure: {
              strategy: "pressure-pnorm-local-max",
              p: 12,
              meanPressure: 0.3,
              pnormPressure: 0.3,
              maxLocalPressure: 0.3,
              localPressure: 0,
              finalPressure: 0.3,
            },
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
      readiness: {
        score: 0.7,
        pressure: 0.3,
        status: "yellow",
      },
      hard_gate_status: "pass",
      hard_gate_violations: [],
    })
    expect(decoded.categories["generated-slop"].aggregation?.shapedByPressure).toBe(false)
  })

  test("public JSON preserves signal applicability metadata", async () => {
    const notApplicable = makeLeaf({
      id: "TEST-NOT-APPLICABLE",
      category: "generated-slop",
      score: 0,
      metadata: { applicability: "not_applicable" },
    })
    const insufficient = makeLeaf({
      id: "TEST-INSUFFICIENT",
      category: "legibility-decay",
      score: 0,
      metadata: { applicability: "insufficient_evidence" },
    })

    const result = await run([notApplicable, insufficient])
    const publicJson = toObserverJson(result)
    const decoded = Schema.decodeUnknownSync(ObserverOutputSchema)(publicJson)

    expect(decoded.signal_metadata?.["TEST-NOT-APPLICABLE"]?.applicability).toBe(
      "not_applicable",
    )
    expect(decoded.signal_metadata?.["TEST-INSUFFICIENT"]?.applicability).toBe(
      "insufficient_evidence",
    )
  })

  test("public JSON includes active calibration attribution", async () => {
    const a = makeLeaf({ id: "TEST-A", category: "legibility-decay", score: 0.7 })
    const calibrationContext = makeResolvedCalibrationContext({
      repoFacts: {
        repoRoot: "/repo",
        fingerprint: "repo-facts-v1",
        detectedTechnologies: ["typescript"],
        sourceExtensions: [".ts"],
      },
      activeModules: [
        activateProjectModule({
          id: "repo.local-module",
          version: "1.0.0",
          scope: "repository",
          source: "repo-local",
          sourceRef: ".pulsar/modules/local.mjs",
          sourceFingerprint: "sha256:local",
          contributions: [],
        }),
      ],
    })

    const program = Effect.gen(function* () {
      const registry = yield* buildRegistry([a])
      return yield* observe(registry, undefined)
    }).pipe(Effect.provide(Layer.succeed(CalibrationContextTag, calibrationContext)))

    const result = await Effect.runPromise(
      program as Effect.Effect<ObserverOutput, unknown, never>,
    )
    const publicJson = toObserverJson(result)
    const decoded = Schema.decodeUnknownSync(ObserverOutputSchema)(publicJson)

    expect(decoded.calibration?.fingerprint).toBe(calibrationContext.fingerprint)
    expect(decoded.calibration?.active_modules[0]).toMatchObject({
      id: "repo.local-module",
      version: "1.0.0",
      scope: "repository",
      source: "repo-local",
      source_ref: ".pulsar/modules/local.mjs",
      source_fingerprint: "sha256:local",
    })
  })

  test("public JSON includes signal factor ledger entries", async () => {
    const a = makeLeaf({
      id: "TEST-A",
      category: "generated-slop",
      score: 0.8,
      factorLedger: {
        signalId: "TEST-A",
        entries: [
          {
            path: "stub_kinds.throw-not-implemented.score_cap",
            value: 0.8,
            source: "computed",
            affectsScore: true,
            scoreRole: "score-cap",
            title: "Throw-not-implemented score cap",
          },
        ],
      },
    })

    const result = await run([a])
    const publicJson = toObserverJson(result)
    const decoded = Schema.decodeUnknownSync(ObserverOutputSchema)(publicJson)

    expect(decoded.signal_factors?.["TEST-A"]?.[0]).toMatchObject({
      path: "stub_kinds.throw-not-implemented.score_cap",
      value: 0.8,
      source: "computed",
      affectsScore: true,
      scoreRole: "score-cap",
    })
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
