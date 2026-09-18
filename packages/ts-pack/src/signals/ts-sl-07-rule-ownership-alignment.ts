import { computeDiagnosticHash, ReferenceDataTag, type Diagnostic, type Signal } from "@skastr0/pulsar-core/signal"
import { makeFactorEntry, makeFactorLedger, type SignalFactorDefinition } from "@skastr0/pulsar-core/factors"
import { Effect, Option, Schema } from "effect"

export const OWNERSHIP_REFERENCE_DATA_KEY = "ownership"
export const CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH = ".pulsar/ownership.json"

export const TsSl07Config = Schema.Struct({ top_n_diagnostics: Schema.Number })
type TsSl07Config = typeof TsSl07Config.Type

interface OwnershipLabelValue {
  readonly group_id: string
  readonly status: "resolved" | "unresolved" | "not_applicable"
  readonly anchor_id?: string
  readonly anchor_value?: number
  readonly distribution: ReadonlyArray<{
    readonly anchor_id: string
    readonly anchor_value?: number
    readonly probability: number
    readonly selected: boolean
  }>
}

interface OwnershipFacts {
  readonly state: "present" | "not_configured" | "unknown"
  readonly policy?: {
    readonly preference: string
    readonly target: number
    readonly anchors: ReadonlyArray<{ readonly id: string; readonly value: number; readonly description: string }>
    readonly stretch?: unknown
    readonly groups: ReadonlyArray<{
      readonly id: string
      readonly owner_paths: ReadonlyArray<string>
      readonly caller_paths: ReadonlyArray<string>
    }>
  }
  readonly policyFingerprint?: string
  readonly assessmentFingerprint?: string
  readonly inventory: {
    readonly declaredGroupIds: ReadonlyArray<string>
    readonly labeledGroupIds: ReadonlyArray<string>
    readonly complete: boolean
  }
  readonly labels: ReadonlyArray<{
    readonly label: { readonly confidence: number; readonly value: unknown }
  }>
  readonly aggregate?: {
    readonly applicability: "applicable" | "not_applicable" | "insufficient_evidence"
    readonly attainment?: number
    readonly observedAttainment?: number
    readonly target: number
    readonly score?: number
    readonly histogram: Readonly<Record<string, number>>
    readonly resolvedGroupIds: ReadonlyArray<string>
    readonly unresolvedGroupIds: ReadonlyArray<string>
    readonly notApplicableGroupIds: ReadonlyArray<string>
    readonly missingGroupIds: ReadonlyArray<string>
  }
}

export interface TsSl07Output {
  readonly facts: OwnershipFacts | undefined
  readonly diagnosticLimit: number
}

const ID = "TS-SL-07-rule-ownership-alignment"
const policyFactor: SignalFactorDefinition = {
  path: "ownership.policy",
  title: "Repository ownership rubric",
  valueKind: "object",
  scoreRole: "threshold",
  description:
    "Explicit repo-owned anchor utilities, not measured probabilities or a universal architecture preference.",
}
const attainmentFactor: SignalFactorDefinition = {
  path: "ownership.attainment",
  title: "Weakest assessed ownership obligation",
  valueKind: "number",
  scoreRole: "evidence",
  description: "Minimum resolved anchor, only applicable for a complete declared inventory. Null means unknown.",
}

const sanitizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0

const labelValueOf = (facts: OwnershipFacts, groupId: string): OwnershipLabelValue | undefined => {
  for (const artifact of facts.labels) {
    const value = artifact.label.value
    if (
      value !== null &&
      typeof value === "object" &&
      "group_id" in value &&
      (value as { group_id?: unknown }).group_id === groupId
    ) {
      return value as OwnershipLabelValue
    }
  }
  return undefined
}

const groupStatus = (
  facts: OwnershipFacts,
  groupId: string,
): "resolved" | "unresolved" | "not_applicable" | "missing" => {
  if (facts.aggregate?.resolvedGroupIds.includes(groupId) === true) return "resolved"
  if (facts.aggregate?.notApplicableGroupIds.includes(groupId) === true) return "not_applicable"
  if (facts.aggregate?.unresolvedGroupIds.includes(groupId) === true) return "unresolved"
  if (facts.aggregate?.missingGroupIds.includes(groupId) === true) return "missing"
  const label = labelValueOf(facts, groupId)
  return label?.status ?? "missing"
}

const comparisonOf = (facts: OwnershipFacts): string => {
  const aggregate = facts.aggregate
  const attainment = aggregate?.attainment
  const target = aggregate?.target ?? 1
  if (aggregate?.applicability === "not_applicable") return "not_applicable"
  if (attainment === undefined) return "unknown"
  if (attainment < target) return "below_target"
  if (attainment > target) return "exceeds_target"
  return "meets_target"
}

const summaryDiagnostic = (facts: OwnershipFacts): Diagnostic => {
  const aggregate = facts.aggregate
  const attainment = aggregate?.attainment
  const target = aggregate?.target ?? 1
  const comparison = comparisonOf(facts)
  return {
    severity: comparison === "below_target" ? "warn" : "info",
    message: `Rule ownership: ${comparison.replaceAll("_", " ")}${
      attainment === undefined ? "" : ` (${attainment}; target ${target})`
    }. Scope: declared ownership inventory, not all repository rules.`,
    location: { file: CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH, line: 1 },
    data: {
      kind: "ownership-alignment",
      scope: "declared-ownership-inventory",
      hash: computeDiagnosticHash(`ownership-summary:${facts.policyFingerprint ?? "none"}`),
      attainment: attainment ?? null,
      observed_attainment: aggregate?.observedAttainment ?? null,
      target,
      comparison,
      expected_groups: facts.inventory.declaredGroupIds.length,
      assessed_groups:
        (aggregate?.resolvedGroupIds.length ?? 0) + (aggregate?.notApplicableGroupIds.length ?? 0),
      unresolved_groups:
        facts.inventory.declaredGroupIds.length -
        (aggregate?.resolvedGroupIds.length ?? 0) -
        (aggregate?.notApplicableGroupIds.length ?? 0),
      histogram: aggregate?.histogram ?? {},
      policy_fingerprint: facts.policyFingerprint,
      assessment_fingerprint: facts.assessmentFingerprint,
      fact_source: "ai_classified",
      enforcement_ceiling: "soft-warning",
      limitations:
        "Model judgments are estimates, not proofs. Confidence is separate from attainment. No unconfigured stretch credit.",
    },
  }
}

const groupDiagnostic = (facts: OwnershipFacts, groupId: string): Diagnostic => {
  const label = labelValueOf(facts, groupId)
  const status = groupStatus(facts, groupId)
  const group = facts.policy?.groups.find((entry) => entry.id === groupId)
  const locationFile = group?.owner_paths[0] ?? group?.caller_paths[0] ?? CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH
  const envelope = facts.labels.find((artifact) => {
    const value = artifact.label.value
    return (
      value !== null &&
      typeof value === "object" &&
      "group_id" in value &&
      (value as { group_id?: unknown }).group_id === groupId
    )
  })
  return {
    severity: status === "resolved" && label?.anchor_id === "contrary" ? "warn" : "info",
    message: `Ownership group ${groupId}: ${status}${
      label?.anchor_id === undefined ? "" : ` (${label.anchor_id})`
    }. Declared inventory only.`,
    location: { file: locationFile, line: 1 },
    data: {
      kind: "ownership-group",
      scope: "declared-ownership-inventory",
      hash: computeDiagnosticHash(`ownership-group:${groupId}:${status}:${label?.anchor_id ?? "none"}`),
      group_id: groupId,
      status,
      anchor_id: label?.anchor_id ?? null,
      anchor_value: label?.anchor_value ?? null,
      model_confidence: envelope?.label.confidence ?? null,
      distribution: label?.distribution ?? [],
      fact_source: "ai_classified",
      enforcement_ceiling: "soft-warning",
    },
  }
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
  cacheVersion: "ownership-attainment-v2",
  configSchema: TsSl07Config,
  defaultConfig: { top_n_diagnostics: 10 },
  inputs: [],
  factorDefinitions: [policyFactor, attainmentFactor],
  knownFailureModes: [
    {
      description: "Byte-valid AI artifacts can contain an incorrect judgment; probability is not verification or quality.",
      fixture: {
        file: "packages/ts-pack/src/__tests__/ts-sl-07.test.ts",
        testName: "model confidence does not change preference attainment or grant hard-gate authority",
      },
    },
    {
      description: "A complete declared inventory does not prove that all repository ownership obligations were discovered.",
      fixture: {
        file: "packages/ts-pack/src/__tests__/ts-sl-07.test.ts",
        testName: "public summary names declared inventory scope and preserves partial evidence",
      },
    },
  ],
  compute: (config) =>
    Effect.gen(function* () {
      const references = yield* ReferenceDataTag
      const facts = yield* references.get<OwnershipFacts>(OWNERSHIP_REFERENCE_DATA_KEY)
      return {
        facts: Option.getOrUndefined(facts),
        diagnosticLimit: sanitizeDiagnosticLimit(config.top_n_diagnostics),
      }
    }),
  // The mandatory scalar is not a measurement when applicability excludes it.
  // In particular, missing evidence is never encoded as a healthy 1.
  score: ({ facts }) => facts?.aggregate?.score ?? 0,
  outputMetadata: ({ facts }) => ({
    factSource: "ai_classified",
    applicability:
      facts === undefined || facts.state === "not_configured"
        ? "not_applicable"
        : facts.state === "unknown"
          ? "insufficient_evidence"
          : facts.aggregate?.applicability ?? "insufficient_evidence",
  }),
  diagnose: ({ facts, diagnosticLimit }): ReadonlyArray<Diagnostic> => {
    if (facts === undefined || facts.state === "not_configured") return []
    const groupIds = facts.inventory.declaredGroupIds
    const remaining = Math.max(0, diagnosticLimit)
    const groups = remaining === 0 ? [] : groupIds.slice(0, remaining).map((groupId) => groupDiagnostic(facts, groupId))
    return [summaryDiagnostic(facts), ...groups]
  },
  factorLedger: ({ facts }) =>
    makeFactorLedger(ID, [
      makeFactorEntry(
        policyFactor,
        facts?.policy === undefined
          ? null
          : {
              preference: facts.policy.preference,
              target: facts.policy.target,
              anchors: facts.policy.anchors.map((anchor) => ({
                id: anchor.id,
                value: anchor.value,
                description: anchor.description,
              })),
              stretch:
                facts.policy.stretch !== undefined &&
                facts.policy.stretch !== null &&
                typeof facts.policy.stretch === "object"
                  ? Object.fromEntries(
                      Object.entries(facts.policy.stretch as Record<string, unknown>).flatMap(
                        ([key, value]) =>
                          typeof value === "string" || typeof value === "number" || typeof value === "boolean"
                            ? [[key, value] as const]
                            : [],
                      ),
                    )
                  : null,
              fingerprint: facts.policyFingerprint ?? null,
            },
        {
          attribution: { ruleId: "ownership", sourceRef: CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH },
        },
      ),
      makeFactorEntry(attainmentFactor, facts?.aggregate?.attainment ?? null),
    ]),
}
