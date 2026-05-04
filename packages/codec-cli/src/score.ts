import {
  CATEGORIES,
  compareToBaseline,
  computeObserverConfigHash,
  explainAiAssistedMode,
  timeSeriesConfigOf,
  toObserverJson,
  type AiAssistedModeExplanation,
  type BaselineComparison,
  type CalibrationDecision,
  type Category,
  type Diagnostic,
  type ObserverOutput,
  type Registry,
  type TasteVector,
} from "@taste-codec/core"
import { Effect } from "effect"
import { isAbsolute, relative } from "node:path"
import { readBaselineFile, resolveBaselinePath } from "./baseline-file.js"
import {
  buildCodecRegistry,
  formatReservedRustSignalMessage,
  isReservedRustSignalId,
  observeWorktree,
  runSignalInWorktree,
} from "./runtime.js"
import { discoverTasteVector, type DiscoveredTasteVector } from "./vector-discovery.js"

export interface ScoreOptions {
  readonly repoPath: string
  readonly signalId?: string
  readonly vectorPath?: string
  readonly json?: boolean
  readonly category?: Category
  readonly ci?: boolean
  readonly profile?: boolean
}

interface CiAssessment {
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

const CATEGORY_LABELS: Record<Category, string> = {
  "architectural-drift": "Architectural Drift",
  "dependency-entropy": "Dependency Entropy",
  "abstraction-bloat": "Abstraction Bloat",
  "legibility-decay": "Legibility Decay",
  "generated-slop": "Generated Slop",
  "review-pain": "Review Pain",
}

const TOP_FINDINGS_LIMIT = 5
const TOP_FINDING_HEALTHY_SCORE_CUTOFF = 0.995
const DIAGNOSTIC_DETAIL_MAX_LENGTH = 220

export const runScoreCommand = (opts: ScoreOptions) =>
  Effect.gen(function* () {
    yield* validateScoreOptions(opts)

    if (opts.signalId !== undefined) {
      return yield* runSingleSignalMode(opts)
    }

    const registry = yield* buildCodecRegistry(opts.repoPath)
    const vectorSelection = yield* discoverTasteVector({
      repoPath: opts.repoPath,
      registry,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
    })
    const fallbackDomain = inferFallbackDomain(registry)
    const observerVector =
      opts.category === undefined
        ? narrowVectorToDomain(registry, vectorSelection.vector, fallbackDomain)
        : narrowVectorToCategory(registry, vectorSelection.vector, opts.category, fallbackDomain)
    const timeSeriesEnabled = opts.ci === true || timeSeriesConfigOf(observerVector).enabled
    const { repoRoot, gitSha, result, calibrationContext } = yield* observeWorktree(
      opts.repoPath,
      observerVector,
      {
        ...(timeSeriesEnabled ? { timeSeries: { enabled: true } } : {}),
        ...(opts.profile === true ? { observer: { profile: true } } : {}),
        tsProject: { productionOnly: true },
      },
    )

    const activeSignalCount = CATEGORIES.reduce(
      (sum, category) => sum + result.categories[category].signalCount,
      0,
    )
    if (activeSignalCount === 0) {
      return yield* Effect.fail(new Error("Observer mode has no active signals."))
    }

    const ciAssessment = yield* assessCiMode(
      opts,
      repoRoot,
      result,
      registry,
      observerVector,
      calibrationContext?.fingerprint,
    )
    const paidDebt = ciAssessment.mode === "ratcheted"
      ? ciAssessment.comparison?.paidDebt ?? []
      : []
    if (!opts.json && paidDebt.length > 0) {
      printPaidDebt(paidDebt)
    }

    if (opts.json) {
      console.log(JSON.stringify(toScoreJson(result, vectorSelection), null, 2))
    } else if (opts.category !== undefined) {
      printCategoryView({
        repoRoot,
        gitSha,
        category: opts.category,
        output: result,
        vectorLabel: vectorSelection.label,
        vectorSourceLabel: vectorSelection.sourceLabel,
        aiMode: explainAiAssistedMode(vectorSelection.vector),
        profile: opts.profile === true,
      })
    } else {
      printObserverView({
        repoRoot,
        gitSha,
        output: result,
        vectorLabel: vectorSelection.label,
        vectorSourceLabel: vectorSelection.sourceLabel,
        aiMode: explainAiAssistedMode(vectorSelection.vector),
        ciAssessment,
        colorize: process.stdout.isTTY === true && opts.ci !== true,
        profile: opts.profile === true,
      })
    }

    if (opts.ci === true) {
      printCiSummary({
        repoRoot,
        gitSha,
        output: result,
        ciAssessment,
      })
      return ciAssessment.effectiveStatus === "fail" ? 2 : 0
    }

    return 0
  })

const narrowVectorToCategory = (
  registry: Registry,
  vector: TasteVector | undefined,
  category: Category,
  fallbackDomain: string,
): TasteVector => {
  const activeSignalIds = collectCategorySignalClosure(registry, category, vector, fallbackDomain)
  const signal_overrides: Record<string, TasteVector["signal_overrides"][string]> = {
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
  vector: TasteVector | undefined,
  fallbackDomain: string,
): TasteVector => {
  const domain = vector?.domain ?? fallbackDomain
  const signal_overrides: Record<string, TasteVector["signal_overrides"][string]> = {
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
  vector: TasteVector | undefined,
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

const toScoreJson = (
  output: ObserverOutput,
  vectorSelection: DiscoveredTasteVector,
): ReturnType<typeof toObserverJson> & {
  readonly vector: {
    readonly id: string
    readonly source: DiscoveredTasteVector["source"]
    readonly trust_boundary: DiscoveredTasteVector["trustBoundary"]
    readonly source_label: string
    readonly path?: string
  }
} => ({
  ...toObserverJson(output),
  vector: {
    id: vectorSelection.label,
    source: vectorSelection.source,
    trust_boundary: vectorSelection.trustBoundary,
    source_label: vectorSelection.sourceLabel,
    ...(vectorSelection.path !== undefined ? { path: vectorSelection.path } : {}),
  },
})

const runSingleSignalMode = (opts: ScoreOptions) =>
  Effect.gen(function* () {
    const registry = yield* buildCodecRegistry(opts.repoPath)
    if (!registry.has(opts.signalId!)) {
      if (isReservedRustSignalId(opts.signalId!)) {
        console.log(formatReservedRustSignalMessage(opts.signalId!))
        return 0
      }
      return yield* Effect.fail(new Error(`Unknown signal id: ${opts.signalId}`))
    }

    const vectorSelection = yield* discoverTasteVector({
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
      repoRoot,
      gitSha,
      vectorSelection.sourceLabel,
    )
    return 0
  })

const validateScoreOptions = (opts: ScoreOptions): Effect.Effect<void, Error> => {
  if (opts.signalId !== undefined) {
    if (opts.json === true) {
      return Effect.fail(new Error("taste score --json is only supported in full Observer mode"))
    }
    if (opts.category !== undefined) {
      return Effect.fail(new Error("taste score --category is only supported in full Observer mode"))
    }
    if (opts.ci === true) {
      return Effect.fail(new Error("taste score --ci is only supported in full Observer mode"))
    }
    if (opts.profile === true) {
      return Effect.fail(new Error("taste score --profile is only supported in full Observer mode"))
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
  vector: TasteVector,
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

    const comparison = compareToBaseline(baseline, output.hard_gate_violations)
    return {
      mode: "ratcheted",
      effectiveStatus: comparison.newViolations.length > 0 ? "fail" : "pass",
      baselineSha: baseline.baseline_sha,
      ...(baseline.vector_id !== undefined ? { baselineVectorId: baseline.vector_id } : {}),
      currentVectorId: vector.id,
      comparison,
    } satisfies CiAssessment
  })

const printObserverView = (opts: {
  readonly repoRoot: string
  readonly gitSha: string
  readonly output: ObserverOutput
  readonly vectorLabel: string
  readonly vectorSourceLabel: string
  readonly aiMode: AiAssistedModeExplanation
  readonly ciAssessment: CiAssessment
  readonly colorize: boolean
  readonly profile: boolean
}): void => {
  const lines: Array<string> = []
  lines.push("")
  lines.push(`  Repo:   ${opts.repoRoot}`)
  lines.push(`  SHA:    ${opts.gitSha}`)
  lines.push(`  Vector: ${opts.vectorLabel}`)
  lines.push(`  Vector Source: ${opts.vectorSourceLabel}`)
  lines.push(`  AI Mode:${opts.aiMode.active ? " active" : " inactive"}`)
  lines.push(`          ${opts.aiMode.summary}`)
  if (opts.aiMode.active) {
    lines.push(`          ${opts.aiMode.overrideHint}`)
  }
  const calibrationLine = formatCalibrationLine(opts.output)
  if (calibrationLine !== undefined) {
    lines.push(`  Calibration: ${calibrationLine}`)
  }
  lines.push("")

  for (const category of CATEGORIES) {
    const label = CATEGORY_LABELS[category].padEnd(22, " ")
    const score = opts.output.categories[category].score
    lines.push(`  ${label} ${score.toFixed(2)}  ${renderScoreBar(score)}`)
  }

  lines.push("  ───────────────────────────────────────────────")
  lines.push(`  Weighted Mean         ${opts.output.weighted_mean.toFixed(2)}`)
  if (opts.output.minimum !== undefined) {
    lines.push(
      `  Minimum               ${opts.output.minimum.signal} / ${opts.output.minimum.category} / ${opts.output.minimum.score.toFixed(2)}`,
    )
    if (opts.output.minimum.detail !== "") {
      lines.push(`                        ${JSON.stringify(opts.output.minimum.detail)}`)
    }
  } else {
    lines.push("  Minimum               none")
  }

  lines.push(
    `  Hard Gate             ${renderGateStatus(opts.ciAssessment.effectiveStatus, opts.colorize)}`,
  )
  const ciLine = formatCiBaselineLine(opts.ciAssessment, opts.output)
  if (ciLine !== undefined) {
    lines.push(`  CI Baseline           ${ciLine}`)
  }
  pushTopDiagnostics(lines, opts.repoRoot, opts.output, [...opts.output.signalResults.keys()], TOP_FINDINGS_LIMIT)
  pushRuntimeProfile(lines, opts.output, opts.profile)
  lines.push("")

  for (const line of lines) console.log(line)
}

const printCategoryView = (opts: {
  readonly repoRoot: string
  readonly gitSha: string
  readonly category: Category
  readonly output: ObserverOutput
  readonly vectorLabel: string
  readonly vectorSourceLabel: string
  readonly aiMode: AiAssistedModeExplanation
  readonly profile: boolean
}): void => {
  const entry = opts.output.categories[opts.category]
  const signalEntries = Object.entries(entry.signals).sort(
    (a, b) => a[1] - b[1] || a[0].localeCompare(b[0]),
  )

  console.log("")
  console.log(`  Repo:     ${opts.repoRoot}`)
  console.log(`  SHA:      ${opts.gitSha}`)
  console.log(`  Vector:   ${opts.vectorLabel}`)
  console.log(`  Vector Source: ${opts.vectorSourceLabel}`)
  console.log(`  AI Mode:  ${opts.aiMode.active ? "active" : "inactive"}`)
  console.log(`            ${opts.aiMode.summary}`)
  const calibrationLine = formatCalibrationLine(opts.output)
  if (calibrationLine !== undefined) {
    console.log(`  Calibration: ${calibrationLine}`)
  }
  console.log(`  Category: ${opts.category}`)
  console.log("")
  console.log(
    `  ${CATEGORY_LABELS[opts.category].padEnd(22, " ")} ${entry.score.toFixed(2)}  ${renderScoreBar(entry.score)}`,
  )
  if (opts.output.hard_gate_status === "fail") {
    console.log(`  Hard Gate             ${renderGateStatus(opts.output.hard_gate_status, false)}`)
  }
  printCategoryScoreMath(entry)
  if (signalEntries.length === 0) {
    console.log("")
    console.log("  (no active signals in this category)")
    console.log("")
    return
  }

  console.log("")
  for (const [signalId, score] of signalEntries) {
    console.log(`  ${fixedWidthLabel(signalId, 22)} ${score.toFixed(2)}  ${renderScoreBar(score)}`)
  }
  printTopDiagnostics(opts.repoRoot, opts.output, signalEntries.map(([signalId]) => signalId), TOP_FINDINGS_LIMIT)
  printRuntimeProfile(opts.output, opts.profile)
  console.log("")
}

const printCategoryScoreMath = (
  entry: ObserverOutput["categories"][Category],
): void => {
  if (entry.aggregation === undefined) return

  const lowestSignal = lowestSignalEntry(entry.signals)
  console.log("")
  console.log("  Score Math")
  console.log(
    `    aggregate ${entry.aggregation.aggregateScore.toFixed(3)} (${entry.aggregation.strategy})`,
  )
  if (entry.aggregation.strategy === "language-group-mean") {
    console.log(`    raw mean  ${entry.aggregation.rawScore.toFixed(3)}`)
  }
  if (lowestSignal !== undefined) {
    console.log(`    lowest    ${lowestSignal.signalId} ${lowestSignal.score.toFixed(3)}`)
  }
  if (entry.aggregation.shapedByLowestSignal) {
    console.log("    formula   0.65 * aggregate + 0.35 * lowest")
  }
  console.log(`    weights   ${formatSignalWeights(entry.aggregation.weights)}`)
}

const lowestSignalEntry = (
  signals: Record<string, number>,
): { readonly signalId: string; readonly score: number } | undefined => {
  const entries = Object.entries(signals)
  if (entries.length === 0) return undefined
  const [signalId, score] = entries.sort(
    (a, b) => a[1] - b[1] || a[0].localeCompare(b[0]),
  )[0]!
  return { signalId, score }
}

const formatSignalWeights = (weights: Record<string, number>): string => {
  const entries = Object.entries(weights).sort(([left], [right]) => left.localeCompare(right))
  const visible = entries
    .slice(0, 6)
    .map(([signalId, weight]) => `${signalId}=${formatWeight(weight)}`)
  const hidden = entries.length - visible.length
  return hidden > 0 ? `${visible.join(", ")} (+${hidden} more)` : visible.join(", ")
}

const formatWeight = (weight: number): string =>
  Number.isInteger(weight) ? weight.toFixed(0) : weight.toFixed(2)

const pushTopDiagnostics = (
  lines: Array<string>,
  repoRoot: string,
  output: ObserverOutput,
  signalIds: ReadonlyArray<string>,
  limit: number,
): void => {
  lines.push(...topDiagnosticLines(repoRoot, output, signalIds, limit))
}

const printTopDiagnostics = (
  repoRoot: string,
  output: ObserverOutput,
  signalIds: ReadonlyArray<string>,
  limit: number,
): void => {
  for (const line of topDiagnosticLines(repoRoot, output, signalIds, limit)) {
    console.log(line)
  }
}

const formatCalibrationLine = (output: ObserverOutput): string | undefined => {
  if (output.calibration === undefined) return undefined
  const count = output.calibration.active_modules.length
  const noun = count === 1 ? "module" : "modules"
  return `${count} ${noun} / ${output.calibration.fingerprint.slice(0, 12)}`
}

const topDiagnosticLines = (
  repoRoot: string,
  output: ObserverOutput,
  signalIds: ReadonlyArray<string>,
  limit: number,
): ReadonlyArray<string> => {
  const findings = collectDiagnostics(output, signalIds, limit)
  if (findings.length === 0) return []

  const lines: Array<string> = ["", `  Top Findings (${findings.length}):`]
  for (const finding of findings) {
    lines.push(
      `    ${fixedWidthLabel(finding.signalId, 8)} ${severityLabel(finding.diagnostic).padEnd(5, " ")} ${diagnosticMessage(repoRoot, finding.diagnostic)}`,
    )
    const loc = diagnosticLocation(repoRoot, finding.diagnostic)
    if (loc !== undefined) {
      lines.push(`      at ${loc}`)
    }
    for (const detail of diagnosticDetailLines(repoRoot, finding.diagnostic)) {
      lines.push(`      ${detail}`)
    }
  }

  return lines
}

const collectDiagnostics = (
  output: ObserverOutput,
  signalIds: ReadonlyArray<string>,
  limit: number,
): ReadonlyArray<{ readonly signalId: string; readonly diagnostic: Diagnostic }> => {
  const findings = signalIds
    .flatMap((signalId) => {
      const result = output.signalResults.get(signalId)
      return (result?.diagnostics ?? []).map((diagnostic) => ({
        signalId,
        diagnostic,
        score: result?.score ?? 1,
      }))
    })
    .filter(isActionableTopFinding)
    .sort(
      (a, b) =>
        severityRank(b.diagnostic) - severityRank(a.diagnostic) ||
        a.score - b.score ||
        a.signalId.localeCompare(b.signalId),
    )
    .filter((finding, index, findings) =>
      findings.findIndex((candidate) => diagnosticDedupeKey(candidate) === diagnosticDedupeKey(finding)) === index,
    )

  const rankedFindings = prioritizeDiverseSignalFindings(findings)
  const selected = rankedFindings.slice(0, limit)
  if (selected.length === 0 || selected.length < limit) return selected

  const weakestRepresentable = findings.reduce<
    | {
        readonly signalId: string
        readonly diagnostic: Diagnostic
        readonly score: number
      }
    | undefined
  >((weakest, finding) => {
    if (weakest === undefined) return finding
    if (finding.score !== weakest.score) {
      return finding.score < weakest.score ? finding : weakest
    }
    return finding.signalId.localeCompare(weakest.signalId) < 0 ? finding : weakest
  }, undefined)

  if (weakestRepresentable === undefined) return selected
  if (selected.some((finding) => finding.signalId === weakestRepresentable.signalId)) {
    return selected
  }

  return [...selected.slice(0, limit - 1), weakestRepresentable]
}

const prioritizeDiverseSignalFindings = <
  T extends { readonly signalId: string; readonly diagnostic: Diagnostic },
>(
  findings: ReadonlyArray<T>,
): ReadonlyArray<T> => {
  const signalsWithStrongerEvidence = new Set(
    findings
      .filter((finding) => severityRank(finding.diagnostic) > 0)
      .map((finding) => finding.signalId),
  )
  if (signalsWithStrongerEvidence.size === 0) return findings

  const primary: Array<T> = []
  const deferred: Array<T> = []
  for (const finding of findings) {
    if (
      severityRank(finding.diagnostic) === 0 &&
      signalsWithStrongerEvidence.has(finding.signalId)
    ) {
      deferred.push(finding)
      continue
    }
    primary.push(finding)
  }
  return [...primary, ...deferred]
}

const isActionableTopFinding = (finding: {
  readonly diagnostic: Diagnostic
  readonly score: number
}): boolean =>
  finding.diagnostic.severity === "block" ||
  finding.score < TOP_FINDING_HEALTHY_SCORE_CUTOFF

const pushRuntimeProfile = (
  lines: Array<string>,
  output: ObserverOutput,
  profile: boolean,
): void => {
  if (!profile) return
  if (output.runtimeProfile === undefined) {
    lines.push("  Runtime               unavailable (cached observer result)")
    return
  }
  lines.push(`  Runtime               ${formatDuration(output.runtimeProfile.totalMs)}`)
  pushRuntimeStages(lines, output)
  for (const entry of slowestRuntimeSignals(output, 5)) {
    lines.push(
      `    ${fixedWidthLabel(entry.signalId, 20)} ${formatDuration(entry.durationMs).padStart(8, " ")} score=${entry.score.toFixed(2)} diagnostics=${entry.diagnostics}`,
    )
  }
}

const printRuntimeProfile = (output: ObserverOutput, profile: boolean): void => {
  if (!profile) return
  console.log("")
  if (output.runtimeProfile === undefined) {
    console.log("  Runtime               unavailable (cached observer result)")
    return
  }
  console.log(`  Runtime               ${formatDuration(output.runtimeProfile.totalMs)}`)
  printRuntimeStages(output)
  for (const entry of slowestRuntimeSignals(output, 5)) {
    console.log(
      `    ${fixedWidthLabel(entry.signalId, 20)} ${formatDuration(entry.durationMs).padStart(8, " ")} score=${entry.score.toFixed(2)} diagnostics=${entry.diagnostics}`,
    )
  }
}

const pushRuntimeStages = (lines: Array<string>, output: ObserverOutput): void => {
  const stages = slowestRuntimeStages(output)
  for (const entry of stages) {
    lines.push(`    ${formatRuntimeStageLabel(entry.stageId).padEnd(20, " ")} ${formatDuration(entry.durationMs).padStart(8, " ")}`)
  }
}

const printRuntimeStages = (output: ObserverOutput): void => {
  for (const entry of slowestRuntimeStages(output)) {
    console.log(`    ${formatRuntimeStageLabel(entry.stageId).padEnd(20, " ")} ${formatDuration(entry.durationMs).padStart(8, " ")}`)
  }
}

const slowestRuntimeStages = (
  output: ObserverOutput,
): ReadonlyArray<{ readonly stageId: string; readonly durationMs: number }> => {
  if (output.runtimeProfile?.stages === undefined) return []
  return Object.entries(output.runtimeProfile.stages)
    .map(([stageId, entry]) => ({ stageId, durationMs: entry.durationMs }))
    .sort((a, b) => b.durationMs - a.durationMs || a.stageId.localeCompare(b.stageId))
}

const formatRuntimeStageLabel = (stageId: string): string =>
  stageId
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")

const fixedWidthLabel = (value: string, width: number): string =>
  value.length > width
    ? compactMiddle(value, width)
    : value.padEnd(width, " ")

const compactMiddle = (value: string, width: number): string => {
  if (width <= 3) return value.slice(0, width)
  const suffixLength = Math.min(12, Math.max(1, width - 4))
  const prefixLength = Math.max(1, width - suffixLength - 3)
  return `${value.slice(0, prefixLength)}...${value.slice(-suffixLength)}`
}

const slowestRuntimeSignals = (
  output: ObserverOutput,
  limit: number,
): ReadonlyArray<{
  readonly signalId: string
  readonly durationMs: number
  readonly score: number
  readonly diagnostics: number
}> => {
  if (output.runtimeProfile === undefined) return []
  return Object.entries(output.runtimeProfile.signals)
    .map(([signalId, entry]) => ({ signalId, ...entry }))
    .sort((a, b) => b.durationMs - a.durationMs || a.signalId.localeCompare(b.signalId))
    .slice(0, limit)
}

const printSignalResult = (
  signalId: string,
  score: number,
  diagnostics: ReadonlyArray<Diagnostic>,
  output: unknown,
  repoPath: string,
  sha: string,
  vectorSourceLabel: string,
): void => {
  const scoreBar = renderScoreBar(score)
  console.log("")
  console.log(`  Repo:   ${repoPath}`)
  console.log(`  SHA:    ${sha}`)
  console.log(`  Vector Source: ${vectorSourceLabel}`)
  console.log(`  Signal: ${signalId}`)
  console.log(`  Score:  ${score.toFixed(3)}  ${scoreBar}`)
  console.log("")
  if (diagnostics.length === 0) {
    console.log("  (no diagnostics)")
  } else {
    console.log(`  Diagnostics (${diagnostics.length}):`)
    for (const diagnostic of diagnostics) {
      console.log(`    ${severityLabel(diagnostic).padEnd(5, " ")} ${diagnosticMessage(repoPath, diagnostic)}`)
      const loc = diagnosticLocation(repoPath, diagnostic)
      if (loc !== undefined) {
        console.log(`      at ${loc}`)
      }
      for (const detail of diagnosticDetailLines(repoPath, diagnostic)) {
        console.log(`      ${detail}`)
      }
    }
  }

  const calibrationDecisions = calibrationDecisionsFromOutput(output)
  if (calibrationDecisions.length > 0) {
    console.log("")
    console.log(`  Calibration Decisions (${calibrationDecisions.length}):`)
    for (const decision of calibrationDecisions) {
      console.log(
        `    ${decision.confidence.toUpperCase().padEnd(6, " ")} ${decision.moduleId}/${decision.processorId} ${decision.action}`,
      )
      console.log(`      ${decision.reason}`)
      if (decision.ruleId !== undefined) {
        console.log(`      rule: ${decision.ruleId}`)
      }
      for (const evidence of decision.evidence.slice(0, 3)) {
        console.log(`      evidence: ${evidence.kind}=${compactDecisionEvidence(repoPath, evidence.value)}`)
      }
    }
  }
  console.log("")
}

const calibrationDecisionsFromOutput = (output: unknown): ReadonlyArray<CalibrationDecision> => {
  if (output === null || typeof output !== "object") return []
  const decisions = (output as { readonly calibrationDecisions?: unknown }).calibrationDecisions
  return Array.isArray(decisions) ? decisions.filter(isCalibrationDecisionLike) : []
}

const isCalibrationDecisionLike = (value: unknown): value is CalibrationDecision => {
  if (value === null || typeof value !== "object") return false
  const decision = value as Partial<CalibrationDecision>
  return (
    typeof decision.moduleId === "string" &&
    typeof decision.processorId === "string" &&
    typeof decision.action === "string" &&
    typeof decision.confidence === "string" &&
    typeof decision.reason === "string" &&
    Array.isArray(decision.evidence)
  )
}

const compactDecisionEvidence = (repoPath: string, value: string): string => {
  const repoPrefix = repoPath.replace(/\\/g, "/").replace(/\/$/, "")
  return value
    .replaceAll("\\", "/")
    .replaceAll(`${repoPrefix}/`, "")
    .replaceAll(repoPrefix, ".")
}

const severityLabel = (diagnostic: Diagnostic): "BLOCK" | "WARN" | "INFO" =>
  diagnostic.severity === "block"
    ? "BLOCK"
    : diagnostic.severity === "warn"
      ? "WARN"
      : "INFO"

const severityRank = (diagnostic: Diagnostic): number =>
  diagnostic.severity === "block" ? 2 : diagnostic.severity === "warn" ? 1 : 0

const diagnosticMessage = (repoPath: string, diagnostic: Diagnostic): string => {
  const repoPrefix = repoPath.replace(/\\/g, "/").replace(/\/$/, "")
  const compact = diagnostic.message
    .replaceAll(`${repoPrefix}/`, "")
    .replaceAll(repoPrefix, ".")
    .replaceAll("→", " -> ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact
}

const diagnosticDedupeKey = (finding: {
  readonly signalId: string
  readonly diagnostic: Diagnostic
}): string => {
  const location = finding.diagnostic.location
  return [
    finding.signalId,
    finding.diagnostic.severity,
    finding.diagnostic.message,
    location?.file ?? "",
    location?.line ?? "",
  ].join("\u0000")
}

const diagnosticLocation = (repoPath: string, diagnostic: Diagnostic): string | undefined => {
  const file = diagnostic.location?.file
  if (file === undefined) return undefined
  const normalized = file.replace(/\\/g, "/")
  const displayFile = isAbsolute(normalized)
    ? relative(repoPath, normalized).replace(/\\/g, "/")
    : normalized.replace(/^\.\//, "")
  return `${displayFile}${diagnostic.location?.line !== undefined ? `:${diagnostic.location.line}` : ""}`
}

const diagnosticDetailLines = (repoPath: string, diagnostic: Diagnostic): ReadonlyArray<string> => {
  const lines: Array<string> = []

  const members = diagnostic.data?.members
  if (isDiagnosticMemberArray(members)) {
    const visible = members.slice(0, 3).map((member) => {
      const displayFile = diagnosticDisplayPath(repoPath, member.file)
      return `${displayFile}${member.startLine !== undefined ? `:${member.startLine}` : ""}${member.name !== undefined ? ` ${member.name}` : ""}`
    })
    const hidden = members.length - visible.length
    lines.push(
      compactDiagnosticDetailLine(
        `members ${hidden > 0 ? `${visible.join("; ")} (+${hidden} more)` : visible.join("; ")}`,
      ),
    )
  }

  const largestFiles = diagnostic.data?.largestFiles
  if (isDiagnosticChangedFileStatArray(largestFiles)) {
    const visible = largestFiles.slice(0, 5).map((stat) =>
      `${diagnosticDisplayPath(repoPath, stat.file)} (+${stat.linesAdded}/-${stat.linesDeleted})`,
    )
    const hidden = largestFiles.length - visible.length
    lines.push(
      compactDiagnosticDetailLine(
        `largest files ${hidden > 0 ? `${visible.join("; ")} (+${hidden} more)` : visible.join("; ")}`,
      ),
    )
  }

  return lines
}

const compactDiagnosticDetailLine = (line: string): string =>
  line.length > DIAGNOSTIC_DETAIL_MAX_LENGTH
    ? `${line.slice(0, DIAGNOSTIC_DETAIL_MAX_LENGTH - 3)}...`
    : line

const diagnosticDisplayPath = (repoPath: string, file: string): string => {
  const normalized = file.replace(/\\/g, "/")
  return isAbsolute(normalized)
    ? relative(repoPath, normalized).replace(/\\/g, "/")
    : normalized.replace(/^\.\//, "")
}

const isDiagnosticMemberArray = (
  value: unknown,
): value is ReadonlyArray<{
  readonly file: string
  readonly startLine?: number
  readonly name?: string
}> => {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((member) => {
    if (typeof member !== "object" || member === null) return false
    const record = member as Record<string, unknown>
    return (
      typeof record.file === "string" &&
      (record.startLine === undefined || typeof record.startLine === "number") &&
      (record.name === undefined || typeof record.name === "string")
    )
  })
}

const isDiagnosticChangedFileStatArray = (
  value: unknown,
): value is ReadonlyArray<{
  readonly file: string
  readonly linesAdded: number
  readonly linesDeleted: number
}> => {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false
    const record = entry as Record<string, unknown>
    return (
      typeof record.file === "string" &&
      typeof record.linesAdded === "number" &&
      typeof record.linesDeleted === "number"
    )
  })
}

const printPaidDebt = (paidDebt: NonNullable<CiAssessment["comparison"]>["paidDebt"]): void => {
  console.log("")
  console.log(`  Paid debt (${paidDebt.length}):`)
  for (const violation of paidDebt) {
    console.log(
      `    · ${violation.signalId} ${formatLocation({
        file: violation.file,
        ...(violation.line !== undefined ? { line: violation.line } : {}),
      })} — ${violation.detail}`,
    )
  }
}

const printCiSummary = (opts: {
  readonly repoRoot: string
  readonly gitSha: string
  readonly output: ObserverOutput
  readonly ciAssessment: CiAssessment
}): void => {
  if (opts.ciAssessment.mode === "missing-baseline") {
    console.error(
      `taste-ci status=pass baseline=missing sha=${opts.gitSha} current=${opts.output.hard_gate_violations.length}`,
    )
    console.error(
      `taste-ci warning=no-baseline path=${opts.ciAssessment.baselinePath} action="taste baseline set"`,
    )
    return
  }

  if (opts.ciAssessment.mode === "observer-config-mismatch") {
    console.error(
      `taste-ci status=fail baseline=${opts.ciAssessment.baselineSha} sha=${opts.gitSha} reason=observer-config-mismatch baseline_vector=${opts.ciAssessment.baselineVectorId ?? "unknown"} current_vector=${opts.ciAssessment.currentVectorId ?? "unknown"} baseline_config=${opts.ciAssessment.baselineObserverConfigHash ?? "unknown"} current_config=${opts.ciAssessment.currentObserverConfigHash ?? "unknown"}`,
    )
    console.error(
      `taste-ci warning=baseline-observer-config-mismatch action="taste baseline refresh"`,
    )
    return
  }

  if (opts.ciAssessment.mode !== "ratcheted") {
    console.error(
      `taste-ci status=${opts.ciAssessment.effectiveStatus} sha=${opts.gitSha} current=${opts.output.hard_gate_violations.length}`,
    )
    return
  }

  const comparison = opts.ciAssessment.comparison!
  console.error(
    `taste-ci status=${opts.ciAssessment.effectiveStatus} baseline=${opts.ciAssessment.baselineSha} sha=${opts.gitSha} new=${comparison.newViolations.length} tolerated=${comparison.tolerated.length} paid=${comparison.paidDebt.length}`,
  )
  if (comparison.newViolations.length === 0) return

  console.error("taste-ci new-violations:")
  for (const violation of comparison.newViolations) {
    console.error(
      `- ${violation.signalId} ${formatLocation({
        file: violation.file,
        ...(violation.line !== undefined ? { line: violation.line } : {}),
      })} :: ${violation.detail}`,
    )
  }
}

const formatCiBaselineLine = (
  assessment: CiAssessment,
  output: ObserverOutput,
): string | undefined => {
  if (assessment.mode === "disabled") return undefined
  if (assessment.mode === "missing-baseline") {
    return `missing (${output.hard_gate_violations.length} current violation${output.hard_gate_violations.length === 1 ? "" : "s"}; run taste baseline set)`
  }
  if (assessment.mode === "observer-config-mismatch") {
    return `${assessment.baselineSha} (observer config mismatch: ${assessment.baselineVectorId ?? "unknown"} -> ${assessment.currentVectorId ?? "unknown"}; run taste baseline refresh)`
  }

  const comparison = assessment.comparison!
  const pieces = [`${comparison.tolerated.length} tolerated`]
  if (comparison.newViolations.length > 0) {
    pieces.unshift(`${comparison.newViolations.length} new`)
  }
  if (comparison.paidDebt.length > 0) {
    pieces.push(`${comparison.paidDebt.length} paid down`)
  }
  return `${assessment.baselineSha} (${pieces.join(", ")})`
}

const renderGateStatus = (status: "pass" | "fail", colorize: boolean): string => {
  if (!colorize) return status.toUpperCase()
  const color = status === "pass" ? "\u001b[32m" : "\u001b[31m"
  return `${color}${status.toUpperCase()}\u001b[0m`
}

const renderScoreBar = (score: number): string => {
  const width = 20
  const filled = Math.max(0, Math.min(width, Math.round(score * width)))
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}]`
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const formatLocation = (location: { readonly file: string; readonly line?: number }): string =>
  `${location.file}${location.line !== undefined ? `:${location.line}` : ""}`
