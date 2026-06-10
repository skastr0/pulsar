import { Schema } from "effect"
import type { Diagnostic } from "./diagnostic.js"
import type { SignalKind, Tier } from "./tier.js"

const EnforcementLevel = Schema.Literal(
  "hard-gate",
  "soft-warning",
  "trend",
  "dashboard",
  "review-routing",
)
type EnforcementLevel = typeof EnforcementLevel.Type

export const EnforcementCeiling = Schema.Array(EnforcementLevel)
export type EnforcementCeiling = typeof EnforcementCeiling.Type

/**
 * Derive the enforcement ceiling for a (tier, kind) pair as specified
 * by the architecture document's Enforcement Policy Matrix.
 *
 * Signal weights in a pulsar vector adjust sensitivity WITHIN this ceiling.
 * They never lift it.
 */
/**
 * Whether a signal's evidence class licenses it to single-handedly set the
 * repo-level readiness/category headline (the "poison" rule in the
 * observer aggregators).
 *
 * Poison authority is deliberately STRICTER than hard-gate authority. A
 * hard gate blocks with cited violations and fix hints, and tier-2
 * structural signals earn it conditionally ("given reference data" — the
 * signal must withhold block findings when its reference data is missing
 * or stale). Poisoning a headline is a silent verdict with no citation
 * obligation, so it is reserved for proof-grade evidence: tier 1 (pure
 * computation) and tier 1.5 (deterministically derived from tier 1).
 */
export const hasPoisonAuthority = (signal: { readonly tier: Tier }): boolean =>
  signal.tier === 1 || signal.tier === 1.5

/**
 * Engine-level severity ceiling. Block-severity findings are gate inputs,
 * so only signals whose enforcement ceiling includes "hard-gate" may emit
 * them; anything else is downgraded to warn with an explicit note. A
 * signal cannot claim authority its evidence class does not license —
 * regardless of what its diagnose() pass writes.
 */
export const enforceSeverityCeiling = (
  enforcement: EnforcementCeiling,
  diagnostics: ReadonlyArray<Diagnostic>,
): ReadonlyArray<Diagnostic> => {
  if (enforcement.includes("hard-gate")) return diagnostics
  if (!diagnostics.some((diagnostic) => diagnostic.severity === "block")) return diagnostics
  return diagnostics.map((diagnostic) =>
    diagnostic.severity === "block"
      ? {
          ...diagnostic,
          severity: "warn" as const,
          message: `${diagnostic.message} [severity capped to warn: signal enforcement ceiling lacks hard-gate authority]`,
        }
      : diagnostic,
  )
}

export const deriveEnforcement = (
  tier: Tier,
  kind: SignalKind,
): EnforcementCeiling => {
  if (kind === "compound") {
    if (tier === 1 || tier === 1.5) return ["trend", "review-routing", "dashboard"]
    if (tier === 2) return ["trend"]
    return []
  }
  if (kind === "structural") {
    if (tier === 1 || tier === 2) return ["hard-gate"]
    return []
  }
  // legibility
  if (tier === 1 || tier === 2) return ["soft-warning", "trend"]
  if (tier === 3) return ["soft-warning"]
  return []
}
