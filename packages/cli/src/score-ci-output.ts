import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import { formatLocation } from "./score-format.js"
import type { CiAssessment } from "./score.js"

export const printPaidDebt = (paidDebt: NonNullable<CiAssessment["comparison"]>["paidDebt"]): void => {
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

export const printCiSummary = (opts: {
  readonly repoRoot: string
  readonly gitSha: string
  readonly output: ObserverOutput
  readonly ciAssessment: CiAssessment
}): void => {
  if (opts.ciAssessment.mode === "missing-baseline") {
    console.error(
      `pulsar-ci status=pass baseline=missing sha=${opts.gitSha} current=${opts.output.hard_gate_violations.length}`,
    )
    console.error(
      `pulsar-ci warning=no-baseline path=${opts.ciAssessment.baselinePath} action="pulsar baseline set"`,
    )
    return
  }

  if (opts.ciAssessment.mode === "observer-config-mismatch") {
    console.error(
      `pulsar-ci status=fail baseline=${opts.ciAssessment.baselineSha} sha=${opts.gitSha} reason=observer-config-mismatch baseline_vector=${opts.ciAssessment.baselineVectorId ?? "unknown"} current_vector=${opts.ciAssessment.currentVectorId ?? "unknown"} baseline_config=${opts.ciAssessment.baselineObserverConfigHash ?? "unknown"} current_config=${opts.ciAssessment.currentObserverConfigHash ?? "unknown"}`,
    )
    console.error(
      `pulsar-ci warning=baseline-observer-config-mismatch action="pulsar baseline refresh"`,
    )
    return
  }

  if (opts.ciAssessment.mode !== "ratcheted") {
    console.error(
      `pulsar-ci status=${opts.ciAssessment.effectiveStatus} sha=${opts.gitSha} current=${opts.output.hard_gate_violations.length}`,
    )
    return
  }

  const comparison = opts.ciAssessment.comparison!
  console.error(
    `pulsar-ci status=${opts.ciAssessment.effectiveStatus} baseline=${opts.ciAssessment.baselineSha} sha=${opts.gitSha} new=${comparison.newViolations.length} tolerated=${comparison.tolerated.length} paid=${comparison.paidDebt.length}`,
  )
  if (comparison.newViolations.length === 0) return

  console.error("pulsar-ci new-violations:")
  for (const violation of comparison.newViolations) {
    console.error(
      `- ${violation.signalId} ${formatLocation({
        file: violation.file,
        ...(violation.line !== undefined ? { line: violation.line } : {}),
      })} :: ${violation.detail}`,
    )
  }
}

export const formatCiBaselineLine = (
  assessment: CiAssessment,
  output: ObserverOutput,
): string | undefined => {
  if (assessment.mode === "disabled") return undefined
  if (assessment.mode === "missing-baseline") {
    return `missing (${output.hard_gate_violations.length} current violation${output.hard_gate_violations.length === 1 ? "" : "s"}; run pulsar baseline set)`
  }
  if (assessment.mode === "observer-config-mismatch") {
    return `${assessment.baselineSha} (observer config mismatch: ${assessment.baselineVectorId ?? "unknown"} -> ${assessment.currentVectorId ?? "unknown"}; run pulsar baseline refresh)`
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

export const renderGateStatus = (status: "pass" | "fail", colorize: boolean): string => {
  if (!colorize) return status.toUpperCase()
  const color = status === "pass" ? "\u001b[32m" : "\u001b[31m"
  return `${color}${status.toUpperCase()}\u001b[0m`
}
