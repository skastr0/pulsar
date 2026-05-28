import { clamp01 } from "./ts-rp-01-hotspot-math.js"
import type { HotspotFactState } from "./ts-rp-01-hotspot-types.js"

interface ComplexityInput {
  readonly byFile: ReadonlyMap<string, { readonly max: number }>
  readonly totalFunctions: number
  readonly maxComplexity: number
}

interface RecentChurnInput {
  readonly byFile: ReadonlyMap<string, number>
  readonly totalCommits: number
  readonly windowDays: number
  readonly sampled?: boolean
}

interface WeightedChurnInput {
  readonly byFile: ReadonlyMap<string, { readonly weightedChurn: number }>
  readonly totalCommits: number
  readonly windowDays: number
  readonly halfLifeDays: number
  readonly sampled?: boolean
}

interface OwnershipInput {
  readonly touchedFileCount: number
  readonly touchedLoc: number
  readonly siloed: ReadonlyArray<OwnershipEntry>
  readonly effectiveSiloed?: ReadonlyArray<OwnershipEntry>
  readonly repoAuthors: ReadonlyArray<unknown>
}

interface OwnershipEntry {
  readonly file: string
  readonly loc: number
  readonly penaltyWeight?: number
}

interface CoverageInput {
  readonly state: HotspotFactState
  readonly files: ReadonlyArray<{
    readonly file: string
    readonly lines: { readonly pct: number }
  }>
  readonly summary: {
    readonly lines: { readonly pct: number }
    readonly functions: { readonly pct: number }
    readonly branches: { readonly pct: number }
  }
}

interface CochangeInput {
  readonly pairs: ReadonlyArray<{
    readonly leftFile: string
    readonly rightFile: string
    readonly confidence: number
    readonly support: number
  }>
  readonly totalCommits: number
  readonly windowDays: number
  readonly sampled?: boolean
}

interface HotspotCompositeInputSpec {
  readonly id: string
  readonly aliases: ReadonlyArray<string>
  readonly optional?: boolean
  readonly factorPath: string
  readonly weight: number
  readonly cacheFingerprint: string
  readonly rawValue: (value: unknown) => unknown
  readonly normalize: (value: unknown) => number
}

interface HotspotInputResolution {
  valueOf<A>(id: string): A | undefined
}

export interface HotspotInputs {
  readonly complexity: ComplexityInput | undefined
  readonly churn: RecentChurnInput | undefined
  readonly weightedChurn: WeightedChurnInput | undefined
  readonly ownership: OwnershipInput | undefined
  readonly coverage: CoverageInput | undefined
  readonly cochange: CochangeInput | undefined
}

export const TS_RP_01_COMPOSITE_INPUTS = [
  {
    id: "TS-LD-01-cyclomatic-complexity",
    aliases: ["TS-LD-01"],
    factorPath: "inputs.complexity",
    weight: 0.5,
    cacheFingerprint: "ts-rp-01-hotspot-complexity-input-v1",
    rawValue: (value) => summarizeComplexityInput(value as ComplexityInput),
    normalize: (value) => normalizeComplexityInput(value as ComplexityInput),
  },
  {
    id: "SHARED-CHURN-01-recent-churn",
    aliases: ["SHARED-CHURN-01"],
    factorPath: "inputs.churn",
    weight: 0.5,
    cacheFingerprint: "ts-rp-01-hotspot-churn-input-v1",
    rawValue: (value) => summarizeChurnInput(value as RecentChurnInput),
    normalize: (value) => normalizeChurnInput(value as RecentChurnInput),
  },
  {
    id: "SHARED-CHURN-02-recency-weighted-churn",
    aliases: ["SHARED-CHURN-02"],
    optional: true,
    factorPath: "inputs.recency_weighted_churn",
    weight: 0.25,
    cacheFingerprint: "ts-rp-01-hotspot-weighted-churn-input-v1",
    rawValue: (value) => summarizeWeightedChurnInput(value as WeightedChurnInput),
    normalize: (value) => normalizeWeightedChurnInput(value as WeightedChurnInput),
  },
  {
    id: "SHARED-02-bus-factor",
    aliases: ["SHARED-02"],
    optional: true,
    factorPath: "inputs.ownership",
    weight: 0.15,
    cacheFingerprint: "ts-rp-01-hotspot-ownership-input-v1",
    rawValue: (value) => summarizeOwnershipInput(value as OwnershipInput),
    normalize: (value) => normalizeOwnershipInput(value as OwnershipInput),
  },
  {
    id: "SHARED-COV-01-coverage-facts",
    aliases: ["SHARED-COV-01"],
    optional: true,
    factorPath: "inputs.coverage",
    weight: 0.15,
    cacheFingerprint: "ts-rp-01-hotspot-coverage-input-v1",
    rawValue: (value) => summarizeCoverageInput(value as CoverageInput),
    normalize: (value) => normalizeCoverageInput(value as CoverageInput),
  },
  {
    id: "SHARED-COCHANGE-01-logical-coupling",
    aliases: ["SHARED-COCHANGE-01"],
    optional: true,
    factorPath: "inputs.cochange",
    weight: 0.1,
    cacheFingerprint: "ts-rp-01-hotspot-cochange-input-v1",
    rawValue: (value) => summarizeCochangeInput(value as CochangeInput),
    normalize: (value) => normalizeCochangeInput(value as CochangeInput),
  },
] satisfies ReadonlyArray<HotspotCompositeInputSpec>

export const resolveHotspotInputs = (
  inputs: HotspotInputResolution,
): HotspotInputs => ({
  complexity: inputs.valueOf<ComplexityInput>("TS-LD-01-cyclomatic-complexity"),
  churn: inputs.valueOf<RecentChurnInput>("SHARED-CHURN-01-recent-churn"),
  weightedChurn: inputs.valueOf<WeightedChurnInput>("SHARED-CHURN-02-recency-weighted-churn"),
  ownership: inputs.valueOf<OwnershipInput>("SHARED-02-bus-factor"),
  coverage: inputs.valueOf<CoverageInput>("SHARED-COV-01-coverage-facts"),
  cochange: inputs.valueOf<CochangeInput>("SHARED-COCHANGE-01-logical-coupling"),
})

const summarizeComplexityInput = (input: ComplexityInput): unknown => ({
  files: input.byFile.size,
  totalFunctions: input.totalFunctions,
  maxComplexity: input.maxComplexity,
})

const summarizeChurnInput = (input: RecentChurnInput): unknown =>
  summarizeCommitWindow({
    files: input.byFile.size,
    totalCommits: input.totalCommits,
    windowDays: input.windowDays,
    sampled: input.sampled === true,
  })

const summarizeWeightedChurnInput = (input: WeightedChurnInput): unknown =>
  summarizeCommitWindow({
    files: input.byFile.size,
    totalCommits: input.totalCommits,
    windowDays: input.windowDays,
    halfLifeDays: input.halfLifeDays,
    sampled: input.sampled === true,
  })

const summarizeCommitWindow = (args: {
  readonly files: number
  readonly totalCommits: number
  readonly windowDays: number
  readonly halfLifeDays?: number
  readonly sampled: boolean
}): unknown => ({
  files: args.files,
  totalCommits: args.totalCommits,
  windowDays: args.windowDays,
  ...(args.halfLifeDays === undefined ? {} : { halfLifeDays: args.halfLifeDays }),
  ...(args.sampled ? { sampled: true } : {}),
})

const summarizeOwnershipInput = (input: OwnershipInput): unknown => ({
  touchedFiles: input.touchedFileCount,
  touchedLoc: input.touchedLoc,
  siloed: input.effectiveSiloed?.length ?? input.siloed.length,
  repoAuthors: input.repoAuthors.length,
})

const summarizeCoverageInput = (input: CoverageInput): unknown => ({
  state: input.state,
  files: input.files.length,
  lineCoverage: input.summary.lines.pct,
  functionCoverage: input.summary.functions.pct,
  branchCoverage: input.summary.branches.pct,
})

const summarizeCochangeInput = (input: CochangeInput): unknown => ({
  pairs: input.pairs.length,
  totalCommits: input.totalCommits,
  windowDays: input.windowDays,
  ...(input.sampled === true ? { sampled: true } : {}),
})

const normalizeComplexityInput = (input: ComplexityInput): number =>
  clamp01(input.maxComplexity / 50)

const normalizeChurnInput = (input: RecentChurnInput): number => {
  const maxFileChurn = Math.max(0, ...input.byFile.values())
  return clamp01(maxFileChurn / Math.max(1, input.windowDays))
}

const normalizeWeightedChurnInput = (input: WeightedChurnInput): number => {
  const maxWeightedChurn = Math.max(
    0,
    ...[...input.byFile.values()].map((file) => file.weightedChurn),
  )
  return clamp01(maxWeightedChurn / Math.max(1, input.halfLifeDays))
}

const normalizeOwnershipInput = (input: OwnershipInput): number => {
  const entries = input.effectiveSiloed ?? input.siloed
  return clamp01(Math.max(0, ...entries.map((entry) => {
    if ("penaltyWeight" in entry && typeof entry.penaltyWeight === "number") {
      return entry.penaltyWeight
    }
    return input.touchedLoc === 0 ? 0 : entry.loc / input.touchedLoc
  })))
}

const normalizeCoverageInput = (input: CoverageInput): number => {
  if (input.state === "absent" || input.state === "unknown" || input.state === "not_configured") {
    return 0
  }
  return clamp01(1 - input.summary.lines.pct)
}

const normalizeCochangeInput = (input: CochangeInput): number =>
  clamp01(Math.max(0, ...input.pairs.map((pair) => pair.confidence)))
