import { ReferenceDataTag, type Diagnostic, type Signal } from "@skastr0/pulsar-core/signal"
import {
  CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH,
  OWNERSHIP_REFERENCE_DATA_KEY,
  type OwnershipFacts,
} from "@skastr0/pulsar-core/reference-data"
import { makeFactorEntry, makeFactorLedger, type SignalFactorDefinition } from "@skastr0/pulsar-core/factors"
import { Effect, Option, Schema } from "effect"

export const TsSl07Config = Schema.Struct({ top_n_diagnostics: Schema.Number })
type TsSl07Config = typeof TsSl07Config.Type

export interface TsSl07Output {
  readonly facts: OwnershipFacts | undefined
  readonly diagnosticLimit: number
}

const ID = "TS-SL-07-rule-ownership-alignment"
const policyFactor: SignalFactorDefinition = {
  path: "ownership.policy", title: "Repository ownership rubric", valueKind: "object", scoreRole: "threshold",
  description: "Explicit repo-owned anchor utilities, not measured probabilities or a universal architecture preference.",
}
const attainmentFactor: SignalFactorDefinition = {
  path: "ownership.attainment", title: "Weakest assessed ownership obligation", valueKind: "number", scoreRole: "evidence",
  description: "Minimum resolved anchor, only applicable for a complete declared inventory. Null means unknown.",
}

/**
 * Claim: replayed model-estimated attainment of the repository's declared ownership
 * rubric on its declared inventory. Not a census of all rules or proof of code quality.
 * No configured policy means not applicable. Partial/stale evidence cannot earn fit.
 * Core owns artifact validation, grouping, applicability, arithmetic and freshness;
 * this signal projects that result into the existing observer. No provider calls.
 */
export const TsSl07: Signal<TsSl07Config, TsSl07Output, ReferenceDataTag> = {
  id: ID,
  title: "Rule ownership alignment",
  aliases: ["TS-SL-07"],
  tier: 3,
  kind: "structural",
  category: "generated-slop",
  evidenceClass: "heuristic-pattern",
  enforcement: ["soft-warning", "review-routing", "dashboard"],
  cacheVersion: "ownership-attainment-v1",
  configSchema: TsSl07Config,
  defaultConfig: { top_n_diagnostics: 10 },
  inputs: [],
  factorDefinitions: [policyFactor, attainmentFactor],
  knownFailureModes: [{
    description: "Byte-valid AI artifacts can contain an incorrect judgment; probability is not verification or quality.",
    fixture: {
      file: "packages/ts-pack/src/__tests__/ts-sl-07.test.ts",
      testName: "model confidence does not change preference attainment or grant hard-gate authority",
    },
  }, {
    description: "A complete declared inventory does not prove that all repository ownership obligations were discovered.",
    fixture: {
      file: "packages/ts-pack/src/__tests__/ts-sl-07.test.ts",
      testName: "public summary names declared inventory scope and preserves partial evidence",
    },
  }],
  compute: (config) => Effect.gen(function* () {
    const references = yield* ReferenceDataTag
    const facts = yield* references.get<OwnershipFacts>(OWNERSHIP_REFERENCE_DATA_KEY)
    return {
      facts: Option.getOrUndefined(facts),
      diagnosticLimit: Number.isFinite(config.top_n_diagnostics) ? Math.max(0, Math.floor(config.top_n_diagnostics)) : 0,
    }
  }),
  // The mandatory scalar is not a measurement when applicability excludes it.
  // In particular, missing evidence is never encoded as a healthy 1.
  score: ({ facts }) => facts?.aggregate?.score ?? 0,
  outputMetadata: ({ facts }) => ({
    factSource: "ai_classified",
    applicability: facts === undefined || facts.state === "not_configured"
      ? "not_applicable"
      : facts.state === "unknown" ? "insufficient_evidence" : facts.aggregate?.applicability ?? "insufficient_evidence",
  }),
  diagnose: ({ facts }): ReadonlyArray<Diagnostic> => {
    if (facts === undefined || facts.state === "not_configured") return []
    const aggregate = facts.aggregate
    const attainment = aggregate?.attainment ?? null
    const target = aggregate?.target ?? 1
    const comparison = aggregate?.applicability === "not_applicable" ? "not_applicable"
      : attainment === null ? "unknown" : attainment < target ? "below_target" : attainment > target ? "exceeds_target" : "meets_target"
    return [{
      severity: comparison === "below_target" ? "warn" : "info",
      message: `Rule ownership: ${comparison.replaceAll("_", " ")}${attainment === null ? "" : ` (${attainment}; target ${target})`}. Scope: declared ownership inventory, not all repository rules.`,
      location: { file: CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH, line: 1 },
      data: {
        kind: "ownership-alignment",
        scope: "declared-ownership-inventory",
        attainment,
        observed_attainment: aggregate?.observedAttainment ?? null,
        target,
        comparison,
        expected_groups: facts.inventory.declaredGroupIds.length,
        assessed_groups: (aggregate?.resolvedGroupIds.length ?? 0) + (aggregate?.notApplicableGroupIds.length ?? 0),
        unresolved_groups: facts.inventory.declaredGroupIds.length - (aggregate?.resolvedGroupIds.length ?? 0) - (aggregate?.notApplicableGroupIds.length ?? 0),
        histogram: aggregate?.histogram ?? {},
        policy_fingerprint: facts.policyFingerprint,
        assessment_fingerprint: facts.assessmentFingerprint,
        fact_source: "ai_classified",
        enforcement_ceiling: "soft-warning",
        limitations: "Model judgments are estimates, not proofs. Confidence is separate from attainment. No unconfigured stretch credit.",
      },
    }]
  },
  factorLedger: ({ facts }) => makeFactorLedger(ID, [
    makeFactorEntry(policyFactor, {
      fingerprint: facts?.policyFingerprint ?? null,
      source: CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH,
    }, { attribution: { ruleId: "ownership", sourceRef: CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH } }),
    makeFactorEntry(attainmentFactor, facts?.aggregate?.attainment ?? null),
  ]),
}
