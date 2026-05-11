import type { Diagnostic, ObserverOutput } from "@skastr0/pulsar-core"
import { isAbsolute, relative } from "node:path"
import { fixedWidthLabel } from "./score-format.js"

export const TOP_FINDINGS_LIMIT = 5

const TOP_FINDING_HEALTHY_SCORE_CUTOFF = 0.995
const DIAGNOSTIC_DETAIL_MAX_LENGTH = 220

export const pushTopDiagnostics = (
  lines: Array<string>,
  repoRoot: string,
  output: ObserverOutput,
  signalIds: ReadonlyArray<string>,
  limit: number,
): void => {
  lines.push(...topDiagnosticLines(repoRoot, output, signalIds, limit))
}

export const printTopDiagnostics = (
  repoRoot: string,
  output: ObserverOutput,
  signalIds: ReadonlyArray<string>,
  limit: number,
): void => {
  for (const line of topDiagnosticLines(repoRoot, output, signalIds, limit)) {
    console.log(line)
  }
}

export const formatCalibrationLine = (output: ObserverOutput): string | undefined => {
  if (output.calibration === undefined) return undefined
  const count = output.calibration.active_modules.length
  const noun = count === 1 ? "module" : "modules"
  return `${count} ${noun} / ${output.calibration.fingerprint.slice(0, 12)}`
}

export const severityLabel = (diagnostic: Diagnostic): "BLOCK" | "WARN" | "INFO" =>
  diagnostic.severity === "block"
    ? "BLOCK"
    : diagnostic.severity === "warn"
      ? "WARN"
      : "INFO"

export const diagnosticMessage = (repoPath: string, diagnostic: Diagnostic): string => {
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

export const diagnosticLocation = (repoPath: string, diagnostic: Diagnostic): string | undefined => {
  const file = diagnostic.location?.file
  if (file === undefined) return undefined
  const normalized = file.replace(/\\/g, "/")
  const displayFile = isAbsolute(normalized)
    ? relative(repoPath, normalized).replace(/\\/g, "/")
    : normalized.replace(/^\.\//, "")
  return `${displayFile}${diagnostic.location?.line !== undefined ? `:${diagnostic.location.line}` : ""}`
}

export const diagnosticDetailLines = (
  repoPath: string,
  diagnostic: Diagnostic,
): ReadonlyArray<string> => {
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

const severityRank = (diagnostic: Diagnostic): number =>
  diagnostic.severity === "block" ? 2 : diagnostic.severity === "warn" ? 1 : 0

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
