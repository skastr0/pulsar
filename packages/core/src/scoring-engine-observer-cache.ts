import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib"
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
import type { SignalApplicability } from "./signal.js"
import { rememberCachedSignalApplicability } from "./observer-score-utils.js"

export const OBSERVER_CACHE_SIGNAL_ID = "__observer__"
export const OBSERVER_CACHE_MAX_SIGNAL_BYTES = 50 * 1024 * 1024

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
  readonly signalResults: ReadonlyArray<CachedSignalRunResult>
  readonly signalMetadata?: ObserverOutput["signalMetadata"]
  readonly calibration?: ObserverOutput["calibration"]
}

interface CachedSignalRunResult {
  readonly signalId: string
  readonly score: number
  readonly diagnostics: SignalRunResult["diagnostics"]
  readonly metadata?: SignalRunResult["metadata"]
  readonly applicability?: SignalApplicability
  readonly factorLedger?: SignalRunResult["factorLedger"]
  readonly output?: SignalRunResult["output"]
  readonly compressedOutput?: string
}

const OUTPUT_COMPRESSION_THRESHOLD_BYTES = 1_024
const OUTPUT_COMPRESSION_QUALITY = 4

export const OBSERVER_AGGREGATION_CACHE_VERSION =
  "observer-aggregation-v10-evidence-bounded-authority-compact-results"

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
        evidenceClass: signal.evidenceClass,
        enforcement: signal.enforcement,
        factorDefinitions: signal.factorDefinitions ?? [],
        factorOverrides: factorOverridesOf(signal, vector),
        inputs:
          signal.kind === "compound"
            ? signal.inputs.map((input) => ({
                id: input.id,
                optional: input.optional === true,
                cacheFingerprint: input.cacheFingerprint ?? null,
                signal: observerSignalConfigPayload(
                  input.id,
                  registry,
                  vector,
                  new Set([signal.id]),
                ),
              }))
            : [],
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

const observerSignalConfigPayload = (
  signalId: string,
  registry: Registry,
  vector: PulsarVector | undefined,
  seen: Set<string>,
): unknown => {
  const signal = registry.byId.get(signalId)
  if (signal === undefined) return null
  if (seen.has(signal.id)) return { id: signal.id, cycle: true }
  seen.add(signal.id)
  return {
    id: signal.id,
    category: signal.category,
    config: vectorResolvedConfig(signal, signal.defaultConfig, vector),
    cacheVersion: signal.cacheVersion ?? null,
    evidenceClass: signal.evidenceClass,
    enforcement: signal.enforcement,
    factorDefinitions: signal.factorDefinitions ?? [],
    factorOverrides: factorOverridesOf(signal, vector),
    inputs:
      signal.kind === "compound"
        ? signal.inputs.map((input) => ({
            id: input.id,
            optional: input.optional === true,
            cacheFingerprint: input.cacheFingerprint ?? null,
            signal: observerSignalConfigPayload(
              input.id,
              registry,
              vector,
              new Set(seen),
            ),
          }))
        : [],
    kind: signal.kind,
    normalizationGroup: signal.normalizationGroup ?? null,
    tier: signal.tier,
    weight: vectorWeightOf(signal, vector),
  }
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
  signalResults: [...result.signalResults.values()].map(toCachedSignalRunResult),
  ...(result.signalMetadata !== undefined ? { signalMetadata: result.signalMetadata } : {}),
  ...(result.calibration !== undefined ? { calibration: result.calibration } : {}),
})

const toCachedSignalRunResult = (result: SignalRunResult): CachedSignalRunResult => ({
  signalId: result.signalId,
  score: result.score,
  diagnostics: result.diagnostics,
  ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),
  applicability:
    result.metadata?.applicability ??
    (result.output === undefined ? "failed" : "applicable"),
  ...(result.factorLedger !== undefined ? { factorLedger: result.factorLedger } : {}),
  ...cachedSignalRunResultOutput(result.output),
})

const cachedSignalRunResultOutput = (
  output: SignalRunResult["output"],
): Pick<CachedSignalRunResult, "output" | "compressedOutput"> => {
  if (output === undefined) return {}
  const serialized = JSON.stringify(output)
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf8") < OUTPUT_COMPRESSION_THRESHOLD_BYTES
  ) {
    return { output }
  }
  const compressedOutput = brotliCompressSync(Buffer.from(serialized, "utf8"), {
    params: { [constants.BROTLI_PARAM_QUALITY]: OUTPUT_COMPRESSION_QUALITY },
  }).toString("base64")
  return Buffer.byteLength(JSON.stringify(compressedOutput), "utf8") <
    Buffer.byteLength(serialized, "utf8")
    ? { compressedOutput }
    : { output }
}

const decodeSignalRunResultOutput = (encodedOutput: unknown): unknown | undefined => {
  if (typeof encodedOutput !== "string") return encodedOutput
  try {
    return JSON.parse(
      brotliDecompressSync(Buffer.from(encodedOutput, "base64")).toString("utf8"),
    )
  } catch (cause) {
    const error = new Error("Failed to decode cached observer signal output")
    error.cause = cause
    throw error
  }
}

const makeSignalRunResultOutput = (cached: CachedSignalRunResult): (() => unknown) => {
  let output: unknown
  let loaded = false
  return () => {
    if (!loaded) {
      output = cached.compressedOutput === undefined
        ? cached.output
        : decodeSignalRunResultOutput(cached.compressedOutput)
      loaded = true
    }
    return output
  }
}

export const fromCachedObserverOutput = (cached: CachedObserverOutput): ObserverOutput => ({
  observer_semantics: cached.observer_semantics ?? OBSERVER_OUTPUT_SEMANTICS,
  categories: cached.categories,
  minimum: cached.minimum,
  weighted_mean: cached.weighted_mean,
  ...(cached.readiness !== undefined ? { readiness: cached.readiness } : {}),
  hard_gate_status: cached.hard_gate_status,
  hard_gate_violations: cached.hard_gate_violations,
  inactiveSignals: cached.inactiveSignals,
  signalResults: new Map(
    cached.signalResults.map((result) => [
      result.signalId,
      (() => {
        const getOutput = makeSignalRunResultOutput(result)
        const restored: SignalRunResult = {
          signalId: result.signalId,
          score: result.score,
          get output() {
            return getOutput()
          },
          diagnostics: result.diagnostics,
          ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),
          ...(result.factorLedger !== undefined ? { factorLedger: result.factorLedger } : {}),
        }
        return rememberCachedSignalApplicability(restored, result.applicability)
      })(),
    ]),
  ),
  ...(cached.signalMetadata !== undefined ? { signalMetadata: cached.signalMetadata } : {}),
  ...(cached.calibration !== undefined ? { calibration: cached.calibration } : {}),
})

export const computeReferenceVersionHash = (
  referenceEntries: ReadonlyMap<string, unknown>,
): string => {
  const normalized = [...referenceEntries.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  ).map(([key, value]) => [key, normalizeReferenceVersionValue(value)] as const)
  return createHash("sha256").update(stableStringify(normalized)).digest("hex")
}

const normalizeReferenceVersionValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeReferenceVersionValue)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "sourcePath")
        .map(([key, nested]) => [key, normalizeReferenceVersionValue(nested)]),
    )
  }
  return value
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
