import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { RustProjectTag } from "../project.js"
import { isExcluded } from "./shared-globs.js"

export const RsLd04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type RsLd04Config = typeof RsLd04Config.Type

export interface BoundaryErrorSurface {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly errorType: string
  readonly classification: "granular" | "collapsed"
}

export interface RsLd04Output {
  readonly boundaryFunctions: ReadonlyArray<BoundaryErrorSurface>
  readonly granularCount: number
  readonly collapsedCount: number
  readonly totalBoundaryResults: number
}

export const RsLd04: Signal<RsLd04Config, RsLd04Output, RustProjectTag> = {
  id: "RS-LD-04-error-granularity",
  title: "Error granularity",
  aliases: ["RS-LD-04"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: RsLd04Config,
  defaultConfig: {
    exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd04Output> => {
          const facts = await collectRustProjectFacts(project)
          const boundaryFunctions = facts.functions
            .filter((fn) => !isExcluded(fn.file, config.exclude_globs))
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

          return {
            granularCount: boundaryFunctions.filter((fn) => fn.classification === "granular").length,
            collapsedCount: boundaryFunctions.filter((fn) => fn.classification === "collapsed").length,
            totalBoundaryResults: boundaryFunctions.length,
            boundaryFunctions,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-04-error-granularity", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.totalBoundaryResults === 0) return 1
    return out.granularCount / out.totalBoundaryResults
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.boundaryFunctions
      .filter((fn) => fn.classification === "collapsed")
      .slice(0, 10)
      .map((fn) => ({
        severity: "warn" as const,
        message: `Boundary function ${fn.name} returns collapsed error type ${fn.errorType}`,
        location: { file: fn.file, line: fn.line },
        data: { ...fn },
      })),
}

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
