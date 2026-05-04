import { Effect, Schema } from "effect"
import { CATEGORIES, Category as CategorySchema, type Category } from "./category.js"
import { Diagnostic as DiagnosticSchema, type Diagnostic } from "./diagnostic.js"
import { buildInputOutputs } from "./input-outputs.js"
import type { SignalRunResult } from "./runner.js"
import type { Registry } from "./registry.js"
import type { ResolvedSignal, SignalOutputMetadata } from "./signal.js"
import {
  isActive as vectorIsActive,
  resolvedConfig as vectorResolvedConfig,
  type TasteVector,
  weightOf as vectorWeightOf,
} from "./vector.js"

/**
 * The top-level scoring output — a dimension vector grouped by taxonomy
 * category, the minimum dimension, a weighted mean, and hard-gate status.
 *
 * Mirrors ARCHITECTURE.md §Score Output. The public JSON contract keeps
 * the architecture doc's snake_case keys (`weighted_mean`,
 * `hard_gate_status`, `hard_gate_violations`). Additional runtime-only
 * metadata (`inactiveSignals`, `signalResults`) stays attached for
 * in-process consumers such as tests and compound signals.
 */
export interface CategoryOutput {
  readonly score: number
  readonly signals: Record<string, number>
  readonly signalCount: number
  readonly activeSignalIds: ReadonlyArray<string>
  readonly aggregation?: {
    readonly strategy: "weighted-mean" | "language-group-mean"
    readonly rawScore: number
    readonly aggregateScore: number
    readonly lowestSignalScore: number
    readonly finalScore: number
    readonly shapedByLowestSignal: boolean
    readonly weightTotal: number
    readonly weights: Record<string, number>
  }
  readonly normalization?: {
    readonly strategy: "language-group-mean"
    readonly groups: Record<
      string,
      {
        readonly score: number
        readonly signals: ReadonlyArray<string>
        readonly signalCount: number
      }
    >
  }
}

export interface MinimumDimension {
  readonly signal: string
  readonly category: Category
  readonly score: number
  readonly detail: string
}

export interface HardGateViolation {
  readonly signalId: string
  readonly category: Category
  readonly diagnostic: Diagnostic
}

export interface ObserverRuntimeProfile {
  readonly totalMs: number
  readonly stages?: Record<
    string,
    {
      readonly durationMs: number
    }
  >
  readonly signals: Record<
    string,
    {
      readonly durationMs: number
      readonly score: number
      readonly diagnostics: number
    }
  >
}

interface ObserverOptions {
  readonly profile?: boolean
}

const DEFAULT_OBSERVER_SIGNAL_CONCURRENCY = 1

const ObserverCategorySnapshot = Schema.Struct({
  score: Schema.Number,
  signals: Schema.Record({ key: Schema.String, value: Schema.Number }),
  aggregation: Schema.optional(
    Schema.Struct({
      strategy: Schema.Union(
        Schema.Literal("weighted-mean"),
        Schema.Literal("language-group-mean"),
      ),
      rawScore: Schema.Number,
      aggregateScore: Schema.Number,
      lowestSignalScore: Schema.Number,
      finalScore: Schema.Number,
      shapedByLowestSignal: Schema.Boolean,
      weightTotal: Schema.Number,
      weights: Schema.Record({ key: Schema.String, value: Schema.Number }),
    }),
  ),
  normalization: Schema.optional(
    Schema.Struct({
      strategy: Schema.Literal("language-group-mean"),
      groups: Schema.Record({
        key: Schema.String,
        value: Schema.Struct({
          score: Schema.Number,
          signals: Schema.Array(Schema.String),
          signalCount: Schema.Number,
        }),
      }),
    }),
  ),
})

const ObserverCategories = Schema.Struct({
  "architectural-drift": ObserverCategorySnapshot,
  "dependency-entropy": ObserverCategorySnapshot,
  "abstraction-bloat": ObserverCategorySnapshot,
  "legibility-decay": ObserverCategorySnapshot,
  "generated-slop": ObserverCategorySnapshot,
  "review-pain": ObserverCategorySnapshot,
})

const MinimumDimensionSnapshot = Schema.Struct({
  signal: Schema.String,
  category: CategorySchema,
  score: Schema.Number,
  detail: Schema.String,
})

const HardGateViolationSnapshot = Schema.Struct({
  signalId: Schema.String,
  category: CategorySchema,
  diagnostic: DiagnosticSchema,
})

const ObserverSignalMetadataSnapshot = Schema.Struct({
  effectiveConfidence: Schema.optional(Schema.Number),
  baseConfidence: Schema.optional(Schema.Number),
  computedAt: Schema.optional(Schema.String),
  stale: Schema.optional(Schema.Boolean),
})

const ObserverRuntimeProfileSnapshot = Schema.Struct({
  total_ms: Schema.Number,
  stages: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Struct({
        duration_ms: Schema.Number,
      }),
    }),
  ),
  signals: Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
      duration_ms: Schema.Number,
      score: Schema.Number,
      diagnostics: Schema.Number,
    }),
  }),
})

export const ObserverOutput = Schema.Struct({
  categories: ObserverCategories,
  minimum: Schema.Union(MinimumDimensionSnapshot, Schema.Undefined),
  weighted_mean: Schema.Number,
  hard_gate_status: Schema.Literal("pass", "fail"),
  hard_gate_violations: Schema.Array(HardGateViolationSnapshot),
  signal_metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: ObserverSignalMetadataSnapshot }),
  ),
  runtime_profile: Schema.optional(ObserverRuntimeProfileSnapshot),
})

type ObserverOutputPublic = typeof ObserverOutput.Type

export type ObserverOutput = ObserverOutputPublic & {
  readonly categories: Record<Category, CategoryOutput>
  readonly minimum: MinimumDimension | undefined
  readonly inactiveSignals: ReadonlyArray<string>
  readonly signalResults: ReadonlyMap<string, SignalRunResult>
  readonly signalMetadata?: Record<string, SignalOutputMetadata>
  readonly runtimeProfile?: ObserverRuntimeProfile
}

export const toObserverJson = (output: ObserverOutput): ObserverOutputPublic => ({
  categories: {
    "architectural-drift": toObserverCategorySnapshot(
      output.categories["architectural-drift"],
    ),
    "dependency-entropy": toObserverCategorySnapshot(
      output.categories["dependency-entropy"],
    ),
    "abstraction-bloat": toObserverCategorySnapshot(
      output.categories["abstraction-bloat"],
    ),
    "legibility-decay": toObserverCategorySnapshot(
      output.categories["legibility-decay"],
    ),
    "generated-slop": toObserverCategorySnapshot(
      output.categories["generated-slop"],
    ),
    "review-pain": toObserverCategorySnapshot(output.categories["review-pain"]),
  },
  minimum: output.minimum,
  weighted_mean: output.weighted_mean,
  hard_gate_status: output.hard_gate_status,
  hard_gate_violations: output.hard_gate_violations,
  ...(output.signalMetadata !== undefined && Object.keys(output.signalMetadata).length > 0
    ? { signal_metadata: output.signalMetadata }
    : {}),
  ...(output.runtimeProfile !== undefined
    ? {
        runtime_profile: {
          total_ms: output.runtimeProfile.totalMs,
          ...(output.runtimeProfile.stages !== undefined
            ? {
                stages: Object.fromEntries(
                  Object.entries(output.runtimeProfile.stages).map(([stageId, profile]) => [
                    stageId,
                    { duration_ms: profile.durationMs },
                  ]),
                ),
              }
            : {}),
          signals: Object.fromEntries(
            Object.entries(output.runtimeProfile.signals).map(([signalId, profile]) => [
              signalId,
              {
                duration_ms: profile.durationMs,
                score: profile.score,
                diagnostics: profile.diagnostics,
              },
            ]),
          ),
        },
      }
    : {}),
})

const toObserverCategorySnapshot = (
  category: CategoryOutput,
): typeof ObserverCategorySnapshot.Type => ({
  score: category.score,
  signals: category.signals,
  ...(category.aggregation !== undefined
    ? { aggregation: category.aggregation }
    : {}),
  ...(category.normalization !== undefined
    ? { normalization: category.normalization }
    : {}),
})

/**
 * Run every active signal in the registry against the ambient context,
 * then aggregate the results into the canonical ObserverOutput shape.
 *
 * Error channel is `never` because per-signal compute failures are
 * captured as score-0 warn diagnostics inside the signal's category
 * (AC-8). This keeps one flaky signal from collapsing the whole
 * observation.
 *
 * Requirements `R` is left open — it is whatever the active signals
 * demand (e.g. TsProjectTag for the TS pack). The caller provides the
 * layer union exactly as they do for runSignal.
 */
export const observe = (
  registry: Registry,
  vector: TasteVector | undefined,
  options?: ObserverOptions,
): Effect.Effect<ObserverOutput, never, any> =>
  Effect.gen(function* () {
    const observerStartedAt = nowMs()
    const outputs = new Map<string, unknown>()
    const signalResults = new Map<string, SignalRunResult>()
    const inactiveSignals: Array<string> = []
    const signalMetadata: Record<string, SignalOutputMetadata> = {}
    const signalProfiles: ObserverRuntimeProfile["signals"] = {}

    const processedSignals = new Set<string>()
    const registryIds = new Set(registry.sorted.map((signal) => signal.id))
    let pendingSignals: Array<ResolvedSignal> = []

    for (const signal of registry.sorted) {
      if (!vectorIsActive(signal.id, vector)) {
        inactiveSignals.push(signal.id)
        processedSignals.add(signal.id)
        continue
      }

      pendingSignals.push(signal)
    }

    while (pendingSignals.length > 0) {
      const readySignals = pendingSignals.filter((signal) =>
        signal.inputs.every((input) => processedSignals.has(input.id) || !registryIds.has(input.id)),
      )

      const batch = readySignals.length > 0 ? readySignals : [pendingSignals[0]!]
      const batchIds = new Set(batch.map((signal) => signal.id))
      pendingSignals = pendingSignals.filter((signal) => !batchIds.has(signal.id))

      const outputSnapshot = new Map(outputs)
      const batchResults = yield* Effect.forEach(
        batch,
        (signal) =>
          Effect.gen(function* () {
            const startedAt = nowMs()
            const result = yield* runOneSignal(signal, outputSnapshot, vector)
            return {
              signal,
              result,
              durationMs: roundRuntimeMs(nowMs() - startedAt),
            }
          }),
        { concurrency: DEFAULT_OBSERVER_SIGNAL_CONCURRENCY },
      )

      for (const { signal, result, durationMs } of batchResults) {
        if (options?.profile === true) {
          signalProfiles[signal.id] = {
            durationMs,
            score: result.score,
            diagnostics: result.diagnostics.length,
          }
        }
        if (result.output !== undefined) {
          outputs.set(signal.id, result.output)
        }
        if (result.metadata !== undefined) {
          signalMetadata[signal.id] = result.metadata
        }
        signalResults.set(signal.id, result)
        processedSignals.add(signal.id)
      }
    }

    const categories = aggregateCategories(registry, signalResults, vector)
    const minimum = findMinimum(registry, signalResults)
    const weighted_mean = computeWeightedMean(categories)
    const hard_gate_violations = collectHardGateViolations(registry, signalResults)
    const hard_gate_status: "pass" | "fail" =
      hard_gate_violations.length > 0 ? "fail" : "pass"

    return {
      categories,
      minimum,
      weighted_mean,
      hard_gate_status,
      hard_gate_violations,
      inactiveSignals,
      signalResults,
      ...(Object.keys(signalMetadata).length > 0 ? { signalMetadata } : {}),
      ...(options?.profile === true
        ? {
            runtimeProfile: {
              totalMs: roundRuntimeMs(nowMs() - observerStartedAt),
              signals: signalProfiles,
            },
          }
        : {}),
    }
  })

const nowMs = (): number => {
  if (typeof performance !== "undefined") return performance.now()
  return Date.now()
}

const roundRuntimeMs = (value: number): number => Math.max(0, Number(value.toFixed(2)))

/**
 * Run a single signal against the shared outputs map. Compute failures
 * are swallowed into a score-0 result with a synthetic `warn` diagnostic.
 * The observer never crashes on a bad leaf signal.
 */
const runOneSignal = (
  signal: ResolvedSignal,
  outputs: ReadonlyMap<string, unknown>,
  vector: TasteVector | undefined,
): Effect.Effect<SignalRunResult, never, any> =>
  Effect.gen(function* () {
    const inputOutputs = buildInputOutputs(signal, outputs)
    const config = vectorResolvedConfig(signal.id, signal.defaultConfig, vector)

    const either = yield* Effect.either(signal.compute(config, inputOutputs))
    if (either._tag === "Left") {
      const err = either.left
      const message = (err as { message?: string }).message ?? String(err)
      const failureDiagnostic: Diagnostic = {
        severity: "warn",
        message: `Signal ${signal.id} failed: ${message}`,
      }
      return {
        signalId: signal.id,
        score: 0,
        output: undefined,
        diagnostics: [failureDiagnostic],
      }
    }

    const out = either.right
    const metadata = signal.outputMetadata?.(out)
    return {
      signalId: signal.id,
      score: signal.score(out),
      output: out,
      diagnostics: signal.diagnose(out),
      ...(metadata !== undefined ? { metadata } : {}),
    }
  })

/**
 * Category score = taste-weighted mean of active signals in that category.
 *
 *     categoryScore = sum(weight_i * score_i) / sum(weight_i)
 *
 * A category with no active signals scores 1 (neutral) and is excluded
 * from the overall weighted mean's denominator — so empty categories
 * neither drag the score up nor skew it down.
 */
const aggregateCategories = (
  registry: Registry,
  signalResults: ReadonlyMap<string, SignalRunResult>,
  vector: TasteVector | undefined,
): Record<Category, CategoryOutput> => {
  const out: Record<string, CategoryOutput> = {}
  for (const category of CATEGORIES) {
    const signalsInCategory = registry.sorted.filter(
      (s) => s.category === category && signalResults.has(s.id),
    )

    const signalsRecord: Record<string, number> = {}
    const weightsRecord: Record<string, number> = {}
    const activeIds: Array<string> = []
    let weightedSum = 0
    let weightTotal = 0
    const groups = new Map<
      string,
      {
        weightedSum: number
        weightTotal: number
        signalIds: Array<string>
      }
    >()
    const languageLocalGroups = new Set<string>()
    for (const s of signalsInCategory) {
      const result = signalResults.get(s.id)
      if (result === undefined) continue
      const weight = vectorWeightOf(s.id, vector)
      signalsRecord[s.id] = result.score
      weightsRecord[s.id] = weight
      activeIds.push(s.id)
      weightedSum += weight * result.score
      weightTotal += weight

      const normalizationGroup = normalizationGroupOfSignal(s)
      const bucket = groups.get(normalizationGroup) ?? {
        weightedSum: 0,
        weightTotal: 0,
        signalIds: [],
      }
      bucket.weightedSum += weight * result.score
      bucket.weightTotal += weight
      bucket.signalIds.push(s.id)
      groups.set(normalizationGroup, bucket)
      if (isLanguageNormalizationGroup(normalizationGroup)) {
        languageLocalGroups.add(normalizationGroup)
      }
    }

    const rawScore = weightTotal === 0 ? 1 : weightedSum / weightTotal
    const lowestSignalScore = Math.min(
      ...Object.values(signalsRecord),
    )
    const normalization =
      languageLocalGroups.size > 1
        ? buildCategoryNormalization(groups)
        : undefined
    const normalizedScore = normalization?.score ?? rawScore
    const shapedByLowestSignal = shouldShapeCategoryScore(category)
    const score = shapeCategoryScore(
      category,
      normalizedScore,
      Number.isFinite(lowestSignalScore) ? lowestSignalScore : 1,
    )
    out[category] = {
      score,
      signals: signalsRecord,
      signalCount: signalsInCategory.length,
      activeSignalIds: activeIds,
      aggregation: {
        strategy: normalization === undefined ? "weighted-mean" : "language-group-mean",
        rawScore,
        aggregateScore: normalizedScore,
        lowestSignalScore: Number.isFinite(lowestSignalScore) ? lowestSignalScore : 1,
        finalScore: score,
        shapedByLowestSignal,
        weightTotal,
        weights: weightsRecord,
      },
      ...(normalization !== undefined
        ? { normalization: normalization.snapshot }
        : {}),
    }
  }
  return out as Record<Category, CategoryOutput>
}

const shapeCategoryScore = (
  category: Category,
  score: number,
  lowestSignalScore: number,
): number => {
  if (!shouldShapeCategoryScore(category)) return score
  return (score * 0.65) + (lowestSignalScore * 0.35)
}

const shouldShapeCategoryScore = (category: Category): boolean =>
  category === "dependency-entropy" || category === "generated-slop"

const buildCategoryNormalization = (
  groups: ReadonlyMap<
    string,
    {
      weightedSum: number
      weightTotal: number
      signalIds: ReadonlyArray<string>
    }
  >,
): {
  readonly score: number
  readonly snapshot: NonNullable<CategoryOutput["normalization"]>
} => {
  const normalizedGroups: NonNullable<CategoryOutput["normalization"]>["groups"] = {}
  let groupScoreSum = 0
  let groupCount = 0

  for (const [group, bucket] of groups) {
    const score = bucket.weightTotal === 0 ? 1 : bucket.weightedSum / bucket.weightTotal
    normalizedGroups[group] = {
      score,
      signals: [...bucket.signalIds].sort(),
      signalCount: bucket.signalIds.length,
    }
    groupScoreSum += score
    groupCount += 1
  }

  return {
    score: groupCount === 0 ? 1 : groupScoreSum / groupCount,
    snapshot: {
      strategy: "language-group-mean",
      groups: normalizedGroups,
    },
  }
}

const normalizationGroupOfSignal = (signal: ResolvedSignal): string => {
  if (signal.normalizationGroup !== undefined) return signal.normalizationGroup
  if (signal.id.startsWith("TS-")) return "typescript"
  if (signal.id.startsWith("RS-")) return "rust"
  if (signal.id.startsWith("SHARED-")) return "shared"
  return "default"
}

const isLanguageNormalizationGroup = (group: string): boolean =>
  group === "typescript" || group === "rust"

/**
 * Count-weighted mean across categories: categories with more active
 * signals carry proportionally more weight. Empty categories (no active
 * signals) are excluded from both numerator and denominator — their
 * neutral `1` score does not inflate the overall number.
 *
 * Design choice: flat vs count-weighted vs vector-metadata-weighted.
 * Default is count-weighted so the aggregate tracks signal density.
 * Vector-metadata-weighted (e.g. `vector.category_weights`) is a future
 * knob — when added, it will feed in here as the per-category weight
 * instead of `signalCount`.
 */
const computeWeightedMean = (
  categories: Record<Category, CategoryOutput>,
): number => {
  let weightedSum = 0
  let totalCount = 0
  for (const category of CATEGORIES) {
    const entry = categories[category]
    if (entry.signalCount === 0) continue
    weightedSum += entry.score * entry.signalCount
    totalCount += entry.signalCount
  }
  if (totalCount === 0) return 1
  return weightedSum / totalCount
}

/**
 * Lowest-score signal across all categories. Ties resolve by the
 * CATEGORIES constant order (architectural-drift < dependency-entropy
 * < abstraction-bloat < legibility-decay < generated-slop < review-pain),
 * then by signal id alphabetically as a final tiebreak.
 *
 * Returns undefined when no signals produced a result (empty registry
 * or every signal inactive).
 */
const findMinimum = (
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
  if (diagnostics.length === 0) return ""
  if (diagnostics.length === 1) return diagnostics[0]!.message
  return `${diagnostics[0]!.message}; ${diagnostics[1]!.message}`
}

/**
 * A signal fails the hard gate iff:
 *   1. its enforcement ceiling includes "hard-gate", AND
 *   2. it emitted one or more diagnostics at severity "block".
 *
 * The taste-vector weight plays no part in this decision. A Tier 1
 * structural signal at weight 0.1 still fails the gate per architecture:
 *   "Structural violations fail the gate regardless of weight."
 */
const collectHardGateViolations = (
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
