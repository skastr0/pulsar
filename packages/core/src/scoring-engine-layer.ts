import { Effect, Layer } from "effect"
import {
  InMemoryCacheLayer,
  SignalCacheTag,
  cacheKeyString,
  type CacheConfig,
  type CacheKey,
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
import type {
  ScoringEngineError,
  SignalError,
} from "./errors.js"
import { observe, type ObserverOutput } from "./observer.js"
import { loadCanonicalReferenceDataEntries } from "./reference-data-loader.js"
import type { Registry } from "./registry.js"
import { runSignal, type SignalRunResult } from "./runner.js"
import {
  computeConfigHash,
  ScoringEngineTag,
  type PackLayerFactory,
} from "./scoring-engine-contract.js"
import {
  acquireWorktree,
  canUseCurrentWorktreeForCommit,
  collectWorktreeChangedHunks,
  computeContentHash,
  computeWorktreeContentHash,
  resolveRange,
} from "./scoring-engine-git.js"
import {
  OBSERVER_CACHE_SIGNAL_ID,
  type CachedObserverOutput,
  computeObserverConfigHash,
  computeReferenceVersionHash,
  fromCachedObserverOutput,
  hashChangedHunks,
  mergeCachedResultMetadata,
  nowMs,
  toCachedObserverOutput,
  withRuntimeEnvironmentProfile,
} from "./scoring-engine-observer-cache.js"
import type { TimeSeriesWriter } from "./time-series.js"
import type { Tier } from "./tier.js"
import type { PulsarVector } from "./vector.js"

interface ScoringEngineOptions {
  readonly timeSeriesWriter?: TimeSeriesWriter
  readonly cacheConfig?: CacheConfig
  readonly observerProfile?: boolean
  readonly calibrationContext?: ResolvedCalibrationContext
  readonly calibrationContextForWorktree?: (
    worktreePath: string,
  ) => Effect.Effect<ResolvedCalibrationContext | undefined, unknown, never>
}

interface EngineInternals {
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

/**
 * Build the scoring engine layer. The registry is frozen at layer
 * construction; the cache is created once and shared across every
 * commit scored by this engine instance.
 */
export const ScoringEngineLayer = (
  registry: Registry,
  packLayerFactory: PackLayerFactory,
  vector?: PulsarVector,
  options?: ScoringEngineOptions,
): Layer.Layer<ScoringEngineTag> =>
  Layer.effect(
    ScoringEngineTag,
    Effect.gen(function* () {
      const internals = yield* makeEngineInternals(packLayerFactory, options)
      const runWithEnvironment = makeRunWithEnvironment(internals)
      const withCommitWorktree = makeWithCommitWorktree()
      const observeWithCache = makeObserveWithCache(internals.cacheRef, options)
      const scoreCommit = makeScoreCommit({
        registry,
        vector,
        internals,
        runWithEnvironment,
        withCommitWorktree,
      })
      const observeCommit = makeObserveCommit({
        registry,
        vector,
        options,
        internals,
        runWithEnvironment,
        withCommitWorktree,
        observeWithCache,
      })

      return ScoringEngineTag.of({
        scoreCommit,
        scoreRange: makeScoreRange(scoreCommit),
        observeCommit,
        observeWorktree: makeObserveWorktree({
          registry,
          vector,
          options,
          internals,
          runWithEnvironment,
          observeWithCache,
          observeCommit,
        }),
        observeRange: makeObserveRange(observeCommit),
      })
    }),
  )

const makeEngineInternals = (
  packLayerFactory: PackLayerFactory,
  options?: ScoringEngineOptions,
): Effect.Effect<EngineInternals, never, never> =>
  Effect.gen(function* () {
    const cacheLayer =
      options?.cacheConfig !== undefined
        ? DiskBackedCacheLayer(options.cacheConfig)
        : InMemoryCacheLayer
    const cacheRef = yield* Effect.provide(SignalCacheTag, cacheLayer)
    const calibrationContextCache = new Map<string, ResolvedCalibrationContext | undefined>()
    const resolveCalibrationContext = makeCalibrationResolver(options, calibrationContextCache)

    return {
      cacheRef,
      resolveCalibrationContext,
      makeEnvLayer: makeEnvironmentLayerFactory(cacheRef, packLayerFactory),
    }
  })

const makeCalibrationResolver = (
  options: ScoringEngineOptions | undefined,
  cache: Map<string, ResolvedCalibrationContext | undefined>,
) => (
  worktreePath: string,
): Effect.Effect<ResolvedCalibrationContext | undefined, never, never> =>
  Effect.gen(function* () {
    const factory = options?.calibrationContextForWorktree
    if (factory === undefined) return options?.calibrationContext
    if (cache.has(worktreePath)) return cache.get(worktreePath)
    const resolved = yield* factory(worktreePath).pipe(
      Effect.orDieWith(
        (cause) =>
          new Error(`Failed to resolve calibration context for ${worktreePath}: ${String(cause)}`),
      ),
    )
    cache.set(worktreePath, resolved)
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

const makeRunWithEnvironment = (internals: EngineInternals) => <A, E>(
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
    const EnvLayer = internals.makeEnvLayer(
      worktreePath,
      sha,
      referenceEntries,
      calibrationContext,
      changedHunks,
    )
    return yield* runInWorktree(EnvLayer, referenceEntries)
  })

const makeWithCommitWorktree = () => <A, E>(
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

const makeObserveWithCache = (
  cacheRef: typeof SignalCacheTag.Service,
  options?: ScoringEngineOptions,
) => (
  key: CacheKey,
  runFresh: () => Effect.Effect<ObserverOutput, ScoringEngineError, never>,
): Effect.Effect<
  { readonly result: ObserverOutput; readonly cacheHit: boolean },
  ScoringEngineError,
  never
> =>
  Effect.gen(function* () {
    const cached = yield* cacheRef.getTiered<CachedObserverOutput>(key, { tier: 1 })
    const profile = options?.observerProfile === true
    const cacheHit = !profile && (cached.status === "hit" || cached.status === "stale")
    if (cacheHit) return { result: fromCachedObserverOutput(cached.value!), cacheHit }

    const runtimeStartedAt = nowMs()
    const result = yield* runFresh().pipe(
      Effect.map((fresh) =>
        profile ? withRuntimeEnvironmentProfile(fresh, nowMs() - runtimeStartedAt) : fresh,
      ),
      Effect.tap((fresh) =>
        profile ? Effect.void : cacheRef.setTiered(key, toCachedObserverOutput(fresh), { tier: 1 }),
      ),
    )
    return { result, cacheHit }
  })

const makeScoreCommit = (args: {
  readonly registry: Registry
  readonly vector: PulsarVector | undefined
  readonly internals: EngineInternals
  readonly runWithEnvironment: ReturnType<typeof makeRunWithEnvironment>
  readonly withCommitWorktree: ReturnType<typeof makeWithCommitWorktree>
}) =>
  Effect.fn("ScoringEngine.scoreCommit")(
    function* (repoPath: string, sha: string, signalId: string) {
      yield* Effect.annotateCurrentSpan("sha", sha)
      yield* Effect.annotateCurrentSpan("signalId", signalId)

      const signal = args.registry.byId.get(signalId)
      const canonicalSignalId = signal?.id ?? signalId
      const contentHash = yield* computeContentHash(repoPath, sha)
      const result = yield* args.withCommitWorktree(repoPath, sha, (worktreePath) =>
        Effect.gen(function* () {
          const calibrationContext = yield* args.internals.resolveCalibrationContext(worktreePath)
          const configHash = computeConfigHash(
            canonicalSignalId,
            args.registry,
            args.vector,
            calibrationContext?.fingerprint,
          )
          const key: CacheKey = { signalId: canonicalSignalId, contentHash, configHash }
          const cached = yield* readScoreCache(args.internals.cacheRef, key, signal?.tier)
          if (cached !== undefined) return cached

          return yield* runSignalWithCache({
            registry: args.registry,
            vector: args.vector,
            signalId,
            signalTier: signal?.tier,
            key,
            worktreePath,
            sha,
            calibrationContext,
            runWithEnvironment: args.runWithEnvironment,
            cacheRef: args.internals.cacheRef,
          })
        }),
      )

      yield* Effect.annotateCurrentSpan("cacheHit", false)
      return result
    },
  )

const readScoreCache = (
  cacheRef: typeof SignalCacheTag.Service,
  key: CacheKey,
  tier: Tier | undefined,
): Effect.Effect<SignalRunResult | undefined, never, never> =>
  Effect.gen(function* () {
    if (tier !== undefined && tier !== 1 && tier !== 1.5) return undefined
    const cached = yield* cacheRef.getTiered<SignalRunResult>(key, {
      ...(tier !== undefined ? { tier } : {}),
    })
    if (cached.status !== "hit" && cached.status !== "stale") return undefined
    yield* Effect.annotateCurrentSpan("cacheKey", cacheKeyString(key))
    yield* Effect.annotateCurrentSpan("cacheHit", true)
    return mergeCachedResultMetadata(cached.value!, cached)
  })

const runSignalWithCache = (args: {
  readonly registry: Registry
  readonly vector: PulsarVector | undefined
  readonly signalId: string
  readonly signalTier: Tier | undefined
  readonly key: CacheKey
  readonly worktreePath: string
  readonly sha: string
  readonly calibrationContext: ResolvedCalibrationContext | undefined
  readonly runWithEnvironment: ReturnType<typeof makeRunWithEnvironment>
  readonly cacheRef: typeof SignalCacheTag.Service
}): Effect.Effect<SignalRunResult, SignalError | ScoringEngineError, never> =>
  args.runWithEnvironment(
    args.worktreePath,
    args.sha,
    [],
    args.calibrationContext,
    (EnvLayer, referenceEntries) =>
      Effect.gen(function* () {
        const tierOptions = {
          ...(args.signalTier !== undefined ? { tier: args.signalTier } : {}),
          ...(args.signalTier === 2
            ? { refVersionHash: computeReferenceVersionHash(referenceEntries) }
            : {}),
        }
        const tieredCached = yield* args.cacheRef.getTiered<SignalRunResult>(args.key, tierOptions)
        if (tieredCached.status === "hit" || tieredCached.status === "stale") {
          yield* Effect.annotateCurrentSpan("cacheKey", cacheKeyString(args.key))
          yield* Effect.annotateCurrentSpan("cacheHit", true)
          return mergeCachedResultMetadata(tieredCached.value!, tieredCached)
        }

        const fresh = yield* (Effect.provide(
          runSignal(args.registry, args.signalId, args.vector),
          EnvLayer,
        ) as Effect.Effect<SignalRunResult, SignalError, never>)
        yield* args.cacheRef.setTiered(args.key, fresh, tierOptions)
        return fresh
      }),
  ).pipe(Effect.tap(() => Effect.annotateCurrentSpan("cacheKey", cacheKeyString(args.key))))

const makeScoreRange = (
  scoreCommit: ReturnType<typeof makeScoreCommit>,
) =>
  Effect.fn("ScoringEngine.scoreRange")(
    function* (
      repoPath: string,
      fromSha: string,
      toSha: string,
      signalId: string,
      options?: { concurrency?: number },
    ) {
      yield* Effect.annotateCurrentSpan("fromSha", fromSha)
      yield* Effect.annotateCurrentSpan("toSha", toSha)
      yield* Effect.annotateCurrentSpan("signalId", signalId)
      const shas = yield* resolveRange(repoPath, fromSha, toSha)
      yield* Effect.annotateCurrentSpan("commitCount", shas.length)
      return yield* Effect.forEach(
        shas,
        (sha) => scoreCommit(repoPath, sha, signalId).pipe(
          Effect.map((result) => ({ sha, result })),
        ),
        { concurrency: options?.concurrency ?? 4 },
      )
    },
  )

const makeObserveCommit = (args: {
  readonly registry: Registry
  readonly vector: PulsarVector | undefined
  readonly options: ScoringEngineOptions | undefined
  readonly internals: EngineInternals
  readonly runWithEnvironment: ReturnType<typeof makeRunWithEnvironment>
  readonly withCommitWorktree: ReturnType<typeof makeWithCommitWorktree>
  readonly observeWithCache: ReturnType<typeof makeObserveWithCache>
}) =>
  Effect.fn("ScoringEngine.observeCommit")(
    function* (repoPath: string, sha: string) {
      yield* Effect.annotateCurrentSpan("sha", sha)
      const contentHash = yield* computeContentHash(repoPath, sha)
      const { result, cacheHit, key } = yield* args.withCommitWorktree(repoPath, sha, (worktreePath) =>
        observeCommitInWorktree({ ...args, repoPath, sha, worktreePath, contentHash }),
      )
      yield* Effect.annotateCurrentSpan("cacheKey", cacheKeyString(key))
      yield* Effect.annotateCurrentSpan("cacheHit", cacheHit)
      if (args.options?.timeSeriesWriter !== undefined) {
        yield* args.options.timeSeriesWriter.appendObservation(sha, result)
      }
      return result
    },
  )

const observeCommitInWorktree = (args: {
  readonly registry: Registry
  readonly vector: PulsarVector | undefined
  readonly options: ScoringEngineOptions | undefined
  readonly internals: EngineInternals
  readonly runWithEnvironment: ReturnType<typeof makeRunWithEnvironment>
  readonly observeWithCache: ReturnType<typeof makeObserveWithCache>
  readonly repoPath: string
  readonly sha: string
  readonly worktreePath: string
  readonly contentHash: string
}) =>
  Effect.gen(function* () {
    const calibrationContext = yield* args.internals.resolveCalibrationContext(args.worktreePath)
    const referenceEntries = yield* loadCanonicalReferenceDataEntries(args.worktreePath)
    const key = observerCacheKey(args, calibrationContext, referenceEntries)
    const observed = yield* args.observeWithCache(key, () =>
      args.runWithEnvironment(args.worktreePath, args.sha, [], calibrationContext, (EnvLayer) =>
        Effect.provide(
          observe(args.registry, args.vector, { profile: args.options?.observerProfile === true }),
          EnvLayer,
        ) as Effect.Effect<ObserverOutput, never, never>,
      ),
    )
    return { ...observed, key }
  })

const observerCacheKey = (
  args: {
    readonly registry: Registry
    readonly vector: PulsarVector | undefined
    readonly contentHash: string
  },
  calibrationContext: ResolvedCalibrationContext | undefined,
  referenceEntries: ReadonlyMap<string, unknown>,
): CacheKey => ({
  signalId: OBSERVER_CACHE_SIGNAL_ID,
  contentHash: args.contentHash,
  configHash: computeObserverConfigHash(
    args.registry,
    args.vector,
    calibrationContext?.fingerprint,
    computeReferenceVersionHash(referenceEntries),
  ),
})

const makeObserveWorktree = (args: {
  readonly registry: Registry
  readonly vector: PulsarVector | undefined
  readonly options: ScoringEngineOptions | undefined
  readonly internals: EngineInternals
  readonly runWithEnvironment: ReturnType<typeof makeRunWithEnvironment>
  readonly observeWithCache: ReturnType<typeof makeObserveWithCache>
  readonly observeCommit: ReturnType<typeof makeObserveCommit>
}) =>
  Effect.fn("ScoringEngine.observeWorktree")(
    function* (
      repoPath: string,
      headSha: string,
      worktreeOptions?: { readonly changedHunks?: ReadonlyArray<ChangedHunk> },
    ) {
      yield* Effect.annotateCurrentSpan("sha", headSha)
      const cleanHead = yield* canUseCurrentWorktreeForCommit(repoPath, headSha)
      if (cleanHead) return yield* args.observeCommit(repoPath, headSha)

      const changedHunks =
        worktreeOptions?.changedHunks ?? (yield* collectWorktreeChangedHunks(repoPath))
      const contentHash = `${yield* computeWorktreeContentHash(repoPath)}:${hashChangedHunks(changedHunks)}`
      const calibrationContext = yield* args.internals.resolveCalibrationContext(repoPath)
      const referenceEntries = yield* loadCanonicalReferenceDataEntries(repoPath)
      const key = observerCacheKey({ ...args, contentHash }, calibrationContext, referenceEntries)
      const { result, cacheHit } = yield* args.observeWithCache(key, () =>
        args.runWithEnvironment(repoPath, headSha, changedHunks, calibrationContext, (EnvLayer) =>
          Effect.provide(
            observe(args.registry, args.vector, { profile: args.options?.observerProfile === true }),
            EnvLayer,
          ) as Effect.Effect<ObserverOutput, never, never>,
        ),
      )

      yield* Effect.annotateCurrentSpan("cacheKey", cacheKeyString(key))
      yield* Effect.annotateCurrentSpan("cacheHit", cacheHit)
      return result
    },
  )

const makeObserveRange = (
  observeCommit: ReturnType<typeof makeObserveCommit>,
) =>
  Effect.fn("ScoringEngine.observeRange")(
    function* (
      repoPath: string,
      fromSha: string,
      toSha: string,
      options?: { concurrency?: number },
    ) {
      yield* Effect.annotateCurrentSpan("fromSha", fromSha)
      yield* Effect.annotateCurrentSpan("toSha", toSha)
      const shas = yield* resolveRange(repoPath, fromSha, toSha)
      yield* Effect.annotateCurrentSpan("commitCount", shas.length)
      return yield* Effect.forEach(
        shas,
        (sha) => observeCommit(repoPath, sha).pipe(
          Effect.map((result) => ({ sha, result })),
        ),
        { concurrency: options?.concurrency ?? 4 },
      )
    },
  )
