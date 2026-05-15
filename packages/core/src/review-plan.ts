import { createHash } from "node:crypto"
import { Schema } from "effect"
import { CATEGORIES, type Category } from "./category.js"
import { dedupeByKey } from "./dedupe-by-key.js"
import type { ObserverOutput } from "./observer.js"
import type { RoutingOutput } from "./routing.js"
import { reviewThresholdOf, type PulsarVector } from "./vector.js"

const ReviewPriority = Schema.Literal("block", "required", "informational")
type ReviewPriority = typeof ReviewPriority.Type

const ReviewTrigger = Schema.Struct({
  source: Schema.Literal("hard-gate", "score-threshold", "structural-pattern"),
  detail: Schema.String,
})
type ReviewTrigger = typeof ReviewTrigger.Type

const ContextItem = Schema.Struct({
  kind: Schema.Literal("signal-output", "file-excerpt", "diagnostic", "diff-hunk"),
  content: Schema.Unknown,
})
type ContextItem = typeof ContextItem.Type

const ReviewRequest = Schema.Struct({
  reviewerRole: Schema.String,
  reason: Schema.String,
  priority: ReviewPriority,
  trigger: ReviewTrigger,
  context: Schema.Array(ContextItem),
})
type ReviewRequest = typeof ReviewRequest.Type

export const ReviewPlan = Schema.Struct({
  planId: Schema.String,
  sha: Schema.String,
  generatedAt: Schema.String,
  reviewRequests: Schema.Array(ReviewRequest),
  hardGateBlocking: Schema.Boolean,
})
export type ReviewPlan = typeof ReviewPlan.Type

const DEFAULT_CATEGORY_REVIEWERS: Record<Category, string> = {
  "architectural-drift": "contract-reviewer",
  "dependency-entropy": "supply-chain-reviewer",
  "abstraction-bloat": "api-design-reviewer",
  "legibility-decay": "simplicity-reviewer",
  "generated-slop": "consolidation-reviewer",
  "review-pain": "verification-reviewer",
}

const PRIORITY_RANK: Record<ReviewPriority, number> = {
  informational: 0,
  required: 1,
  block: 2,
}

export const generateReviewPlan = (
  observerOutput: ObserverOutput,
  routingOutput: RoutingOutput,
  vector?: PulsarVector,
  options?: {
    readonly generatedAt?: string
    readonly sha?: string
    readonly contextLimitBytes?: number
  },
): ReviewPlan => {
  const generatedAt = options?.generatedAt ?? new Date().toISOString()
  const sha = options?.sha ?? "unknown"
  const contextLimitBytes = options?.contextLimitBytes ?? 20 * 1024
  const requests = [
    ...hardGateReviewRequests(observerOutput),
    ...scoreThresholdReviewRequests(observerOutput, vector),
    ...structuralPatternReviewRequests(routingOutput),
  ]
  const reviewRequests = [...mergeRequests(requests, contextLimitBytes)].sort(compareRequests)

  return {
    planId: createPlanId(sha, generatedAt, reviewRequests),
    sha,
    generatedAt,
    reviewRequests,
    hardGateBlocking: reviewRequests.some((request) => request.priority === "block"),
  }
}

const hardGateReviewRequests = (
  observerOutput: ObserverOutput,
): ReadonlyArray<ReviewRequest> =>
  observerOutput.hard_gate_violations.map((violation) => ({
    reviewerRole: DEFAULT_CATEGORY_REVIEWERS[violation.category],
    reason: `Hard gate violation in ${humanizeCategory(violation.category)}`,
    priority: "block",
    trigger: {
      source: "hard-gate",
      detail: `${violation.signalId}: ${violation.diagnostic.message}`,
    },
    context: compactContext([
      {
        kind: "diagnostic",
        content: serialize({
          signalId: violation.signalId,
          category: violation.category,
          diagnostic: violation.diagnostic,
        }),
      },
      signalContextItem(observerOutput, violation.signalId),
    ]),
  }))

const scoreThresholdReviewRequests = (
  observerOutput: ObserverOutput,
  vector: PulsarVector | undefined,
): ReadonlyArray<ReviewRequest> =>
  CATEGORIES.flatMap((category) => {
    const categoryOutput = observerOutput.categories[category]
    const reviewerRole = DEFAULT_CATEGORY_REVIEWERS[category]
    const threshold = reviewThresholdOf(reviewerRole, vector, 0.6)
    if (categoryOutput.score >= threshold) return []
    return [
      {
        reviewerRole,
        reason: `${humanizeCategory(category)} score fell below review threshold`,
        priority: "required",
        trigger: {
          source: "score-threshold",
          detail: `${category} scored ${categoryOutput.score.toFixed(2)} below threshold ${threshold.toFixed(2)}`,
        },
        context: compactContext([
          {
            kind: "diagnostic",
            content: {
              category,
              score: categoryOutput.score,
              threshold,
              activeSignalIds: [...categoryOutput.activeSignalIds],
            },
          },
          ...categoryContext(observerOutput, categoryOutput.activeSignalIds),
        ]),
      },
    ]
  })

const structuralPatternReviewRequests = (
  routingOutput: RoutingOutput,
): ReadonlyArray<ReviewRequest> =>
  routingOutput.triggers.map((trigger) => ({
    reviewerRole: trigger.reviewerRole,
    reason: humanizePatternId(trigger.patternId),
    priority: "required",
    trigger: {
      source: "structural-pattern",
      detail: `Matched structural pattern ${trigger.patternId}`,
    },
    context: compactContext([
      {
        kind: "signal-output",
        content: serialize(trigger.contextPayload),
      },
      {
        kind: "diff-hunk",
        content: serialize({ sourceLocations: trigger.sourceLocations }),
      },
    ]),
  }))

const mergeRequests = (
  requests: ReadonlyArray<ReviewRequest>,
  contextLimitBytes: number,
): ReadonlyArray<ReviewRequest> => {
  const merged = new Map<string, ReviewRequest>()

  for (const request of requests) {
    const existing = merged.get(request.reviewerRole)
    if (existing === undefined) {
      merged.set(request.reviewerRole, truncateContext(request, contextLimitBytes))
      continue
    }

    const priority =
      PRIORITY_RANK[request.priority] > PRIORITY_RANK[existing.priority]
        ? request.priority
        : existing.priority
    const trigger =
      PRIORITY_RANK[request.priority] > PRIORITY_RANK[existing.priority]
        ? request.trigger
        : existing.trigger

    const mergedRequest: ReviewRequest = {
      reviewerRole: request.reviewerRole,
      reason: mergeText(existing.reason, request.reason),
      priority,
      trigger: {
        source: trigger.source,
        detail: mergeText(existing.trigger.detail, request.trigger.detail),
      },
      context: dedupeContext([...existing.context, ...request.context]),
    }

    merged.set(request.reviewerRole, truncateContext(mergedRequest, contextLimitBytes))
  }

  return [...merged.values()]
}

const truncateContext = (
  request: ReviewRequest,
  contextLimitBytes: number,
): ReviewRequest => {
  if (byteLength(request.context) <= contextLimitBytes) return request

  const truncated: Array<ContextItem> = []
  for (const item of request.context) {
    const next = [...truncated, item]
    if (byteLength(next) > contextLimitBytes) break
    truncated.push(item)
  }

  truncated.push({
    kind: "diagnostic",
    content: {
      note: "Context truncated to fit review-plan size budget",
      fullArtifactPath: `pulsar-state:review-plans/${request.reviewerRole}.full-context.json`,
    },
  })

  return {
    ...request,
    context: truncated,
  }
}

const byteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8")

const categoryContext = (
  observerOutput: ObserverOutput,
  signalIds: ReadonlyArray<string>,
): ReadonlyArray<ContextItem> =>
  signalIds
    .map((signalId) => signalContextItem(observerOutput, signalId))
    .filter((item): item is ContextItem => item !== undefined)

const signalContextItem = (
  observerOutput: ObserverOutput,
  signalId: string,
): ContextItem | undefined => {
  const signal = observerOutput.signalResults.get(signalId)
  if (signal === undefined) return undefined

  return {
    kind: "signal-output",
    content: serialize({
      signalId,
      score: signal.score,
      diagnostics: signal.diagnostics,
      output: signal.output,
    }),
  }
}

const dedupeContext = (items: ReadonlyArray<ContextItem>): ReadonlyArray<ContextItem> =>
  dedupeByKey(items, (item) => `${item.kind}:${JSON.stringify(item.content)}`)

const compareRequests = (left: ReviewRequest, right: ReviewRequest): number => {
  if (PRIORITY_RANK[left.priority] !== PRIORITY_RANK[right.priority]) {
    return PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority]
  }
  return left.reviewerRole.localeCompare(right.reviewerRole)
}

const mergeText = (left: string, right: string): string =>
  left === right ? left : `${left}; ${right}`

const createPlanId = (
  sha: string,
  generatedAt: string,
  requests: ReadonlyArray<ReviewRequest>,
): string => {
  const hash = createHash("sha256")
  hash.update(JSON.stringify({ sha, generatedAt, requests }))
  return `review-plan-${hash.digest("hex").slice(0, 12)}`
}

const humanizeDashWords = (value: string): string =>
  value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")

const humanizeCategory = (category: Category): string => humanizeDashWords(category)

const humanizePatternId = (patternId: string): string => humanizeDashWords(patternId)

const compactContext = (items: ReadonlyArray<ContextItem | undefined>): ReadonlyArray<ContextItem> =>
  items.filter((item): item is ContextItem => item !== undefined)

const serialize = (value: unknown): unknown => {
  if (value === null || value === undefined) return value
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (Array.isArray(value)) return value.map(serialize)
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([key, entry]) => [key, serialize(entry)]))
  }
  if (value instanceof Set) return [...value.values()].map(serialize)
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, serialize(entry)]),
    )
  }
  return String(value)
}
