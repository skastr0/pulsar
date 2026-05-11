import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import {
  decodePulsarVector,
  type PulsarVector,
} from "@skastr0/pulsar-core/vector"
import {
  collectWorktreeChangedHunks,
  type Registry,
  runSignal,
  ScoringEngineLayer,
  ScoringEngineTag,
  type SignalRunResult,
} from "@skastr0/pulsar-core/scoring"
import { createTimeSeriesServices } from "@skastr0/pulsar-core/time-series"
import {
  loadCanonicalReferenceDataEntries,
  makeReferenceData,
} from "@skastr0/pulsar-core/reference-data"
import {
  InMemoryCacheLayer,
  ReferenceDataTag,
  SignalContextTag,
} from "@skastr0/pulsar-core/signal"
import {
  CalibrationContextTag,
  type ResolvedCalibrationContext,
} from "@skastr0/pulsar-core/calibration"
import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import type { TimeSeriesServices } from "@skastr0/pulsar-core/time-series"
import { RustProjectLayer } from "@skastr0/pulsar-rs-pack"
import { TsProjectLayer } from "@skastr0/pulsar-ts-pack"
import { Effect, Layer } from "effect"
import { loadProjectModuleCalibrationContext } from "./runtime-calibration.js"
import {
  readHeadSha,
  resolveRepoRoot,
  withDetachedWorktreeAtRef,
} from "./runtime-git.js"
import {
  buildPulsarRegistry,
  formatReservedRustSignalMessage,
  isReservedRustSignalId,
  collectActiveLanguagePacks,
  validateVectorAgainstPulsarSignals,
} from "./runtime-registry.js"

export {
  readHeadSha,
  resolveRepoRoot,
  withDetachedWorktreeAtRef,
  buildPulsarRegistry,
  formatReservedRustSignalMessage,
  isReservedRustSignalId,
}

interface PulsarRuntimeOptions {
  readonly timeSeries?: {
    readonly enabled?: boolean
  }
  readonly tsProject?: {
    readonly productionOnly?: boolean
  }
  readonly observer?: {
    readonly profile?: boolean
  }
}

interface SignalWorktreeRun {
  readonly repoRoot: string
  readonly gitSha: string
  readonly registry: Registry
  readonly result: SignalRunResult
}

interface ObserverWorktreeRun {
  readonly repoRoot: string
  readonly gitSha: string
  readonly registry: Registry
  readonly result: ObserverOutput
  readonly timeSeries: TimeSeriesServices | undefined
  readonly calibrationContext: ResolvedCalibrationContext | undefined
}

interface PulsarRuntime {
  readonly registry: Registry
  readonly engine: typeof ScoringEngineTag.Service
  readonly timeSeries: TimeSeriesServices | undefined
  readonly calibrationContext: ResolvedCalibrationContext | undefined
}

export const loadPulsarVectorFromPath = (
  vectorPath: string | undefined,
): Effect.Effect<PulsarVector | undefined, Error, never> =>
  Effect.gen(function* () {
    if (vectorPath === undefined) return undefined

    const absolutePath = resolve(vectorPath)
    const raw = yield* Effect.tryPromise({
      try: () => readFile(absolutePath, "utf8"),
      catch: (cause) =>
        new Error(`Failed to read pulsar vector at ${absolutePath}: ${String(cause)}`),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: (cause) =>
        new Error(`Failed to parse pulsar vector JSON at ${absolutePath}: ${String(cause)}`),
    })

    return yield* decodePulsarVector(parsed).pipe(Effect.mapError(asError))
  })

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

export const runSignalInWorktree = (
  repoPath: string,
  signalId: string,
  vector?: PulsarVector,
): Effect.Effect<SignalWorktreeRun, unknown, never> =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const gitSha = yield* readHeadSha(repoRoot)
    const registry: Registry = yield* buildPulsarRegistry(repoRoot)
    if (vector !== undefined) {
      yield* validateVectorAgainstPulsarSignals(vector, repoRoot)
    }

    const worktreeEnvLayer = yield* buildWorktreeEnvLayer(repoRoot, gitSha, signalId)
    const result = yield* (Effect.provide(
      runSignal(registry, signalId, vector),
      worktreeEnvLayer,
    ) as Effect.Effect<SignalRunResult, unknown, never>)

    return { repoRoot, gitSha, registry, result }
  })

export const observeWorktree = (
  repoPath: string,
  vector?: PulsarVector,
  options?: PulsarRuntimeOptions,
): Effect.Effect<ObserverWorktreeRun, unknown, never> =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const gitSha = yield* readHeadSha(repoRoot)
    const { registry, engine, timeSeries, calibrationContext } = yield* makePulsarRuntime(
      repoRoot,
      vector,
      options,
    )
    const result = yield* engine.observeWorktree(repoRoot, gitSha)

    return { repoRoot, gitSha, registry, result, timeSeries, calibrationContext }
  })

export const makePulsarRuntime = (
  repoPath: string,
  vector?: PulsarVector,
  options?: PulsarRuntimeOptions,
): Effect.Effect<PulsarRuntime, unknown, never> =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const registry: Registry = yield* buildPulsarRegistry(repoRoot)
    if (vector !== undefined) {
      yield* validateVectorAgainstPulsarSignals(vector, repoRoot)
    }

    const timeSeries =
      options?.timeSeries?.enabled === true
        ? createTimeSeriesServices(repoRoot)
        : undefined
    const calibrationContext = yield* loadProjectModuleCalibrationContext(repoRoot)

    const activePacks = collectActiveLanguagePacks(registry, vector)
    const scoringEngineLayer = ScoringEngineLayer(
      registry,
      (worktreePath): Layer.Layer<any, unknown, never> =>
        Layer.mergeAll(
          activePacks.typescript
            ? TsProjectLayer(worktreePath, options?.tsProject)
            : Layer.empty,
          activePacks.rust ? RustProjectLayer(worktreePath) : Layer.empty,
        ) as Layer.Layer<any, unknown, never>,
      vector,
      {
        ...(timeSeries === undefined ? {} : { timeSeriesWriter: timeSeries.writer }),
        cacheConfig: { cacheDir: join(repoRoot, ".pulsar", "cache") },
        ...(options?.observer?.profile === true ? { observerProfile: true } : {}),
        ...(calibrationContext === undefined ? {} : { calibrationContext }),
        calibrationContextForWorktree: (worktreePath) =>
          loadProjectModuleCalibrationContext(worktreePath, { dependencyRoot: repoRoot }),
      },
    )
    const engine = yield* Effect.provide(ScoringEngineTag, scoringEngineLayer)
    return { registry, engine, timeSeries, calibrationContext }
  })

const buildWorktreeEnvLayer = (repoRoot: string, gitSha: string, signalId: string) =>
  Effect.gen(function* () {
    const referenceEntries = yield* loadCanonicalReferenceDataEntries(repoRoot)
    const changedHunks = yield* collectWorktreeChangedHunks(repoRoot)
    const calibrationContext = yield* loadProjectModuleCalibrationContext(repoRoot)
    const signalContextLayer = Layer.succeed(SignalContextTag, {
      gitSha,
      worktreePath: repoRoot,
      changedHunks,
    })
    const referenceDataLayer = Layer.succeed(
      ReferenceDataTag,
      makeReferenceData(referenceEntries),
    )
    const calibrationContextLayer =
      calibrationContext === undefined
        ? Layer.empty
        : Layer.succeed(CalibrationContextTag, calibrationContext)

    return Layer.mergeAll(
      signalContextLayer,
      referenceDataLayer,
      InMemoryCacheLayer,
      calibrationContextLayer,
      signalId.startsWith("TS-")
        ? TsProjectLayer(repoRoot, { productionOnly: true })
        : Layer.empty,
      signalId.startsWith("RS-") ? RustProjectLayer(repoRoot) : Layer.empty,
    )
  })
