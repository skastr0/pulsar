import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { RustProjectTag } from "../project.js"
import { DEFAULT_RUST_EXCLUDE_GLOBS } from "./shared-rust-ast.js"
import { isExcluded } from "./shared-globs.js"

const RsLd04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type RsLd04Config = typeof RsLd04Config.Type

interface BoundaryErrorSurface {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly errorType: string
  readonly classification: "granular" | "collapsed"
}

interface RsLd04Output {
  readonly boundaryFunctions: ReadonlyArray<BoundaryErrorSurface>
  readonly granularCount: number
  readonly collapsedCount: number
  readonly totalBoundaryResults: number
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly diagnosticLimit: number
  readonly scoreMode: "granular-result-boundary-share"
  readonly scoreDenominator: "public-result-boundary-functions"
  readonly granularBoundaryShare: number
  readonly collapsedBoundaryShare: number
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const RS_LD_04_SCORE_MODE = "granular-result-boundary-share" as const
const RS_LD_04_SCORE_DENOMINATOR = "public-result-boundary-functions" as const

const RsLd04FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsLd04: Signal<RsLd04Config, RsLd04Output, RustProjectTag> = {
  id: "RS-LD-04-error-granularity",
  title: "Error granularity",
  aliases: ["RS-LD-04"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "error-granularity-config-applicability-diagnostics-v1",
  configSchema: RsLd04Config,
  factorDefinitions: RsLd04FactorDefinitions,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsLd04Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd04Output> => {
          const facts = await collectRustProjectFacts(project)
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )
          const analyzedSourceFileSet = new Set(analyzedSourceFiles)
          const boundaryFunctions = facts.functions
            .filter((fn) => analyzedSourceFileSet.has(fn.file))
            .filter((fn) => fn.visibility.kind !== "private")
            .filter((fn) => fn.resultErrorType !== undefined)
            .map((fn) => ({
              file: fn.file,
              module: fn.modulePath,
              name: fn.name,
              line: fn.line,
              errorType: fn.resultErrorType!,
              classification: classifyErrorType(fn.resultErrorType!) as "granular" | "collapsed",
            }))
            .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
          const granularCount = boundaryFunctions.filter((fn) => fn.classification === "granular").length
          const collapsedCount = boundaryFunctions.filter((fn) => fn.classification === "collapsed").length

          return {
            granularCount,
            collapsedCount,
            totalBoundaryResults: boundaryFunctions.length,
            boundaryFunctions,
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            scoreMode: RS_LD_04_SCORE_MODE,
            scoreDenominator: RS_LD_04_SCORE_DENOMINATOR,
            granularBoundaryShare: ratio(granularCount, boundaryFunctions.length),
            collapsedBoundaryShare: ratio(collapsedCount, boundaryFunctions.length),
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-04-error-granularity", message: String(cause), cause }),
      })
    }),
  score: (out) => out.totalBoundaryResults === 0 ? 1 : out.granularBoundaryShare,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-LD-04 found no Rust source files for error granularity analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          totalBoundaryResults: out.totalBoundaryResults,
          granularCount: out.granularCount,
          collapsedCount: out.collapsedCount,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return out.boundaryFunctions
      .filter((fn) => fn.classification === "collapsed")
      .slice(0, out.diagnosticLimit)
      .map((fn) => ({
        severity: "warn" as const,
        message: `Boundary function ${fn.name} returns collapsed error type ${fn.errorType}`,
        location: { file: fn.file, line: fn.line },
        data: {
          ...fn,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }))
  },
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedSourceFileCount === 0 || out.totalBoundaryResults === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsLd04FactorLedger(),
}

type NormalizedRsLd04Config = RsLd04Config

const normalizeRsLd04Config = (config: RsLd04Config): NormalizedRsLd04Config => ({
  exclude_globs: config.exclude_globs,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsLd04FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-LD-04-error-granularity",
    RsLd04FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

const classifyErrorType = (errorType: string): "granular" | "collapsed" => {
  const normalized = errorType.replace(/\s+/g, "")
  if (
    normalized === "anyhow::Error" ||
    normalized === "String" ||
    normalized === "&'staticstr" ||
    /Box<dyn.*Error.*>/.test(normalized) ||
    /dyn.*Error/.test(normalized)
  ) {
    return "collapsed"
  }
  return "granular"
}
