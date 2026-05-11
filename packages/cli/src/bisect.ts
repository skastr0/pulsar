import { existsSync } from "node:fs"
import { resolve } from "node:path"
import {
  isActive as vectorIsActive,
  type PulsarVector,
  timeSeriesConfigOf,
} from "@skastr0/pulsar-core/vector"
import { type Registry } from "@skastr0/pulsar-core/scoring"
import { Effect } from "effect"
import { loadPulsarVectorFromPath, makePulsarRuntime } from "./runtime.js"
import {
  printHumanReport,
  printJsonReport,
  printObserverHumanReport,
} from "./bisect-output.js"
import {
  resolveBisectCommits,
  sampleObserverTrajectory,
  sampleSignalTrajectory,
} from "./bisect-execution.js"
import {
  buildObserverReport,
  observerReportOptions,
} from "./bisect-observer-report.js"
import { buildSignalBisectReport } from "./bisect-signal-report.js"
import type {
  BisectCommandRuntime,
  BisectOptions,
  SignalBisectOptions,
} from "./bisect-types.js"

export {
  chooseAdaptiveMidpoint,
  chooseObserverAdaptiveMidpoint,
  initialAdaptiveIndexes,
  resolveSamplingPlan,
  selectMergeOnlyIndexes,
} from "./bisect-sampling.js"
export type {
  BisectSamplingMode,
  BisectSamplingSummary,
  RangeCommit,
} from "./bisect-sampling.js"
export { countFinalApplicableSignalsByCategory } from "./bisect-output.js"
export {
  findCulprits,
  findDriftCulprits,
  findFirstCrossing,
} from "./bisect-signal-report.js"
export type {
  BisectOptions,
  BisectReport,
  CategoryTrajectory,
  CommitScore,
  Culprit,
  FirstCrossingQuery,
  FirstCrossingResult,
  ObserverBisectReport,
  ObserverCommitEntry,
  ObserverCommitMinimum,
  ObserverCurveSet,
  SignalTrajectory,
} from "./bisect-types.js"

export const runBisectCommand = (opts: BisectOptions) =>
  Effect.gen(function* () {
    const repoPath = resolve(opts.repoPath)
    if (!existsSync(repoPath)) {
      return yield* Effect.fail(new Error(`Path does not exist: ${repoPath}`))
    }

    const vector = yield* loadPulsarVectorFromPath(opts.vectorPath)
    const { engine, registry } = yield* makePulsarRuntime(repoPath, vector, {
      timeSeries: {
        enabled: opts.observer === true || opts.signalId === undefined || timeSeriesConfigOf(vector).enabled,
      },
    })
    const observerMode = opts.observer === true || opts.signalId === undefined

    const runtime = { engine, registry, vector, repoPath }
    return observerMode
      ? yield* runObserverBisect(opts, runtime)
      : yield* runSignalBisect({ ...opts, signalId: opts.signalId! }, runtime)
  })

const runObserverBisect = (
  opts: BisectOptions,
  runtime: BisectCommandRuntime,
): Effect.Effect<void, unknown, never> =>
  Effect.gen(function* () {
    yield* ensureObserverHasActiveSignals(runtime.registry, runtime.vector)
    const started = Date.now()
    const commits = yield* resolveBisectCommits(runtime.repoPath, opts.fromSha, opts.toSha)
    const sampled = yield* sampleObserverTrajectory(
      commits,
      opts.sampling,
      opts.firstCrossing !== undefined,
      opts.concurrency,
      (sha) => runtime.engine.observeCommit(runtime.repoPath, sha),
    )
    const report = buildObserverReport(sampled.trajectory, observerReportOptions(opts, runtime, sampled.sampling))
    if (opts.json) return printJsonReport(report)
    printObserverHumanReport(report, Date.now() - started, report.finalApplicableSignalCount)
  })

const runSignalBisect = (
  opts: SignalBisectOptions,
  runtime: BisectCommandRuntime,
): Effect.Effect<void, unknown, never> =>
  Effect.gen(function* () {
    const started = Date.now()
    const commits = yield* resolveBisectCommits(runtime.repoPath, opts.fromSha, opts.toSha)
    const sampled = yield* sampleSignalTrajectory(
      commits,
      opts.sampling,
      opts.firstCrossing !== undefined,
      opts.concurrency,
      (sha) => runtime.engine.scoreCommit(runtime.repoPath, sha, opts.signalId),
    )
    const report = buildSignalBisectReport(opts, runtime.repoPath, sampled)
    if (opts.json) return printJsonReport(report)
    printHumanReport(report, Date.now() - started)
  })

const ensureObserverHasActiveSignals = (
  registry: Registry,
  vector: PulsarVector | undefined,
): Effect.Effect<void, Error, never> =>
  Effect.sync(() =>
    registry.sorted.filter((signal) => vectorIsActive(signal, vector)).map((signal) => signal.id),
  ).pipe(
    Effect.flatMap((activeSignalIds) =>
      activeSignalIds.length > 0
        ? Effect.void
        : Effect.fail(
            new Error(
              `Observer mode has no active signals${vector?.id ? ` for vector ${vector.id}` : ""}.`,
            ),
          ),
    ),
  )
