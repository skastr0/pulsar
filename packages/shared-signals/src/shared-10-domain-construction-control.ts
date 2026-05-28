import {
  ReferenceDataTag,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import {
  CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH,
  DOMAIN_CONSTRUCTION_REFERENCE_DATA_KEY,
  buildNotConfiguredDomainConstructionFacts,
  type DomainConstructionFacts,
  type DomainConstructionFinding,
} from "@skastr0/pulsar-core/reference-data"
import { Effect, Option, Schema } from "effect"

export const Shared10DomainConstructionControlConfig = Schema.Struct({
  top_n_diagnostics: Schema.Number,
  max_weighted_findings: Schema.Number,
  include_explicitly_open_diagnostics: Schema.Boolean,
})
export type Shared10DomainConstructionControlConfig =
  typeof Shared10DomainConstructionControlConfig.Type

export interface Shared10DomainConstructionControlOutput
  extends DomainConstructionFacts {
  readonly topFindings: ReadonlyArray<DomainConstructionFinding>
  readonly scoreFindings: ReadonlyArray<DomainConstructionFinding>
  readonly totalFindings: number
  readonly weightedFindings: number
  readonly maxWeightedFindings: number
  readonly scorePressure: number
  readonly diagnosticLimit: number
  readonly configuredConstructCount: number
  readonly explicitlyOpenConstructCount: number
  readonly controlledConstructCount: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly evidenceClass: ReadonlyArray<string>
  readonly claimLimit: string
  readonly nonClaimLimit: string
  readonly knownFailureModes: ReadonlyArray<string>
  readonly enforcementCeiling: ReadonlyArray<string>
}

const notConfiguredDomainConstructionFacts = (): DomainConstructionFacts =>
  buildNotConfiguredDomainConstructionFacts([
    CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH,
  ])

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const DEFAULT_MAX_WEIGHTED_FINDINGS = 8
const DEFAULT_INCLUDE_EXPLICITLY_OPEN_DIAGNOSTICS = true

const DOMAIN_CONSTRUCTION_COMPOSITE_CONSUMERS = [
  "boundary trust breach",
  "abstraction hazard",
  "boundary integrity",
  "theory encoding index",
  "contract safety gap",
] as const

const DOMAIN_CONSTRUCTION_CACHE_CONTRIBUTORS = [
  "reference-data.domain-construction",
  ".pulsar/domain-construction.json",
  "declared construct source hashes",
  "declared parser/smart-constructor evidence hashes",
  "config.top_n_diagnostics",
  "config.max_weighted_findings",
  "config.include_explicitly_open_diagnostics",
] as const

const DOMAIN_CONSTRUCTION_EVIDENCE_CLASS = [
  "repo-owned manifest",
  "sha256 declaration content",
  "sha256 parser/smart-constructor evidence content",
  "syntax-level constructor/export evidence",
] as const

const DOMAIN_CONSTRUCTION_KNOWN_FAILURE_MODES = [
  "manifest omits a domain primitive",
  "declared parser exists but does not enforce the intended invariant",
  "factory naming differs from declared evidence symbols",
] as const

const DOMAIN_CONSTRUCTION_ENFORCEMENT_CEILING = [
  "soft-warning",
  "review-routing",
  "composite-input",
] as const

export const Shared10DomainConstructionControl: Signal<
  Shared10DomainConstructionControlConfig,
  Shared10DomainConstructionControlOutput,
  ReferenceDataTag
> = {
  id: "SHARED-10-domain-construction-control",
  title: "Domain construction control",
  aliases: ["SHARED-10"],
  tier: 2,
  category: "abstraction-bloat",
  kind: "legibility",
  cacheVersion: "reference-data-v2-normalized-config-source-provenance",
  configSchema: Shared10DomainConstructionControlConfig,
  defaultConfig: {
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
    max_weighted_findings: DEFAULT_MAX_WEIGHTED_FINDINGS,
    include_explicitly_open_diagnostics: DEFAULT_INCLUDE_EXPLICITLY_OPEN_DIAGNOSTICS,
  },
  configDirections: {
    top_n_diagnostics: "higher-is-looser",
    max_weighted_findings: "higher-is-looser",
  },
  factorDefinitions: [
    {
      path: "config.max_weighted_findings",
      title: "Config max weighted findings",
      valueKind: "number",
      scoreRole: "threshold",
      defaultValue: DEFAULT_MAX_WEIGHTED_FINDINGS,
    },
  ],
  factorLedger: () => ({
    signalId: "SHARED-10-domain-construction-control",
    entries: [
      {
        path: "config.max_weighted_findings",
        title: "Config max weighted findings",
        scoreRole: "threshold",
        value: DEFAULT_MAX_WEIGHTED_FINDINGS,
        source: "signal-default",
        affectsScore: true,
      },
    ],
  }),
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const referenceData = yield* ReferenceDataTag
      const facts = yield* referenceData.get<DomainConstructionFacts>(
        DOMAIN_CONSTRUCTION_REFERENCE_DATA_KEY,
      )
      return buildOutput(
        Option.isSome(facts) ? facts.value : notConfiguredDomainConstructionFacts(),
        config,
      )
    }),
  score: (out) => {
    if (out.weightedFindings === 0) return 1
    return 1 / (1 + out.scorePressure)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.topFindings.length > 0) {
      return out.topFindings.map((finding) => ({
        severity: finding.severity,
        message: `${domainConstructionKindLabel(finding.kind)} for ${finding.symbol}`,
        location: { file: finding.file, line: 1 },
        data: {
          ...finding,
          state: out.state,
          sourceFingerprint: out.sourceFingerprint,
          weightedFindings: out.weightedFindings,
          maxWeightedFindings: out.maxWeightedFindings,
          scorePressure: out.scorePressure,
          diagnosticLimit: out.diagnosticLimit,
          compositeConsumers: out.compositeConsumers,
          cacheContributors: out.cacheContributors,
          calibrationSurface: out.calibrationSurface,
          evidenceClass: out.evidenceClass,
          claimLimit: out.claimLimit,
          nonClaimLimit: out.nonClaimLimit,
          knownFailureModes: out.knownFailureModes,
          enforcementCeiling: out.enforcementCeiling,
        },
      }))
    }

    const severity: "info" | "warn" = out.state === "unknown" ? "warn" : "info"
    return [
      {
        severity,
        message: `Domain construction facts: ${out.state}`,
        data: {
          state: out.state,
          sourcePath: out.sourcePath,
          checkedPaths: out.checkedPaths,
          message: out.message,
          configuredConstructCount: out.configuredConstructCount,
          controlledConstructCount: out.controlledConstructCount,
          explicitlyOpenConstructCount: out.explicitlyOpenConstructCount,
          weightedFindings: out.weightedFindings,
          maxWeightedFindings: out.maxWeightedFindings,
          scorePressure: out.scorePressure,
          diagnosticLimit: out.diagnosticLimit,
          compositeConsumers: out.compositeConsumers,
          cacheContributors: out.cacheContributors,
          calibrationSurface: out.calibrationSurface,
          evidenceClass: out.evidenceClass,
          claimLimit: out.claimLimit,
          nonClaimLimit: out.nonClaimLimit,
          knownFailureModes: out.knownFailureModes,
          enforcementCeiling: out.enforcementCeiling,
        },
      },
    ].slice(0, out.diagnosticLimit)
  },
  outputMetadata: (out) =>
    out.state === "present" || out.state === "zero"
      ? undefined
      : {
          applicability:
            out.state === "not_applicable"
              ? "not_applicable" as const
              : "insufficient_evidence" as const,
        },
}

const buildOutput = (
  facts: DomainConstructionFacts,
  config: Shared10DomainConstructionControlConfig,
): Shared10DomainConstructionControlOutput => {
  const normalizedConfig = normalizeShared10DomainConstructionControlConfig(config)
  const diagnosticLimit = normalizedConfig.top_n_diagnostics
  const maxWeightedFindings = normalizedConfig.max_weighted_findings
  const topFindings = topDomainConstructionFindings(facts, normalizedConfig)
  const scoreFindings = scoreDomainConstructionFindings(facts)
  const weightedFindings = weightedDomainConstructionFindings(scoreFindings)

  return {
    ...facts,
    topFindings,
    scoreFindings,
    totalFindings: facts.findings.length,
    weightedFindings,
    maxWeightedFindings,
    scorePressure: weightedFindings / maxWeightedFindings,
    diagnosticLimit,
    configuredConstructCount: facts.constructs.length,
    ...domainConstructionControlCounts(facts),
    ...domainConstructionControlMetadata(),
  }
}

const topDomainConstructionFindings = (
  facts: DomainConstructionFacts,
  config: Shared10DomainConstructionControlConfig,
): ReadonlyArray<DomainConstructionFinding> =>
  [...facts.findings]
    .filter((finding) =>
      config.include_explicitly_open_diagnostics ||
      finding.kind !== "explicitly-open-construct",
    )
    .sort(compareFindings)
    .slice(0, config.top_n_diagnostics)

const scoreDomainConstructionFindings = (
  facts: DomainConstructionFacts,
): ReadonlyArray<DomainConstructionFinding> =>
  facts.findings.filter((finding) => finding.weight > 0)

const weightedDomainConstructionFindings = (
  findings: ReadonlyArray<DomainConstructionFinding>,
): number => findings.reduce((total, finding) => total + finding.weight, 0)

const domainConstructionControlCounts = (
  facts: DomainConstructionFacts,
): Pick<
  Shared10DomainConstructionControlOutput,
  "explicitlyOpenConstructCount" | "controlledConstructCount"
> => ({
  explicitlyOpenConstructCount: facts.constructs.filter(
    (construct) => construct.controlIntent === "intentionally_open",
  ).length,
  controlledConstructCount: facts.constructs.filter(
    (construct) => construct.controlIntent === "controlled",
  ).length,
})

const domainConstructionControlMetadata = (): Pick<
  Shared10DomainConstructionControlOutput,
  | "compositeConsumers"
  | "cacheContributors"
  | "calibrationSurface"
  | "evidenceClass"
  | "claimLimit"
  | "nonClaimLimit"
  | "knownFailureModes"
  | "enforcementCeiling"
> => ({
  compositeConsumers: DOMAIN_CONSTRUCTION_COMPOSITE_CONSUMERS,
  cacheContributors: DOMAIN_CONSTRUCTION_CACHE_CONTRIBUTORS,
  calibrationSurface:
    "repo-owned .pulsar/domain-construction.json; thresholds only affect diagnostic and pressure scaling",
  evidenceClass: DOMAIN_CONSTRUCTION_EVIDENCE_CLASS,
  claimLimit:
    "declared domain constructs have recorded construction-control evidence and current source hashes",
  nonClaimLimit:
    "does not prove parser semantic correctness, invariant completeness, or all undeclared domain constructs",
  knownFailureModes: DOMAIN_CONSTRUCTION_KNOWN_FAILURE_MODES,
  enforcementCeiling: DOMAIN_CONSTRUCTION_ENFORCEMENT_CEILING,
})

const normalizeShared10DomainConstructionControlConfig = (
  config: Shared10DomainConstructionControlConfig,
): Shared10DomainConstructionControlConfig => ({
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
  max_weighted_findings:
    Number.isFinite(config.max_weighted_findings) && config.max_weighted_findings > 0
      ? config.max_weighted_findings
      : DEFAULT_MAX_WEIGHTED_FINDINGS,
  include_explicitly_open_diagnostics:
    config.include_explicitly_open_diagnostics === true,
})

const domainConstructionKindLabel = (
  kind: DomainConstructionFinding["kind"],
): string => {
  switch (kind) {
    case "uncontrolled-constructor-export":
      return "Uncontrolled constructor/export"
    case "missing-construction-evidence":
      return "Missing construction evidence"
    case "missing-source-provenance":
      return "Missing source provenance"
    case "stale-source":
      return "Stale construction source evidence"
    case "explicitly-open-construct":
      return "Explicitly open construct"
  }
}

const compareFindings = (
  left: DomainConstructionFinding,
  right: DomainConstructionFinding,
): number => {
  const bySeverity = severityRank(right.severity) - severityRank(left.severity)
  if (bySeverity !== 0) return bySeverity
  const byWeight = right.weight - left.weight
  if (byWeight !== 0) return byWeight
  if (left.file !== right.file) return left.file.localeCompare(right.file)
  return left.kind.localeCompare(right.kind)
}

const severityRank = (severity: "info" | "warn"): number =>
  severity === "warn" ? 1 : 0
