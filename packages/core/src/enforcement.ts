import { Schema } from "effect"
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
