import {
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import {
  Effect,
  Schema,
} from "effect"

export const Shared06PrDepDeltaConfig = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
export type Shared06PrDepDeltaConfig = typeof Shared06PrDepDeltaConfig.Type

interface TsPrDeltaLike {
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly filesChanged?: ReadonlyArray<unknown>
  readonly newCrossPackageEdges: ReadonlyArray<unknown>
  readonly newCrossBoundaryEdges: ReadonlyArray<unknown>
  readonly diffMode?: "git-working-tree" | "git-branch-range" | "git-commit-range" | "changed-hunks-fallback" | "missing"
  readonly dependencyDeltaMode?: "measured" | "unavailable"
}

interface RsPrDeltaLike {
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly filesChanged?: ReadonlyArray<unknown>
  readonly newCrossCrateEdges: ReadonlyArray<unknown>
  readonly diffMode?: "git-working-tree" | "git-commit-range" | "changed-hunks-fallback" | "missing"
}

type DependencyDeltaState =
  | "measured"
  | "unavailable"
  | "missing"
  | "not_applicable"

interface TsDependencyFacts {
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly crossBoundaryEdges: number
  readonly crossPackageEdges: number
  readonly diffMode: NonNullable<TsPrDeltaLike["diffMode"]>
  readonly dependencyDeltaMode: NonNullable<TsPrDeltaLike["dependencyDeltaMode"]>
  readonly dependencyDeltaState: DependencyDeltaState
}

interface RsDependencyFacts {
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly crossCrateEdges: number
  readonly diffMode: NonNullable<RsPrDeltaLike["diffMode"]>
  readonly dependencyDeltaMode: "measured" | "unavailable" | "missing"
  readonly dependencyDeltaState: DependencyDeltaState
}

export interface Shared06PrDepDeltaOutput {
  readonly dependencyDeltaState: DependencyDeltaState
  readonly totalNewDependencyEdges: number
  readonly crossBoundaryEdges: number
  readonly crossPackageEdges: number
  readonly crossCrateEdges: number
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly topDiagnostics: number
  readonly byLanguage: {
    readonly typescript?: {
      readonly newDependencyEdges: number
      readonly crossBoundaryEdges: number
      readonly crossPackageEdges: number
      readonly linesAdded: number
      readonly linesDeleted: number
      readonly diffMode: NonNullable<TsPrDeltaLike["diffMode"]>
      readonly dependencyDeltaMode: NonNullable<TsPrDeltaLike["dependencyDeltaMode"]>
    }
    readonly rust?: {
      readonly newDependencyEdges: number
      readonly crossCrateEdges: number
      readonly linesAdded: number
      readonly linesDeleted: number
      readonly diffMode: NonNullable<RsPrDeltaLike["diffMode"]>
      readonly dependencyDeltaMode: "measured" | "unavailable" | "missing"
    }
  }
}

export const Shared06PrDepDelta: Signal<Shared06PrDepDeltaConfig, Shared06PrDepDeltaOutput> = {
  id: "SHARED-06-pr-dependency-delta",
  title: "PR dependency delta",
  aliases: ["SHARED-06"],
  tier: 1.5,
  category: "review-pain",
  kind: "compound",
  cacheVersion: "empty-diff-applicability-v2-evidence-state-diagnostics",
  configSchema: Shared06PrDepDeltaConfig,
  defaultConfig: {
    top_n_diagnostics: 10,
  },
  inputs: [
    {
      id: "TS-RP-02-pr-size",
      optional: true,
      cacheFingerprint: "shared-06-typescript-pr-delta-input-v1",
    },
    {
      id: "RS-RP-03-pr-size",
      optional: true,
      cacheFingerprint: "shared-06-rust-pr-delta-input-v1",
    },
  ],
  compute: (config, inputs) =>
    Effect.sync(() => computePrDependencyDeltaOutput(config, inputs)),
  score: (out) => {
    if (out.totalNewDependencyEdges === 0) return 1
    const edgePenalty =
      out.crossBoundaryEdges * 0.2 + out.crossPackageEdges * 0.1 + out.crossCrateEdges * 0.15
    return Math.max(0, 1 - edgePenalty)
  },
  outputMetadata: (out) =>
    out.dependencyDeltaState === "missing" || out.dependencyDeltaState === "unavailable"
      ? { applicability: "insufficient_evidence" as const }
      : out.totalNewDependencyEdges === 0 && out.linesAdded === 0 && out.linesDeleted === 0
      ? { applicability: "not_applicable" as const }
      : undefined,
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    prDependencyDeltaDiagnostics(out).slice(0, out.topDiagnostics),
}

const computePrDependencyDeltaOutput = (
  config: Shared06PrDepDeltaConfig,
  inputs: ReadonlyMap<string, unknown>,
): Shared06PrDepDeltaOutput => {
  const normalizedConfig = normalizeShared06PrDepDeltaConfig(config)
  const tsInput = getPrDeltaInput<TsPrDeltaLike>(inputs, "TS-RP-02-pr-size", "TS-RP-02")
  const rsInput = getPrDeltaInput<RsPrDeltaLike>(inputs, "RS-RP-03-pr-size", "RS-RP-03")
  const tsFacts = tsInput === undefined ? undefined : tsDependencyFacts(tsInput)
  const rsFacts = rsInput === undefined ? undefined : rsDependencyFacts(rsInput)

  return buildPrDependencyDeltaOutput(normalizedConfig.top_n_diagnostics, tsFacts, rsFacts)
}

const buildPrDependencyDeltaOutput = (
  topDiagnostics: number,
  tsFacts: TsDependencyFacts | undefined,
  rsFacts: RsDependencyFacts | undefined,
): Shared06PrDepDeltaOutput => {
  const tsDependencyEdges =
    (tsFacts?.crossPackageEdges ?? 0) + (tsFacts?.crossBoundaryEdges ?? 0)
  const rsDependencyEdges = rsFacts?.crossCrateEdges ?? 0

  return {
    dependencyDeltaState: aggregateDependencyDeltaState([
      tsFacts?.dependencyDeltaState,
      rsFacts?.dependencyDeltaState,
    ]),
    totalNewDependencyEdges: tsDependencyEdges + rsDependencyEdges,
    crossBoundaryEdges: tsFacts?.crossBoundaryEdges ?? 0,
    crossPackageEdges: tsFacts?.crossPackageEdges ?? 0,
    crossCrateEdges: rsFacts?.crossCrateEdges ?? 0,
    linesAdded: (tsFacts?.linesAdded ?? 0) + (rsFacts?.linesAdded ?? 0),
    linesDeleted: (tsFacts?.linesDeleted ?? 0) + (rsFacts?.linesDeleted ?? 0),
    topDiagnostics,
    byLanguage: languageOutputs(tsFacts, rsFacts, tsDependencyEdges, rsDependencyEdges),
  }
}

const languageOutputs = (
  tsFacts: TsDependencyFacts | undefined,
  rsFacts: RsDependencyFacts | undefined,
  tsDependencyEdges: number,
  rsDependencyEdges: number,
): Shared06PrDepDeltaOutput["byLanguage"] => ({
  ...(tsFacts !== undefined
    ? { typescript: typescriptLanguageOutput(tsFacts, tsDependencyEdges) }
    : {}),
  ...(rsFacts !== undefined ? { rust: rustLanguageOutput(rsFacts, rsDependencyEdges) } : {}),
})

const typescriptLanguageOutput = (
  facts: TsDependencyFacts,
  newDependencyEdges: number,
): NonNullable<Shared06PrDepDeltaOutput["byLanguage"]["typescript"]> => ({
  newDependencyEdges,
  crossBoundaryEdges: facts.crossBoundaryEdges,
  crossPackageEdges: facts.crossPackageEdges,
  linesAdded: facts.linesAdded,
  linesDeleted: facts.linesDeleted,
  diffMode: facts.diffMode,
  dependencyDeltaMode: facts.dependencyDeltaMode,
})

const rustLanguageOutput = (
  facts: RsDependencyFacts,
  newDependencyEdges: number,
): NonNullable<Shared06PrDepDeltaOutput["byLanguage"]["rust"]> => ({
  newDependencyEdges,
  crossCrateEdges: facts.crossCrateEdges,
  linesAdded: facts.linesAdded,
  linesDeleted: facts.linesDeleted,
  diffMode: facts.diffMode,
  dependencyDeltaMode: facts.dependencyDeltaMode,
})

const getPrDeltaInput = <T>(
  inputs: ReadonlyMap<string, unknown>,
  canonicalId: string,
  alias: string,
): T | undefined =>
  (inputs.get(canonicalId) ?? inputs.get(alias)) as T | undefined

const prDependencyDeltaDiagnostics = (
  out: Shared06PrDepDeltaOutput,
): ReadonlyArray<Diagnostic> => [
  aggregateDependencyDeltaDiagnostic(out),
  ...languageDependencyDeltaDiagnostics(out),
]

const aggregateDependencyDeltaDiagnostic = (
  out: Shared06PrDepDeltaOutput,
): Diagnostic => ({
  severity: diagnosticSeverity(out.dependencyDeltaState, out.totalNewDependencyEdges),
  message: `Cross-language PR dependency delta: ${out.totalNewDependencyEdges} new dependency edges (+${out.linesAdded} / -${out.linesDeleted})`,
  data: {
    dependencyDeltaState: out.dependencyDeltaState,
    totalNewDependencyEdges: out.totalNewDependencyEdges,
    crossBoundaryEdges: out.crossBoundaryEdges,
    crossPackageEdges: out.crossPackageEdges,
    crossCrateEdges: out.crossCrateEdges,
    linesAdded: out.linesAdded,
    linesDeleted: out.linesDeleted,
  },
})

const languageDependencyDeltaDiagnostics = (
  out: Shared06PrDepDeltaOutput,
): ReadonlyArray<Diagnostic> => [
  ...(out.byLanguage.typescript !== undefined
    ? [typescriptDependencyDeltaDiagnostic(out.byLanguage.typescript)]
    : []),
  ...(out.byLanguage.rust !== undefined ? [rustDependencyDeltaDiagnostic(out.byLanguage.rust)] : []),
]

const typescriptDependencyDeltaDiagnostic = (
  facts: NonNullable<Shared06PrDepDeltaOutput["byLanguage"]["typescript"]>,
): Diagnostic => ({
  severity: diagnosticSeverity(
    languageDependencyDeltaState(facts.dependencyDeltaMode),
    facts.newDependencyEdges,
  ),
  message: `TypeScript PR dependency delta: ${facts.newDependencyEdges} new dependency edges (+${facts.linesAdded} / -${facts.linesDeleted})`,
  data: {
    language: "typescript",
    newDependencyEdges: facts.newDependencyEdges,
    crossBoundaryEdges: facts.crossBoundaryEdges,
    crossPackageEdges: facts.crossPackageEdges,
    linesAdded: facts.linesAdded,
    linesDeleted: facts.linesDeleted,
    diffMode: facts.diffMode,
    dependencyDeltaMode: facts.dependencyDeltaMode,
  },
})

const rustDependencyDeltaDiagnostic = (
  facts: NonNullable<Shared06PrDepDeltaOutput["byLanguage"]["rust"]>,
): Diagnostic => ({
  severity: diagnosticSeverity(
    languageDependencyDeltaState(facts.dependencyDeltaMode),
    facts.newDependencyEdges,
  ),
  message: `Rust PR dependency delta: ${facts.newDependencyEdges} new dependency edges (+${facts.linesAdded} / -${facts.linesDeleted})`,
  data: {
    language: "rust",
    newDependencyEdges: facts.newDependencyEdges,
    crossCrateEdges: facts.crossCrateEdges,
    linesAdded: facts.linesAdded,
    linesDeleted: facts.linesDeleted,
    diffMode: facts.diffMode,
    dependencyDeltaMode: facts.dependencyDeltaMode,
  },
})

const normalizeShared06PrDepDeltaConfig = (
  config: Shared06PrDepDeltaConfig,
): Shared06PrDepDeltaConfig => ({
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const tsDependencyFacts = (ts: TsPrDeltaLike): TsDependencyFacts => {
  const linesAdded = nonNegativeInteger(ts.linesAdded)
  const linesDeleted = nonNegativeInteger(ts.linesDeleted)
  const crossBoundaryEdges = countArray(ts.newCrossBoundaryEdges)
  const crossPackageEdges = countArray(ts.newCrossPackageEdges)
  const diffMode = ts.diffMode ?? "git-commit-range"
  const dependencyDeltaMode = ts.dependencyDeltaMode ?? "measured"
  const hasChangedSource = linesAdded + linesDeleted > 0 || countArray(ts.filesChanged) > 0

  return {
    linesAdded,
    linesDeleted,
    crossBoundaryEdges,
    crossPackageEdges,
    diffMode,
    dependencyDeltaMode,
    dependencyDeltaState:
      diffMode === "missing"
        ? "missing"
        : dependencyDeltaMode === "unavailable" && hasChangedSource
          ? "unavailable"
          : "measured",
  } as const
}

const rsDependencyFacts = (rs: RsPrDeltaLike): RsDependencyFacts => {
  const linesAdded = nonNegativeInteger(rs.linesAdded)
  const linesDeleted = nonNegativeInteger(rs.linesDeleted)
  const crossCrateEdges = countArray(rs.newCrossCrateEdges)
  const diffMode = rs.diffMode ?? "git-commit-range"
  const hasChangedSource = linesAdded + linesDeleted > 0 || countArray(rs.filesChanged) > 0
  const dependencyDeltaMode =
    diffMode === "missing"
      ? "missing"
      : diffMode === "changed-hunks-fallback" && hasChangedSource
        ? "unavailable"
        : "measured"

  return {
    linesAdded,
    linesDeleted,
    crossCrateEdges,
    diffMode,
    dependencyDeltaMode,
    dependencyDeltaState: languageDependencyDeltaState(dependencyDeltaMode),
  } as const
}

const aggregateDependencyDeltaState = (
  states: ReadonlyArray<DependencyDeltaState | undefined>,
): DependencyDeltaState => {
  const present = states.filter((state): state is DependencyDeltaState => state !== undefined)
  if (present.length === 0) return "not_applicable"
  if (present.includes("missing")) return "missing"
  if (present.includes("unavailable")) return "unavailable"
  return "measured"
}

const languageDependencyDeltaState = (
  mode: "measured" | "unavailable" | "missing",
): DependencyDeltaState =>
  mode === "missing" ? "missing" : mode === "unavailable" ? "unavailable" : "measured"

const diagnosticSeverity = (
  state: DependencyDeltaState,
  newDependencyEdges: number,
): Diagnostic["severity"] =>
  state === "missing" || state === "unavailable" || newDependencyEdges > 0 ? "warn" : "info"

const countArray = (value: ReadonlyArray<unknown> | undefined): number =>
  Array.isArray(value) ? value.length : 0

const nonNegativeInteger = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
