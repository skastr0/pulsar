import { Effect } from "effect"
import {
  type CacheKey,
  SignalCacheTag,
  cacheKeyString,
} from "./cache.js"
import type { ResolvedCalibrationContext } from "./calibration.js"
import type {
  ScoringEngineError,
  SignalError,
} from "./errors.js"
import type { Registry } from "./registry.js"
import { runSignal, type SignalRunResult } from "./runner.js"
import { computeConfigHash } from "./scoring-engine-contract.js"
import {
  computeContentHash,
  computeGitRevisionContextHash,
  resolveRange,
} from "./scoring-engine-git.js"
import {
  computeReferenceVersionHash,
  mergeCachedResultMetadata,
} from "./scoring-engine-observer-cache.js"
import type {
  EngineInternals,
  RunWithEnvironment,
  WithCommitWorktree,
} from "./scoring-engine-runtime.js"
import type { Tier } from "./tier.js"
import type { PulsarVector } from "./vector.js"

export const makeScoreCommit = (args: {
  readonly registry: Registry
  readonly vector: PulsarVector | undefined
  readonly internals: EngineInternals
  readonly runWithEnvironment: RunWithEnvironment
  readonly withCommitWorktree: WithCommitWorktree
}) =>
  Effect.fn("ScoringEngine.scoreCommit")(
    function* (repoPath: string, sha: string, signalId: string) {
      yield* Effect.annotateCurrentSpan("sha", sha)
      yield* Effect.annotateCurrentSpan("signalId", signalId)

      const signal = args.registry.byId.get(signalId)
      const canonicalSignalId = signal?.id ?? signalId
      const result = yield* args.withCommitWorktree(repoPath, sha, (worktreePath) =>
        Effect.gen(function* () {
          const contentHash = yield* cacheContentHashForSignal(repoPath, worktreePath, sha, signal)
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

const cacheContentHashForSignal = (
  repoPath: string,
  worktreePath: string,
  sha: string,
  signal: { readonly cacheDependencies?: ReadonlyArray<string> } | undefined,
): Effect.Effect<string, ScoringEngineError, never> =>
  Effect.gen(function* () {
    const contentHash = yield* computeContentHash(repoPath, sha)
    if (!signal?.cacheDependencies?.includes("git-revision-context")) {
      return contentHash
    }
    const revisionContextHash = yield* computeGitRevisionContextHash(worktreePath)
    return `${contentHash}:git-revision-context:${revisionContextHash}`
  })

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
  readonly runWithEnvironment: RunWithEnvironment
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

export const makeScoreRange = (
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
