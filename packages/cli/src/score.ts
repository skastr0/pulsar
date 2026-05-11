import {
  CATEGORIES,
  compareToBaseline,
  computeObserverConfigHash,
  explainAiAssistedMode,
  timeSeriesConfigOf,
  type BaselineComparison,
  type Category,
  type ObserverOutput,
  type Registry,
  type PulsarVector,
} from "@skastr0/pulsar-core"
import { Effect } from "effect"
import { readBaselineFile, resolveBaselinePath } from "./baseline-file.js"
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
import { discoverPulsarVector, type DiscoveredPulsarVector } from "./vector-discovery.js"

export interface ScoreOptions {
  readonly repoPath: string
  readonly signalId?: string
  readonly vectorPath?: string
  readonly json?: boolean
  readonly category?: Category
  readonly ci?: boolean
  readonly profile?: boolean
}

export interface CiAssessment {
  readonly mode:
    | "disabled"
    | "missing-baseline"
    | "observer-config-mismatch"
    | "ratcheted"
  readonly effectiveStatus: "pass" | "fail"
  readonly baselineSha?: string
  readonly baselineVectorId?: string
  readonly currentVectorId?: string
  readonly baselineObserverConfigHash?: string
  readonly currentObserverConfigHash?: string
  readonly comparison?: BaselineComparison
  readonly baselinePath?: string
}

export const runScoreCommand = (opts: ScoreOptions) =>
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

const narrowVectorToCategory = (
  registry: Registry,
  vector: PulsarVector | undefined,
  category: Category,
  fallbackDomain: string,
): PulsarVector => {
  const activeSignalIds = collectCategorySignalClosure(registry, category, vector, fallbackDomain)
  const signal_overrides: Record<string, PulsarVector["signal_overrides"][string]> = {
    ...(vector?.signal_overrides ?? {}),
  }

  for (const signal of registry.sorted) {
    if (activeSignalIds.has(signal.id)) continue
    signal_overrides[signal.id] = {
      ...(signal_overrides[signal.id] ?? {}),
      active: false,
    }
  }

  return {
    id: vector?.id ?? `category-${category}`,
    domain: vector?.domain ?? fallbackDomain,
    ...(vector?.description !== undefined ? { description: vector.description } : {}),
    signal_overrides,
    ...(vector?.review_routing !== undefined ? { review_routing: vector.review_routing } : {}),
    ...(vector?.observer !== undefined ? { observer: vector.observer } : {}),
    ...(vector?.backpressure !== undefined ? { backpressure: vector.backpressure } : {}),
    ...(vector?.provenance !== undefined ? { provenance: vector.provenance } : {}),
    ...(vector?.modes !== undefined ? { modes: vector.modes } : {}),
  }
}

const narrowVectorToDomain = (
  registry: Registry,
  vector: PulsarVector | undefined,
  fallbackDomain: string,
): PulsarVector => {
  const domain = vector?.domain ?? fallbackDomain
  const signal_overrides: Record<string, PulsarVector["signal_overrides"][string]> = {
    ...(vector?.signal_overrides ?? {}),
  }

  for (const signal of registry.sorted) {
    if (signalMatchesDomain(signal.id, domain)) continue
    signal_overrides[signal.id] = {
      ...(signal_overrides[signal.id] ?? {}),
      active: false,
    }
  }

  return {
    id: vector?.id ?? "all-defaults",
    domain,
    ...(vector?.description !== undefined ? { description: vector.description } : {}),
    signal_overrides,
    ...(vector?.review_routing !== undefined ? { review_routing: vector.review_routing } : {}),
    ...(vector?.observer !== undefined ? { observer: vector.observer } : {}),
    ...(vector?.backpressure !== undefined ? { backpressure: vector.backpressure } : {}),
    ...(vector?.provenance !== undefined ? { provenance: vector.provenance } : {}),
    ...(vector?.modes !== undefined ? { modes: vector.modes } : {}),
  }
}

const collectCategorySignalClosure = (
  registry: Registry,
  category: Category,
  vector: PulsarVector | undefined,
  fallbackDomain: string,
): ReadonlySet<string> => {
  const activeSignalIds = new Set<string>()
  const domain = vector?.domain ?? fallbackDomain

  const visit = (signalId: string): void => {
    if (activeSignalIds.has(signalId)) return
    const signal = registry.byId.get(signalId)
    if (signal === undefined) return
    if (!signalMatchesDomain(signal.id, domain)) return
    activeSignalIds.add(signalId)
    for (const input of signal.inputs) {
      visit(input.id)
    }
  }

  for (const signal of registry.sorted) {
    if (!signalMatchesDomain(signal.id, domain)) continue
    if (signal.category === category) {
      visit(signal.id)
    }
  }

  return activeSignalIds
}

const signalMatchesDomain = (signalId: string, domain: string | undefined): boolean => {
  if (domain === "typescript" && signalId.startsWith("RS-")) return false
  if (domain === "rust" && signalId.startsWith("TS-")) return false
  return true
}

const inferFallbackDomain = (registry: Registry): "typescript" | "rust" | "polyglot" => {
  const hasTypeScript = registry.sorted.some((signal) => signal.id.startsWith("TS-"))
  const hasRust = registry.sorted.some((signal) => signal.id.startsWith("RS-"))
  if (hasTypeScript && hasRust) return "polyglot"
  if (hasRust) return "rust"
  return "typescript"
}

const runSingleSignalMode = (opts: ScoreOptions) =>
  Effect.gen(function* () {
    const registry = yield* buildPulsarRegistry(opts.repoPath)
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

const assessCiMode = (
  opts: ScoreOptions,
  repoRoot: string,
  output: ObserverOutput,
  registry: Registry,
  vector: PulsarVector,
  calibrationFingerprint: string | undefined,
) =>
  Effect.gen(function* () {
    if (opts.ci !== true) {
      return {
        mode: "disabled",
        effectiveStatus: output.hard_gate_status,
      } satisfies CiAssessment
    }

    const baseline = yield* readBaselineFile(repoRoot)
    if (baseline === undefined) {
      return {
        mode: "missing-baseline",
        effectiveStatus: "pass",
        baselinePath: resolveBaselinePath(repoRoot),
      } satisfies CiAssessment
    }

    const currentObserverConfigHash = computeObserverConfigHash(
      registry,
      vector,
      calibrationFingerprint,
    )
    if (
      baseline.observer_config_hash !== undefined &&
      baseline.observer_config_hash !== currentObserverConfigHash
    ) {
      return {
        mode: "observer-config-mismatch",
        effectiveStatus: "fail",
        baselineSha: baseline.baseline_sha,
        ...(baseline.vector_id !== undefined ? { baselineVectorId: baseline.vector_id } : {}),
        currentVectorId: vector.id,
        baselineObserverConfigHash: baseline.observer_config_hash,
        currentObserverConfigHash,
      } satisfies CiAssessment
    }

    const comparison = compareToBaseline(baseline, output.hard_gate_violations, {
      canonicalSignalId: registry.canonicalIdOf,
    })
    return {
      mode: "ratcheted",
      effectiveStatus: comparison.newViolations.length > 0 ? "fail" : "pass",
      baselineSha: baseline.baseline_sha,
      ...(baseline.vector_id !== undefined ? { baselineVectorId: baseline.vector_id } : {}),
      currentVectorId: vector.id,
      comparison,
    } satisfies CiAssessment
  })
