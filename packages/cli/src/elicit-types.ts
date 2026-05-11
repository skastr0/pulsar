import {
  type PulsarVector,
  type QuizItem,
  QuizResponse,
  type QuizSession,
  type RevealedPreferenceSample,
} from "@skastr0/pulsar-core/vector"
import { type ObserverOutput } from "@skastr0/pulsar-core/observer"

export interface ElicitCommandOptions {
  readonly action: "quiz" | "bootstrap" | "review" | "accept" | "reject"
  readonly items?: number
  readonly commits?: number
  readonly repoPath: string
  readonly outputPath?: string
  readonly resumePath?: string
  readonly vectorPath?: string
  readonly presetId?: string
  readonly proposalId?: string
  readonly force?: boolean
}

export interface MutableQuizSession {
  schema_version: 1
  session_id: string
  created_at: string
  updated_at: string
  domain: string
  item_target: number
  output_path: string
  base_vector: PulsarVector
  asked_item_ids: Array<string>
  responses: Array<typeof QuizResponse.Type>
  completed: boolean
}

export interface ProposalPaths {
  readonly pulsarDir: string
  readonly pendingDir: string
  readonly acceptedDir: string
  readonly rejectedDir: string
  readonly revealedPreferenceDir: string
  readonly worktreeVectorPath: string
}

export interface CommitLogEntry {
  readonly sha: string
  readonly parents: ReadonlyArray<string>
  readonly subject: string
  readonly body: string
  readonly changedFiles: ReadonlyArray<string>
  readonly revertTarget: string | undefined
  readonly isRevertCommit: boolean
}

export interface ScoredCommitLogEntry extends CommitLogEntry {
  readonly observer: ObserverOutput
}

export interface RevealedPreferenceCommitEvent extends RevealedPreferenceSample {
  readonly sha: string
  readonly subject: string
  readonly related_sha?: string
  readonly changed_files: ReadonlyArray<string>
  readonly detected_by: "survived-history" | "followup-overlap" | "revert-commit"
}

export interface RevealedPreferenceBootstrapReport {
  readonly schema_version: 1
  readonly created_at: string
  readonly repo_root: string
  readonly head_sha: string
  readonly base_vector: string
  readonly algorithm: "pairwise" | "prior-adjusted"
  readonly sample_count: number
  readonly minimum_sample_count: number
  readonly sufficient_data: boolean
  readonly compared_pairs: number
  readonly outcome_counts: OutcomeCounts
  readonly support: Readonly<Record<string, number>>
  readonly weights: Readonly<Record<string, number>>
  readonly events: ReadonlyArray<RevealedPreferenceCommitEvent>
}

export interface OutcomeCounts {
  readonly accepted: number
  readonly revised: number
  readonly reverted: number
}

export interface BootstrapActionContext {
  readonly repoRoot: string
  readonly baseVector: PulsarVector | undefined
  readonly baseVectorLabel: string
  readonly baseVectorSourceLabel: string
  readonly presetId: string | undefined
  readonly scoredCommits: ReadonlyArray<ScoredCommitLogEntry>
  readonly events: ReadonlyArray<RevealedPreferenceCommitEvent>
}

export interface BootstrapInferenceResult {
  readonly algorithm: "pairwise" | "prior-adjusted"
  readonly sampleCount: number
  readonly comparedPairs: number
  readonly support: Readonly<Record<string, number>>
  readonly weights: Readonly<Record<string, number>>
  readonly outcomeCounts: OutcomeCounts
}

export interface QuizActionContext {
  readonly sessionPath: string
  readonly outputPath: string
  readonly quizItems: ReadonlyArray<QuizItem>
  readonly session: MutableQuizSession
}
