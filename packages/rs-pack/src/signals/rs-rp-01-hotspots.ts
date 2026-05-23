import {
  buildCompositeExplanation,
  compositeSignalInputs,
  type CompositeExplanation,
  type CompositeInputResolution,
  type CompositeInputSpec,
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  resolveCompositeInputs,
} from "@skastr0/pulsar-core/signal"
import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
import type { SharedChurn01Output } from "@skastr0/pulsar-shared-signals"
import { Effect, Schema } from "effect"

const RsRp01Config = Schema.Struct({
  top_n: Schema.Number,
  min_churn: Schema.Number,
  min_complexity: Schema.Number,
})
type RsRp01Config = typeof RsRp01Config.Type

type RustQuadrant = "top-right" | "top-left" | "bottom-right" | "bottom-left"

interface RustHotspot {
  readonly file: string
  readonly churn: number
  readonly complexity: number
  readonly hotspotScore: number
  readonly quadrant: RustQuadrant
  readonly rank: number
}

type RsRp01Output = {
  readonly hotspots: ReadonlyArray<RustHotspot>
  readonly explanation: CompositeExplanation
  readonly diagnosticLimit: number
  readonly totalFilesConsidered: number
  readonly hotspotFileCount: number
  readonly topRightShare: number
  readonly hotspotPressure: number
  readonly medianChurn: number
  readonly medianComplexity: number
  readonly minChurn: number
  readonly minComplexity: number
  readonly analysisMode: "rust-churn-complexity-hotspots"
  readonly scoreMode: "bounded-hotspot-pressure"
  readonly scoreDenominator: "aligned-churn-complexity-files"
}

interface ComplexityByFileInput {
  readonly byFile: ReadonlyMap<string, { readonly max: number }>
}

const DEFAULT_TOP_N = 10
const DEFAULT_MIN_CHURN = 2
const DEFAULT_MIN_COMPLEXITY = 5
const RS_RP_01_SCORE_MODE = "bounded-hotspot-pressure" as const
const RS_RP_01_SCORE_DENOMINATOR = "aligned-churn-complexity-files" as const
const RS_RP_01_ENFORCEMENT_CEILING = [
  "trend",
  "review-routing",
  "dashboard",
] as const

const RsRp01FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.top_n",
    title: "Config top n",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N,
  },
  {
    path: "config.min_churn",
    title: "Config min churn",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_MIN_CHURN,
  },
  {
    path: "config.min_complexity",
    title: "Config min complexity",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_MIN_COMPLEXITY,
  },
]

const RS_RP_01_COMPOSITE_INPUTS = [
  {
    id: "RS-LD-05-cyclomatic-complexity",
    aliases: ["RS-LD-05"],
    factorPath: "inputs.complexity",
    weight: 0.5,
    cacheFingerprint: "rs-rp-01-complexity-input-v2",
    rawValue: (value) => summarizeComplexityInput(value as ComplexityByFileInput),
    normalize: (value) => normalizeComplexityInput(value as ComplexityByFileInput),
  },
  {
    id: "SHARED-CHURN-01-recent-churn",
    aliases: ["SHARED-CHURN-01"],
    factorPath: "inputs.churn",
    weight: 0.5,
    cacheFingerprint: "rs-rp-01-churn-input-v2",
    rawValue: (value) => summarizeChurnInput(value as SharedChurn01Output),
    normalize: (value) => normalizeChurnInput(value as SharedChurn01Output),
  },
] satisfies ReadonlyArray<CompositeInputSpec>

export const RsRp01: Signal<RsRp01Config, RsRp01Output, never> = {
  id: "RS-RP-01-hotspots",
  title: "Hotspots",
  aliases: ["RS-RP-01"],
  tier: 1.5,
  category: "review-pain",
  kind: "compound",
  cacheVersion: "rust-hotspot-config-compound-applicability-ranking-v2",
  configSchema: RsRp01Config,
  factorDefinitions: RsRp01FactorDefinitions,
  defaultConfig: {
    top_n: DEFAULT_TOP_N,
    min_churn: DEFAULT_MIN_CHURN,
    min_complexity: DEFAULT_MIN_COMPLEXITY,
  },
  inputs: compositeSignalInputs(RS_RP_01_COMPOSITE_INPUTS),
  compute: (config, inputs) =>
    Effect.sync(() => {
      const normalizedConfig = normalizeRsRp01Config(config)
      const resolution = resolveCompositeInputs(RS_RP_01_COMPOSITE_INPUTS, inputs)
      const complexity = resolution.valueOf<ComplexityByFileInput>("RS-LD-05-cyclomatic-complexity")
      const churn = resolution.valueOf<SharedChurn01Output>("SHARED-CHURN-01-recent-churn")
      if (resolution.hasMissingRequiredInputs || complexity === undefined || churn === undefined) {
        return withRsRp01Explanation(
          emptyRsRp01Output(normalizedConfig),
          resolution,
          "Rust hotspot composite is neutral because required primitive inputs are missing.",
        )
      }

      const candidates = new Map<string, { churn: number; complexity: number }>()
      for (const [file, summary] of complexity.byFile) {
        const cplx = summary.max
        const fileChurn = churn.byFile.get(file) ?? 0
        if (!Number.isFinite(cplx) || !Number.isFinite(fileChurn) || fileChurn <= 0) continue
        candidates.set(file, { churn: fileChurn, complexity: cplx })
      }

      const churnValues = [...candidates.values()].map((entry) => entry.churn)
      const complexityValues = [...candidates.values()].map((entry) => entry.complexity)
      const medChurn = median(churnValues)
      const medComplexity = median(complexityValues)

      const hotspots = [...candidates.entries()]
        .filter(([, entry]) =>
          entry.churn >= normalizedConfig.min_churn &&
          entry.complexity >= normalizedConfig.min_complexity,
        )
        .map(([file, entry]) => ({
          file,
          churn: entry.churn,
          complexity: entry.complexity,
          hotspotScore: entry.churn * entry.complexity,
          quadrant: classifyQuadrant(entry.churn, entry.complexity, medChurn, medComplexity, normalizedConfig),
          rank: 0,
        }))
        .sort((left, right) => right.hotspotScore - left.hotspotScore || left.file.localeCompare(right.file))
        .map((entry, index) => ({ ...entry, rank: index + 1 }))

      const topRightShare =
        hotspots.length === 0
          ? 0
          : hotspots.filter((entry) => entry.quadrant === "top-right").length / hotspots.length

      const output = {
        hotspots,
        diagnosticLimit: normalizedConfig.top_n,
        totalFilesConsidered: candidates.size,
        hotspotFileCount: hotspots.length,
        topRightShare,
        hotspotPressure: computeHotspotPressure(hotspots, candidates.size, normalizedConfig),
        medianChurn: medChurn,
        medianComplexity: medComplexity,
        minChurn: normalizedConfig.min_churn,
        minComplexity: normalizedConfig.min_complexity,
        analysisMode: "rust-churn-complexity-hotspots" as const,
        scoreMode: RS_RP_01_SCORE_MODE,
        scoreDenominator: RS_RP_01_SCORE_DENOMINATOR,
      }
      return withRsRp01Explanation(
        output,
        resolution,
        "Ranks Rust files by the composite pressure of recent churn and cyclomatic complexity.",
      )
    }),
  score: (out) => {
    if (out.totalFilesConsidered === 0 || out.hotspotFileCount === 0) return 1
    return Math.max(0.2, 1 - Math.min(0.8, out.hotspotPressure))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.explanation.missingInputs.length > 0
      ? [{
        severity: "warn" as const,
        message: `RS-RP-01 missing required compound inputs: ${out.explanation.missingInputs.join(", ")}`,
        data: {
          missingInputs: out.explanation.missingInputs,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
      : out.hotspots.slice(0, out.diagnosticLimit).map((entry) => ({
      severity: entry.quadrant === "top-right" ? ("warn" as const) : ("info" as const),
      message: `Hotspot #${entry.rank}: ${entry.file} (churn=${entry.churn}, complexity=${entry.complexity.toFixed(1)})`,
      location: { file: entry.file },
      data: {
        churn: entry.churn,
        complexity: entry.complexity,
        hotspotScore: entry.hotspotScore,
        quadrant: entry.quadrant,
        rank: entry.rank,
        topRightShare: out.topRightShare,
        hotspotPressure: out.hotspotPressure,
        analysisMode: out.analysisMode,
        scoreMode: out.scoreMode,
        scoreDenominator: out.scoreDenominator,
      },
    })),
  outputMetadata: (out) => {
    if (out.explanation.missingInputs.length > 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.totalFilesConsidered === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsRp01FactorLedger(),
}

type NormalizedRsRp01Config = RsRp01Config

const normalizeRsRp01Config = (config: RsRp01Config): NormalizedRsRp01Config => ({
  top_n: Number.isFinite(config.top_n) ? Math.max(0, Math.floor(config.top_n)) : 0,
  min_churn: Number.isFinite(config.min_churn)
    ? Math.max(0, Math.floor(config.min_churn))
    : DEFAULT_MIN_CHURN,
  min_complexity: Number.isFinite(config.min_complexity)
    ? Math.max(0, Math.floor(config.min_complexity))
    : DEFAULT_MIN_COMPLEXITY,
})

const emptyRsRp01Output = (config: NormalizedRsRp01Config): Omit<RsRp01Output, "explanation"> => ({
  hotspots: [],
  diagnosticLimit: config.top_n,
  totalFilesConsidered: 0,
  hotspotFileCount: 0,
  topRightShare: 0,
  hotspotPressure: 0,
  medianChurn: 0,
  medianComplexity: 0,
  minChurn: config.min_churn,
  minComplexity: config.min_complexity,
  analysisMode: "rust-churn-complexity-hotspots",
  scoreMode: RS_RP_01_SCORE_MODE,
  scoreDenominator: RS_RP_01_SCORE_DENOMINATOR,
})

const withRsRp01Explanation = (
  output: Omit<RsRp01Output, "explanation">,
  inputs: CompositeInputResolution,
  rationale: string,
): RsRp01Output => {
  const withPlaceholder = {
    ...output,
    explanation: {
      primitiveInputs: [],
      missingInputs: [],
      weights: [],
      finalScore: 1,
      rationale,
      enforcementCeiling: [...RS_RP_01_ENFORCEMENT_CEILING],
    },
  }
  return {
    ...output,
    explanation: buildCompositeExplanation({
      inputs,
      finalScore: RsRp01.score(withPlaceholder),
      rationale,
      enforcementCeiling: [...RS_RP_01_ENFORCEMENT_CEILING],
    }),
  }
}

const makeRsRp01FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-RP-01-hotspots",
    RsRp01FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0)
}

const classifyQuadrant = (
  churn: number,
  complexity: number,
  medianChurn: number,
  medianComplexity: number,
  config: NormalizedRsRp01Config,
): RustQuadrant => {
  const highChurn = churn >= Math.max(config.min_churn, medianChurn)
  const highComplexity = complexity >= Math.max(config.min_complexity, medianComplexity)
  if (highChurn && highComplexity) return "top-right"
  if (highChurn) return "top-left"
  if (highComplexity) return "bottom-right"
  return "bottom-left"
}

const computeHotspotPressure = (
  hotspots: ReadonlyArray<RustHotspot>,
  totalFilesConsidered: number,
  config: NormalizedRsRp01Config,
): number => {
  if (hotspots.length === 0 || totalFilesConsidered === 0) return 0
  const total = hotspots.reduce((sum, hotspot) => {
    const churnPressure = ratio(hotspot.churn, Math.max(1, config.min_churn))
    const complexityPressure = ratio(hotspot.complexity, Math.max(1, config.min_complexity))
    return sum + Math.min(1, Math.sqrt(churnPressure * complexityPressure))
  }, 0)
  return Math.min(1, total / totalFilesConsidered)
}

const ratio = (numerator: number, denominator: number): number =>
  denominator <= 0 ? 0 : numerator / denominator

const summarizeComplexityInput = (input: ComplexityByFileInput): unknown => ({
  files: input.byFile.size,
  maxComplexity: Math.max(0, ...[...input.byFile.values()].map((entry) => entry.max)),
})

const summarizeChurnInput = (input: SharedChurn01Output): unknown => ({
  files: input.byFile.size,
  totalCommits: input.totalCommits,
  windowDays: input.windowDays,
  ...(input.sampled === true ? { sampled: true } : {}),
})

const normalizeComplexityInput = (input: ComplexityByFileInput): number =>
  Math.min(1, Math.max(0, summarizeMaxComplexity(input) / 50))

const normalizeChurnInput = (input: SharedChurn01Output): number =>
  Math.min(1, Math.max(0, input.totalCommits / 100))

const summarizeMaxComplexity = (input: ComplexityByFileInput): number =>
  Math.max(0, ...[...input.byFile.values()].map((entry) => entry.max))
