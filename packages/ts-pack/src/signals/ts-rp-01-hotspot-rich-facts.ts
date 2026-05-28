import { clamp01 } from "./ts-rp-01-hotspot-math.js"
import type {
  HotspotFactState,
  HotspotInputFactStates,
} from "./ts-rp-01-hotspot-types.js"
import type { HotspotInputs } from "./ts-rp-01-hotspot-inputs.js"

type OwnershipFacts = NonNullable<HotspotInputs["ownership"]>
type CoverageFacts = NonNullable<HotspotInputs["coverage"]>
type CochangeFacts = NonNullable<HotspotInputs["cochange"]>

export interface RichFactIndexes {
  readonly weightedChurnByFile: ReadonlyMap<string, { readonly weightedChurn: number }>
  readonly ownershipRiskByFile: ReadonlyMap<string, number>
  readonly coverageGapByFile: ReadonlyMap<string, number>
  readonly cochangeRiskByFile: ReadonlyMap<string, number>
  readonly states: HotspotInputFactStates
}

export const buildRichFactIndexes = (
  inputs: Pick<HotspotInputs, "weightedChurn" | "ownership" | "coverage" | "cochange">,
): RichFactIndexes => {
  const weightedChurnByFile = inputs.weightedChurn?.byFile ?? new Map()
  const ownershipRiskByFile = ownershipRiskMap(inputs.ownership)
  const coverageGapByFile = coverageGapMap(inputs.coverage)
  const cochangeRiskByFile = cochangeRiskMap(inputs.cochange)
  const states = {
    recencyWeightedChurn: collectionFactState(inputs.weightedChurn?.byFile.size),
    ownership: ownershipState(inputs.ownership),
    coverage: inputs.coverage?.state ?? "not_configured",
    cochange: collectionFactState(inputs.cochange?.pairs.length),
  } satisfies HotspotInputFactStates
  return {
    weightedChurnByFile,
    ownershipRiskByFile,
    coverageGapByFile,
    cochangeRiskByFile,
    states,
  }
}

const ownershipRiskMap = (
  input: OwnershipFacts | undefined,
): ReadonlyMap<string, number> => {
  if (input === undefined) return new Map()
  const entries = input.effectiveSiloed ?? input.siloed
  return new Map(
    entries.map((entry) => {
      const penaltyWeight =
        "penaltyWeight" in entry && typeof entry.penaltyWeight === "number"
          ? entry.penaltyWeight
          : input.touchedLoc === 0 ? 0 : entry.loc / input.touchedLoc
      return [entry.file, clamp01(penaltyWeight)] as const
    }),
  )
}

const coverageGapMap = (
  input: CoverageFacts | undefined,
): ReadonlyMap<string, number> => {
  if (input === undefined) return new Map()
  if (input.state !== "present" && input.state !== "zero") return new Map()
  return new Map(
    input.files.map((file) => [
      file.file,
      clamp01(1 - file.lines.pct),
    ] as const),
  )
}

const cochangeRiskMap = (
  input: CochangeFacts | undefined,
): ReadonlyMap<string, number> => {
  if (input === undefined) return new Map()
  const byFile = new Map<string, number>()
  for (const pair of input.pairs) {
    const risk = clamp01(Math.max(pair.confidence, pair.support))
    byFile.set(pair.leftFile, Math.max(byFile.get(pair.leftFile) ?? 0, risk))
    byFile.set(pair.rightFile, Math.max(byFile.get(pair.rightFile) ?? 0, risk))
  }
  return byFile
}

const ownershipState = (
  input: OwnershipFacts | undefined,
): HotspotFactState => {
  if (input === undefined) return "not_configured"
  if (input.touchedFileCount === 0 || input.touchedLoc === 0) return "not_applicable"
  return (input.effectiveSiloed?.length ?? input.siloed.length) === 0 ? "zero" : "present"
}

const collectionFactState = (size: number | undefined): HotspotFactState =>
  size === undefined ? "not_configured" : size === 0 ? "zero" : "present"
