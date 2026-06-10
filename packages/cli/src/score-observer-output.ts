import { type AiAssistedModeExplanation } from "@skastr0/pulsar-core/vector"
import { type ObserverOutput } from "@skastr0/pulsar-core/observer"
import {
  CATEGORIES,
  type Category,
} from "@skastr0/pulsar-core/signal"
import type { CiAssessment } from "./score.js"
import { formatCiBaselineLine, renderGateStatus } from "./score-ci-output.js"
import {
  frameworkLines,
  formatCalibrationLine,
  printTopDiagnostics,
  pushTopDiagnostics,
  TOP_FINDINGS_LIMIT,
} from "./score-diagnostics.js"
import {
  CATEGORY_LABELS,
  fixedWidthLabel,
  renderScoreBar,
} from "./score-format.js"
import {
  printRuntimeProfile,
  pushRuntimeProfile,
} from "./score-runtime-profile.js"

export const printObserverView = (opts: {
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
  const lines = [
    ...observerViewHeaderLines(opts),
    ...observerViewCategoryLines(opts.output),
    ...observerViewSummaryLines(opts),
  ]
  pushTopDiagnostics(lines, opts.repoRoot, opts.output, [...opts.output.signalResults.keys()], TOP_FINDINGS_LIMIT)
  pushRuntimeProfile(lines, opts.output, opts.profile)
  lines.push("")

  for (const line of lines) console.log(line)
}

const observerViewHeaderLines = (opts: {
  readonly repoRoot: string
  readonly gitSha: string
  readonly output: ObserverOutput
  readonly vectorLabel: string
  readonly vectorSourceLabel: string
  readonly aiMode: AiAssistedModeExplanation
}): ReadonlyArray<string> => [
  "",
  `  Repo:   ${opts.repoRoot}`,
  `  SHA:    ${opts.gitSha}`,
  `  Vector: ${opts.vectorLabel}`,
  `  Vector Source: ${opts.vectorSourceLabel}`,
  `  AI Mode:${opts.aiMode.active ? " active" : " inactive"}`,
  `          ${opts.aiMode.summary}`,
  ...(opts.aiMode.active ? [`          ${opts.aiMode.overrideHint}`] : []),
  ...calibrationLines(opts.output),
  ...frameworkLines(opts.repoRoot, opts.output),
  "",
]

const calibrationLines = (output: ObserverOutput): ReadonlyArray<string> => {
  const calibrationLine = formatCalibrationLine(output)
  return calibrationLine === undefined ? [] : [`  Calibration: ${calibrationLine}`]
}

export const observerViewCategoryLines = (output: ObserverOutput): ReadonlyArray<string> => [
  ...CATEGORIES.map((category) => {
    const label = CATEGORY_LABELS[category].padEnd(22, " ")
    const entry = output.categories[category]
    const marker = entry.aggregation?.shapedByPressure === true ? "  ◂ pressure" : ""
    return `  ${label} ${entry.score.toFixed(2)}  ${renderScoreBar(entry.score)}${marker}`
  }),
  "  ───────────────────────────────────────────────",
]

const observerViewSummaryLines = (opts: {
  readonly output: ObserverOutput
  readonly ciAssessment: CiAssessment
  readonly colorize: boolean
}): ReadonlyArray<string> => [
  ...readinessSummaryLines(opts.output),
  `  Evidence Mean         ${opts.output.weighted_mean.toFixed(2)}`,
  ...minimumSummaryLines(opts.output),
  `  Hard Gate             ${renderGateStatus(opts.ciAssessment.effectiveStatus, opts.colorize)}`,
  ...ciBaselineLines(opts.ciAssessment, opts.output),
]

export const readinessSummaryLines = (output: ObserverOutput): ReadonlyArray<string> => {
  const readiness = output.readiness
  if (readiness === undefined) return []
  const aggregation = readiness.aggregation
  const failedCount = aggregation.failed_signal_count ?? 0

  if (aggregation.applicable_signal_count === 0 && failedCount > 0) {
    return [
      `  Readiness             n/a   failed / no measured signals (${formatSignalCount(failedCount)} failed to run)`,
    ]
  }

  const score = `${readiness.score.toFixed(2)}  ${renderScoreBar(readiness.score)}`
  const pressure = `pressure=${readiness.pressure.toFixed(2)}`
  const driver =
    aggregation.dominant_pressure_source === undefined
      ? undefined
      : `driver=${aggregation.dominant_pressure_source.replace("_", "-")}`
  const margin = thinMarginNote(readiness)

  if (readiness.status === "failed") {
    const band = readiness.band === undefined ? "" : ` / band=${readiness.band}`
    return [
      `  Readiness             ${score}  degraded${band} / ${pressure} (${formatSignalCount(failedCount)} failed; score reflects measured signals)`,
    ]
  }

  const parts = [readiness.status, pressure, ...(driver === undefined ? [] : [driver])]
  return [
    `  Readiness             ${score}  ${parts.join(" / ")}${margin === undefined ? "" : ` (${margin})`}`,
  ]
}

const THIN_MARGIN = 0.05

/**
 * Names the band on the other side of the nearest edge when the verdict
 * was decided by a thin margin — the honesty note for cases like quartz,
 * where 0.0014 of pressure picked the headline color.
 */
const thinMarginNote = (
  readiness: NonNullable<ObserverOutput["readiness"]>,
): string | undefined => {
  const margin = readiness.aggregation.band_margin
  const band = readiness.band
  if (margin === undefined || band === undefined) return undefined
  if (Math.abs(margin) >= THIN_MARGIN) return undefined
  const adjacent =
    band === "green" ? "yellow" : band === "red" ? "yellow" : margin > 0 ? "red" : "green"
  return `${Math.abs(margin).toFixed(3)} from ${adjacent}`
}

const formatSignalCount = (count: number): string =>
  count === 1 ? "1 signal" : `${count} signals`

const minimumSummaryLines = (output: ObserverOutput): ReadonlyArray<string> => {
  if (output.minimum === undefined) return ["  Minimum               none"]
  return [
    `  Minimum               ${output.minimum.signal} / ${output.minimum.category} / ${output.minimum.score.toFixed(2)}`,
    ...(output.minimum.detail === ""
      ? []
      : [`                        ${JSON.stringify(output.minimum.detail)}`]),
  ]
}

const ciBaselineLines = (
  ciAssessment: CiAssessment,
  output: ObserverOutput,
): ReadonlyArray<string> => {
  const ciLine = formatCiBaselineLine(ciAssessment, output)
  return ciLine === undefined ? [] : [`  CI Baseline           ${ciLine}`]
}

export const printCategoryView = (opts: {
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
  for (const line of frameworkLines(opts.repoRoot, opts.output)) {
    console.log(line)
  }
  console.log(`  Category: ${opts.category}`)
  console.log("")
  console.log(
    `  ${CATEGORY_LABELS[opts.category].padEnd(22, " ")} ${entry.score.toFixed(2)}  ${renderScoreBar(entry.score)}`,
  )
  if (opts.output.hard_gate_status === "fail") {
    console.log(`  Hard Gate             ${renderGateStatus(opts.output.hard_gate_status, false)}`)
  }
  printCategoryScoreMath(entry, opts.output.signalMetadata)
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
  signalMetadata: ObserverOutput["signalMetadata"] | undefined,
): void => {
  if (entry.aggregation === undefined) return

  const lowestSignal = lowestApplicableSignalEntry(entry.signals, signalMetadata)
  console.log("")
  console.log("  Score Math")
  console.log(
    `    aggregate ${entry.aggregation.aggregateScore.toFixed(3)} (${entry.aggregation.strategy})`,
  )
  console.log(
    `    pressure  ${entry.aggregation.pressure.finalPressure.toFixed(3)} ` +
      `(${entry.aggregation.pressure.strategy}, p=${entry.aggregation.pressure.p})`,
  )
  if (entry.aggregation.strategy === "language-group-mean") {
    console.log(`    raw mean  ${entry.aggregation.rawScore.toFixed(3)}`)
  }
  if (lowestSignal !== undefined) {
    console.log(`    lowest    ${lowestSignal.signalId} ${lowestSignal.score.toFixed(3)}`)
  }
  if (entry.aggregation.shapedByPressure) {
    console.log("    formula   min(aggregate, 1 - pressure)")
  }
  console.log(`    weights   ${formatSignalWeights(entry.aggregation.weights)}`)
}

const lowestApplicableSignalEntry = (
  signals: Record<string, number>,
  signalMetadata: ObserverOutput["signalMetadata"] | undefined,
): { readonly signalId: string; readonly score: number } | undefined => {
  const entries = Object.entries(signals).filter(([signalId]) => {
    const applicability = signalMetadata?.[signalId]?.applicability
    return applicability === undefined || applicability === "applicable"
  })
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
