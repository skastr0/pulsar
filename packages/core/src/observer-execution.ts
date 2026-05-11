import { Effect } from "effect"
import type { ResolvedCalibrationContext } from "./calibration.js"
import type { Diagnostic } from "./diagnostic.js"
import { applySignalFactorPolicy, makeSignalFactorPolicyContext, SignalFactorPolicyTag } from "./factor-ledger.js"
import { buildInputOutputs } from "./input-outputs.js"
import type { Registry } from "./registry.js"
import type { SignalRunResult } from "./runner.js"
import type { ResolvedSignal, SignalRequirements } from "./signal.js"
import { isActive as vectorIsActive, resolvedConfig as vectorResolvedConfig, type PulsarVector } from "./vector.js"
import type {
  ObserverCalibrationSummary,
  ObserverRuntimeOutput,
  ObserverRuntimeProfile,
} from "./observer-model.js"
import { nowMs, roundRuntimeMs } from "./observer-time.js"

const DEFAULT_OBSERVER_SIGNAL_CONCURRENCY = 1
type ObserverSignalMetadata = NonNullable<ObserverRuntimeOutput["signalMetadata"]>

interface ObserverSignalExecution {
  readonly outputs: Map<string, unknown>
  readonly signalResults: Map<string, SignalRunResult>
  readonly inactiveSignals: Array<string>
  readonly signalMetadata: ObserverSignalMetadata
  readonly signalProfiles: ObserverRuntimeProfile["signals"]
  readonly processedSignals: Set<string>
  readonly registryIds: Set<string>
  pendingSignals: Array<ResolvedSignal>
}

interface ObserverBatchResult {
  readonly signal: ResolvedSignal
  readonly result: SignalRunResult
  readonly durationMs: number
}

export const executeObserverSignals = (
  registry: Registry,
  vector: PulsarVector | undefined,
  profile: boolean,
): Effect.Effect<ObserverSignalExecution, never, SignalRequirements> =>
  Effect.gen(function* () {
    const execution = createObserverSignalExecution(registry, vector)
    while (execution.pendingSignals.length > 0) {
      const batch = takeNextObserverBatch(execution)
      const batchResults = yield* runObserverSignalBatch(batch, execution.outputs, vector)
      recordObserverBatchResults(execution, batchResults, profile)
    }
    return execution
  })

const createObserverSignalExecution = (
  registry: Registry,
  vector: PulsarVector | undefined,
): ObserverSignalExecution => {
  const execution: ObserverSignalExecution = {
    outputs: new Map(),
    signalResults: new Map(),
    inactiveSignals: [],
    signalMetadata: {},
    signalProfiles: {},
    processedSignals: new Set(),
    registryIds: new Set(registry.sorted.map((signal) => signal.id)),
    pendingSignals: [],
  }
  for (const signal of registry.sorted) {
    if (vectorIsActive(signal, vector)) {
      execution.pendingSignals.push(signal)
    } else {
      execution.inactiveSignals.push(signal.id)
      execution.processedSignals.add(signal.id)
    }
  }
  return execution
}

const takeNextObserverBatch = (
  execution: ObserverSignalExecution,
): ReadonlyArray<ResolvedSignal> => {
  const readySignals = execution.pendingSignals.filter((signal) =>
    signal.inputs.every((input) => execution.processedSignals.has(input.id) || !execution.registryIds.has(input.id)),
  )
  const batch = readySignals.length > 0 ? readySignals : [execution.pendingSignals[0]!]
  const batchIds = new Set(batch.map((signal) => signal.id))
  execution.pendingSignals = execution.pendingSignals.filter((signal) => !batchIds.has(signal.id))
  return batch
}

const runObserverSignalBatch = (
  batch: ReadonlyArray<ResolvedSignal>,
  outputs: ReadonlyMap<string, unknown>,
  vector: PulsarVector | undefined,
): Effect.Effect<ReadonlyArray<ObserverBatchResult>, never, SignalRequirements> => {
  const outputSnapshot = new Map(outputs)
  return Effect.forEach(
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
}

const recordObserverBatchResults = (
  execution: ObserverSignalExecution,
  batchResults: ReadonlyArray<ObserverBatchResult>,
  profile: boolean,
): void => {
  for (const { signal, result, durationMs } of batchResults) {
    if (profile) {
      execution.signalProfiles[signal.id] = {
        durationMs,
        score: result.score,
        diagnostics: result.diagnostics.length,
      }
    }
    if (result.output !== undefined) execution.outputs.set(signal.id, result.output)
    if (result.metadata !== undefined) execution.signalMetadata[signal.id] = result.metadata
    execution.signalResults.set(signal.id, result)
    execution.processedSignals.add(signal.id)
  }
}

export const summarizeCalibration = (
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

/**
 * Run a single signal against the shared outputs map. Compute failures
 * are swallowed into a score-0 result with a synthetic `warn` diagnostic.
 * The observer never crashes on a bad leaf signal.
 */
const runOneSignal = (
  signal: ResolvedSignal,
  outputs: ReadonlyMap<string, unknown>,
  vector: PulsarVector | undefined,
): Effect.Effect<SignalRunResult, never, SignalRequirements> =>
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
