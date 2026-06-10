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
 * Poison authority is deliberately STRICTER than hard-gate authority — it
 * requires both:
 *
 * - proof-grade evidence (tier 1 pure computation, or tier 1.5 derived
 *   deterministically from it) — tier-2 structural signals may hard-gate
 *   "given reference data", but a reference-backed heuristic may not be
 *   the verdict alone; and
 * - a hard-gate enforcement ceiling (structural kind). A signal whose
 *   ceiling is soft-warning cannot block a single diff; letting it
 *   single-handedly red an entire repo would invert the enforcement
 *   ladder. Fleet evidence pinned this: a tier-1 function-size
 *   distribution at 0.75 effective pressure set a repo verdict its own
 *   auditor rejected, while the evidence mean read 0.72.
 *
 * Severe heuristic and legibility findings still reach the headline
 * through the p-norm and stay visible as the minimum line and top
 * pressures; they just cannot be the verdict by themselves.
 */
export const hasPoisonAuthority = (signal: {
  readonly tier: Tier
  readonly enforcement: EnforcementCeiling
}): boolean =>
  (signal.tier === 1 || signal.tier === 1.5) &&
  signal.enforcement.includes("hard-gate")

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
