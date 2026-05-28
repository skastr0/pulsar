import { isExcluded } from "./shared-globs.js"
import { countNonEmptyLines } from "./ts-ld-07-output.js"
import type { SourceFile } from "./ts-ld-09-ast.js"
import { collectErrorChannelOpacityFindings } from "./ts-ld-09-collection.js"
import type {
  ErrorChannelOpacityFileSummary,
  ErrorChannelOpacityFinding,
  ErrorChannelOpacityKind,
  TsLd09Config,
  TsLd09Output,
} from "./ts-ld-09-types.js"

export const computeErrorChannelOpacityOutput = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsLd09Config,
): TsLd09Output => {
  const byFile = new Map<string, ErrorChannelOpacityFileSummary>()
  const byKind = new Map<ErrorChannelOpacityKind, number>()
  const findings: Array<ErrorChannelOpacityFinding> = []
  let analyzedFiles = 0
  let analyzedLines = 0

  for (const sourceFile of sourceFiles) {
    const file = sourceFile.getFilePath()
    if (sourceFile.isDeclarationFile() || isExcluded(file, config.exclude_globs)) continue

    analyzedFiles += 1
    analyzedLines += countNonEmptyLines(sourceFile)

    const fileFindings = collectErrorChannelOpacityFindings(sourceFile, config)
      .map((finding) => ({ ...finding, file }))
      .sort(compareErrorChannelFindings)

    if (fileFindings.length === 0) continue

    findings.push(...fileFindings)
    byFile.set(file, summarizeFileFindings(fileFindings))
    for (const finding of fileFindings) {
      byKind.set(finding.kind, (byKind.get(finding.kind) ?? 0) + 1)
    }
  }

  findings.sort(compareErrorChannelFindings)
  return buildErrorChannelOpacityOutput(byFile, byKind, findings, analyzedFiles, analyzedLines, config)
}

const buildErrorChannelOpacityOutput = (
  byFile: ReadonlyMap<string, ErrorChannelOpacityFileSummary>,
  byKind: ReadonlyMap<ErrorChannelOpacityKind, number>,
  findings: ReadonlyArray<ErrorChannelOpacityFinding>,
  analyzedFiles: number,
  analyzedLines: number,
  config: TsLd09Config,
): TsLd09Output => {
  const weightedOpacity = findings.reduce((sum, finding) => sum + finding.weight, 0)
  const boundaryFindings = findings.filter((finding) => finding.boundary).length
  const boundaryWeightedOpacity = findings.reduce(
    (sum, finding) => sum + (finding.boundary ? finding.weight : 0),
    0,
  )
  const analyzedKloc = Math.max(1, analyzedLines / 1000)
  const densityPerKloc = weightedOpacity / analyzedKloc
  const diagnosticLimit = normalizeDiagnosticLimit(config.top_n_diagnostics)

  return {
    state: analyzedFiles === 0 ? "not_applicable" : findings.length === 0 ? "zero" : "present",
    findings,
    topFindings: findings.slice(0, diagnosticLimit),
    byFile,
    byKind,
    totalFindings: findings.length,
    boundaryFindings,
    weightedOpacity,
    boundaryWeightedOpacity,
    analyzedFiles,
    analyzedLines,
    densityPerKloc,
    densityPressure: thresholdPressure(densityPerKloc, config.max_weighted_opacity_per_kloc),
    boundaryPressure: thresholdPressure(
      boundaryWeightedOpacity,
      config.max_boundary_weighted_opacity,
    ),
    densityThreshold: config.max_weighted_opacity_per_kloc,
    boundaryThreshold: config.max_boundary_weighted_opacity,
    diagnosticLimit,
    compositeConsumers: [
      "contract safety gap",
      "review shock",
      "theory encoding index",
    ],
    cacheContributors: [
      "source tree",
      "config.exclude_globs",
      "config.expected_failure_name_patterns",
      "config.max_weighted_opacity_per_kloc",
      "config.max_boundary_weighted_opacity",
      "config.top_n_diagnostics",
    ],
    calibrationSurface:
      "config thresholds and exclude globs; future typescript.error-channel-policy can deweight intentional adapters with provenance",
    evidenceClass: [
      "syntax",
      "type",
      "runtime boundary",
    ],
    claimLimit:
      "Identifies code where expected failure semantics are hidden behind broad exceptions, opaque promises, or collapsed Effect error channels.",
    nonClaimLimit:
      "Does not prove the error behavior is incorrect or that every expected failure has been modeled.",
    knownFailureMode:
      "Name-pattern expected-failure evidence can miss domain-specific operation names or flag intentional boundary translation.",
    enforcementCeiling: ["soft-warning", "trend", "review-routing"],
  }
}

const summarizeFileFindings = (
  findings: ReadonlyArray<ErrorChannelOpacityFinding>,
): ErrorChannelOpacityFileSummary => ({
  findings: findings.length,
  boundaryFindings: findings.filter((finding) => finding.boundary).length,
  weightedOpacity: findings.reduce((sum, finding) => sum + finding.weight, 0),
  boundaryWeightedOpacity: findings.reduce(
    (sum, finding) => sum + (finding.boundary ? finding.weight : 0),
    0,
  ),
})

const compareErrorChannelFindings = (
  left: ErrorChannelOpacityFinding,
  right: ErrorChannelOpacityFinding,
): number => {
  if (left.boundary !== right.boundary) return left.boundary ? -1 : 1
  const byWeight = right.weight - left.weight
  if (byWeight !== 0) return byWeight
  if (left.file !== right.file) return left.file < right.file ? -1 : 1
  return left.line - right.line || left.column - right.column
}

const thresholdPressure = (value: number, threshold: number): number =>
  threshold <= 0 ? 0 : value / threshold

const normalizeDiagnosticLimit = (limit: number): number => {
  if (!Number.isFinite(limit)) return 0
  const integerLimit = Math.floor(limit)
  return integerLimit <= 0 ? 0 : integerLimit
}
