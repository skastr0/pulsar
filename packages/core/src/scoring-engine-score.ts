import { Effect } from "effect"
import type { Registry } from "./registry.js"
import { resolveRange } from "./scoring-engine-git.js"
import {
  scoreSignalCommit,
  type ScoreCommit,
  type ScoreRange,
} from "./scoring-engine-score-execution.js"
import type {
  EngineInternals,
  RunWithEnvironment,
  WithCommitWorktree,
} from "./scoring-engine-runtime.js"
import type { PulsarVector } from "./vector.js"

export const makeScoreCommit = (args: {
  readonly registry: Registry
  readonly vector: PulsarVector | undefined
  readonly internals: EngineInternals
  readonly runWithEnvironment: RunWithEnvironment
  readonly withCommitWorktree: WithCommitWorktree
}): ScoreCommit =>
  Effect.fn("ScoringEngine.scoreCommit")(
    function* (repoPath: string, sha: string, signalId: string) {
      yield* Effect.annotateCurrentSpan("sha", sha)
      yield* Effect.annotateCurrentSpan("signalId", signalId)

      const result = yield* args.withCommitWorktree(repoPath, sha, (worktreePath) =>
        scoreSignalCommit({
          registry: args.registry,
          vector: args.vector,
          internals: args.internals,
          signalId,
          repoPath,
          worktreePath,
          sha,
          runWithEnvironment: args.runWithEnvironment,
        }),
      )

      yield* Effect.annotateCurrentSpan("cacheHit", false)
      return result
    },
  )

export const makeScoreRange = (
  scoreCommit: ScoreCommit,
): ScoreRange =>
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
