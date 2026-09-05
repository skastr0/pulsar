import { Schema } from "effect"

/**
 * The strongest evidence substrate a signal (or individual finding) relies on.
 *
 * This is intentionally separate from `tier`: tier describes execution and
 * cache semantics, while evidence class bounds what the result may claim.
 */
export const SignalEvidenceClass = Schema.Literals([
  "deterministic-ast",
  "manifest-fact",
  "reference-backed",
  "historical-fact",
  "statistical",
  "heuristic-pattern",
  "mixed",
])
export type SignalEvidenceClass = typeof SignalEvidenceClass.Type

export interface SignalTestReference {
  /** Repository-relative test file path. */
  readonly file: string
  /** Exact Bun test/it title in that file. */
  readonly testName: string
}

/** A known claim boundary paired with the executable fixture that proves it. */
export interface KnownFailureMode {
  readonly description: string
  readonly fixture: SignalTestReference
}

export const evidenceClassAllowsHardGate = (
  evidenceClass: SignalEvidenceClass,
): boolean =>
  evidenceClass === "deterministic-ast" ||
  evidenceClass === "manifest-fact" ||
  evidenceClass === "reference-backed"

export const evidenceClassAllowsPoison = (
  evidenceClass: SignalEvidenceClass,
): boolean =>
  evidenceClass === "deterministic-ast" || evidenceClass === "manifest-fact"
