import { createHash } from "node:crypto"
import { Schema } from "effect"

const Severity = Schema.Literal("info", "warn", "block")
type Severity = typeof Severity.Type

const DiagnosticFixHintConfidence = Schema.Literal("low", "medium", "high")
type DiagnosticFixHintConfidence = typeof DiagnosticFixHintConfidence.Type

export const DiagnosticFixHint = Schema.Struct({
  kind: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  confidence: DiagnosticFixHintConfidence,
  autoApplicable: Schema.Boolean,
  diffHint: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type DiagnosticFixHint = typeof DiagnosticFixHint.Type

/**
 * A single actionable finding emitted by a signal's `diagnose` pass.
 *
 * Diagnostics are structured data, not strings. Downstream consumers
 * (review routing, bisect reports, harness adapters) render them
 * differently but should share the same underlying shape.
 *
 * `data` is optional structured metadata for downstream consumers.
 * Hard-gate signals that participate in ratcheting should set
 * `data.hash` to a stable identity string for the offending span.
 */
export const Diagnostic = Schema.Struct({
  severity: Severity,
  message: Schema.String,
  location: Schema.optional(
    Schema.Struct({
      file: Schema.String,
      line: Schema.optional(Schema.Number),
      column: Schema.optional(Schema.Number),
    }),
  ),
  data: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  fixHints: Schema.optional(Schema.Array(DiagnosticFixHint)),
})
export type Diagnostic = typeof Diagnostic.Type

export const computeDiagnosticHash = (input: string): string => {
  const hash = createHash("sha256")
  hash.update(input.replace(/\s+/g, " ").trim())
  return hash.digest("hex")
}

export const diagnosticHashOf = (diagnostic: Diagnostic): string | undefined => {
  const value = diagnostic.data?.hash
  return typeof value === "string" ? value : undefined
}
