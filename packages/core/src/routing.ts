import { Effect, Schema } from "effect"
import type { ObserverOutput } from "./observer.js"
import { buildContextPayload, dedupeLocations, matchPattern } from "./routing-matching.js"
import { loadRoutingPatterns } from "./routing-pattern-catalog.js"
import {
  RoutingDiff,
  type RoutingOutput,
  type RoutingPattern,
  type RoutingTrigger,
} from "./routing-schema.js"

export * from "./routing-schema.js"
export { generateReviewPlan, type ReviewPlan } from "./review-plan.js"

export class RoutingDetector {
  constructor(
    readonly patterns: ReadonlyArray<RoutingPattern>,
  ) {}

  detect(observerOutput: ObserverOutput, diff: RoutingDiff): RoutingOutput {
    const normalizedDiff = Schema.decodeUnknownSync(RoutingDiff)(diff)
    const triggers = this.patterns
      .flatMap((pattern) => {
        const match = matchPattern(pattern, observerOutput, normalizedDiff)
        if (match === undefined) return []

        return [
          {
            patternId: pattern.id,
            reviewerRole: pattern.reviewerRole,
            contextPayload: buildContextPayload(pattern, observerOutput, normalizedDiff, match),
            sourceLocations: dedupeLocations(match.sourceLocations),
          } satisfies RoutingTrigger,
        ]
      })

    return { triggers }
  }

  static load(options?: { readonly repoRoot?: string }): Effect.Effect<RoutingDetector, unknown, never> {
    return loadRoutingPatterns(options).pipe(
      Effect.map((patterns) => new RoutingDetector(patterns)),
    )
  }
}
