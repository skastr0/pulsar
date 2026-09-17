import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export type ShapeFileMap = Record<string, string>

export type ShapeCandidates = {
  extraction: { a: ShapeFileMap; b: ShapeFileMap; mutant: ShapeFileMap }
  consolidation: { a: ShapeFileMap; b: ShapeFileMap }
  representation: { a: ShapeFileMap; b: ShapeFileMap }
}

const RUNNER = "packages/core/src/runner.ts"
const OBSERVER = "packages/core/src/observer-execution.ts"
const CACHE = "packages/core/src/cache.ts"
const SCORE_EXECUTION = "packages/core/src/scoring-engine-score-execution.ts"

const RUNNER_SUCCESS = `    const metadata = target.outputMetadata?.(out)
    const rawFactorLedger = target.factorLedger?.(out)
    const factorLedger =
      rawFactorLedger === undefined
        ? undefined
        : applySignalFactorPolicy(
            rawFactorLedger,
            makeSignalFactorPolicyContext(target, vector),
          )
    return {
      signalId: target.id,
      score: target.score(out),
      output: out,
      diagnostics: enforceSeverityCeiling(target, target.diagnose(out)),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(factorLedger !== undefined ? { factorLedger } : {}),
    }`

const OBSERVER_SUCCESS = `    const out = result.success
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
      diagnostics: enforceSeverityCeiling(signal, signal.diagnose(out)),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(factorLedger !== undefined ? { factorLedger } : {}),
    }`

const OBSERVER_RUNNER_IMPORT = `import type { SignalRunResult } from "./runner.js"`

const RUNNER_HELPER_INSERTION = `/**
 * Minimal single-invocation scoring runner for one target signal.`

const HELPER = `export const finalizeSignalResult = (
  signal: ResolvedSignal,
  out: unknown,
  factorPolicy: typeof SignalFactorPolicyTag.Service,
): SignalRunResult => {
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
    diagnostics: enforceSeverityCeiling(signal, signal.diagnose(out)),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(factorLedger !== undefined ? { factorLedger } : {}),
  }
}

`

const HELPER_CEILING = `diagnostics: enforceSeverityCeiling(signal, signal.diagnose(out)),`
const MUTANT_DIAGNOSTICS = `diagnostics: signal.diagnose(out),`

const CONSOLIDATION_BLOCK = `interface ObserverBatchResult {
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
    { concurrency: "unbounded" },
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
`

const CONSOLIDATED_EXECUTE = `export const executeObserverSignals = (
  registry: Registry,
  vector: PulsarVector | undefined,
  profile: boolean,
): Effect.Effect<ObserverSignalExecution, never, SignalRequirements> =>
  Effect.gen(function* () {
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
    while (execution.pendingSignals.length > 0) {
      const readySignals = execution.pendingSignals.filter((signal) =>
        signal.inputs.every((input) => execution.processedSignals.has(input.id) || !execution.registryIds.has(input.id)),
      )
      const batch = readySignals.length > 0 ? readySignals : [execution.pendingSignals[0]!]
      const batchIds = new Set(batch.map((signal) => signal.id))
      execution.pendingSignals = execution.pendingSignals.filter((signal) => !batchIds.has(signal.id))
      const outputSnapshot = new Map(execution.outputs)
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
        { concurrency: "unbounded" },
      )
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
    return execution
  })
`

const CACHE_LOOKUP = `interface CacheLookupResult<T> {
  readonly status: "hit" | "miss" | "stale"
  readonly entry?: TieredCacheEntry<T>
  readonly value?: T
  readonly effectiveConfidence?: number
}`

const CACHE_LOOKUP_UNION = `type CacheLookupResult<T> =
  | {
      readonly status: "miss"
      readonly entry?: never
      readonly value?: never
      readonly effectiveConfidence?: number
    }
  | {
      readonly status: "hit" | "stale"
      readonly entry: TieredCacheEntry<T>
      readonly value: T
      readonly effectiveConfidence: number
    }`

const occurrences = (haystack: string, needle: string): number => {
  if (needle.length === 0) throw new Error("empty anchor")
  let count = 0
  let from = 0
  while (true) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) return count
    count += 1
    from = at + needle.length
  }
}

const requireUnique = (source: string, path: string, anchor: string, label: string): void => {
  const count = occurrences(source, anchor)
  if (count !== 1) {
    throw new Error(`Anchor drift (${label}) in ${path}: expected 1 occurrence, found ${count}`)
  }
}

const replaceUnique = (
  source: string,
  path: string,
  anchor: string,
  replacement: string,
  label: string,
): string => {
  requireUnique(source, path, anchor, label)
  return source.replace(anchor, replacement)
}

const readSource = (root: string, path: string): string => readFileSync(resolve(root, path), "utf8")

export function buildShapeCandidates(root: string): ShapeCandidates {
  const runnerA = readSource(root, RUNNER)
  const observerA = readSource(root, OBSERVER)
  const cacheA = readSource(root, CACHE)
  const scoreA = readSource(root, SCORE_EXECUTION)

  requireUnique(runnerA, RUNNER, RUNNER_SUCCESS, "runner success result")
  requireUnique(runnerA, RUNNER, RUNNER_HELPER_INSERTION, "runSignal documentation")
  requireUnique(observerA, OBSERVER, OBSERVER_SUCCESS, "observer success result")
  requireUnique(observerA, OBSERVER, OBSERVER_RUNNER_IMPORT, "observer runner import")
  requireUnique(observerA, OBSERVER, CONSOLIDATION_BLOCK, "observer batch helpers")
  requireUnique(observerA, OBSERVER, "interface ObserverSignalExecution {", "ObserverSignalExecution")
  requireUnique(observerA, OBSERVER, "export const summarizeCalibration =", "summarizeCalibration")
  requireUnique(observerA, OBSERVER, "const runOneSignal = (", "runOneSignal")
  requireUnique(cacheA, CACHE, CACHE_LOOKUP, "CacheLookupResult")
  requireUnique(scoreA, SCORE_EXECUTION, "cached.value!", "readScoreCache value")
  requireUnique(scoreA, SCORE_EXECUTION, "tieredCached.value!", "runSignalWithCache value")

  const runnerB = replaceUnique(
    replaceUnique(runnerA, RUNNER, RUNNER_HELPER_INSERTION, `${HELPER}${RUNNER_HELPER_INSERTION}`, "insert finalizeSignalResult"),
    RUNNER,
    RUNNER_SUCCESS,
    "    return finalizeSignalResult(target, out, makeSignalFactorPolicyContext(target, vector))",
    "runner success call",
  )
  requireUnique(runnerB, RUNNER, HELPER_CEILING, "helper severity ceiling")

  const observerB = replaceUnique(
    replaceUnique(
      replaceUnique(
        replaceUnique(
          observerA,
          OBSERVER,
          OBSERVER_RUNNER_IMPORT,
          `import { finalizeSignalResult, type SignalRunResult } from "./runner.js"`,
          "observer finalize import",
        ),
        OBSERVER,
        OBSERVER_SUCCESS,
        `    const out = result.success
    return finalizeSignalResult(signal, out, factorPolicy)`,
        "observer success call",
      ),
      OBSERVER,
      `import { enforceSeverityCeiling } from "./enforcement.js"\n`,
      "",
      "observer unused enforcement import",
    ),
    OBSERVER,
    "import { applySignalFactorPolicy, makeSignalFactorPolicyContext, SignalFactorPolicyTag } from \"./factor-ledger.js\"",
    "import { makeSignalFactorPolicyContext, SignalFactorPolicyTag } from \"./factor-ledger.js\"",
    "observer unused factor-policy import",
  )

  const runnerMutant = replaceUnique(
    runnerB,
    RUNNER,
    HELPER_CEILING,
    MUTANT_DIAGNOSTICS,
    "mutant remove severity ceiling",
  )

  const observerConsolidated = replaceUnique(
    observerA,
    OBSERVER,
    CONSOLIDATION_BLOCK,
    CONSOLIDATED_EXECUTE,
    "inline observer batches",
  )
  if (observerConsolidated.includes("createObserverSignalExecution")) {
    throw new Error(`Anchor drift (unused helper remains) in ${OBSERVER}`)
  }
  if (observerConsolidated.includes("interface ObserverBatchResult")) {
    throw new Error(`Anchor drift (ObserverBatchResult remains) in ${OBSERVER}`)
  }

  const cacheB = replaceUnique(cacheA, CACHE, CACHE_LOOKUP, CACHE_LOOKUP_UNION, "tagged CacheLookupResult")
  const scoreB = replaceUnique(
    replaceUnique(scoreA, SCORE_EXECUTION, "cached.value!", "cached.value", "drop cached value assertion"),
    SCORE_EXECUTION,
    "tieredCached.value!",
    "tieredCached.value",
    "drop tieredCached value assertion",
  )

  return {
    extraction: {
      a: { [RUNNER]: runnerA, [OBSERVER]: observerA },
      b: { [RUNNER]: runnerB, [OBSERVER]: observerB },
      mutant: { [RUNNER]: runnerMutant, [OBSERVER]: observerB },
    },
    consolidation: {
      a: { [OBSERVER]: observerA },
      b: { [OBSERVER]: observerConsolidated },
    },
    representation: {
      a: { [CACHE]: cacheA, [SCORE_EXECUTION]: scoreA },
      b: { [CACHE]: cacheB, [SCORE_EXECUTION]: scoreB },
    },
  }
}
