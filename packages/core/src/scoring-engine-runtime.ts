import { Effect, Layer } from "effect"
import {
  InMemoryCacheLayer,
  SignalCacheTag,
  type CacheConfig,
} from "./cache.js"
import { DiskBackedCacheLayer } from "./cache-disk.js"
import {
  CalibrationContextTag,
  type ResolvedCalibrationContext,
} from "./calibration.js"
import {
  type ChangedHunk,
  ReferenceDataTag,
  SignalContextTag,
  makeReferenceData,
} from "./context.js"
import type { ScoringEngineError } from "./errors.js"
import { loadCanonicalReferenceDataEntries } from "./reference-data-loader.js"
import type { PackLayerFactory } from "./scoring-engine-contract.js"
import {
  acquireWorktree,
  canUseCurrentWorktreeForCommit,
} from "./scoring-engine-git.js"
import type { TimeSeriesWriter } from "./time-series.js"

export interface ScoringEngineOptions {
  readonly timeSeriesWriter?: TimeSeriesWriter
  readonly cacheConfig?: CacheConfig
  readonly observerProfile?: boolean
  readonly calibrationContext?: ResolvedCalibrationContext
  readonly calibrationContextForWorktree?: (
    worktreePath: string,
  ) => Effect.Effect<ResolvedCalibrationContext | undefined, unknown, never>
}

export interface EngineInternals {
  readonly cacheRef: typeof SignalCacheTag.Service
  readonly resolveCalibrationContext: (
    worktreePath: string,
  ) => Effect.Effect<ResolvedCalibrationContext | undefined, never, never>
  readonly makeEnvLayer: (
    worktreePath: string,
    sha: string,
    referenceEntries: ReadonlyMap<string, unknown>,
    calibrationContext: ResolvedCalibrationContext | undefined,
    changedHunks?: ReadonlyArray<ChangedHunk>,
  ) => Layer.Layer<any, unknown, never>
}

export type RunWithEnvironment = <A, E>(
  worktreePath: string,
  sha: string,
  changedHunks: ReadonlyArray<ChangedHunk>,
  calibrationContext: ResolvedCalibrationContext | undefined,
  runInWorktree: (
    envLayer: Layer.Layer<any, unknown, never>,
    referenceEntries: ReadonlyMap<string, unknown>,
  ) => Effect.Effect<A, E, never>,
) => Effect.Effect<A, E | ScoringEngineError, never>

export type WithCommitWorktree = <A, E>(
  repoPath: string,
  sha: string,
  runInWorktree: (worktreePath: string) => Effect.Effect<A, E, never>,
) => Effect.Effect<A, E | ScoringEngineError, never>

export const makeEngineInternals = (
  packLayerFactory: PackLayerFactory,
  options?: ScoringEngineOptions,
): Effect.Effect<EngineInternals, never, never> =>
  Effect.gen(function* () {
    const cacheLayer =
      options?.cacheConfig !== undefined
        ? DiskBackedCacheLayer(options.cacheConfig)
        : InMemoryCacheLayer
    const cacheRef = yield* Effect.provide(SignalCacheTag, cacheLayer)
    const resolveCalibrationContext = makeCalibrationResolver(options)

    return {
      cacheRef,
      resolveCalibrationContext,
      makeEnvLayer: makeEnvironmentLayerFactory(cacheRef, packLayerFactory),
    }
  })

const makeCalibrationResolver = (
  options: ScoringEngineOptions | undefined,
) => (
  worktreePath: string,
): Effect.Effect<ResolvedCalibrationContext | undefined, never, never> =>
  Effect.gen(function* () {
    const factory = options?.calibrationContextForWorktree
    if (factory === undefined) return options?.calibrationContext
    const resolved = yield* factory(worktreePath).pipe(
      Effect.orDieWith(
        (cause) =>
          new Error(`Failed to resolve calibration context for ${worktreePath}: ${String(cause)}`),
      ),
    )
    return resolved
  })

const makeEnvironmentLayerFactory = (
  cacheRef: typeof SignalCacheTag.Service,
  packLayerFactory: PackLayerFactory,
) => (
  worktreePath: string,
  sha: string,
  referenceEntries: ReadonlyMap<string, unknown>,
  calibrationContext: ResolvedCalibrationContext | undefined,
  changedHunks: ReadonlyArray<ChangedHunk> = [],
): Layer.Layer<any, unknown, never> =>
  Layer.mergeAll(
    Layer.succeed(SignalContextTag, { gitSha: sha, worktreePath, changedHunks }),
    Layer.succeed(ReferenceDataTag, makeReferenceData(referenceEntries)),
    Layer.succeed(SignalCacheTag, cacheRef),
    calibrationContext === undefined
      ? Layer.empty
      : Layer.succeed(CalibrationContextTag, calibrationContext),
    packLayerFactory(worktreePath),
  )

export const makeRunWithEnvironment = (internals: EngineInternals): RunWithEnvironment => <A, E>(
  worktreePath: string,
  sha: string,
  changedHunks: ReadonlyArray<ChangedHunk>,
  calibrationContext: ResolvedCalibrationContext | undefined,
  runInWorktree: (
    envLayer: Layer.Layer<any, unknown, never>,
    referenceEntries: ReadonlyMap<string, unknown>,
  ) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E | ScoringEngineError, never> =>
  Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan("worktreePath", worktreePath)
    const referenceEntries = yield* loadCanonicalReferenceDataEntries(worktreePath)
    const envLayer = internals.makeEnvLayer(
      worktreePath,
      sha,
      referenceEntries,
      calibrationContext,
      changedHunks,
    )
    return yield* runInWorktree(envLayer, referenceEntries)
  })

export const makeWithCommitWorktree = (): WithCommitWorktree => <A, E>(
  repoPath: string,
  sha: string,
  runInWorktree: (worktreePath: string) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E | ScoringEngineError, never> =>
  Effect.gen(function* () {
    const useCurrentWorktree = yield* canUseCurrentWorktreeForCommit(repoPath, sha)
    if (useCurrentWorktree) return yield* runInWorktree(repoPath)
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const worktreePath = yield* acquireWorktree(repoPath, sha)
        return yield* runInWorktree(worktreePath)
      }),
    )
  })
