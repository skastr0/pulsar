import { createHash } from "node:crypto"
import type { ChangedHunk } from "./context.js"
import {
  OBSERVER_OUTPUT_SEMANTICS,
  type ObserverOutput,
} from "./observer.js"
import { roundRuntimeMs } from "./observer-time.js"
import type { Registry } from "./registry.js"
import type { SignalRunResult } from "./runner.js"
import { stableStringify } from "./scoring-engine-contract.js"
import {
  categoryAggregationConfigOf,
  factorOverridesOf,
  isActive as vectorIsActive,
  readinessConfigOf,
  resolvedConfig as vectorResolvedConfig,
  weightOf as vectorWeightOf,
  type PulsarVector,
} from "./vector.js"

export const OBSERVER_CACHE_SIGNAL_ID = "__observer__"

export { nowMs } from "./observer-time.js"

export interface CachedObserverOutput {
  readonly observer_semantics?: ObserverOutput["observer_semantics"]
  readonly categories: ObserverOutput["categories"]
  readonly minimum: ObserverOutput["minimum"]
  readonly weighted_mean: ObserverOutput["weighted_mean"]
  readonly readiness?: ObserverOutput["readiness"]
  readonly hard_gate_status: ObserverOutput["hard_gate_status"]
  readonly hard_gate_violations: ObserverOutput["hard_gate_violations"]
  readonly inactiveSignals: ObserverOutput["inactiveSignals"]
  readonly signalResults: ReadonlyArray<SignalRunResult>
  readonly signalMetadata?: ObserverOutput["signalMetadata"]
  readonly calibration?: ObserverOutput["calibration"]
}

const OBSERVER_AGGREGATION_CACHE_VERSION =
  "observer-aggregation-v4-category-pressure-applicability"

export const computeObserverConfigHash = (
  registry: Registry,
  vector: PulsarVector | undefined,
  calibrationFingerprint?: string,
  referenceVersionHash?: string,
): string => {
  const activeSignals = registry.sorted
    .filter((signal) => vectorIsActive(signal, vector))
    .map((signal) => [
      signal.id,
      {
        category: signal.category,
        config: vectorResolvedConfig(signal, signal.defaultConfig, vector),
        cacheVersion: signal.cacheVersion ?? null,
        enforcement: signal.enforcement,
        factorDefinitions: signal.factorDefinitions ?? [],
        factorOverrides: factorOverridesOf(signal, vector),
        kind: signal.kind,
        normalizationGroup: signal.normalizationGroup ?? null,
        tier: signal.tier,
        weight: vectorWeightOf(signal, vector),
      },
    ])
  const observerConfig = {
    diffTimeIntegration: vector?.observer?.diffTimeIntegration ?? true,
    categoryAggregation: categoryAggregationConfigOf(vector),
    readiness: readinessConfigOf(vector),
  }
  const optionalFingerprints = {
    ...(calibrationFingerprint !== undefined ? { calibrationFingerprint } : {}),
    ...(referenceVersionHash !== undefined ? { referenceVersionHash } : {}),
  }
  return createHash("sha256")
    .update(
      stableStringify({
        activeSignals,
        ...optionalFingerprints,
        observerAggregationVersion: OBSERVER_AGGREGATION_CACHE_VERSION,
        observerConfig,
      }),
    )
    .digest("hex")
}

export const toCachedObserverOutput = (result: ObserverOutput): CachedObserverOutput => ({
  observer_semantics: result.observer_semantics,
  categories: result.categories,
  minimum: result.minimum,
  weighted_mean: result.weighted_mean,
  ...(result.readiness !== undefined ? { readiness: result.readiness } : {}),
  hard_gate_status: result.hard_gate_status,
  hard_gate_violations: result.hard_gate_violations,
  inactiveSignals: result.inactiveSignals,
  signalResults: [...result.signalResults.values()],
  ...(result.signalMetadata !== undefined ? { signalMetadata: result.signalMetadata } : {}),
  ...(result.calibration !== undefined ? { calibration: result.calibration } : {}),
})

export const fromCachedObserverOutput = (cached: CachedObserverOutput): ObserverOutput => ({
  observer_semantics: cached.observer_semantics ?? OBSERVER_OUTPUT_SEMANTICS,
  categories: cached.categories,
  minimum: cached.minimum,
  weighted_mean: cached.weighted_mean,
  ...(cached.readiness !== undefined ? { readiness: cached.readiness } : {}),
  hard_gate_status: cached.hard_gate_status,
  hard_gate_violations: cached.hard_gate_violations,
  inactiveSignals: cached.inactiveSignals,
  signalResults: new Map(cached.signalResults.map((result) => [result.signalId, result])),
  ...(cached.signalMetadata !== undefined ? { signalMetadata: cached.signalMetadata } : {}),
  ...(cached.calibration !== undefined ? { calibration: cached.calibration } : {}),
})

export const computeReferenceVersionHash = (
  referenceEntries: ReadonlyMap<string, unknown>,
): string => {
  const normalized = [...referenceEntries.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )
  return createHash("sha256").update(stableStringify(normalized)).digest("hex")
}

export const hashChangedHunks = (changedHunks: ReadonlyArray<ChangedHunk>): string => {
  const normalized = [...changedHunks].sort((left, right) =>
    `${left.file}:${left.oldStart}:${left.newStart}`.localeCompare(
      `${right.file}:${right.oldStart}:${right.newStart}`,
    ),
  )
  return createHash("sha256").update(stableStringify(normalized)).digest("hex")
}

export const mergeCachedResultMetadata = (
  result: SignalRunResult,
  cached: {
    readonly status: "hit" | "miss" | "stale"
    readonly effectiveConfidence?: number
    readonly entry?: {
      readonly tier: number
      readonly baseConfidence: number
      readonly computedAt: string
    }
  },
): SignalRunResult => {
  if (
    cached.effectiveConfidence === undefined ||
    cached.entry === undefined ||
    cached.entry.tier !== 3
  ) {
    return result
  }

  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      effectiveConfidence: cached.effectiveConfidence,
      baseConfidence: cached.entry.baseConfidence,
      computedAt: cached.entry.computedAt,
      stale: cached.status === "stale",
    },
  }
}

export const withRuntimeEnvironmentProfile = (
  output: ObserverOutput,
  environmentDurationMs: number,
): ObserverOutput => {
  if (output.runtimeProfile === undefined) return output

  const totalMs = roundRuntimeMs(environmentDurationMs)
  const observerMs = output.runtimeProfile.totalMs
  const setupMs = roundRuntimeMs(totalMs - observerMs)
  return {
    ...output,
    runtimeProfile: {
      ...output.runtimeProfile,
      totalMs,
      stages: {
        ...(output.runtimeProfile.stages ?? {}),
        "environment-setup": { durationMs: setupMs },
        observer: { durationMs: observerMs },
      },
    },
  }
}
