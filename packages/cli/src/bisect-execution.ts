import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  type ObserverOutput,
  type SignalRunResult,
} from "@skastr0/pulsar-core"
import { Effect } from "effect"
import {
  chooseAdaptiveMidpoint,
  chooseObserverAdaptiveMidpoint,
  sampleTrajectory,
  type BisectSamplingMode,
  type BisectSamplingSummary,
  type RangeCommit,
} from "./bisect-sampling.js"
import { toObserverCurveSample } from "./bisect-observer-convert.js"
import type {
  CommitScore,
  ObserverCurveSample,
} from "./bisect-types.js"

const execFileAsync = promisify(execFile)

export const resolveBisectCommits = (
  repoPath: string,
  fromSha: string,
  toSha: string,
): Effect.Effect<ReadonlyArray<RangeCommit>, Error> =>
  Effect.tryPromise({
    try: async () => {
      const result = await execFileAsync(
        "git",
        ["rev-list", "--reverse", "--parents", `${fromSha}..${toSha}`],
        { cwd: repoPath },
      )
      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const parts = line.split(/\s+/)
          return {
            sha: parts[0]!,
            parentCount: Math.max(0, parts.length - 1),
          }
        })
    },
    catch: (cause) => new Error(`git rev-list ${fromSha}..${toSha} failed: ${String(cause)}`),
  })

export const sampleSignalTrajectory = (
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  hasFirstCrossing: boolean,
  concurrency: number,
  scoreCommit: (sha: string) => Effect.Effect<SignalRunResult, unknown, never>,
): Effect.Effect<
  { readonly trajectory: ReadonlyArray<CommitScore>; readonly sampling: BisectSamplingSummary },
  unknown,
  never
> =>
  sampleTrajectory(
    commits,
    requested,
    hasFirstCrossing,
    concurrency,
    scoreCommit,
    (sha, result) => ({
      sha,
      score: result.score,
      diagnosticsCount: result.diagnostics.length,
      firstDiagnostic: result.diagnostics[0]?.message,
    }),
    (leftIndex, rightIndex, leftEntry, rightEntry) =>
      chooseAdaptiveMidpoint(leftIndex, rightIndex, leftEntry.score, rightEntry.score),
  )

export const sampleObserverTrajectory = (
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  hasFirstCrossing: boolean,
  concurrency: number,
  observeCommit: (sha: string) => Effect.Effect<ObserverOutput, unknown, never>,
): Effect.Effect<
  {
    readonly trajectory: ReadonlyArray<ObserverCurveSample>
    readonly sampling: BisectSamplingSummary
  },
  unknown,
  never
> =>
  sampleTrajectory(
    commits,
    requested,
    hasFirstCrossing,
    concurrency,
    observeCommit,
    toObserverCurveSample,
    chooseObserverAdaptiveMidpoint,
  )
