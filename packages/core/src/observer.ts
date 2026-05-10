import { Effect, Option, Schema } from "effect"
import { CATEGORIES, Category as CategorySchema, type Category } from "./category.js"
import {
  CalibrationContextTag,
  ProjectModuleScope,
  type ResolvedCalibrationContext,
} from "./calibration.js"
import { Diagnostic as DiagnosticSchema, type Diagnostic } from "./diagnostic.js"
import {
  applySignalFactorPolicy,
  makeSignalFactorPolicyContext,
  SignalFactorPolicyTag,
} from "./factor-ledger.js"
import { buildInputOutputs } from "./input-outputs.js"
import type { SignalRunResult } from "./runner.js"
import type { Registry } from "./registry.js"
import type { ResolvedSignal, SignalApplicability, SignalOutputMetadata } from "./signal.js"
import {
  categoryAggregationConfigOf,
  isActive as vectorIsActive,
  readinessConfigOf,
  type CategoryAggregationObserverConfig,
  resolvedConfig as vectorResolvedConfig,
  type ReadinessObserverConfig,
  type PulsarVector,
  weightOf as vectorWeightOf,
} from "./vector.js"

export const OBSERVER_OUTPUT_SEMANTICS = "applicability-aware-readiness-v1" as const
export type ObserverOutputSemantics = typeof OBSERVER_OUTPUT_SEMANTICS

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
  readonly applicableSignalCount?: number
  readonly activeSignalIds: ReadonlyArray<string>
  readonly aggregation?: {
    readonly strategy: "weighted-mean" | "language-group-mean"
    readonly rawScore: number
    readonly aggregateScore: number
    readonly lowestSignalScore: number
    readonly finalScore: number
    readonly shapedByPressure: boolean
    readonly pressure: {
      readonly strategy: "pressure-pnorm-local-max"
      readonly p: number
      readonly meanPressure: number
      readonly pnormPressure: number
      readonly maxLocalPressure: number
      readonly localPressure: number
      readonly finalPressure: number
    }
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

export interface ReadinessPressure {
  readonly signal_id: string
  readonly category: Category
  readonly score: number
  readonly raw_pressure: number
  readonly effective_pressure: number
  readonly weight: number
  readonly confidence: number
  readonly applicability: SignalApplicability
}

export interface ReadinessOutput {
  readonly score: number
  readonly pressure: number
  readonly status: "green" | "yellow" | "red" | "blocked" | "unknown" | "failed"
  readonly aggregation: {
    readonly strategy: "pressure-pnorm-local-max"
    readonly p: number
    readonly mean_pressure: number
    readonly pnorm_pressure: number
    readonly max_local_pressure: number
    readonly failed_signal_pressure: number
    readonly hard_gate_pressure: number
    readonly hard_gate_score_cap: number
    readonly local_warning_threshold: number
    readonly local_poison_threshold: number
    readonly local_warning_gain: number
    readonly applicable_signal_count: number
    readonly ignored_signal_count: number
    readonly failed_signal_count: number
  }
  readonly top_pressures: ReadonlyArray<ReadinessPressure>
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

export interface ObserverCalibrationModuleSummary {
  readonly id: string
  readonly version: string
  readonly scope: typeof ProjectModuleScope.Type
  readonly source: "builtin" | "package" | "workspace" | "repo-local"
  readonly source_ref?: string
  readonly source_fingerprint?: string
  readonly fingerprint: string
}

export interface ObserverCalibrationSummary {
  readonly fingerprint: string
  readonly active_modules: ReadonlyArray<ObserverCalibrationModuleSummary>
}

interface ObserverOptions {
  readonly profile?: boolean
}

const DEFAULT_OBSERVER_SIGNAL_CONCURRENCY = 1

const ObserverCategorySnapshot = Schema.Struct({
  score: Schema.Number,
  signals: Schema.Record({ key: Schema.String, value: Schema.Number }),
  signalCount: Schema.optional(Schema.Number),
  applicableSignalCount: Schema.optional(Schema.Number),
  activeSignalIds: Schema.optional(Schema.Array(Schema.String)),
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
      shapedByPressure: Schema.Boolean,
      pressure: Schema.Struct({
        strategy: Schema.Literal("pressure-pnorm-local-max"),
        p: Schema.Number,
        meanPressure: Schema.Number,
        pnormPressure: Schema.Number,
        maxLocalPressure: Schema.Number,
        localPressure: Schema.Number,
        finalPressure: Schema.Number,
      }),
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

const ReadinessPressureSnapshot = Schema.Struct({
  signal_id: Schema.String,
  category: CategorySchema,
  score: Schema.Number,
  raw_pressure: Schema.Number,
  effective_pressure: Schema.Number,
  weight: Schema.Number,
  confidence: Schema.Number,
  applicability: Schema.Union(
    Schema.Literal("applicable"),
    Schema.Literal("not_applicable"),
    Schema.Literal("insufficient_evidence"),
    Schema.Literal("failed"),
  ),
})

const ReadinessSnapshot = Schema.Struct({
  score: Schema.Number,
  pressure: Schema.Number,
  status: Schema.Union(
    Schema.Literal("green"),
    Schema.Literal("yellow"),
    Schema.Literal("red"),
    Schema.Literal("blocked"),
    Schema.Literal("unknown"),
    Schema.Literal("failed"),
  ),
  aggregation: Schema.Struct({
    strategy: Schema.Literal("pressure-pnorm-local-max"),
    p: Schema.Number,
    mean_pressure: Schema.Number,
    pnorm_pressure: Schema.Number,
    max_local_pressure: Schema.Number,
    failed_signal_pressure: Schema.optional(Schema.Number),
    hard_gate_pressure: Schema.Number,
    hard_gate_score_cap: Schema.Number,
    local_warning_threshold: Schema.Number,
    local_poison_threshold: Schema.Number,
    local_warning_gain: Schema.Number,
    applicable_signal_count: Schema.Number,
    ignored_signal_count: Schema.Number,
    failed_signal_count: Schema.optional(Schema.Number),
  }),
  top_pressures: Schema.Array(ReadinessPressureSnapshot),
})

const ObserverSignalMetadataSnapshot = Schema.Struct({
  effectiveConfidence: Schema.optional(Schema.Number),
  baseConfidence: Schema.optional(Schema.Number),
  computedAt: Schema.optional(Schema.String),
  stale: Schema.optional(Schema.Boolean),
  applicability: Schema.optional(
    Schema.Union(
      Schema.Literal("applicable"),
      Schema.Literal("not_applicable"),
      Schema.Literal("insufficient_evidence"),
      Schema.Literal("failed"),
    ),
  ),
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

const ObserverCalibrationSnapshot = Schema.Struct({
  fingerprint: Schema.String,
  active_modules: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      version: Schema.String,
      scope: ProjectModuleScope,
      source: Schema.Literal("builtin", "package", "workspace", "repo-local"),
      source_ref: Schema.optional(Schema.String),
      source_fingerprint: Schema.optional(Schema.String),
      fingerprint: Schema.String,
    }),
  ),
})

const SignalFactorLedgerEntrySnapshot = Schema.Struct({
  path: Schema.String,
  value: Schema.Unknown,
  source: Schema.Literal("signal-default", "computed", "vector", "module"),
  affectsScore: Schema.Boolean,
  title: Schema.optional(Schema.String),
  scoreRole: Schema.optional(
    Schema.Literal(
      "evidence",
      "threshold",
      "penalty",
      "weight",
      "confidence",
      "score-cap",
      "metadata",
    ),
  ),
  attribution: Schema.optional(Schema.Unknown),
  mutations: Schema.optional(Schema.Array(Schema.Unknown)),
})

export const ObserverOutput = Schema.Struct({
  observer_semantics: Schema.optional(Schema.Literal(OBSERVER_OUTPUT_SEMANTICS)),
  categories: ObserverCategories,
  minimum: Schema.Union(MinimumDimensionSnapshot, Schema.Undefined),
  weighted_mean: Schema.Number,
  readiness: Schema.optional(ReadinessSnapshot),
  hard_gate_status: Schema.Literal("pass", "fail"),
  hard_gate_violations: Schema.Array(HardGateViolationSnapshot),
  signal_metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: ObserverSignalMetadataSnapshot }),
  ),
  runtime_profile: Schema.optional(ObserverRuntimeProfileSnapshot),
  calibration: Schema.optional(ObserverCalibrationSnapshot),
  signal_factors: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Array(SignalFactorLedgerEntrySnapshot) }),
  ),
})

type ObserverOutputPublic = typeof ObserverOutput.Type

export type ObserverOutput = ObserverOutputPublic & {
  readonly observer_semantics?: ObserverOutputSemantics
  readonly categories: Record<Category, CategoryOutput>
  readonly minimum: MinimumDimension | undefined
  readonly readiness?: ReadinessOutput
  readonly inactiveSignals: ReadonlyArray<string>
  readonly signalResults: ReadonlyMap<string, SignalRunResult>
  readonly signalMetadata?: Record<string, SignalOutputMetadata>
  readonly runtimeProfile?: ObserverRuntimeProfile
  readonly calibration?: ObserverCalibrationSummary
}

export const toObserverJson = (output: ObserverOutput): ObserverOutputPublic => ({
  observer_semantics: OBSERVER_OUTPUT_SEMANTICS,
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
  ...(output.readiness !== undefined ? { readiness: output.readiness } : {}),
  hard_gate_status: output.hard_gate_status,
  hard_gate_violations: output.hard_gate_violations,
  ...(output.calibration !== undefined ? { calibration: output.calibration } : {}),
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
  ...(signalFactorsJson(output).length > 0
    ? { signal_factors: Object.fromEntries(signalFactorsJson(output)) }
    : {}),
})

const signalFactorsJson = (
  output: ObserverOutput,
): ReadonlyArray<readonly [string, ReadonlyArray<typeof SignalFactorLedgerEntrySnapshot.Type>]> =>
  [...output.signalResults.entries()]
    .flatMap(([signalId, result]) =>
      result.factorLedger === undefined
        ? []
        : [[signalId, result.factorLedger.entries] as const],
    )
    .sort(([left], [right]) => left.localeCompare(right))

const toObserverCategorySnapshot = (
  category: CategoryOutput,
): typeof ObserverCategorySnapshot.Type => ({
  score: category.score,
  signals: category.signals,
  signalCount: category.signalCount,
  applicableSignalCount: category.applicableSignalCount ?? category.signalCount,
  activeSignalIds: [...category.activeSignalIds],
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
  vector: PulsarVector | undefined,
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
      if (!vectorIsActive(signal, vector)) {
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
    const readiness = computeReadiness(registry, signalResults, vector, hard_gate_status)
    const calibration = yield* Effect.serviceOption(CalibrationContextTag)
    const calibrationSummary = Option.isSome(calibration)
      ? summarizeCalibration(calibration.value)
      : undefined

    return {
      observer_semantics: OBSERVER_OUTPUT_SEMANTICS,
      categories,
      minimum,
      weighted_mean,
      readiness,
      hard_gate_status,
      hard_gate_violations,
      inactiveSignals,
      signalResults,
      ...(calibrationSummary !== undefined ? { calibration: calibrationSummary } : {}),
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

const summarizeCalibration = (
  calibration: ResolvedCalibrationContext,
): ObserverCalibrationSummary => ({
  fingerprint: calibration.fingerprint,
  active_modules: calibration.activeModules
    .map((module) => ({
      id: module.id,
      version: module.version,
      scope: module.scope,
      source: module.source,
      ...(module.sourceRef !== undefined ? { source_ref: module.sourceRef } : {}),
      ...(module.sourceFingerprint !== undefined
        ? { source_fingerprint: module.sourceFingerprint }
        : {}),
      fingerprint: module.fingerprint,
    }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version)),
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
  vector: PulsarVector | undefined,
): Effect.Effect<SignalRunResult, never, any> =>
  Effect.gen(function* () {
    const inputOutputs = buildInputOutputs(signal, outputs)
    const config = vectorResolvedConfig(signal, signal.defaultConfig, vector)
    const factorPolicy = makeSignalFactorPolicyContext(signal, vector)

    const either = yield* Effect.either(
      signal.compute(config, inputOutputs).pipe(
        Effect.provideService(SignalFactorPolicyTag, factorPolicy),
      ),
    )
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
        metadata: { applicability: "failed" },
      }
    }

    const out = either.right
    const metadata = signal.outputMetadata?.(out)
    const rawFactorLedger = signal.factorLedger?.(out)
    const factorLedger =
      rawFactorLedger === undefined
        ? undefined
        : applySignalFactorPolicy(rawFactorLedger, factorPolicy)
    return {
      signalId: signal.id,
      score: signal.score(out),
      output: out,
      diagnostics: signal.diagnose(out),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(factorLedger !== undefined ? { factorLedger } : {}),
    }
  })

/**
 * Category score = pressure-shaped score of active signals that produced
 * applicable repo-quality evidence in that category.
 *
 * The pulsar-weighted mean stays in aggregation metadata because it is useful
 * as an evidence average. The public category score is mixed from pressure:
 * a weak local signal should not disappear behind unrelated clean checks in
 * the same category.
 *
 * Non-applicable, insufficient-evidence, and failed runs stay visible in
 * per-signal output/metadata, but they are not evidence about the repo's
 * quality. They therefore do not pull the evidence mean up or down.
 *
 * A category with no applicable evidence scores 1 (neutral) and is excluded
 * from the overall weighted mean's denominator — so missing evidence neither
 * drags the score down nor inflates it.
 */
const aggregateCategories = (
  registry: Registry,
  signalResults: ReadonlyMap<string, SignalRunResult>,
  vector: PulsarVector | undefined,
): Record<Category, CategoryOutput> => {
  const out: Record<string, CategoryOutput> = {}
  for (const category of CATEGORIES) {
    const signalsInCategory = registry.sorted.filter(
      (s) => s.category === category && signalResults.has(s.id),
    )

    const signalsRecord: Record<string, number> = {}
    const weightsRecord: Record<string, number> = {}
    const activeIds: Array<string> = []
    let applicableSignalCount = 0
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
    const pressureInputs: Array<{ score: number; weight: number; confidence: number }> = []
    for (const s of signalsInCategory) {
      const result = signalResults.get(s.id)
      if (result === undefined) continue
      const weight = vectorWeightOf(s, vector)
      signalsRecord[s.id] = result.score
      weightsRecord[s.id] = weight
      activeIds.push(s.id)

      if (signalApplicabilityOf(result) !== "applicable") continue

      const confidence = confidenceForSignal(s, result)
      const effectiveScore = confidenceAdjustedScore(result.score, confidence)
      applicableSignalCount += 1
      weightedSum += weight * effectiveScore
      weightTotal += weight
      pressureInputs.push({ score: result.score, weight, confidence })

      const normalizationGroup = normalizationGroupOfSignal(s)
      const bucket = groups.get(normalizationGroup) ?? {
        weightedSum: 0,
        weightTotal: 0,
        signalIds: [],
      }
      bucket.weightedSum += weight * effectiveScore
      bucket.weightTotal += weight
      bucket.signalIds.push(s.id)
      groups.set(normalizationGroup, bucket)
      if (isLanguageNormalizationGroup(normalizationGroup)) {
        languageLocalGroups.add(normalizationGroup)
      }
    }

    const rawScore = weightTotal === 0 ? 1 : weightedSum / weightTotal
    const applicableScores = signalsInCategory.flatMap((s) => {
      const result = signalResults.get(s.id)
      if (result === undefined || signalApplicabilityOf(result) !== "applicable") return []
      return [result.score]
    })
    const lowestSignalScore = Math.min(...applicableScores)
    const normalization =
      languageLocalGroups.size > 1
        ? buildCategoryNormalization(groups)
        : undefined
    const normalizedScore = normalization?.score ?? rawScore
    const pressure = aggregateCategoryPressure(
      pressureInputs,
      categoryAggregationConfigOf(vector),
      pressureInputs,
    )
    const pressureScore = clamp01(1 - pressure.finalPressure)
    const score = roundScore(Math.min(normalizedScore, pressureScore))
    const shapedByPressure = score < normalizedScore
    out[category] = {
      score,
      signals: signalsRecord,
      signalCount: signalsInCategory.length,
      applicableSignalCount,
      activeSignalIds: activeIds,
      aggregation: {
        strategy: normalization === undefined ? "weighted-mean" : "language-group-mean",
        rawScore,
        aggregateScore: normalizedScore,
        lowestSignalScore: Number.isFinite(lowestSignalScore) ? lowestSignalScore : 1,
        finalScore: score,
        shapedByPressure,
        pressure,
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

const aggregateCategoryPressure = (
  inputs: ReadonlyArray<{
    readonly score: number
    readonly weight: number
    readonly confidence: number
  }>,
  config: CategoryAggregationObserverConfig,
  localInputs: ReadonlyArray<{
    readonly score: number
    readonly weight: number
    readonly confidence: number
  }> = inputs,
): NonNullable<CategoryOutput["aggregation"]>["pressure"] => {
  let weightedPressureSum = 0
  let weightedPnormSum = 0
  let weightTotal = 0

  for (const input of inputs) {
    const weight = input.weight
    const pressure = confidenceAdjustedPressure(input.score, input.confidence)
    weightedPressureSum += weight * pressure
    weightedPnormSum += weight * Math.pow(pressure, config.p_norm)
    weightTotal += weight
  }

  let maxLocalPressure = 0
  for (const input of localInputs) {
    maxLocalPressure = Math.max(
      maxLocalPressure,
      confidenceAdjustedPressure(input.score, input.confidence),
    )
  }

  const meanPressure = weightTotal === 0 ? 0 : weightedPressureSum / weightTotal
  const pnormPressure =
    weightTotal === 0
      ? 0
      : Math.pow(weightedPnormSum / weightTotal, 1 / config.p_norm)
  const localPressure = categoryLocalPressure(maxLocalPressure, config)
  const finalPressure = clamp01(Math.max(pnormPressure, localPressure))

  return {
    strategy: "pressure-pnorm-local-max",
    p: config.p_norm,
    meanPressure: roundScore(meanPressure),
    pnormPressure: roundScore(pnormPressure),
    maxLocalPressure: roundScore(maxLocalPressure),
    localPressure: roundScore(localPressure),
    finalPressure: roundScore(finalPressure),
  }
}

const confidenceAdjustedScore = (score: number, confidence: number): number =>
  clamp01(1 - confidenceAdjustedPressure(score, confidence))

const confidenceAdjustedPressure = (score: number, confidence: number): number =>
  clamp01(1 - score) * confidence

const categoryLocalPressure = (
  maxLocalPressure: number,
  config: CategoryAggregationObserverConfig,
): number => {
  if (maxLocalPressure >= config.local_poison_threshold) return maxLocalPressure
  if (maxLocalPressure >= config.local_warning_threshold) {
    return maxLocalPressure * config.local_warning_gain
  }
  return 0
}

/**
 * Count-weighted mean across categories: categories with more applicable
 * evidence signals carry proportionally more weight. Categories without
 * applicable evidence are excluded from both numerator and denominator.
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
    const count = entry.applicableSignalCount ?? entry.signalCount
    if (count === 0) continue
    weightedSum += entry.score * count
    totalCount += count
  }
  if (totalCount === 0) return 1
  return weightedSum / totalCount
}

const computeReadiness = (
  registry: Registry,
  signalResults: ReadonlyMap<string, SignalRunResult>,
  vector: PulsarVector | undefined,
  hardGateStatus: "pass" | "fail",
): ReadinessOutput => {
  const config = readinessConfigOf(vector)
  const pressures: Array<ReadinessPressure> = []
  let weightedPressureSum = 0
  let weightedPnormSum = 0
  let weightTotal = 0
  let maxLocalPressure = 0
  let applicableSignalCount = 0
  let ignoredSignalCount = 0
  let failedSignalCount = 0

  for (const signal of registry.sorted) {
    const result = signalResults.get(signal.id)
    if (result === undefined) continue

    const applicability = signalApplicabilityOf(result)
    const ignored = applicability !== "applicable"
    const confidence = ignored ? 0 : confidenceForSignal(signal, result)
    const weight = vectorWeightOf(signal, vector)
    const rawPressure = clamp01(1 - result.score)
    const effectivePressure = rawPressure * confidence

    pressures.push({
      signal_id: signal.id,
      category: signal.category,
      score: result.score,
      raw_pressure: roundScore(rawPressure),
      effective_pressure: roundScore(effectivePressure),
      weight,
      confidence: roundScore(confidence),
      applicability,
    })

    if (ignored) {
      ignoredSignalCount += 1
      if (applicability === "failed") {
        failedSignalCount += 1
      }
      continue
    }

    applicableSignalCount += 1
    weightedPressureSum += weight * effectivePressure
    weightedPnormSum += weight * Math.pow(effectivePressure, config.p_norm)
    weightTotal += weight
    maxLocalPressure = Math.max(maxLocalPressure, effectivePressure)
  }

  const meanPressure = weightTotal === 0 ? 0 : weightedPressureSum / weightTotal
  const pnormPressure =
    weightTotal === 0
      ? 0
      : Math.pow(weightedPnormSum / weightTotal, 1 / config.p_norm)
  const localPressure = localPoisonPressure(maxLocalPressure, config)
  const failedSignalPressure = failedSignalCount > 0 ? 1 : 0
  const hardGatePressure =
    hardGateStatus === "fail" ? 1 - config.hard_gate_score_cap : 0
  const pressure = roundScore(
    clamp01(Math.max(pnormPressure, localPressure, failedSignalPressure, hardGatePressure)),
  )
  const score = roundScore(clamp01(1 - pressure))

  return {
    score,
    pressure,
    status: readinessStatus(
      pressure,
      hardGateStatus,
      config,
      applicableSignalCount,
      failedSignalCount,
    ),
    aggregation: {
      strategy: "pressure-pnorm-local-max",
      p: config.p_norm,
      mean_pressure: roundScore(meanPressure),
      pnorm_pressure: roundScore(pnormPressure),
      max_local_pressure: roundScore(maxLocalPressure),
      failed_signal_pressure: roundScore(failedSignalPressure),
      hard_gate_pressure: roundScore(hardGatePressure),
      hard_gate_score_cap: config.hard_gate_score_cap,
      local_warning_threshold: config.local_warning_threshold,
      local_poison_threshold: config.local_poison_threshold,
      local_warning_gain: config.local_warning_gain,
      applicable_signal_count: applicableSignalCount,
      ignored_signal_count: ignoredSignalCount,
      failed_signal_count: failedSignalCount,
    },
    top_pressures: pressures
      .sort((left, right) =>
        right.effective_pressure - left.effective_pressure ||
        right.raw_pressure - left.raw_pressure ||
        compareAscii(left.signal_id, right.signal_id),
      )
      .slice(0, config.top_pressures),
  }
}

const confidenceForSignal = (
  signal: ResolvedSignal,
  result: SignalRunResult,
): number =>
  clamp01(
    result.metadata?.effectiveConfidence ??
      result.metadata?.baseConfidence ??
      defaultConfidenceForTier(signal.tier),
  )

const signalApplicabilityOf = (result: SignalRunResult): SignalApplicability =>
  result.metadata?.applicability ?? (result.output === undefined ? "failed" : "applicable")

const defaultConfidenceForTier = (tier: ResolvedSignal["tier"]): number => {
  if (tier === 1) return 1
  if (tier === 1.5) return 0.95
  if (tier === 2) return 0.85
  return 0.5
}

const localPoisonPressure = (
  maxLocalPressure: number,
  config: ReadinessObserverConfig,
): number => {
  if (maxLocalPressure >= config.local_poison_threshold) return maxLocalPressure
  if (maxLocalPressure >= config.local_warning_threshold) {
    return maxLocalPressure * config.local_warning_gain
  }
  return 0
}

const readinessStatus = (
  pressure: number,
  hardGateStatus: "pass" | "fail",
  config: ReadinessObserverConfig,
  applicableSignalCount: number,
  failedSignalCount: number,
): ReadinessOutput["status"] => {
  if (hardGateStatus === "fail") return "blocked"
  if (failedSignalCount > 0) return "failed"
  if (applicableSignalCount === 0) return "unknown"
  if (pressure < config.green_max_pressure) return "green"
  if (pressure < config.red_min_pressure) return "yellow"
  return "red"
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const roundScore = (value: number): number => Number(value.toFixed(12))

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

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
  if (diagnostics.length === 0) return ""
  if (diagnostics.length === 1) return diagnostics[0]!.message
  return `${diagnostics[0]!.message}; ${diagnostics[1]!.message}`
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
