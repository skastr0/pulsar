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

const RsLd01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  safe_only_modules: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type RsLd01Config = typeof RsLd01Config.Type

interface UnsafeModuleSummary {
  readonly module: string
  readonly file: string
  readonly totalFunctions: number
  readonly unsafeBlockCount: number
  readonly unsafeFunctionCount: number
  readonly propagatingFunctionCount: number
  readonly unsafeDensity: number
}

interface RsLd01Output {
  readonly modules: ReadonlyArray<UnsafeModuleSummary>
  readonly totalUnsafeBlocks: number
  readonly totalUnsafeFunctions: number
  readonly safeOnlyViolations: ReadonlyArray<UnsafeModuleSummary>
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly functionCount: number
  readonly diagnosticLimit: number
  readonly propagationMode: "local-signature-only"
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10

const RsLd01FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.safe_only_modules",
    title: "Config safe only modules",
    valueKind: "array",
    scoreRole: "threshold",
    defaultValue: [],
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsLd01: Signal<RsLd01Config, RsLd01Output, RustProjectTag> = {
  id: "RS-LD-01-unsafe-code",
  title: "Unsafe code",
  aliases: ["RS-LD-01"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "unsafe-code-config-applicability-diagnostics-v1",
  configSchema: RsLd01Config,
  factorDefinitions: RsLd01FactorDefinitions,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    safe_only_modules: [],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsLd01Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd01Output> => {
          const facts = await collectRustProjectFacts(project)
          const grouped = new Map<string, UnsafeModuleSummary>()
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )
          let functionCount = 0

          for (const fn of facts.functions) {
            if (isExcluded(fn.file, normalizedConfig.exclude_globs)) continue
            functionCount += 1
            const current = grouped.get(fn.modulePath)
            const next =
              current === undefined
                ? {
                    module: fn.modulePath,
                    file: fn.file,
                    totalFunctions: 0,
                    unsafeBlockCount: 0,
                    unsafeFunctionCount: 0,
                    propagatingFunctionCount: 0,
                    unsafeDensity: 0,
                  }
                : { ...current }

            next.totalFunctions += 1
            next.unsafeBlockCount += fn.unsafeBlockCount
            if (fn.isUnsafeFn) next.unsafeFunctionCount += 1
            if (isPropagatingUnsafe(fn)) next.propagatingFunctionCount += 1
            grouped.set(fn.modulePath, next)
          }

          const modules = [...grouped.values()]
            .map((module) => ({
              ...module,
              unsafeDensity:
                module.totalFunctions === 0
                  ? 0
                  : (module.unsafeBlockCount + module.unsafeFunctionCount) / module.totalFunctions,
            }))
            .sort(
              (a, b) =>
                b.unsafeDensity - a.unsafeDensity || b.propagatingFunctionCount - a.propagatingFunctionCount,
            )

          return {
            modules,
            totalUnsafeBlocks: modules.reduce((sum, module) => sum + module.unsafeBlockCount, 0),
            totalUnsafeFunctions: modules.reduce((sum, module) => sum + module.unsafeFunctionCount, 0),
            safeOnlyViolations: modules.filter(
              (module) =>
                normalizedConfig.safe_only_modules.includes(module.module) &&
                module.unsafeBlockCount + module.unsafeFunctionCount > 0,
            ),
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            functionCount,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            propagationMode: "local-signature-only",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-01-unsafe-code", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.safeOnlyViolations.length > 0) return 0
    const totalFunctions = out.modules.reduce((sum, module) => sum + module.totalFunctions, 0)
    if (totalFunctions === 0) return 1
    const ratio =
      (out.totalUnsafeBlocks + out.totalUnsafeFunctions) / Math.max(1, totalFunctions)
    return Math.max(0, 1 - ratio * 2)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-LD-01 found no Rust source files for unsafe code analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          functionCount: out.functionCount,
          propagationMode: out.propagationMode,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return [
      ...out.safeOnlyViolations.map((module) => ({
        severity: "block" as const,
        message: `Unsafe usage in safe-only module ${module.module}`,
        location: { file: module.file },
        data: {
          module: module.module,
          unsafeBlockCount: module.unsafeBlockCount,
          unsafeFunctionCount: module.unsafeFunctionCount,
        },
      })),
      ...out.modules
        .filter((module) => module.unsafeBlockCount + module.unsafeFunctionCount > 0)
        .map((module) => ({
          severity: "warn" as const,
          message: `Unsafe density in ${module.module}: ${(module.unsafeDensity * 100).toFixed(0)}% (${module.propagatingFunctionCount} propagating)`,
          location: { file: module.file },
          data: {
            module: module.module,
            unsafeDensity: module.unsafeDensity,
            unsafeBlockCount: module.unsafeBlockCount,
            unsafeFunctionCount: module.unsafeFunctionCount,
            propagatingFunctionCount: module.propagatingFunctionCount,
            propagationMode: out.propagationMode,
          },
        })),
    ].slice(0, out.diagnosticLimit)
  },
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedSourceFileCount === 0 || out.functionCount === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsLd01FactorLedger(),
}

type NormalizedRsLd01Config = RsLd01Config

const normalizeRsLd01Config = (config: RsLd01Config): NormalizedRsLd01Config => ({
  exclude_globs: config.exclude_globs,
  safe_only_modules: config.safe_only_modules,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsLd01FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-LD-01-unsafe-code",
    RsLd01FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const isPropagatingUnsafe = (
  fn: {
    readonly isUnsafeFn: boolean
    readonly unsafeBlockCount: number
    readonly rawPointerParamCount: number
    readonly rawPointerReturn: boolean
    readonly returnTypeText: string | undefined
  },
): boolean =>
  (fn.isUnsafeFn || fn.unsafeBlockCount > 0) &&
  (fn.rawPointerParamCount > 0 ||
    fn.rawPointerReturn ||
    (fn.returnTypeText?.includes("&") ?? false))
