import { CATEGORIES, type Category } from "./category.js"
import type { Diagnostic } from "./diagnostic.js"
import type { Registry } from "./registry.js"
import type { SignalRunResult } from "./runner.js"
import type { ResolvedSignal } from "./signal.js"
import type { HardGateViolation, MinimumDimension } from "./observer-model.js"
import { signalApplicabilityOf } from "./observer-score-utils.js"

/**
 * Lowest applicable repo-quality signal across all categories. Ties resolve by the
 * CATEGORIES constant order (architectural-drift < dependency-entropy
 * < abstraction-bloat < legibility-decay < generated-slop < review-pain),
 * then by signal id alphabetically as a final tiebreak.
 *
 * Failed, non-applicable, and insufficient-evidence signals are surfaced
 * through readiness metadata, not as quality dimensions.
 *
 * Returns undefined when no applicable signals produced a result.
 */
export const findMinimum = (
  registry: Registry,
  signalResults: ReadonlyMap<string, SignalRunResult>,
): MinimumDimension | undefined => {
  if (signalResults.size === 0) return undefined

  const categoryOrder = new Map<Category, number>(
    CATEGORIES.map((c, i) => [c, i] as const),
  )

  let best: { signal: ResolvedSignal; result: SignalRunResult } | undefined
  for (const signal of registry.sorted) {
    const result = signalResults.get(signal.id)
    if (result === undefined) continue
    if (signalApplicabilityOf(result) !== "applicable") continue
    if (best === undefined) {
      best = { signal, result }
      continue
    }
    if (result.score < best.result.score) {
      best = { signal, result }
      continue
    }
    if (result.score === best.result.score) {
      const thisOrder = categoryOrder.get(signal.category) ?? Number.MAX_SAFE_INTEGER
      const bestOrder =
        categoryOrder.get(best.signal.category) ?? Number.MAX_SAFE_INTEGER
      if (thisOrder < bestOrder) {
        best = { signal, result }
      } else if (thisOrder === bestOrder && signal.id < best.signal.id) {
        best = { signal, result }
      }
    }
  }

  if (best === undefined) return undefined

  return {
    signal: best.signal.id,
    category: best.signal.category,
    score: best.result.score,
    detail: buildMinimumDetail(best.result.diagnostics),
  }
}

/**
 * Condense the first one or two diagnostic messages into a single
 * human-readable detail string. Empty when the signal emitted no
 * diagnostics (rare but possible — a perfect-score signal with nothing
 * to say).
 */
const buildMinimumDetail = (
  diagnostics: ReadonlyArray<Diagnostic>,
): string => {
  const first = diagnostics[0]?.message
  if (first === undefined) return ""
  // Skip past diagnostics that repeat the first message (same finding at
  // multiple sites) so the detail line never reads "X; X".
  const second = diagnostics.slice(1).find((d) => d.message !== first)?.message
  return second === undefined ? first : `${first}; ${second}`
}

/**
 * A signal fails the hard gate iff:
 *   1. its enforcement ceiling includes "hard-gate", AND
 *   2. it emitted one or more diagnostics at severity "block".
 *
 * The pulsar-vector weight plays no part in this decision. A Tier 1
 * structural signal at weight 0.1 still fails the gate per architecture:
 *   "Structural violations fail the gate regardless of weight."
 */
export const collectHardGateViolations = (
  registry: Registry,
  signalResults: ReadonlyMap<string, SignalRunResult>,
): ReadonlyArray<HardGateViolation> => {
  const violations: Array<HardGateViolation> = []
  for (const signal of registry.sorted) {
    if (!signal.enforcement.includes("hard-gate")) continue
    const result = signalResults.get(signal.id)
    if (result === undefined) continue
    const blocking = result.diagnostics.filter((d) => d.severity === "block")
    for (const diagnostic of blocking) {
      violations.push({
        signalId: signal.id,
        category: signal.category,
        diagnostic,
      })
    }
  }
  return violations
}
