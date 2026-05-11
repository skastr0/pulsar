import { SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal, SignalFactorLedger, SignalFactorLedgerEntry } from "@skastr0/pulsar-core/signal"
import type { CalibrationDecision, CalibrationProcessorError, ResolvedCalibrationContext, TypeScriptTypeCouplingPolicyValue } from "@skastr0/pulsar-core/calibration"
import { CalibrationContextTag } from "@skastr0/pulsar-core/calibration"
import {
  commonDirectoryPrefix,
  factorEntryForPolicyDecision,
  factorPathSegment,
  makeFactorLedger,
  relativeFactorPath,
} from "@skastr0/pulsar-core/factors"
import { Effect, Option, Schema } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import { computeFastImportTypeCoupling } from "./ts-de-01-fast-coupling.js"
import { computePreciseTypeCoupling } from "./ts-de-01-precise-coupling.js"
import type {
  CouplingCounterpart,
  ModuleTypeCoupling,
  TsDe01Output,
} from "./ts-de-01-coupling-output.js"

const TsDe01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  precise_module_limit: Schema.Number,
})
type TsDe01Config = typeof TsDe01Config.Type

export const TsDe01: Signal<TsDe01Config, TsDe01Output, TsProjectTag> = {
  id: "TS-DE-01-type-level-coupling",
  title: "Type-level coupling",
  aliases: ["TS-DE-01"],
  tier: 1,
  category: "dependency-entropy",
  kind: "legibility",
  cacheVersion: "factor-policy-v1",
  configSchema: TsDe01Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.d.ts",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/gen/**",
      "**/generated/**",
      "**/vendor/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    top_n_diagnostics: 10,
    precise_module_limit: 1_000,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const result = yield* Effect.try({
        try: (): TsDe01Output => {
          const sourceFiles = project
            .getSourceFiles()
            .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), config.exclude_globs))
          if (sourceFiles.length > config.precise_module_limit) {
            return computeFastImportTypeCoupling(sourceFiles, config.top_n_diagnostics)
          }
          return computePreciseTypeCoupling(sourceFiles, config.top_n_diagnostics)
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-DE-01-type-level-coupling",
            message: String(cause),
            cause,
          }),
      })
      return yield* applyTypeCouplingPolicy(result, calibration).pipe(
        Effect.mapError(toSignalComputeError),
      )
    }),
  score: (out) => {
    if (out.totalModules === 0) return 1

    const threshold = Math.max(1, out.outlierThreshold)
    const excess = out.modules.reduce((total, module) => {
      if (module.visible === false) return total
      return total + (module.penaltyWeight ?? defaultPenaltyWeight(module, threshold))
    }, 0)

    return Math.max(0, 1 - excess / out.totalModules)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const threshold = Math.max(1, out.outlierThreshold)
    return out.modules
      .filter((module) =>
        module.visible !== false &&
        module.externalTypesReferenced > threshold &&
        (module.penaltyWeight ?? defaultPenaltyWeight(module, threshold)) > 0,
      )
      .slice(0, out.diagnosticLimit)
      .map((module) => ({
        severity: module.severity ?? "warn" as const,
        message:
          `Type coupling in ${module.file}: ` +
          `out=${module.externalTypesReferenced}, in=${module.typesReferencedExternally}`,
        location: { file: module.file },
        data: {
          ...module,
          outlierThreshold: out.outlierThreshold,
          policyDecisions: module.policyDecisions ?? [],
        },
      }))
  },
  factorLedger: (out) => out.factorLedger,
}

const applyTypeCouplingPolicy = (
  output: TsDe01Output,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<TsDe01Output, CalibrationProcessorError, never> => {
  if (output.totalModules === 0) return Effect.succeed({
    ...output,
    calibrationDecisions: [],
    factorLedger: makeFactorLedger("TS-DE-01-type-level-coupling", []),
  })

  const threshold = Math.max(1, output.outlierThreshold)
  const factorPathRoot = commonDirectoryPrefix(output.modules.map((module) => module.file))
  return Effect.gen(function* () {
    const modules = yield* Effect.forEach(
      output.modules,
      (module) =>
        Effect.gen(function* () {
          const input = defaultTypeCouplingPolicy(
            module,
            threshold,
            output.outlierThreshold,
            factorPathRoot,
          )
          if (Option.isNone(calibration)) return withEffectivePolicy(module, input, [])
          const policy = yield* calibration.value.runSlot("typescript.type-coupling-policy", input)
          return withEffectivePolicy(module, policy.value, policy.decisions)
        }),
      { concurrency: 1 },
    )

    return {
      ...output,
      modules,
      calibrationDecisions: modules.flatMap((module) => module.policyDecisions ?? []),
      factorLedger: makeTsDe01FactorLedger(modules),
    }
  })
}

const defaultTypeCouplingPolicy = (
  module: ModuleTypeCoupling,
  threshold: number,
  rawThreshold: number,
  factorPathRoot: string,
): TypeScriptTypeCouplingPolicyValue => ({
  signalId: "TS-DE-01-type-level-coupling",
  findingId: module.file,
  file: module.file,
  externalTypesReferenced: module.externalTypesReferenced,
  typesReferencedExternally: module.typesReferencedExternally,
  totalCoupling: module.totalCoupling,
  outlierThreshold: rawThreshold,
  visible: true,
  severity: module.externalTypesReferenced > threshold ? "warn" : "info",
  penaltyWeight: defaultPenaltyWeight(module, threshold),
  factorPathPrefix: `type_coupling.${factorPathSegment(relativeFactorPath(module.file, factorPathRoot))}`,
})

const withEffectivePolicy = (
  module: ModuleTypeCoupling,
  policy: TypeScriptTypeCouplingPolicyValue,
  decisions: ReadonlyArray<CalibrationDecision>,
): ModuleTypeCoupling => ({
  ...module,
  visible: policy.visible,
  severity: policy.severity,
  penaltyWeight: policy.penaltyWeight,
  factorPathPrefix: policy.factorPathPrefix,
  policyDecisions: decisions,
})

const defaultPenaltyWeight = (
  module: ModuleTypeCoupling,
  threshold: number,
): number =>
  module.externalTypesReferenced <= threshold
    ? 0
    : (module.externalTypesReferenced - threshold) / threshold

const makeTsDe01FactorLedger = (
  modules: ReadonlyArray<ModuleTypeCoupling>,
): SignalFactorLedger =>
  makeFactorLedger(
    "TS-DE-01-type-level-coupling",
    modules.flatMap((module): ReadonlyArray<SignalFactorLedgerEntry> => {
      if ((module.penaltyWeight ?? 0) <= 0 && (module.policyDecisions ?? []).length === 0) {
        return []
      }
      const prefix = module.factorPathPrefix ?? `type_coupling.${factorPathSegment(module.file)}`
      const decisions = module.policyDecisions ?? []
      return [
        factorEntryForPolicyDecision({
          decisions,
          path: `${prefix}.visible`,
          title: "Type coupling visible",
          value: module.visible ?? true,
        }),
        factorEntryForPolicyDecision({
          decisions,
          path: `${prefix}.severity`,
          title: "Type coupling severity",
          value: module.severity ?? "warn",
        }),
        factorEntryForPolicyDecision({
          decisions,
          path: `${prefix}.penalty_weight`,
          title: "Type coupling penalty_weight",
          value: module.penaltyWeight ?? 0,
        }),
      ]
    }),
  )

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  cause instanceof SignalComputeError
    ? cause
    : new SignalComputeError({
        signalId: "TS-DE-01-type-level-coupling",
        message: String(cause),
        cause,
      })
