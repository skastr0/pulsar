import type { Category } from "@skastr0/pulsar-core/signal"
import type {
  BisectReport,
  Culprit,
  ObserverBisectReport,
  ObserverCommitEntry,
} from "./bisect.js"

export const printJsonReport = (report: BisectReport | ObserverBisectReport): void => {
  console.log(JSON.stringify(report, null, 2))
}

export const printHumanReport = (report: BisectReport, elapsedMs: number): void => {
  const lines = [
    ...signalHeaderLines(report, elapsedMs),
    ...signalScoreSummaryLines(report),
    ...signalTrajectoryLines(report),
    ...signalCulpritLines(report),
    ...signalDriftCulpritLines(report),
    "",
  ]
  for (const line of lines) console.log(line)
}

const signalHeaderLines = (report: BisectReport, elapsedMs: number): ReadonlyArray<string> => [
  "",
  `  Repo:    ${report.repoPath}`,
  `  Signal:  ${report.signalId}`,
  `  Range:   ${report.fromSha}..${report.toSha}`,
  `  Commits: ${report.trajectory.length}  (${elapsedMs}ms)`,
  ...(report.sampling.scoredCommits === report.sampling.totalCommits
    ? []
    : [
        `  Sample:  ${report.sampling.applied} (${report.sampling.scoredCommits}/${report.sampling.totalCommits} commits scored)`,
      ]),
  ...report.sampling.diagnostics.map((diagnostic) => `  Note:    ${diagnostic}`),
]

const signalScoreSummaryLines = (report: BisectReport): ReadonlyArray<string> => [
  "",
  `  Scores:  min ${report.minScore.toFixed(3)}   max ${report.maxScore.toFixed(3)}   final ${report.finalScore.toFixed(3)}   drift ${report.totalDrift.toFixed(3)}`,
  ...(report.firstCrossing === undefined
    ? []
    : [
        `  First crossing: ${report.firstCrossing.target} ${report.firstCrossing.op} ${report.firstCrossing.threshold} at ${report.firstCrossing.sha.slice(0, 8)} (${report.firstCrossing.score.toFixed(3)})`,
      ]),
]

const signalTrajectoryLines = (report: BisectReport): ReadonlyArray<string> => [
  "",
  "  Trajectory (oldest → newest):",
  ...report.trajectory.map(
    (entry) =>
      `    ${entry.sha.slice(0, 8)}  ${entry.score.toFixed(3)}  ${renderScoreBar(entry.score)}  (${entry.diagnosticsCount} diag)`,
  ),
  "",
]

const signalCulpritLines = (report: BisectReport): ReadonlyArray<string> =>
  report.culprits.length === 0
    ? ["  No score-degrading commits in range."]
    : [
        `  Top ${report.culprits.length} culprit commits (largest score drops):`,
        ...report.culprits.map((culprit) => `    ${formatCulprit(culprit, "drop")}`),
      ]

const signalDriftCulpritLines = (report: BisectReport): ReadonlyArray<string> =>
  shouldPrintDriftCulprits(report.culprits, report.driftCulprits)
    ? [
        "",
        `  Top ${report.driftCulprits.length} drift culprits (sustained deficit):`,
        ...report.driftCulprits.map((culprit) => `    ${formatCulprit(culprit, "drift")}`),
      ]
    : []

export const printObserverHumanReport = (
  report: ObserverBisectReport,
  elapsedMs: number,
  applicableSignalCount: number,
): void => {
  const finalEntry = report.trajectory[report.trajectory.length - 1]
  const lines = [
    ...observerHeaderLines(report, elapsedMs, applicableSignalCount),
    ...observerScoreSummaryLines(report, finalEntry),
    ...observerCategoryScoreLines(report, finalEntry),
    ...observerCategorySummaryLines(report),
    ...culpritSectionLines(
      "readiness",
      report.readinessCulprits,
      "No readiness degrading commits in range.",
    ),
    ...driftCulpritSectionLines(
      "readiness",
      report.readinessCulprits,
      report.readinessDriftCulprits,
    ),
    ...culpritSectionLines(
      "evidence-mean",
      report.weightedMeanCulprits,
      "No evidence-mean degrading commits in range.",
    ),
    ...driftCulpritSectionLines(
      "evidence-mean",
      report.weightedMeanCulprits,
      report.weightedMeanDriftCulprits,
    ),
    ...perCategoryLeaderLines(report),
    ...signalLeaderLines(report),
    ...firstCrossingLines(report),
    "",
  ]
  for (const line of lines) console.log(line)
}

const observerHeaderLines = (
  report: ObserverBisectReport,
  elapsedMs: number,
  applicableSignalCount: number,
): ReadonlyArray<string> => {
  const lines = [
    "",
    `  Repo:    ${report.repoPath}`,
    "  Mode:    observer",
    ...(report.vectorName === null ? [] : [`  Vector:  ${report.vectorName}`]),
    `  Range:   ${report.fromSha}..${report.toSha}`,
    `  Commits: ${report.trajectory.length}  (${elapsedMs}ms)`,
  ]
  if (report.sampling.scoredCommits !== report.sampling.totalCommits) {
    lines.push(
      `  Sample:  ${report.sampling.applied} (${report.sampling.scoredCommits}/${report.sampling.totalCommits} commits scored)`,
    )
  }
  lines.push(`  Evidence: ${applicableSignalCount} applicable signals`)
  lines.push(...report.sampling.diagnostics.map((diagnostic) => `  Note:    ${diagnostic}`))
  return lines
}

const observerScoreSummaryLines = (
  report: ObserverBisectReport,
  finalEntry: ObserverCommitEntry | undefined,
): ReadonlyArray<string> => [
  "",
  ...(report.finalReadinessScore === undefined
    ? []
    : [
        `  Readiness: min ${report.minReadinessScore?.toFixed(3) ?? "n/a"}   max ${report.maxReadinessScore?.toFixed(3) ?? "n/a"}   final ${report.finalReadinessScore.toFixed(3)}   drift ${report.readinessDrift?.toFixed(3) ?? "n/a"}   pressure ${finalEntry?.readinessPressure?.toFixed(3) ?? "n/a"} ${finalEntry?.readinessStatus ?? ""}`,
      ]),
  `  Evidence mean: min ${report.minWeightedMean.toFixed(3)}   max ${report.maxWeightedMean.toFixed(3)}   final ${report.finalWeightedMean.toFixed(3)}   drift ${report.totalDrift.toFixed(3)}`,
  `  Final hard gate: ${report.hardGateStatusAtFinal}`,
  ...(report.finalMinimumDimension === undefined
    ? []
    : [
        `  Final minimum dimension: ${report.finalMinimumDimension.signal} / ${report.finalMinimumDimension.category} @ ${report.finalMinimumDimension.score.toFixed(3)}`,
      ]),
]

const observerCategoryScoreLines = (
  report: ObserverBisectReport,
  finalEntry: ObserverCommitEntry | undefined,
): ReadonlyArray<string> => [
  "",
  "  HEAD category scores:",
  ...report.selectedCategories.map((category) => {
    const score = finalEntry?.categories[category] ?? 1
    const signalCount = countFinalApplicableSignalsByCategory(finalEntry, category)
    return `    ${padCategory(category)}  ${score.toFixed(3)}  ${renderScoreBar(score)}  (${signalCount} applicable)`
  }),
]

const observerCategorySummaryLines = (
  report: ObserverBisectReport,
): ReadonlyArray<string> => [
  "",
  "  Category trajectory summary:",
  ...report.selectedCategories.map((category) => {
    const summary = report.perCategory[category]
    return `    ${padCategory(category)}  min ${summary.min.toFixed(3)}   max ${summary.max.toFixed(3)}   final ${summary.final.toFixed(3)}   drift ${summary.drift.toFixed(3)}   levels ${summary.distinctLevels}`
  }),
  "",
]

const culpritSectionLines = (
  label: string,
  culprits: ReadonlyArray<Culprit>,
  emptyMessage: string,
): ReadonlyArray<string> =>
  culprits.length === 0
    ? [emptyMessage]
    : [
        `  Top ${culprits.length} ${label} culprit commits:`,
        ...culprits.map((culprit) => `    ${formatCulprit(culprit, "drop")}`),
      ]

const driftCulpritSectionLines = (
  label: string,
  adjacent: ReadonlyArray<Culprit>,
  drift: ReadonlyArray<Culprit>,
): ReadonlyArray<string> =>
  shouldPrintDriftCulprits(adjacent, drift)
    ? [
        "",
        `  Top ${drift.length} ${label} drift culprits:`,
        ...drift.map((culprit) => `    ${formatCulprit(culprit, "drift")}`),
        "",
      ]
    : [""]

const formatCulprit = (culprit: Culprit, label: "drop" | "drift"): string =>
  `${culprit.sha.slice(0, 8)}  ${label} ${culprit.drop.toFixed(3)}   ${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)}  (from ${culprit.prevSha.slice(0, 8)})`

const perCategoryLeaderLines = (report: ObserverBisectReport): ReadonlyArray<string> => [
  "  Per-category culprit leaders:",
  ...report.selectedCategories.map((category) => {
    const culprit = report.perCategoryCulprits[category][0]
    if (culprit === undefined) return `    ${padCategory(category)}  none`
    return `    ${padCategory(category)}  ${culprit.sha.slice(0, 8)}  drop ${culprit.drop.toFixed(3)}  (${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)})`
  }),
]

const signalLeaderLines = (report: ObserverBisectReport): ReadonlyArray<string> => {
  const signalLeaders = Object.entries(report.perSignalCulprits)
    .map(([signalId, culprits]) => ({ signalId, culprit: culprits[0] }))
    .filter(
      (entry): entry is { signalId: string; culprit: Culprit } =>
        entry.culprit !== undefined,
    )
    .sort((a, b) => b.culprit.drop - a.culprit.drop)
    .slice(0, 5)
  if (signalLeaders.length === 0) return []
  return [
    "",
    `  Top ${signalLeaders.length} signal culprit leaders:`,
    ...signalLeaders.map(
      ({ signalId, culprit }) =>
        `    ${signalId.padEnd(10, " ")}  ${culprit.sha.slice(0, 8)}  drop ${culprit.drop.toFixed(3)}  (${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)})`,
    ),
  ]
}

const firstCrossingLines = (report: ObserverBisectReport): ReadonlyArray<string> =>
  report.firstCrossing === undefined
    ? []
    : [
        "",
        `  First crossing: ${report.firstCrossing.target} ${report.firstCrossing.op} ${report.firstCrossing.threshold} at ${report.firstCrossing.sha.slice(0, 8)} (${report.firstCrossing.score.toFixed(3)})`,
      ]

const padCategory = (category: Category): string => category.padEnd(20, " ")

export const countFinalApplicableSignalsByCategory = (
  finalEntry: ObserverCommitEntry | undefined,
  category: Category,
): number => {
  if (finalEntry === undefined) return 0
  return finalEntry.categoryApplicableSignalCounts[category]
}

const shouldPrintDriftCulprits = (
  adjacent: ReadonlyArray<Culprit>,
  drift: ReadonlyArray<Culprit>,
): boolean => {
  if (drift.length === 0) return false
  if (adjacent.length !== drift.length) return true
  return adjacent.some((culprit, index) => culprit.sha !== drift[index]?.sha)
}

const renderScoreBar = (score: number): string => {
  const width = 20
  const filled = Math.max(0, Math.min(width, Math.round(score * width)))
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}]`
}
