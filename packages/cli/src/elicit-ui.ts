import {
  type PulsarVector,
} from "@skastr0/pulsar-core/vector"
import {
  type PulsarVectorProposal,
  type QuizItem,
} from "@skastr0/pulsar-core/elicitation"
import { renderVectorDiff, summarizeVectorDiff } from "./vector-format.js"
import type { RevealedPreferenceBootstrapReport } from "./elicit-types.js"

const greenAnsi = "\u001b[32m"
const cyanAnsi = "\u001b[36m"
const boldAnsi = "\u001b[1m"
export const dimAnsi = "\u001b[2m"
export const resetAnsi = "\u001b[0m"

export const renderQuizItem = (questionNumber: number, totalQuestions: number, item: QuizItem): void => {
  console.log(`${boldAnsi}Question ${questionNumber}/${totalQuestions} — ${item.prompt}${resetAnsi}`)
  console.log("")
  console.log(`${greenAnsi}[A] ${item.a_title}${resetAnsi}`)
  console.log(colorizeCode(item.a_code, greenAnsi))
  console.log("")
  console.log(`${cyanAnsi}[B] ${item.b_title}${resetAnsi}`)
  console.log(colorizeCode(item.b_code, cyanAnsi))
  console.log("")
}

export const printFinalQuizVector = (
  outputPath: string,
  baseVector: PulsarVector,
  nextVector: PulsarVector,
): void => {
  console.log("")
  console.log(`${boldAnsi}Final vector saved to ${outputPath}${resetAnsi}`)
  console.log("")
  for (const line of renderVectorDiff(summarizeVectorDiff(baseVector, nextVector))) {
    console.log(line)
  }
  console.log("")
}

export const printBootstrapReport = (input: {
  readonly repoRoot: string
  readonly baseVectorLabel: string
  readonly baseVectorSourceLabel: string
  readonly report: RevealedPreferenceBootstrapReport
  readonly proposal: PulsarVectorProposal
  readonly proposalPath: string
  readonly reportPath: string
  readonly usedPriorPreset?: string
}): void => {
  console.log("")
  console.log("Revealed-preference bootstrap")
  console.log("")
  console.log(`  Repo:            ${input.repoRoot}`)
  console.log(`  Head:            ${input.report.head_sha}`)
  console.log(`  Base vector:     ${input.baseVectorLabel}`)
  console.log(`  Vector Source:   ${input.baseVectorSourceLabel}`)
  console.log(`  Algorithm:       ${input.report.algorithm}`)
  console.log(`  Labeled events:  ${input.report.sample_count}/${input.report.minimum_sample_count} ${dataSufficiencyLabel(input.report.sample_count, input.report.minimum_sample_count)}`)
  console.log(
    `  Outcomes:        accepted ${input.report.outcome_counts.accepted}, revised ${input.report.outcome_counts.revised}, reverted ${input.report.outcome_counts.reverted}`,
  )
  console.log(`  Compared pairs:  ${input.report.compared_pairs}`)
  console.log(`  Proposal confidence: ${(input.proposal.confidence * 100).toFixed(0)}%`)
  if (input.usedPriorPreset !== undefined) {
    console.log(`  Prior preset:    ${input.usedPriorPreset}`)
  }
  console.log(`  Pending proposal:${input.proposalPath}`)
  console.log(`  Evidence report: ${input.reportPath}`)
  console.log("")
  console.log("Support / proposed weights:")
  for (const delta of input.proposal.deltas.slice(0, 8)) {
    console.log(
      `  ${delta.signal_id.padEnd(12)} support ${formatSigned(delta.support ?? 0).padStart(5)}  weight ${delta.previous_weight.toFixed(2)} -> ${delta.proposed_weight.toFixed(2)}`,
    )
  }
  console.log("")
  console.log("Review with: pulsar elicit review .")
  console.log("")
}

export const renderProposalReview = (proposal: PulsarVectorProposal): void => {
  console.log(`${proposal.id}  [${proposal.source}]  confidence ${(proposal.confidence * 100).toFixed(0)}%`)
  console.log(`  ${proposal.summary}`)

  const bootstrapStats = extractBootstrapStats(proposal)
  if (bootstrapStats !== undefined) {
    console.log(
      `  Data sufficiency: ${bootstrapStats.sampleCount}/${bootstrapStats.minimumSampleCount} ${dataSufficiencyLabel(bootstrapStats.sampleCount, bootstrapStats.minimumSampleCount)}; compared pairs ${bootstrapStats.comparedPairs}`,
    )
  }

  if (proposal.mode_deltas.length > 0) {
    console.log("  Mode deltas:")
    for (const delta of proposal.mode_deltas) {
      console.log(`    ${delta.mode} ${String(delta.previous)} -> ${String(delta.proposed)}`)
      console.log(`      ${delta.rationale}`)
    }
  }

  if (proposal.deltas.length > 0) {
    console.log("  Signal deltas:")
    for (const delta of proposal.deltas.slice(0, 8)) {
      const supportSuffix = delta.support !== undefined ? `, support ${formatSigned(delta.support)}` : ""
      const scoreSuffix =
        delta.previous_score !== undefined && delta.current_score !== undefined
          ? `, score ${delta.previous_score.toFixed(2)} -> ${delta.current_score.toFixed(2)}`
          : ""
      console.log(
        `    ${delta.signal_id} weight ${delta.previous_weight.toFixed(2)} -> ${delta.proposed_weight.toFixed(2)}${supportSuffix}${scoreSuffix}`,
      )
    }
  }

  const reportArtifact = proposal.evidence.find((entry) => entry.artifact_path !== undefined)?.artifact_path
  if (reportArtifact !== undefined) {
    console.log(`  Artifact: ${reportArtifact}`)
  }

  if (proposal.source === "ai-assisted-detection") {
    console.log("  Anti-dark-pattern stance:")
    console.log("    Accepting writes modes.ai_assisted into the vector. Rejecting preserves manual thresholds.")
    console.log("    The pulsar does not silently enable AI-assisted mode behind a hidden switch.")
  }
}

const dataSufficiencyLabel = (sampleCount: number, minimumSampleCount: number): string =>
  sampleCount >= minimumSampleCount ? "(meets minimum)" : "(below minimum — kept pending)"

const formatSigned = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`

const colorizeCode = (code: string, color: string): string =>
  code
    .split("\n")
    .map((line) => `${color}${line}${resetAnsi}`)
    .join("\n")

const extractBootstrapStats = (
  proposal: PulsarVectorProposal,
):
  | {
      readonly sampleCount: number
      readonly minimumSampleCount: number
      readonly comparedPairs: number
    }
  | undefined => {
  const evidence = proposal.evidence.find((entry) => entry.kind === "proposal")
  const sampleCount = numberMeta(evidence?.metadata, "sample_count")
  const minimumSampleCount = numberMeta(evidence?.metadata, "minimum_sample_count")
  const comparedPairs = numberMeta(evidence?.metadata, "compared_pairs")
  if (sampleCount === undefined || minimumSampleCount === undefined || comparedPairs === undefined) {
    return undefined
  }
  return { sampleCount, minimumSampleCount, comparedPairs }
}

const numberMeta = (
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined => {
  const value = metadata?.[key]
  return typeof value === "number" ? value : undefined
}
