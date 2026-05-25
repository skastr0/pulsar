import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { categoryRecord, type Category } from "../category.js"
import type { Diagnostic } from "../diagnostic.js"
import type { HardGateViolation, ObserverOutput } from "../observer.js"
import { generateReviewPlan, ReviewPlan as ReviewPlanSchema } from "../review-plan.js"
import type { RoutingOutput } from "../routing.js"
import type { PulsarVector } from "../vector.js"

type MockSignal = {
  readonly id: string
  readonly category: Category
  readonly score: number
  readonly output?: unknown
  readonly diagnostics?: ReadonlyArray<Diagnostic>
}

describe("generateReviewPlan", () => {
  test("covers the hard-gate path", () => {
    const observerOutput = makeObserverOutput({
      categoryScores: {
        "architectural-drift": 0.8,
      },
      signals: [
        {
          id: "TS-AD-01",
          category: "architectural-drift",
          score: 0.2,
          diagnostics: [{ severity: "block", message: "Boundary violated" }],
        },
      ],
      hardGateViolations: [
        {
          signalId: "TS-AD-01",
          category: "architectural-drift",
          diagnostic: { severity: "block", message: "Boundary violated" },
        },
      ],
    })

    const plan = generateReviewPlan(observerOutput, { triggers: [] }, undefined, {
      generatedAt: "2026-04-19T10:00:00.000Z",
      sha: "abc123",
    })

    expect(plan.hardGateBlocking).toBe(true)
    expect(plan.reviewRequests).toHaveLength(1)
    expect(plan.reviewRequests[0]).toMatchObject({
      reviewerRole: "contract-reviewer",
      priority: "block",
      trigger: {
        source: "hard-gate",
        detail: "TS-AD-01: Boundary violated",
      },
    })
  })

  test("covers the score-threshold path with vector-based thresholds", () => {
    const observerOutput = makeObserverOutput({
      categoryScores: {
        "generated-slop": 0.65,
      },
      signals: [
        {
          id: "TS-SL-01",
          category: "generated-slop",
          score: 0.65,
          output: { groups: [] },
          diagnostics: [{ severity: "warn", message: "Generated-looking duplication" }],
        },
      ],
    })

    const baseline = generateReviewPlan(observerOutput, { triggers: [] }, undefined, {
      generatedAt: "2026-04-19T10:00:00.000Z",
      sha: "abc123",
    })
    expect(baseline.reviewRequests).toEqual([])
    expect(baseline.hardGateBlocking).toBe(false)

    const vector: PulsarVector = {
      id: "v1",
      domain: "typescript",
      signal_overrides: {},
      review_routing: {
        score_thresholds: {
          "consolidation-reviewer": 0.7,
        },
      },
    }

    const plan = generateReviewPlan(observerOutput, { triggers: [] }, vector, {
      generatedAt: "2026-04-19T10:00:00.000Z",
      sha: "abc123",
    })

    expect(plan.reviewRequests).toHaveLength(1)
    expect(plan.reviewRequests[0]).toMatchObject({
      reviewerRole: "consolidation-reviewer",
      priority: "required",
      trigger: {
        source: "score-threshold",
      },
    })
    expect(plan.hardGateBlocking).toBe(false)
  })

  test("covers the structural-pattern path", () => {
    const plan = generateReviewPlan(
      makeObserverOutput(),
      {
        triggers: [
          {
            patternId: "auth-paths-touched",
            reviewerRole: "security-reviewer",
            contextPayload: {
              diff: { changedFiles: ["src/auth/service.ts"] },
            },
            sourceLocations: [{ file: "src/auth/service.ts" }],
          },
        ],
      },
      undefined,
      {
        generatedAt: "2026-04-19T10:00:00.000Z",
        sha: "abc123",
      },
    )

    expect(plan.reviewRequests).toHaveLength(1)
    expect(plan.reviewRequests[0]).toMatchObject({
      reviewerRole: "security-reviewer",
      priority: "required",
      trigger: {
        source: "structural-pattern",
        detail: "Matched structural pattern auth-paths-touched",
      },
    })
  })

  test("dedupes requests that route to the same reviewer", () => {
    const observerOutput = makeObserverOutput({
      categoryScores: {
        "abstraction-bloat": 0.4,
      },
      signals: [
        {
          id: "TS-AB-01",
          category: "abstraction-bloat",
          score: 0.4,
          output: { totalPublicExports: 120 },
          diagnostics: [{ severity: "warn", message: "Public surface expanded" }],
        },
      ],
    })

    const routingOutput: RoutingOutput = {
      triggers: [
        {
          patternId: "api-surface-change",
          reviewerRole: "api-design-reviewer",
          contextPayload: { "TS-AB-01": { score: 0.4 } },
          sourceLocations: [{ file: "src/index.ts" }],
        },
      ],
    }

    const plan = generateReviewPlan(observerOutput, routingOutput, undefined, {
      generatedAt: "2026-04-19T10:00:00.000Z",
      sha: "abc123",
    })

    expect(plan.reviewRequests).toHaveLength(1)
    expect(plan.reviewRequests[0]).toMatchObject({
      reviewerRole: "api-design-reviewer",
      priority: "required",
    })
    expect(plan.reviewRequests[0]?.reason).toContain("Abstraction Bloat")
    expect(plan.reviewRequests[0]?.reason).toContain("Api Surface Change")
  })

  test("combines hard-gate, score-threshold, and structural-pattern requests", () => {
    const observerOutput = makeObserverOutput({
      categoryScores: {
        "legibility-decay": 0.45,
      },
      signals: [
        {
          id: "RS-LD-01",
          category: "legibility-decay",
          score: 0.45,
          output: { totalUnsafeBlocks: 2 },
          diagnostics: [
            {
              severity: "block",
              message: "Unsafe usage in safe-only module core::ffi",
              location: { file: "crates/core/src/ffi.rs" },
            },
          ],
        },
      ],
      hardGateViolations: [
        {
          signalId: "RS-LD-01",
          category: "legibility-decay",
          diagnostic: {
            severity: "block",
            message: "Unsafe usage in safe-only module core::ffi",
            location: { file: "crates/core/src/ffi.rs" },
          },
        },
      ],
    })
    const routingOutput: RoutingOutput = {
      triggers: [
        {
          patternId: "unsafe-added",
          reviewerRole: "safety-reviewer",
          contextPayload: { "RS-LD-01": { score: 0.45 } },
          sourceLocations: [{ file: "crates/core/src/ffi.rs", line: 12 }],
        },
      ],
    }

    const plan = generateReviewPlan(observerOutput, routingOutput, undefined, {
      generatedAt: "2026-04-19T10:00:00.000Z",
      sha: "abc123",
    })

    expect(plan.hardGateBlocking).toBe(true)
    expect(plan.reviewRequests.map((request) => request.reviewerRole).sort()).toEqual([
      "safety-reviewer",
      "simplicity-reviewer",
    ])
    expect(plan.reviewRequests.find((request) => request.reviewerRole === "simplicity-reviewer"))
      .toMatchObject({ priority: "block" })
  })

  test("enforces the context size bound and preserves a pointer to the full artifact", () => {
    const observerOutput = makeObserverOutput({
      categoryScores: {
        "abstraction-bloat": 0.4,
      },
      signals: [
        {
          id: "TS-AB-01",
          category: "abstraction-bloat",
          score: 0.4,
          output: { payload: "x".repeat(4000) },
          diagnostics: [{ severity: "warn", message: "Large surface" }],
        },
      ],
    })

    const plan = generateReviewPlan(observerOutput, { triggers: [] }, undefined, {
      generatedAt: "2026-04-19T10:00:00.000Z",
      sha: "abc123",
      contextLimitBytes: 250,
    })

    const truncatedNote = plan.reviewRequests[0]?.context.find(
      (item) => item.kind === "diagnostic" && typeof item.content === "object",
    )

    expect(truncatedNote).toBeDefined()
    expect(Schema.decodeUnknownSync(ReviewPlanSchema)(plan)).toEqual(plan)
  })
})

const makeObserverOutput = (input?: {
  readonly categoryScores?: Partial<Record<Category, number>>
  readonly signals?: ReadonlyArray<MockSignal>
  readonly hardGateViolations?: ReadonlyArray<HardGateViolation>
}): ObserverOutput => {
  const categories: ObserverOutput["categories"] = categoryRecord((category) =>
    emptyCategory(input?.categoryScores?.[category]),
  )
  const signalResults = new Map<string, { signalId: string; score: number; output: unknown; diagnostics: ReadonlyArray<Diagnostic> }>()

  for (const signal of input?.signals ?? []) {
    const category = categories[signal.category]
    categories[signal.category] = {
      score: input?.categoryScores?.[signal.category] ?? signal.score,
      signalCount: category.signalCount + 1,
      activeSignalIds: [...category.activeSignalIds, signal.id],
      signals: {
        ...category.signals,
        [signal.id]: signal.score,
      },
    }
    signalResults.set(signal.id, {
      signalId: signal.id,
      score: signal.score,
      output: signal.output,
      diagnostics: signal.diagnostics ?? [],
    })
  }

  return {
    categories,
    minimum: undefined,
    weighted_mean: 1,
    hard_gate_status:
      (input?.hardGateViolations?.length ?? 0) > 0 ? "fail" : "pass",
    hard_gate_violations: [...(input?.hardGateViolations ?? [])],
    inactiveSignals: [],
    signalResults,
  }
}

const emptyCategory = (score = 1) => ({
  score,
  signals: {},
  signalCount: 0,
  activeSignalIds: [],
})
