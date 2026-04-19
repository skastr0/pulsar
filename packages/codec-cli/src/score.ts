import {
  CATEGORIES,
  compareToBaseline,
  explainAiAssistedMode,
  timeSeriesConfigOf,
  toObserverJson,
  type AiAssistedModeExplanation,
  type BaselineComparison,
  type Category,
  type Diagnostic,
  type ObserverOutput,
} from "@taste-codec/core"
import { Effect } from "effect"
import { readBaselineFile, resolveBaselinePath } from "./baseline-file.js"
import {
  buildCodecRegistry,
  formatReservedRustSignalMessage,
  isReservedRustSignalId,
  observeWorktree,
  runSignalInWorktree,
} from "./runtime.js"
import { discoverTasteVector } from "./vector-discovery.js"

export interface ScoreOptions {
  readonly repoPath: string
  readonly signalId?: string
  readonly vectorPath?: string
  readonly json?: boolean
  readonly category?: Category
  readonly ci?: boolean
}

interface CiAssessment {
  readonly mode: "disabled" | "missing-baseline" | "ratcheted"
  readonly effectiveStatus: "pass" | "fail"
  readonly baselineSha?: string
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

export const runScoreCommand = (opts: ScoreOptions) =>
  Effect.gen(function* () {
    validateScoreOptions(opts)

    if (opts.signalId !== undefined) {
      return yield* runSingleSignalMode(opts)
    }

    const registry = yield* buildCodecRegistry(opts.repoPath)
    const vectorSelection = yield* discoverTasteVector({
      repoPath: opts.repoPath,
      registry,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
    })
    const timeSeriesEnabled = opts.ci === true || timeSeriesConfigOf(vectorSelection.vector).enabled
    const { repoRoot, gitSha, result } = yield* observeWorktree(
      opts.repoPath,
      vectorSelection.vector,
      timeSeriesEnabled ? { timeSeries: { enabled: true } } : undefined,
    )

    const activeSignalCount = CATEGORIES.reduce(
      (sum, category) => sum + result.categories[category].signalCount,
      0,
    )
    if (activeSignalCount === 0) {
      return yield* Effect.fail(new Error("Observer mode has no active signals."))
    }

    const ciAssessment = yield* assessCiMode(opts, repoRoot, result)
    const paidDebt = ciAssessment.comparison?.paidDebt ?? []
    if (!opts.json && paidDebt.length > 0) {
      printPaidDebt(paidDebt)
    }

    if (opts.json) {
      console.log(JSON.stringify(toObserverJson(result), null, 2))
    } else if (opts.category !== undefined) {
      printCategoryView({
        repoRoot,
        gitSha,
        category: opts.category,
        output: result,
        vectorLabel: vectorSelection.label,
        aiMode: explainAiAssistedMode(vectorSelection.vector),
      })
    } else {
      printObserverView({
        repoRoot,
        gitSha,
        output: result,
        vectorLabel: vectorSelection.label,
        aiMode: explainAiAssistedMode(vectorSelection.vector),
        ciAssessment,
        colorize: process.stdout.isTTY === true && opts.ci !== true,
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

    const vector =
      opts.vectorPath === undefined
        ? undefined
        : (
            yield* discoverTasteVector({
              repoPath: opts.repoPath,
              explicitPath: opts.vectorPath,
              registry,
            })
          ).vector

    const { repoRoot, gitSha, result } = yield* runSignalInWorktree(
      opts.repoPath,
      opts.signalId!,
      vector,
    )

    printSignalResult(result.signalId, result.score, result.diagnostics, repoRoot, gitSha)
    return 0
  })

const validateScoreOptions = (opts: ScoreOptions): void => {
  if (opts.signalId !== undefined) {
    if (opts.json === true) {
      throw new Error("taste score --json is only supported in full Observer mode")
    }
    if (opts.category !== undefined) {
      throw new Error("taste score --category is only supported in full Observer mode")
    }
    if (opts.ci === true) {
      throw new Error("taste score --ci is only supported in full Observer mode")
    }
  }

  if (opts.category !== undefined && (opts.json === true || opts.ci === true)) {
    throw new Error("--category cannot be combined with --json or --ci")
  }
}

const assessCiMode = (
  opts: ScoreOptions,
  repoRoot: string,
  output: ObserverOutput,
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

    const comparison = compareToBaseline(baseline, output.hard_gate_violations)
    return {
      mode: "ratcheted",
      effectiveStatus: comparison.newViolations.length > 0 ? "fail" : "pass",
      baselineSha: baseline.baseline_sha,
      comparison,
    } satisfies CiAssessment
  })

const printObserverView = (opts: {
  readonly repoRoot: string
  readonly gitSha: string
  readonly output: ObserverOutput
  readonly vectorLabel: string
  readonly aiMode: AiAssistedModeExplanation
  readonly ciAssessment: CiAssessment
  readonly colorize: boolean
}): void => {
  const lines: Array<string> = []
  lines.push("")
  lines.push(`  Repo:   ${opts.repoRoot}`)
  lines.push(`  SHA:    ${opts.gitSha}`)
  lines.push(`  Vector: ${opts.vectorLabel}`)
  lines.push(`  AI Mode:${opts.aiMode.active ? " active" : " inactive"}`)
  lines.push(`          ${opts.aiMode.summary}`)
  if (opts.aiMode.active) {
    lines.push(`          ${opts.aiMode.overrideHint}`)
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
  lines.push("")

  for (const line of lines) console.log(line)
}

const printCategoryView = (opts: {
  readonly repoRoot: string
  readonly gitSha: string
  readonly category: Category
  readonly output: ObserverOutput
  readonly vectorLabel: string
  readonly aiMode: AiAssistedModeExplanation
}): void => {
  const entry = opts.output.categories[opts.category]
  const signalEntries = Object.entries(entry.signals).sort(
    (a, b) => a[1] - b[1] || a[0].localeCompare(b[0]),
  )

  console.log("")
  console.log(`  Repo:     ${opts.repoRoot}`)
  console.log(`  SHA:      ${opts.gitSha}`)
  console.log(`  Vector:   ${opts.vectorLabel}`)
  console.log(`  AI Mode:  ${opts.aiMode.active ? "active" : "inactive"}`)
  console.log(`            ${opts.aiMode.summary}`)
  console.log(`  Category: ${opts.category}`)
  console.log("")
  console.log(
    `  ${CATEGORY_LABELS[opts.category].padEnd(22, " ")} ${entry.score.toFixed(2)}  ${renderScoreBar(entry.score)}`,
  )
  if (signalEntries.length === 0) {
    console.log("")
    console.log("  (no active signals in this category)")
    console.log("")
    return
  }

  console.log("")
  for (const [signalId, score] of signalEntries) {
    console.log(`  ${signalId.padEnd(22, " ")} ${score.toFixed(2)}  ${renderScoreBar(score)}`)
  }
  console.log("")
}

const printSignalResult = (
  signalId: string,
  score: number,
  diagnostics: ReadonlyArray<Diagnostic>,
  repoPath: string,
  sha: string,
): void => {
  const scoreBar = renderScoreBar(score)
  console.log("")
  console.log(`  Repo:   ${repoPath}`)
  console.log(`  SHA:    ${sha}`)
  console.log(`  Signal: ${signalId}`)
  console.log(`  Score:  ${score.toFixed(3)}  ${scoreBar}`)
  console.log("")
  if (diagnostics.length === 0) {
    console.log("  (no diagnostics)")
    return
  }
  console.log(`  Diagnostics (${diagnostics.length}):`)
  for (const diagnostic of diagnostics) {
    const sev =
      diagnostic.severity === "block"
        ? "!"
        : diagnostic.severity === "warn"
          ? "⚠"
          : "·"
    const loc = diagnostic.location?.file
      ? ` ${diagnostic.location.file}${diagnostic.location.line !== undefined ? `:${diagnostic.location.line}` : ""}`
      : ""
    console.log(`    ${sev} ${diagnostic.message}${loc}`)
  }
  console.log("")
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

const formatLocation = (location: { readonly file: string; readonly line?: number }): string =>
  `${location.file}${location.line !== undefined ? `:${location.line}` : ""}`
