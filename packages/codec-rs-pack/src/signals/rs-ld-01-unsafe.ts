import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { RustProjectTag } from "../project.js"
import { isExcluded } from "./shared-globs.js"

export const RsLd01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  safe_only_modules: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type RsLd01Config = typeof RsLd01Config.Type

export interface UnsafeModuleSummary {
  readonly module: string
  readonly file: string
  readonly totalFunctions: number
  readonly unsafeBlockCount: number
  readonly unsafeFunctionCount: number
  readonly propagatingFunctionCount: number
  readonly unsafeDensity: number
}

export interface RsLd01Output {
  readonly modules: ReadonlyArray<UnsafeModuleSummary>
  readonly totalUnsafeBlocks: number
  readonly totalUnsafeFunctions: number
  readonly safeOnlyViolations: ReadonlyArray<UnsafeModuleSummary>
  readonly propagationMode: "local-signature-only"
}

export const RsLd01: Signal<RsLd01Config, RsLd01Output, RustProjectTag> = {
  id: "RS-LD-01",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: RsLd01Config,
  defaultConfig: {
    exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
    safe_only_modules: [],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd01Output> => {
          const facts = await collectRustProjectFacts(project)
          const grouped = new Map<string, UnsafeModuleSummary>()

          for (const fn of facts.functions) {
            if (isExcluded(fn.file, config.exclude_globs)) continue
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
                config.safe_only_modules.includes(module.module) &&
                module.unsafeBlockCount + module.unsafeFunctionCount > 0,
            ),
            propagationMode: "local-signature-only",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-01", message: String(cause), cause }),
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
  diagnose: (out): ReadonlyArray<Diagnostic> => [
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
      .slice(0, 10)
      .map((module) => ({
        severity: "warn" as const,
        message: `Unsafe density in ${module.module}: ${(module.unsafeDensity * 100).toFixed(0)}% (${module.propagatingFunctionCount} propagating)` ,
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
  ],
}

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
