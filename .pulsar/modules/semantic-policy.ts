/** Opt-in research policy for this repository, not Pulsar's generic defaults.
 * Fixed points and confidence floors are hypotheses, not calibrated thresholds.
 * Loaded only by `bun run dev semantic`; no production signal semantics change.
 */
export default {
  schema: "pulsar.semantic-policy.v1alpha1",
  id: "pulsar-autonomous-maintainability-poc-v1",
  include: ["packages/*/src/**/*.ts"],
  exclude: ["**/__tests__/**", "**/*.test.ts", "**/*.d.ts"],
  rules: [
    {
      id: "single-rule-owner",
      appliesTo: ["clone-group"],
      criterion: "An evidenced shared domain invariant or decision should have one implementation owner. Independently implemented copies that require coordinated edits violate this rule. Similar shape with different contracts, deliberate separate integration adapters, and code already delegating to a common owner do not. Establish shared obligations from code and supplied consumers, not names or syntax alone.",
      penaltyPoints: 20,
    },
    {
      id: "meaningful-boundaries",
      appliesTo: ["complexity-function"],
      criterion: "Keep coherent integration sequences intact when order follows real data, error, resource or publication dependencies. A boundary must serve an evidenced invariant, operation, adaptation, lifecycle, public contract or consumed dependency seam. Forwarding or repackaging alone without such a role is debt. Independently meaningful domain decisions mixed into coordination are debt. Line count and complexity alone are not violations; multiple necessary steps of one operation are acceptable. Redundant decisions or repeated transformations with no contractual purpose are debt only when the evidence establishes that redundancy.",
      penaltyPoints: 15,
    },
  ],
  greenAt: 90,
  redBelow: 85,
  minProbability: 0.6,
  minMargin: 0.15,
  budgets: { maxCandidates: 8, maxCalls: 24, maxSnippetLines: 160, maxContextBytes: 24000 },
} as const
