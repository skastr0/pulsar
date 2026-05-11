import { Effect, Layer } from "effect"
import type { Registry } from "./registry.js"
import {
  ScoringEngineTag,
  type PackLayerFactory,
} from "./scoring-engine-contract.js"
import {
  makeObserveCommit,
  makeObserveRange,
  makeObserveWithCache,
  makeObserveWorktree,
} from "./scoring-engine-observe.js"
import {
  makeEngineInternals,
  makeRunWithEnvironment,
  makeWithCommitWorktree,
  type ScoringEngineOptions,
} from "./scoring-engine-runtime.js"
import {
  makeScoreCommit,
  makeScoreRange,
} from "./scoring-engine-score.js"
import type { PulsarVector } from "./vector.js"

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
