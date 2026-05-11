import {
  aiAssistedModeEnabled,
  type PulsarVector,
} from "../vector.js"
import type { PulsarVectorProposal } from "./proposal-schema.js"
import { sortedUniqueFiles } from "./proposal-utils.js"

export const deriveAiAssistedModeProposal = (input: {
  readonly changedFiles: ReadonlyArray<string>
  readonly toolName: string
  readonly vector: PulsarVector | undefined
  readonly now?: string
}): PulsarVectorProposal | undefined => {
  if (aiAssistedModeEnabled(input.vector)) return undefined

  return {
    schema_version: 1,
    id: "proposal-ai-assisted-mode",
    source: "ai-assisted-detection",
    domain: input.vector?.domain ?? "typescript",
    created_at: input.now ?? new Date().toISOString(),
    status: "pending-confirmation",
    confidence: 0.95,
    summary: "Detected agent-mediated editing; keep AI-assisted thresholds explicit instead of hidden.",
    changed_files: sortedUniqueFiles(input.changedFiles),
    evidence: [
      {
        kind: "observation",
        summary: `Observed edit tool '${input.toolName}' changing tracked files in this worktree.`,
        metadata: {
          tool: input.toolName,
          anti_dark_pattern:
            "The pulsar does not silently tighten thresholds. Accepting this proposal writes modes.ai_assisted into the vector; rejecting it preserves manual mode.",
        },
      },
    ],
    deltas: [],
    mode_deltas: [
      {
        mode: "ai_assisted",
        previous: false,
        proposed: true,
        rationale:
          "Agent edit tools were active in this worktree. Keep any tighter AI-assisted thresholds visible in the vector instead of inferring them through a hidden branch.",
      },
    ],
  }
}
