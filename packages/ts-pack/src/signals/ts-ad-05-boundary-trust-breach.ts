import {
  buildCompositeExplanation,
  compositeSignalInputs,
  resolveCompositeInputs,
  type CompositeExplanation,
  type CompositeInputResolution,
  type CompositeInputSpec,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import type { TsAd04Output } from "./ts-ad-04-boundary-parser-coverage.js"
import type { TsLd07Output } from "./ts-ld-07-unsafe-type-erosion.js"

const TsAd05Config = Schema.Struct({
  top_n_diagnostics: Schema.Number,
  warn_threshold: Schema.Number,
})
type TsAd05Config = typeof TsAd05Config.Type

export type BoundaryTrustBreachState =
  | "present"
  | "zero"
  | "insufficient_evidence"

export type BoundaryTrustInputFactState =
  | "present"
  | "zero"
  | "absent"
  | "unknown"
  | "not_configured"
  | "not_applicable"
  | "missing_required"
  | "missing_optional"

export interface BoundaryTrustBreachFactors {
  readonly parserCoverage?: number
  readonly unsafeBoundaryTypes?: number
  readonly boundaryViolations?: number
  readonly domainLanguageDrift?: number
}

export interface BoundaryTrustBreachCandidate {
  readonly file: string
  readonly score: number
  readonly rank: number
  readonly factors: BoundaryTrustBreachFactors
  readonly evidence: {
    readonly parserFindings?: number
    readonly weakBoundaryParameters?: number
    readonly unsafeBoundaryOccurrences?: number
    readonly unsafeBoundaryWeight?: number
    readonly boundaryViolations?: number
    readonly domainTermDrift?: number
  }
}

export interface BoundaryTrustBreachOutput {
  readonly state: BoundaryTrustBreachState
  readonly breaches: ReadonlyArray<BoundaryTrustBreachCandidate>
  readonly explanation: CompositeExplanation
  readonly diagnosticLimit: number
  readonly inputFactStates: {
    readonly boundaryParserCoverage: BoundaryTrustInputFactState
    readonly unsafeTypeErosion: BoundaryTrustInputFactState
    readonly boundaryViolations: BoundaryTrustInputFactState
    readonly domainTermConsistency: BoundaryTrustInputFactState
  }
  readonly availableFactorWeight: number
  readonly riskPressure: number
  readonly breachPressure: number
  readonly totalFilesConsidered: number
  readonly evidenceCompleteness: number
  readonly riskModel: "boundary-trust-breach-v1"
  readonly warnThreshold: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly evidenceClass: ReadonlyArray<string>
  readonly claimLimit: string
  readonly nonClaimLimit: string
  readonly knownFailureMode: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

interface BoundaryViolationLikeOutput {
  readonly violations: ReadonlyArray<{ readonly fromFile: string }>
  readonly totalImports: number
  readonly referenceDataStatus: "loaded" | "missing"
}

interface DomainTermLikeOutput {
  readonly identifiers: ReadonlyArray<{
    readonly file: string
    readonly classification: string
  }>
  readonly totalIdentifiers: number
  readonly duplicateCount: number
  readonly conflictCount: number
  readonly referenceDataStatus: "loaded" | "missing"
}

interface BoundaryTrustInputs {
  readonly boundaryParserCoverage: TsAd04Output | undefined
  readonly unsafeTypeErosion: TsLd07Output | undefined
  readonly boundaryViolations: BoundaryViolationLikeOutput | undefined
  readonly domainTermConsistency: DomainTermLikeOutput | undefined
}

interface BoundaryEvidenceAccumulator {
  readonly file: string
  parserFindings: number
  coveredWeakBoundaryFunctions: number
  weakBoundaryParameters: number
  unsafeBoundaryOccurrences: number
  unsafeBoundaryWeight: number
  boundaryViolations: number
  domainTermDrift: number
}

const BOUNDARY_TRUST_ENFORCEMENT_CEILING = [
  "trend",
  "review-routing",
  "dashboard",
] as const

const FACTOR_WEIGHTS = {
  parserCoverage: 0.35,
  unsafeBoundaryTypes: 0.3,
  boundaryViolations: 0.25,
  domainLanguageDrift: 0.1,
} as const

export const TS_AD_05_COMPOSITE_INPUTS = [
  {
    id: "TS-AD-04-boundary-parser-coverage",
    aliases: ["TS-AD-04"],
    factorPath: "inputs.boundary_parser_coverage",
    weight: FACTOR_WEIGHTS.parserCoverage,
    cacheFingerprint: "ts-ad-05-boundary-parser-coverage-input-v1",
    rawValue: (value) => summarizeBoundaryParserCoverage(value as TsAd04Output),
    normalize: (value) => normalizeBoundaryParserCoverage(value as TsAd04Output),
  },
  {
    id: "TS-LD-07-unsafe-type-erosion",
    aliases: ["TS-LD-07"],
    optional: true,
    factorPath: "inputs.unsafe_type_erosion",
    weight: FACTOR_WEIGHTS.unsafeBoundaryTypes,
    cacheFingerprint: "ts-ad-05-unsafe-type-erosion-input-v1",
    rawValue: (value) => summarizeUnsafeTypeErosion(value as TsLd07Output),
    normalize: (value) => normalizeUnsafeTypeErosion(value as TsLd07Output),
  },
  {
    id: "TS-AD-01-boundary-violations",
    aliases: ["TS-AD-01"],
    optional: true,
    factorPath: "inputs.boundary_violations",
    weight: FACTOR_WEIGHTS.boundaryViolations,
    cacheFingerprint: "ts-ad-05-boundary-violations-input-v1",
    rawValue: (value) => summarizeBoundaryViolations(value as BoundaryViolationLikeOutput),
    normalize: (value) => normalizeBoundaryViolations(value as BoundaryViolationLikeOutput),
  },
  {
    id: "TS-LD-05-domain-term-consistency",
    aliases: ["TS-LD-05"],
    optional: true,
    factorPath: "inputs.domain_term_consistency",
    weight: FACTOR_WEIGHTS.domainLanguageDrift,
    cacheFingerprint: "ts-ad-05-domain-term-consistency-input-v1",
    rawValue: (value) => summarizeDomainTermConsistency(value as DomainTermLikeOutput),
    normalize: (value) => normalizeDomainTermConsistency(value as DomainTermLikeOutput),
  },
] satisfies ReadonlyArray<CompositeInputSpec>

export const TsAd05: Signal<TsAd05Config, BoundaryTrustBreachOutput, never> = {
  id: "TS-AD-05-boundary-trust-breach",
  title: "Boundary trust breach",
  aliases: ["TS-AD-05"],
  tier: 1.5,
  category: "architectural-drift",
  kind: "compound",
  cacheVersion: "boundary-trust-breach-composite-policy-v1",
  configSchema: TsAd05Config,
  defaultConfig: {
    top_n_diagnostics: 10,
    warn_threshold: 0.35,
  },
  inputs: compositeSignalInputs(TS_AD_05_COMPOSITE_INPUTS),
  compute: (config, inputs) =>
    Effect.sync(() => computeBoundaryTrustBreachOutput(config, inputs)),
  score: (out) => {
    if (out.state === "insufficient_evidence") return 1
    return Math.max(0, 1 - Math.min(1, out.riskPressure))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.state === "insufficient_evidence") {
      return [{
        severity: "warn",
        message:
          "Boundary trust breach composite has insufficient parser coverage evidence",
        data: { inputFactStates: out.inputFactStates },
      }]
    }

    return out.breaches.slice(0, out.diagnosticLimit).map((breach) => ({
      severity: breach.score >= out.warnThreshold ? ("warn" as const) : ("info" as const),
      message:
        `Boundary trust breach #${breach.rank}: ${formatBoundaryFile(breach.file)} ` +
        `(score=${breach.score.toFixed(2)})`,
      location: { file: breach.file },
      data: { ...breach },
    }))
  },
  outputMetadata: (out) =>
    out.state === "insufficient_evidence"
      ? { applicability: "insufficient_evidence" as const }
      : undefined,
}

export const computeBoundaryTrustBreachOutput = (
  config: TsAd05Config,
  inputs: ReadonlyMap<string, unknown>,
): BoundaryTrustBreachOutput => {
  const resolution = resolveCompositeInputs(TS_AD_05_COMPOSITE_INPUTS, inputs)
  const resolvedInputs = resolveBoundaryTrustInputs(resolution)
  const diagnosticLimit = Math.max(0, Math.floor(config.top_n_diagnostics))
  const inputFactStates = boundaryTrustInputFactStates(resolution, resolvedInputs)
  const insufficientParserEvidence =
    resolution.hasMissingRequiredInputs ||
    inputFactStates.boundaryParserCoverage === "absent" ||
    inputFactStates.boundaryParserCoverage === "not_configured"
  const availableFactors = availableBoundaryTrustFactors(inputFactStates)

  if (insufficientParserEvidence) {
    return withBoundaryTrustExplanation(
      baseBoundaryTrustOutput({
        state: "insufficient_evidence",
        breaches: [],
        diagnosticLimit,
        inputFactStates,
        availableFactorWeight: availableFactors.totalWeight,
        riskPressure: 0,
        warnThreshold: config.warn_threshold,
      }),
      resolution,
      "Boundary trust breach is not measured because boundary parser coverage is missing or insufficient.",
    )
  }

  const breaches = buildBoundaryTrustCandidates(resolvedInputs, availableFactors)
    .filter((candidate) => candidate.score > 0)
    .sort(compareBoundaryTrustCandidates)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }))
  const riskPressure = boundaryTrustRiskPressure(breaches)
  const state = breaches.length === 0 ? "zero" as const : "present" as const

  return withBoundaryTrustExplanation(
    baseBoundaryTrustOutput({
      state,
      breaches,
      diagnosticLimit,
      inputFactStates,
      availableFactorWeight: availableFactors.totalWeight,
      riskPressure,
      warnThreshold: config.warn_threshold,
    }),
    resolution,
    state === "present"
      ? "Ranks boundary trust risk from parser coverage gaps, unsafe boundary types, module boundary violations, and domain language drift."
      : "Boundary trust breach is measured and no boundary trust pressure was found.",
  )
}

const resolveBoundaryTrustInputs = (
  inputs: CompositeInputResolution,
): BoundaryTrustInputs => ({
  boundaryParserCoverage: inputs.valueOf<TsAd04Output>("TS-AD-04-boundary-parser-coverage"),
  unsafeTypeErosion: inputs.valueOf<TsLd07Output>("TS-LD-07-unsafe-type-erosion"),
  boundaryViolations: inputs.valueOf<BoundaryViolationLikeOutput>("TS-AD-01-boundary-violations"),
  domainTermConsistency: inputs.valueOf<DomainTermLikeOutput>("TS-LD-05-domain-term-consistency"),
})

const baseBoundaryTrustOutput = (args: {
  readonly state: BoundaryTrustBreachState
  readonly breaches: ReadonlyArray<BoundaryTrustBreachCandidate>
  readonly diagnosticLimit: number
  readonly inputFactStates: BoundaryTrustBreachOutput["inputFactStates"]
  readonly availableFactorWeight: number
  readonly riskPressure: number
  readonly warnThreshold: number
}): Omit<BoundaryTrustBreachOutput, "explanation"> => ({
  ...args,
  breachPressure: args.riskPressure,
  totalFilesConsidered: args.breaches.length,
  evidenceCompleteness: clamp01(args.availableFactorWeight),
  riskModel: "boundary-trust-breach-v1",
  compositeConsumers: [
    "contract safety gap",
    "boundary integrity",
    "AI quicksand risk",
  ],
  cacheContributors: [
    "input.TS-AD-04-boundary-parser-coverage",
    "input.TS-LD-07-unsafe-type-erosion",
    "input.TS-AD-01-boundary-violations",
    "input.TS-LD-05-domain-term-consistency",
    "config.top_n_diagnostics",
    "config.warn_threshold",
  ],
  calibrationSurface:
    "input signal calibration; future composite policy slot can tune boundary trust factor weights by architectural tier",
  evidenceClass: [
    "runtime boundary",
    "architecture dependency",
    "type",
    "domain invariant",
  ],
  claimLimit:
    "Identifies files where weak boundary inputs and related deterministic evidence suggest boundary trust risk.",
  nonClaimLimit:
    "Does not prove parser correctness, domain validity, or runtime security.",
  knownFailureMode:
    "Parser evidence is syntactic and can miss custom construction helpers or over-count parser-like callees.",
  enforcementCeiling: [...BOUNDARY_TRUST_ENFORCEMENT_CEILING],
})

const withBoundaryTrustExplanation = (
  output: Omit<BoundaryTrustBreachOutput, "explanation">,
  inputs: CompositeInputResolution,
  rationale: string,
): BoundaryTrustBreachOutput => ({
  ...output,
  explanation: buildCompositeExplanation({
    inputs,
    finalScore: TsAd05.score(output as BoundaryTrustBreachOutput),
    rationale,
    enforcementCeiling: [...BOUNDARY_TRUST_ENFORCEMENT_CEILING],
  }),
})

const boundaryTrustInputFactStates = (
  resolution: CompositeInputResolution,
  inputs: BoundaryTrustInputs,
): BoundaryTrustBreachOutput["inputFactStates"] => ({
  boundaryParserCoverage:
    resolution.missingRequiredInputs.includes("TS-AD-04-boundary-parser-coverage")
      ? "missing_required"
      : inputs.boundaryParserCoverage?.state ?? "missing_required",
  unsafeTypeErosion:
    resolution.missingInputs.includes("TS-LD-07-unsafe-type-erosion")
      ? "missing_optional"
      : unsafeTypeState(inputs.unsafeTypeErosion),
  boundaryViolations:
    resolution.missingInputs.includes("TS-AD-01-boundary-violations")
      ? "missing_optional"
      : boundaryViolationState(inputs.boundaryViolations),
  domainTermConsistency:
    resolution.missingInputs.includes("TS-LD-05-domain-term-consistency")
      ? "missing_optional"
      : domainTermState(inputs.domainTermConsistency),
})

const unsafeTypeState = (
  input: TsLd07Output | undefined,
): BoundaryTrustInputFactState => {
  if (input === undefined) return "missing_optional"
  if (input.analyzedFiles === 0 || input.analyzedLines === 0) return "not_applicable"
  return input.boundaryOccurrences === 0 ? "zero" : "present"
}

const boundaryViolationState = (
  input: BoundaryViolationLikeOutput | undefined,
): BoundaryTrustInputFactState => {
  if (input === undefined) return "missing_optional"
  if (input.referenceDataStatus === "missing") return "not_configured"
  if (input.totalImports === 0) return "not_applicable"
  return input.violations.length === 0 ? "zero" : "present"
}

const domainTermState = (
  input: DomainTermLikeOutput | undefined,
): BoundaryTrustInputFactState => {
  if (input === undefined) return "missing_optional"
  if (input.referenceDataStatus === "missing") return "not_configured"
  if (input.totalIdentifiers === 0) return "not_applicable"
  return input.conflictCount + input.duplicateCount === 0 ? "zero" : "present"
}

const availableBoundaryTrustFactors = (
  states: BoundaryTrustBreachOutput["inputFactStates"],
): { readonly factors: BoundaryTrustBreachFactors; readonly totalWeight: number } => {
  const factors: {
    parserCoverage?: number
    unsafeBoundaryTypes?: number
    boundaryViolations?: number
    domainLanguageDrift?: number
  } = {}
  if (states.boundaryParserCoverage === "present" || states.boundaryParserCoverage === "zero" || states.boundaryParserCoverage === "not_applicable") {
    factors.parserCoverage = FACTOR_WEIGHTS.parserCoverage
  }
  if (states.unsafeTypeErosion !== "missing_optional") {
    factors.unsafeBoundaryTypes = FACTOR_WEIGHTS.unsafeBoundaryTypes
  }
  if (states.boundaryViolations !== "missing_optional" && states.boundaryViolations !== "not_configured") {
    factors.boundaryViolations = FACTOR_WEIGHTS.boundaryViolations
  }
  if (states.domainTermConsistency !== "missing_optional" && states.domainTermConsistency !== "not_configured") {
    factors.domainLanguageDrift = FACTOR_WEIGHTS.domainLanguageDrift
  }
  return {
    factors,
    totalWeight: Object.values(factors).reduce((sum, value) => sum + (value ?? 0), 0),
  }
}

const buildBoundaryTrustCandidates = (
  inputs: BoundaryTrustInputs,
  availableFactors: { readonly factors: BoundaryTrustBreachFactors; readonly totalWeight: number },
): ReadonlyArray<Omit<BoundaryTrustBreachCandidate, "rank">> => {
  const byFile = new Map<string, BoundaryEvidenceAccumulator>()
  for (const finding of inputs.boundaryParserCoverage?.findings ?? []) {
    const entry = evidenceEntry(byFile, finding.file)
    entry.parserFindings += 1
    entry.weakBoundaryParameters += finding.weakParameters.length
  }
  for (const covered of inputs.boundaryParserCoverage?.covered ?? []) {
    const entry = evidenceEntry(byFile, covered.file)
    entry.coveredWeakBoundaryFunctions += 1
  }
  for (const occurrence of inputs.unsafeTypeErosion?.occurrences ?? []) {
    if (!occurrence.boundary || !occurrence.visible) continue
    const entry = evidenceEntry(byFile, occurrence.file)
    entry.unsafeBoundaryOccurrences += 1
    entry.unsafeBoundaryWeight += occurrence.weight
  }
  for (const violation of inputs.boundaryViolations?.violations ?? []) {
    const entry = evidenceEntry(byFile, violation.fromFile)
    entry.boundaryViolations += 1
  }
  for (const identifier of inputs.domainTermConsistency?.identifiers ?? []) {
    if (
      identifier.classification !== "conflicts-with-canonical" &&
      identifier.classification !== "duplicates-canonical"
    ) {
      continue
    }
    const entry = evidenceEntry(byFile, identifier.file)
    entry.domainTermDrift += identifier.classification === "conflicts-with-canonical" ? 1 : 0.5
  }

  return [...byFile.values()]
    .filter(hasBoundaryTrustAnchor)
    .map((entry) =>
      boundaryTrustCandidate(entry, inputs, availableFactors),
    )
}

const evidenceEntry = (
  byFile: Map<string, BoundaryEvidenceAccumulator>,
  file: string,
): BoundaryEvidenceAccumulator => {
  const existing = byFile.get(file)
  if (existing !== undefined) return existing
  const created: BoundaryEvidenceAccumulator = {
    file,
    parserFindings: 0,
    coveredWeakBoundaryFunctions: 0,
    weakBoundaryParameters: 0,
    unsafeBoundaryOccurrences: 0,
    unsafeBoundaryWeight: 0,
    boundaryViolations: 0,
    domainTermDrift: 0,
  }
  byFile.set(file, created)
  return created
}

const hasBoundaryTrustAnchor = (entry: BoundaryEvidenceAccumulator): boolean =>
  entry.parserFindings > 0 ||
  entry.unsafeBoundaryOccurrences > 0 ||
  entry.boundaryViolations > 0

const boundaryTrustCandidate = (
  entry: BoundaryEvidenceAccumulator,
  inputs: BoundaryTrustInputs,
  availableFactors: { readonly factors: BoundaryTrustBreachFactors; readonly totalWeight: number },
): Omit<BoundaryTrustBreachCandidate, "rank"> => {
  const factors: BoundaryTrustBreachFactors = {
    ...(availableFactors.factors.parserCoverage !== undefined
      ? { parserCoverage: parserCoveragePressure(entry) }
      : {}),
    ...(availableFactors.factors.unsafeBoundaryTypes !== undefined
      ? {
        unsafeBoundaryTypes: clamp01(
          entry.unsafeBoundaryWeight /
          Math.max(1, inputs.unsafeTypeErosion?.boundaryThreshold ?? 1),
        ),
      }
      : {}),
    ...(availableFactors.factors.boundaryViolations !== undefined
      ? { boundaryViolations: clamp01(entry.boundaryViolations / 3) }
      : {}),
    ...(availableFactors.factors.domainLanguageDrift !== undefined
      ? { domainLanguageDrift: clamp01(entry.domainTermDrift / 5) }
      : {}),
  }
  return {
    file: entry.file,
    score: weightedBoundaryTrustScore(factors, availableFactors.factors),
    factors,
    evidence: {
      ...(entry.parserFindings > 0 ? { parserFindings: entry.parserFindings } : {}),
      ...(entry.weakBoundaryParameters > 0
        ? { weakBoundaryParameters: entry.weakBoundaryParameters }
        : {}),
      ...(entry.unsafeBoundaryOccurrences > 0
        ? { unsafeBoundaryOccurrences: entry.unsafeBoundaryOccurrences }
        : {}),
      ...(entry.unsafeBoundaryWeight > 0
        ? { unsafeBoundaryWeight: entry.unsafeBoundaryWeight }
        : {}),
      ...(entry.boundaryViolations > 0 ? { boundaryViolations: entry.boundaryViolations } : {}),
      ...(entry.domainTermDrift > 0 ? { domainTermDrift: entry.domainTermDrift } : {}),
    },
  }
}

const parserCoveragePressure = (entry: BoundaryEvidenceAccumulator): number => {
  const measuredWeakFunctions =
    entry.parserFindings + entry.coveredWeakBoundaryFunctions
  if (measuredWeakFunctions === 0) return 0
  return clamp01(entry.parserFindings / measuredWeakFunctions)
}

const weightedBoundaryTrustScore = (
  factors: BoundaryTrustBreachFactors,
  availableWeights: BoundaryTrustBreachFactors,
): number => {
  const totalWeight = Object.values(availableWeights).reduce(
    (sum, value) => sum + (value ?? 0),
    0,
  )
  if (totalWeight <= 0) return 0
  return clamp01(
    ((factors.parserCoverage ?? 0) * (availableWeights.parserCoverage ?? 0) +
      (factors.unsafeBoundaryTypes ?? 0) * (availableWeights.unsafeBoundaryTypes ?? 0) +
      (factors.boundaryViolations ?? 0) * (availableWeights.boundaryViolations ?? 0) +
      (factors.domainLanguageDrift ?? 0) * (availableWeights.domainLanguageDrift ?? 0)) /
    totalWeight,
  )
}

const boundaryTrustRiskPressure = (
  breaches: ReadonlyArray<BoundaryTrustBreachCandidate>,
): number => {
  if (breaches.length === 0) return 0
  const top = breaches.slice(0, Math.min(10, breaches.length))
  return top.reduce((sum, breach) => sum + breach.score, 0) / top.length
}

const compareBoundaryTrustCandidates = (
  left: Omit<BoundaryTrustBreachCandidate, "rank">,
  right: Omit<BoundaryTrustBreachCandidate, "rank">,
): number =>
  right.score - left.score ||
  left.file.localeCompare(right.file)

const summarizeBoundaryParserCoverage = (input: TsAd04Output): unknown => ({
  state: input.state,
  boundaryFilesMatched: input.boundaryFilesMatched,
  weakBoundaryFunctions: input.weakBoundaryFunctions,
  findings: input.findings.length,
  covered: input.coveredWeakBoundaryFunctions,
})

const summarizeUnsafeTypeErosion = (input: TsLd07Output): unknown => ({
  totalOccurrences: input.totalOccurrences,
  boundaryOccurrences: input.boundaryOccurrences,
  boundaryWeightedUnsafe: input.boundaryWeightedUnsafe,
  boundaryPressure: input.boundaryPressure,
})

const summarizeBoundaryViolations = (input: BoundaryViolationLikeOutput): unknown => ({
  state: input.referenceDataStatus === "missing" ? "not_configured" : "present",
  violations: input.violations.length,
  totalImports: input.totalImports,
})

const summarizeDomainTermConsistency = (input: DomainTermLikeOutput): unknown => ({
  state: input.referenceDataStatus === "missing" ? "not_configured" : "present",
  totalIdentifiers: input.totalIdentifiers,
  duplicateCount: input.duplicateCount,
  conflictCount: input.conflictCount,
})

const normalizeBoundaryParserCoverage = (input: TsAd04Output): number | undefined => {
  if (input.state === "absent" || input.state === "not_configured") return undefined
  if (input.weakBoundaryFunctions === 0) return 0
  return clamp01(input.findings.length / input.weakBoundaryFunctions)
}

const normalizeUnsafeTypeErosion = (input: TsLd07Output): number =>
  clamp01(input.boundaryPressure)

const normalizeBoundaryViolations = (
  input: BoundaryViolationLikeOutput,
): number | undefined => {
  if (input.referenceDataStatus === "missing") return undefined
  if (input.totalImports === 0) return 0
  return clamp01(input.violations.length / input.totalImports)
}

const normalizeDomainTermConsistency = (
  input: DomainTermLikeOutput,
): number | undefined => {
  if (input.referenceDataStatus === "missing") return undefined
  if (input.totalIdentifiers === 0) return 0
  return clamp01((input.conflictCount * 0.9 + input.duplicateCount * 0.5) / input.totalIdentifiers)
}

const formatBoundaryFile = (file: string): string => {
  const markers = ["/packages/", "/apps/", "/src/", "/cli/"] as const
  for (const marker of markers) {
    const index = file.indexOf(marker)
    if (index !== -1) return file.slice(index + 1)
  }
  return file
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))
