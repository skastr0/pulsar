import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import {
  CalibrationContextTag,
  InMemoryCacheLayer,
  ReferenceDataTag,
  ScoringEngineLayer,
  ScoringEngineTag,
  SignalContextTag,
  collectWorktreeChangedHunks,
  createTimeSeriesServices,
  decodePulsarVector,
  loadCanonicalReferenceDataEntries,
  makeReferenceData,
  runSignal,
  type Registry,
  type SignalRunResult,
  type PulsarVector,
} from "@skastr0/pulsar-core"
import { RustProjectLayer } from "@skastr0/pulsar-rs-pack"
import { TsProjectLayer } from "@skastr0/pulsar-ts-pack"
import { Effect, Layer } from "effect"
import { loadProjectModuleCalibrationContext } from "./runtime-calibration.js"
import {
  readHeadSha,
  resolveGitRef,
  resolveRepoRoot,
  withDetachedWorktreeAtRef,
} from "./runtime-git.js"
import {
  buildPulsarRegistry,
  collectActiveLanguagePacks,
  formatReservedRustSignalMessage,
  isReservedRustSignalId,
  PULSAR_SHARED_SIGNALS,
  PULSAR_SIGNALS,
  validateVectorAgainstPulsarSignals,
} from "./runtime-registry.js"

export {
  loadProjectModuleCalibrationContext,
  readHeadSha,
  resolveGitRef,
  resolveRepoRoot,
  withDetachedWorktreeAtRef,
  buildPulsarRegistry,
  formatReservedRustSignalMessage,
  isReservedRustSignalId,
  PULSAR_SHARED_SIGNALS,
  PULSAR_SIGNALS,
}

export interface PulsarRuntimeOptions {
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

export const loadPulsarVectorFromPath = (vectorPath: string | undefined) =>
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

    return yield* decodePulsarVector(parsed)
  })

export const runSignalInWorktree = (
  repoPath: string,
  signalId: string,
  vector?: PulsarVector,
) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const gitSha = yield* readHeadSha(repoRoot)
    const registry: Registry = yield* buildPulsarRegistry(repoRoot)
    if (vector !== undefined) {
      yield* validateVectorAgainstPulsarSignals(vector, repoRoot)
    }

    const EnvLayer = yield* buildWorktreeEnvLayer(repoRoot, gitSha, signalId)
    const result = yield* (Effect.provide(
      runSignal(registry, signalId, vector),
      EnvLayer,
    ) as Effect.Effect<SignalRunResult, unknown, never>)

    return { repoRoot, gitSha, registry, result }
  })

export const observeWorktree = (
  repoPath: string,
  vector?: PulsarVector,
  options?: PulsarRuntimeOptions,
) =>
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
) =>
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
    const EngineLayer = ScoringEngineLayer(
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
        calibrationContextForWorktree: loadProjectModuleCalibrationContext,
      },
    )
    const engine = yield* Effect.provide(ScoringEngineTag, EngineLayer)
    return { registry, engine, timeSeries, calibrationContext }
  })

const buildWorktreeEnvLayer = (repoRoot: string, gitSha: string, signalId: string) =>
  Effect.gen(function* () {
    const referenceEntries = yield* loadCanonicalReferenceDataEntries(repoRoot)
    const changedHunks = yield* collectWorktreeChangedHunks(repoRoot)
    const calibrationContext = yield* loadProjectModuleCalibrationContext(repoRoot)
    const ContextLayer = Layer.succeed(SignalContextTag, {
      gitSha,
      worktreePath: repoRoot,
      changedHunks,
    })
    const ReferenceLayer = Layer.succeed(
      ReferenceDataTag,
      makeReferenceData(referenceEntries),
    )
    const CalibrationLayer =
      calibrationContext === undefined
        ? Layer.empty
        : Layer.succeed(CalibrationContextTag, calibrationContext)

    return Layer.mergeAll(
      ContextLayer,
      ReferenceLayer,
      InMemoryCacheLayer,
      CalibrationLayer,
      signalId.startsWith("TS-")
        ? TsProjectLayer(repoRoot, { productionOnly: true })
        : Layer.empty,
      signalId.startsWith("RS-") ? RustProjectLayer(repoRoot) : Layer.empty,
    )
  })
