import {
  ReferenceDataTag,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import {
  CONTRACT_FRESHNESS_REFERENCE_DATA_KEY,
  type ContractFreshnessFacts,
  type ContractFreshnessFinding,
} from "@skastr0/pulsar-core/reference-data"
import { Effect, Option, Schema } from "effect"

export const Shared09ContractFreshnessConfig = Schema.Struct({
  top_n_diagnostics: Schema.Number,
  max_weighted_findings: Schema.Number,
})
export type Shared09ContractFreshnessConfig =
  typeof Shared09ContractFreshnessConfig.Type

export interface Shared09ContractFreshnessOutput extends ContractFreshnessFacts {
  readonly topFindings: ReadonlyArray<ContractFreshnessFinding>
  readonly totalFindings: number
  readonly weightedFindings: number
  readonly scorePressure: number
  readonly diagnosticLimit: number
  readonly configuredContractCount: number
  readonly sourceFileCount: number
  readonly artifactFileCount: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly evidenceClass: ReadonlyArray<string>
  readonly claimLimit: string
  readonly nonClaimLimit: string
  readonly knownFailureModes: ReadonlyArray<string>
  readonly enforcementCeiling: ReadonlyArray<string>
}

const notConfiguredContractFreshnessFacts = (): ContractFreshnessFacts => ({
  state: "not_configured",
  checkedPaths: [],
  contracts: [],
  findings: [],
  sourceFingerprint: "not-configured",
  message: "Contract freshness reference data was not loaded",
})

export const Shared09ContractFreshness: Signal<
  Shared09ContractFreshnessConfig,
  Shared09ContractFreshnessOutput,
  ReferenceDataTag
> = {
  id: "SHARED-09-contract-freshness",
  title: "Contract freshness",
  aliases: ["SHARED-09"],
  tier: 2,
  category: "review-pain",
  kind: "legibility",
  cacheVersion: "reference-data-v1",
  configSchema: Shared09ContractFreshnessConfig,
  defaultConfig: {
    top_n_diagnostics: 10,
    max_weighted_findings: 8,
  },
  configDirections: {
    top_n_diagnostics: "higher-is-looser",
    max_weighted_findings: "higher-is-looser",
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const referenceData = yield* ReferenceDataTag
      const facts = yield* referenceData.get<ContractFreshnessFacts>(
        CONTRACT_FRESHNESS_REFERENCE_DATA_KEY,
      )
      return buildOutput(
        Option.isSome(facts) ? facts.value : notConfiguredContractFreshnessFacts(),
        config,
      )
    }),
  score: (out) => {
    if (out.totalFindings === 0) return 1
    return 1 / (1 + out.scorePressure)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.topFindings.length > 0) {
      return out.topFindings.map((finding) => ({
        severity: finding.severity,
        message: `${contractFreshnessKindLabel(finding.kind)} for ${finding.groupId} contract`,
        location: { file: finding.file, line: 1 },
        data: {
          ...finding,
          state: out.state,
          sourceFingerprint: out.sourceFingerprint,
          scorePressure: out.scorePressure,
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
        message: `Contract freshness facts: ${out.state}`,
        data: {
          state: out.state,
          sourcePath: out.sourcePath,
          checkedPaths: out.checkedPaths,
          message: out.message,
          configuredContractCount: out.configuredContractCount,
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
  facts: ContractFreshnessFacts,
  config: Shared09ContractFreshnessConfig,
): Shared09ContractFreshnessOutput => {
  const diagnosticLimit = Math.max(0, Math.floor(config.top_n_diagnostics))
  const maxWeightedFindings = Math.max(1, config.max_weighted_findings)
  const topFindings = [...facts.findings]
    .sort(compareFindings)
    .slice(0, diagnosticLimit)
  const weightedFindings = facts.findings.reduce(
    (total, finding) => total + finding.weight,
    0,
  )
  return {
    ...facts,
    topFindings,
    totalFindings: facts.findings.length,
    weightedFindings,
    scorePressure: weightedFindings / maxWeightedFindings,
    diagnosticLimit,
    configuredContractCount: facts.contracts.length,
    sourceFileCount: uniqueCount(facts.contracts.flatMap((contract) => contract.sourcePaths)),
    artifactFileCount: uniqueCount(facts.contracts.map((contract) => contract.artifactPath)),
    compositeConsumers: [
      "contract safety gap",
      "review shock",
      "theory encoding index",
    ],
    cacheContributors: [
      "reference-data.contract-freshness",
      ".pulsar/contract-freshness.json",
      "declared source hashes",
      "declared artifact hashes",
      "config.top_n_diagnostics",
      "config.max_weighted_findings",
    ],
    calibrationSurface:
      "repo-owned .pulsar/contract-freshness.json; thresholds only affect diagnostic and pressure scaling",
    evidenceClass: [
      "repo-owned manifest",
      "sha256 source content",
      "sha256 artifact content",
      "opt-in generated artifact globs",
    ],
    claimLimit:
      "declared generated contracts are fresh relative to recorded source and artifact hashes",
    nonClaimLimit:
      "does not prove semantic compatibility, generator correctness, or undeclared contract coverage",
    knownFailureModes: [
      "manifest omitted for a generated surface",
      "generator output is semantically stale while byte hashes match",
      "broad generated artifact globs create orphan noise",
    ],
    enforcementCeiling: ["soft-warning", "review-routing", "composite-input"],
  }
}

const contractFreshnessKindLabel = (
  kind: ContractFreshnessFinding["kind"],
): string => {
  switch (kind) {
    case "missing-provenance":
      return "Missing generation provenance"
    case "stale-artifact":
      return "Stale generated artifact"
    case "missing-generated-artifact":
      return "Missing generated artifact"
    case "orphan-generated-artifact":
      return "Orphan generated artifact"
  }
}

const compareFindings = (
  left: ContractFreshnessFinding,
  right: ContractFreshnessFinding,
): number => {
  const bySeverity = severityRank(right.severity) - severityRank(left.severity)
  if (bySeverity !== 0) return bySeverity
  const byWeight = right.weight - left.weight
  if (byWeight !== 0) return byWeight
  if (left.groupId !== right.groupId) return left.groupId.localeCompare(right.groupId)
  if (left.file !== right.file) return left.file.localeCompare(right.file)
  return left.kind.localeCompare(right.kind)
}

const severityRank = (severity: "info" | "warn"): number =>
  severity === "warn" ? 1 : 0

const uniqueCount = (values: ReadonlyArray<string>): number =>
  new Set(values).size
