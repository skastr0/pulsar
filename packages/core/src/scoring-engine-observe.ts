import { Effect } from "effect"
import {
  type CacheKey,
  type SignalCache,
  cacheKeyString,
} from "./cache.js"
import type { ChangedHunk, SignalAssessmentScope } from "./context.js"
import type { ScoringEngineError } from "./errors.js"
import { observe, type ObserverOutput } from "./observer.js"
import { loadCanonicalReferenceDataEntries } from "./reference-data-loader.js"
import type { Registry } from "./registry.js"
import {
  computeObserverConfigHash,
  computeReferenceVersionHash,
  fromCachedObserverOutput,
  hashChangedHunks,
  OBSERVER_CACHE_SIGNAL_ID,
  toCachedObserverOutput,
  type CachedObserverOutput,
  nowMs,
  withRuntimeEnvironmentProfile,
} from "./scoring-engine-observer-cache.js"
import {
  canUseCurrentWorktreeForCommit,
  collectWorktreeChangedHunks,
  computeContentHash,
  computeGitRevisionContextHash,
  computeWorktreeContentHash,
  resolveRange,
} from "./scoring-engine-git.js"
import type {
  EngineInternals,
  RunWithEnvironment,
  WithCommitWorktree,
} from "./scoring-engine-runtime.js"
import type { PulsarVector } from "./vector.js"

const GIT_REVISION_CONTEXT_CACHE_DEPENDENCY = "git-revision-context"

type ObserveWithCache = (
  key: CacheKey,
  runFresh: () => Effect.Effect<ObserverOutput, ScoringEngineError, never>,
) => Effect.Effect<
  { readonly result: ObserverOutput; readonly cacheHit: boolean },
  ScoringEngineError,
  never
>

type ObserveCommit = (
  repoPath: string,
  sha: string,
) => Effect.Effect<ObserverOutput, ScoringEngineError, never>

type ObserveWorktree = (
  repoPath: string,
  headSha: string,
  worktreeOptions?: {
    readonly changedHunks?: ReadonlyArray<ChangedHunk>
    readonly assessmentScope?: SignalAssessmentScope
  },
) => Effect.Effect<ObserverOutput, ScoringEngineError, never>

type ObserveRange = (
  repoPath: string,
  fromSha: string,
  toSha: string,
  options?: { concurrency?: number },
) => Effect.Effect<
  ReadonlyArray<{ readonly sha: string; readonly result: ObserverOutput }>,
  ScoringEngineError,
  never
>

interface ObserveEngineOptions {
  readonly observerProfile?: boolean
  readonly timeSeriesWriter?: {
    readonly appendObservation: (
      sha: string,
      observerOutput: ObserverOutput,
    ) => Effect.Effect<unknown, ScoringEngineError, never>
  }
}

export const makeObserveWithCache = (
  cacheRef: SignalCache,
  options?: ObserveEngineOptions,
): ObserveWithCache => (
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

export const makeObserveCommit = (args: {
  readonly registry: Registry
  readonly vector: PulsarVector | undefined
  readonly options: ObserveEngineOptions | undefined
  readonly internals: EngineInternals
  readonly runWithEnvironment: RunWithEnvironment
  readonly withCommitWorktree: WithCommitWorktree
  readonly observeWithCache: ObserveWithCache
}): ObserveCommit =>
  Effect.fn("ScoringEngine.observeCommit")(
    function* (repoPath: string, sha: string) {
      yield* Effect.annotateCurrentSpan("sha", sha)
      const { result, cacheHit, key } = yield* args.withCommitWorktree(repoPath, sha, (worktreePath) =>
        Effect.gen(function* () {
          const contentHash = yield* observerContentHash(args.registry, repoPath, worktreePath, sha)
          return yield* observeCommitInWorktree({ ...args, repoPath, sha, worktreePath, contentHash })
        }),
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
  readonly options: ObserveEngineOptions | undefined
  readonly internals: EngineInternals
  readonly runWithEnvironment: RunWithEnvironment
  readonly observeWithCache: ObserveWithCache
  readonly repoPath: string
  readonly sha: string
  readonly worktreePath: string
  readonly contentHash: string
}) =>
  Effect.gen(function* () {
    const calibrationContext = yield* args.internals.resolveCalibrationContext(args.worktreePath)
    const referenceEntries = yield* loadCanonicalReferenceDataEntries(args.worktreePath)
    const key = observerCacheKey(args, calibrationContext?.fingerprint, referenceEntries)
    const observed = yield* args.observeWithCache(key, () =>
      args.runWithEnvironment(args.worktreePath, args.sha, [], undefined, calibrationContext, (EnvLayer) =>
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
  calibrationFingerprint: string | undefined,
  referenceEntries: ReadonlyMap<string, unknown>,
): CacheKey => ({
  signalId: OBSERVER_CACHE_SIGNAL_ID,
  contentHash: args.contentHash,
  configHash: computeObserverConfigHash(
    args.registry,
    args.vector,
    calibrationFingerprint,
    computeReferenceVersionHash(referenceEntries),
  ),
})

export const makeObserveWorktree = (args: {
  readonly registry: Registry
  readonly vector: PulsarVector | undefined
  readonly options: ObserveEngineOptions | undefined
  readonly internals: EngineInternals
  readonly runWithEnvironment: RunWithEnvironment
  readonly observeWithCache: ObserveWithCache
  readonly observeCommit: ObserveCommit
}): ObserveWorktree =>
  Effect.fn("ScoringEngine.observeWorktree")(
    function* (
      repoPath: string,
      headSha: string,
      worktreeOptions?: {
        readonly changedHunks?: ReadonlyArray<ChangedHunk>
        readonly assessmentScope?: SignalAssessmentScope
      },
    ) {
      yield* Effect.annotateCurrentSpan("sha", headSha)
      const cleanHead = yield* canUseCurrentWorktreeForCommit(repoPath, headSha)
      if (cleanHead) return yield* args.observeCommit(repoPath, headSha)

      const changedHunks =
        worktreeOptions?.changedHunks ?? (yield* collectWorktreeChangedHunks(repoPath))
      const assessmentScope = worktreeOptions?.assessmentScope
      const baseContentHash =
        `${yield* computeWorktreeContentHash(repoPath)}:${hashChangedHunks(changedHunks)}:${assessmentScope ?? "whole-repo"}`
      const contentHash = yield* appendObserverRevisionContext(args.registry, repoPath, baseContentHash)
      const calibrationContext = yield* args.internals.resolveCalibrationContext(repoPath)
      const referenceEntries = yield* loadCanonicalReferenceDataEntries(repoPath)
      const key = observerCacheKey(
        { ...args, contentHash },
        calibrationContext?.fingerprint,
        referenceEntries,
      )
      const { result, cacheHit } = yield* args.observeWithCache(key, () =>
        args.runWithEnvironment(repoPath, headSha, changedHunks, assessmentScope, calibrationContext, (EnvLayer) =>
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

const observerContentHash = (
  registry: Registry,
  repoPath: string,
  worktreePath: string,
  sha: string,
): Effect.Effect<string, ScoringEngineError, never> =>
  Effect.gen(function* () {
    const contentHash = yield* computeContentHash(repoPath, sha)
    return yield* appendObserverRevisionContext(registry, worktreePath, contentHash)
  })

const appendObserverRevisionContext = (
  registry: Registry,
  worktreePath: string,
  contentHash: string,
): Effect.Effect<string, ScoringEngineError, never> =>
  Effect.gen(function* () {
    if (
      !registry.sorted.some((signal) =>
        signal.cacheDependencies?.includes(GIT_REVISION_CONTEXT_CACHE_DEPENDENCY),
      )
    ) {
      return contentHash
    }
    const revisionContextHash = yield* computeGitRevisionContextHash(worktreePath)
    return `${contentHash}:${GIT_REVISION_CONTEXT_CACHE_DEPENDENCY}:${revisionContextHash}`
  })

export const makeObserveRange = (
  observeCommit: ObserveCommit,
): ObserveRange =>
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
