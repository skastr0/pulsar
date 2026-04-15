import { Schema } from "effect"

/**
 * Provability tier. Determines the enforcement ceiling of a signal.
 *
 * - 1:   Pure computation
 * - 1.5: Derived / compound (takes other signal outputs as inputs)
 * - 2:   Computation + reference data
 * - 3:   LLM with grounded context (soft warning only; never a hard gate)
 */
export const Tier = Schema.Literal(1, 1.5, 2, 3)
export type Tier = typeof Tier.Type

export const SignalKind = Schema.Literal("structural", "legibility", "compound")
export type SignalKind = typeof SignalKind.Type
