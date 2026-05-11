import type {
  CalibrationDecision,
  Diagnostic,
  SignalFactorLedger,
  SignalFactorLedgerEntry,
} from "@skastr0/pulsar-core"
import {
  diagnosticDetailLines,
  diagnosticLocation,
  diagnosticMessage,
  severityLabel,
} from "./score-diagnostics.js"
import { renderScoreBar } from "./score-format.js"

export const printSignalResult = (
  signalId: string,
  score: number,
  diagnostics: ReadonlyArray<Diagnostic>,
  output: unknown,
  factorLedger: SignalFactorLedger | undefined,
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
  printFactorAudit(factorLedger)
  console.log("")
}

const printFactorAudit = (factorLedger: SignalFactorLedger | undefined): void => {
  if (factorLedger === undefined) return
  const scoreBearing = factorLedger.entries.filter((entry) => entry.affectsScore)
  if (scoreBearing.length === 0) return

  console.log("")
  console.log(`  Factor Audit (${scoreBearing.length} score-bearing):`)
  for (const entry of topFactorEntries(scoreBearing, 8)) {
    const role = entry.scoreRole === undefined ? "" : ` ${entry.scoreRole}`
    console.log(`    ${entry.source.padEnd(8, " ")} ${entry.path}=${formatFactorValue(entry.value)}${role}`)
    const attribution = entry.attribution
    if (attribution?.ruleId !== undefined) {
      console.log(`      rule: ${attribution.ruleId}`)
    }
    for (const mutation of entry.mutations ?? []) {
      console.log(
        `      ${mutation.action}: ${formatFactorValue(mutation.before ?? null)} -> ${formatFactorValue(mutation.after)}${mutation.ruleId !== undefined ? ` (${mutation.ruleId})` : ""}`,
      )
    }
  }
  if (scoreBearing.length > 8) {
    console.log(`    ... ${scoreBearing.length - 8} more score-bearing factors`)
  }
}

const topFactorEntries = (
  entries: ReadonlyArray<SignalFactorLedgerEntry>,
  limit: number,
): ReadonlyArray<SignalFactorLedgerEntry> =>
  [...entries]
    .sort((left, right) => factorRoleRank(left) - factorRoleRank(right) || left.path.localeCompare(right.path))
    .slice(0, limit)

const factorRoleRank = (entry: SignalFactorLedgerEntry): number => {
  if (entry.source === "vector") return 0
  if (entry.source === "module") return 1
  if (entry.scoreRole === "score-cap") return 2
  if (entry.scoreRole === "penalty") return 3
  if (entry.scoreRole === "threshold") return 4
  return 5
}

const formatFactorValue = (value: unknown): string => {
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value)
  }
  return JSON.stringify(value)
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
