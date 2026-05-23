import {
  explainAiAssistedMode,
  type PulsarVector,
  timeSeriesConfigOf,
} from "@skastr0/pulsar-core/vector"
import { type ObserverOutput } from "@skastr0/pulsar-core/observer"
import { type Registry } from "@skastr0/pulsar-core/scoring"
import {
  CATEGORIES,
  type Category,
} from "@skastr0/pulsar-core/signal"
import { Effect } from "effect"
import {
  buildPulsarRegistry,
  formatReservedRustSignalMessage,
  isReservedRustSignalId,
  observeWorktree,
  runSignalInWorktree,
} from "./runtime.js"
import {
  printCiSummary,
  printPaidDebt,
} from "./score-ci-output.js"
import {
  printCategoryView,
  printObserverView,
} from "./score-observer-output.js"
import { printSignalResult } from "./score-signal-output.js"
import { toScoreJson } from "./score-json.js"
import { assessCiMode, type CiAssessment } from "./score-ci-assessment.js"
import { inferFallbackDomain, narrowVectorToCategory, narrowVectorToDomain } from "./score-vector.js"
import { discoverPulsarVector, type DiscoveredPulsarVector } from "./vector-discovery.js"

export type { CiAssessment } from "./score-ci-assessment.js"

export interface ScoreOptions {
  readonly repoPath: string
  readonly signalId?: string
  readonly vectorPath?: string
  readonly json?: boolean
  readonly category?: Category
  readonly ci?: boolean
  readonly profile?: boolean
}

export const runScoreCommand = (opts: ScoreOptions): Effect.Effect<number, unknown, never> =>
  Effect.gen(function* () {
    yield* validateScoreOptions(opts)

    if (opts.signalId !== undefined) {
      return yield* runSingleSignalMode(opts)
    }

    return yield* runObserverScoreMode(opts)
  })

interface ScoreVectorContext {
  readonly registry: Registry
  readonly vectorSelection: DiscoveredPulsarVector
  readonly observerVector: PulsarVector
}

interface ObserverScoreRun {
  readonly repoRoot: string
  readonly gitSha: string
  readonly output: ObserverOutput
  readonly calibrationFingerprint: string | undefined
}

const runObserverScoreMode = (opts: ScoreOptions) =>
  Effect.gen(function* () {
    const vectorContext = yield* resolveScoreVectorContext(opts)
    const run = yield* observeScoreWorktree(opts, vectorContext.observerVector)
    yield* ensureObserverHasActiveSignals(run.output)
    const ciAssessment = yield* assessCiMode(
      opts,
      run.repoRoot,
      run.output,
      vectorContext.registry,
      vectorContext.observerVector,
      run.calibrationFingerprint,
    )
    printScoreCommandOutput(opts, vectorContext, run, ciAssessment)
    return scoreCommandExitCode(opts, run, ciAssessment)
  })

const resolveScoreVectorContext = (opts: ScoreOptions) =>
  Effect.gen(function* () {
    const registry = yield* buildPulsarRegistry(opts.repoPath)
    const vectorSelection = yield* discoverPulsarVector({
      repoPath: opts.repoPath,
      registry,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
    })
    const fallbackDomain = inferFallbackDomain(registry)
    const observerVector =
      opts.category === undefined
        ? narrowVectorToDomain(registry, vectorSelection.vector, fallbackDomain)
        : narrowVectorToCategory(registry, vectorSelection.vector, opts.category, fallbackDomain)
    return { registry, vectorSelection, observerVector } satisfies ScoreVectorContext
  })

const observeScoreWorktree = (
  opts: ScoreOptions,
  observerVector: PulsarVector,
): Effect.Effect<ObserverScoreRun, unknown, never> =>
  Effect.gen(function* () {
    const timeSeriesEnabled = opts.ci === true || timeSeriesConfigOf(observerVector).enabled
    const observed = yield* observeWorktree(opts.repoPath, observerVector, {
      ...(timeSeriesEnabled ? { timeSeries: { enabled: true } } : {}),
      ...(opts.profile === true ? { observer: { profile: true } } : {}),
      tsProject: { productionOnly: true },
    })
    return {
      repoRoot: observed.repoRoot,
      gitSha: observed.gitSha,
      output: observed.result,
      calibrationFingerprint: observed.calibrationContext?.fingerprint,
    }
  })

const ensureObserverHasActiveSignals = (
  output: ObserverOutput,
): Effect.Effect<void, Error, never> => {
  const activeSignalCount = CATEGORIES.reduce(
    (sum, category) => sum + output.categories[category].signalCount,
    0,
  )
  return activeSignalCount === 0
    ? Effect.fail(new Error("Observer mode has no active signals."))
    : Effect.void
}

const printScoreCommandOutput = (
  opts: ScoreOptions,
  vectorContext: ScoreVectorContext,
  run: ObserverScoreRun,
  ciAssessment: CiAssessment,
): void => {
  const paidDebt = ciAssessment.mode === "ratcheted"
    ? ciAssessment.comparison?.paidDebt ?? []
    : []
  if (!opts.json && paidDebt.length > 0) {
    printPaidDebt(paidDebt)
  }

  if (opts.json) {
    console.log(JSON.stringify(toScoreJson(run.output, vectorContext.vectorSelection), null, 2))
  } else if (opts.category !== undefined) {
    printCategoryView({
      repoRoot: run.repoRoot,
      gitSha: run.gitSha,
      category: opts.category,
      output: run.output,
      vectorLabel: vectorContext.vectorSelection.label,
      vectorSourceLabel: vectorContext.vectorSelection.sourceLabel,
      aiMode: explainAiAssistedMode(vectorContext.vectorSelection.vector),
      profile: opts.profile === true,
    })
  } else {
    printObserverView({
      repoRoot: run.repoRoot,
      gitSha: run.gitSha,
      output: run.output,
      vectorLabel: vectorContext.vectorSelection.label,
      vectorSourceLabel: vectorContext.vectorSelection.sourceLabel,
      aiMode: explainAiAssistedMode(vectorContext.vectorSelection.vector),
      ciAssessment,
      colorize: process.stdout.isTTY === true && opts.ci !== true,
      profile: opts.profile === true,
    })
  }
}

const scoreCommandExitCode = (
  opts: ScoreOptions,
  run: ObserverScoreRun,
  ciAssessment: CiAssessment,
): number => {
  if (opts.ci !== true) return 0
  printCiSummary({
    repoRoot: run.repoRoot,
    gitSha: run.gitSha,
    output: run.output,
    ciAssessment,
  })
  return ciAssessment.effectiveStatus === "fail" ? 2 : 0
}

const runSingleSignalMode = (opts: ScoreOptions) =>
  Effect.gen(function* () {
    const registry = yield* buildPulsarRegistry(opts.repoPath, {
      includeSignalId: opts.signalId!,
    })
    if (!registry.has(opts.signalId!)) {
      if (isReservedRustSignalId(opts.signalId!)) {
        console.log(formatReservedRustSignalMessage(opts.signalId!))
        return 0
      }
      return yield* Effect.fail(new Error(`Unknown signal id: ${opts.signalId}`))
    }

    const vectorSelection = yield* discoverPulsarVector({
      repoPath: opts.repoPath,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
      registry,
    })

    const { repoRoot, gitSha, result } = yield* runSignalInWorktree(
      opts.repoPath,
      opts.signalId!,
      vectorSelection.vector,
    )

    printSignalResult(
      result.signalId,
      result.score,
      result.diagnostics,
      result.output,
      result.factorLedger,
      repoRoot,
      gitSha,
      vectorSelection.sourceLabel,
    )
    return 0
  })

const validateScoreOptions = (opts: ScoreOptions): Effect.Effect<void, Error> => {
  if (opts.signalId !== undefined) {
    if (opts.json === true) {
      return Effect.fail(new Error("pulsar score --json is only supported in full Observer mode"))
    }
    if (opts.category !== undefined) {
      return Effect.fail(new Error("pulsar score --category is only supported in full Observer mode"))
    }
    if (opts.ci === true) {
      return Effect.fail(new Error("pulsar score --ci is only supported in full Observer mode"))
    }
    if (opts.profile === true) {
      return Effect.fail(new Error("pulsar score --profile is only supported in full Observer mode"))
    }
  }

  if (opts.category !== undefined && (opts.json === true || opts.ci === true)) {
    return Effect.fail(new Error("--category cannot be combined with --json or --ci"))
  }

  return Effect.void
}
