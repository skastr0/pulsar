import { createHash } from "node:crypto"
import { Schema } from "effect"
import { stableCalibrationStringify } from "./calibration-fingerprint.js"

export const AI_FACT_ARTIFACT_SCHEMA_VERSION = "pulsar.ai_fact_label.v1" as const
export const AI_FACT_REPLAY_OUTPUT_SCHEMA_VERSION = "pulsar.ai_fact_replay_output.v1" as const

export const AiFactInputScope = Schema.Literal(
  "file",
  "symbol",
  "module",
  "diff",
  "commit",
  "repository",
)
export type AiFactInputScope = typeof AiFactInputScope.Type

export const AiFactEnforcementCeiling = Schema.Literal(
  "informational",
  "review-route",
  "soft-warning",
)
export type AiFactEnforcementCeiling = typeof AiFactEnforcementCeiling.Type

export const AiFactArtifactMode = Schema.Literal("model-run", "offline-replay")
export type AiFactArtifactMode = typeof AiFactArtifactMode.Type

export const AiFactEvidenceRef = Schema.Struct({
  path: Schema.String,
  line: Schema.optional(Schema.Number),
  symbol: Schema.optional(Schema.String),
  quote_hash: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
})
export type AiFactEvidenceRef = typeof AiFactEvidenceRef.Type

export const AiFactClassifierDescriptor = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  prompt_id: Schema.String,
  prompt_fingerprint: Schema.String,
  model_id: Schema.String,
  model_provider: Schema.optional(Schema.String),
})
export type AiFactClassifierDescriptor = typeof AiFactClassifierDescriptor.Type

export const AiFactInputDescriptor = Schema.Struct({
  scope: AiFactInputScope,
  content_hash: Schema.String,
  input_fingerprint: Schema.String,
  source_paths: Schema.Array(Schema.String),
  git_sha: Schema.optional(Schema.String),
  symbol: Schema.optional(Schema.String),
})
export type AiFactInputDescriptor = typeof AiFactInputDescriptor.Type

export const AiFactLabel = Schema.Struct({
  kind: Schema.String,
  value: Schema.Unknown,
  confidence: Schema.Number.pipe(Schema.between(0, 1)),
  rationale: Schema.String,
  evidence: Schema.Array(AiFactEvidenceRef),
})
export type AiFactLabel = typeof AiFactLabel.Type

export const AiFactPolicy = Schema.Struct({
  enforcement_ceiling: AiFactEnforcementCeiling,
  missing_label_behavior: Schema.Literal("fail-open", "ignore", "soft-warn"),
  stale_after_days: Schema.optional(Schema.Number),
  expires_at: Schema.optional(Schema.String),
  review_route: Schema.optional(Schema.String),
})
export type AiFactPolicy = typeof AiFactPolicy.Type

export const AiFactProvenance = Schema.Struct({
  mode: AiFactArtifactMode,
  created_at: Schema.String,
  created_by: Schema.String,
  source: Schema.Literal("committed-fixture", "repo-artifact", "generated-cache"),
})
export type AiFactProvenance = typeof AiFactProvenance.Type

export const AiFactLabelArtifact = Schema.Struct({
  schema_version: Schema.Literal(AI_FACT_ARTIFACT_SCHEMA_VERSION),
  artifact_id: Schema.String,
  classifier: AiFactClassifierDescriptor,
  input: AiFactInputDescriptor,
  label: AiFactLabel,
  policy: AiFactPolicy,
  provenance: AiFactProvenance,
})
export type AiFactLabelArtifact = typeof AiFactLabelArtifact.Type

export const AiFactReplayOutput = Schema.Struct({
  schema_version: Schema.Literal(AI_FACT_REPLAY_OUTPUT_SCHEMA_VERSION),
  artifact_id: Schema.String,
  fact_source: Schema.Literal("ai_classified"),
  label: AiFactLabel,
  classifier: AiFactClassifierDescriptor,
  input: AiFactInputDescriptor,
  policy: AiFactPolicy,
  provenance: AiFactProvenance,
  cache_fingerprint: Schema.String,
  artifact_fingerprint: Schema.String,
})
export type AiFactReplayOutput = typeof AiFactReplayOutput.Type

export const decodeAiFactLabelArtifactSync =
  Schema.decodeUnknownSync(AiFactLabelArtifact)

export const computeAiFactCacheFingerprint = (
  artifact: AiFactLabelArtifact,
): string =>
  sha256({
    schema_version: artifact.schema_version,
    classifier: {
      id: artifact.classifier.id,
      version: artifact.classifier.version,
      prompt_id: artifact.classifier.prompt_id,
      prompt_fingerprint: artifact.classifier.prompt_fingerprint,
      model_id: artifact.classifier.model_id,
    },
    input: {
      scope: artifact.input.scope,
      content_hash: artifact.input.content_hash,
      input_fingerprint: artifact.input.input_fingerprint,
      source_paths: [...artifact.input.source_paths].sort(),
      symbol: artifact.input.symbol ?? null,
    },
  })

export const computeAiFactArtifactFingerprint = (
  artifact: AiFactLabelArtifact,
): string => sha256(artifact)

export const replayAiFactArtifact = (
  artifact: AiFactLabelArtifact,
): AiFactReplayOutput => ({
  schema_version: AI_FACT_REPLAY_OUTPUT_SCHEMA_VERSION,
  artifact_id: artifact.artifact_id,
  fact_source: "ai_classified",
  label: artifact.label,
  classifier: artifact.classifier,
  input: {
    ...artifact.input,
    source_paths: [...artifact.input.source_paths].sort(),
  },
  policy: artifact.policy,
  provenance: artifact.provenance,
  cache_fingerprint: computeAiFactCacheFingerprint(artifact),
  artifact_fingerprint: computeAiFactArtifactFingerprint(artifact),
})

export const serializeAiFactReplayOutput = (
  output: AiFactReplayOutput,
): string => stableCalibrationStringify(output)

const sha256 = (value: unknown): string =>
  createHash("sha256").update(stableCalibrationStringify(value)).digest("hex")
