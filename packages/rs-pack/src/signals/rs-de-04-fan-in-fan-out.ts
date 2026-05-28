import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import { computeDiagnosticHash } from "@skastr0/pulsar-core/reference-data"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { RustProjectTag } from "../project.js"
import {
  computeRsDe04Output,
  type RsDe04Output,
  type RustModuleFan,
} from "./rs-de-04-analysis.js"
import { DEFAULT_RUST_EXCLUDE_GLOBS } from "./shared-rust-ast.js"
import { rustAnalysisOutputMetadata } from "./shared-applicability.js"

const RsDe04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  hub_fan_in_threshold: Schema.Number,
  hub_fan_out_threshold: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type RsDe04Config = typeof RsDe04Config.Type

const DEFAULT_HUB_FAN_IN_THRESHOLD = 6
const DEFAULT_HUB_FAN_OUT_THRESHOLD = 4
const DEFAULT_TOP_N_DIAGNOSTICS = 10

const RS_DE_04_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.hub_fan_in_threshold",
    title: "Config hub fan in threshold",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_HUB_FAN_IN_THRESHOLD,
  },
  {
    path: "config.hub_fan_out_threshold",
    title: "Config hub fan out threshold",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_HUB_FAN_OUT_THRESHOLD,
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsDe04: Signal<RsDe04Config, RsDe04Output, RustProjectTag> = {
  id: "RS-DE-04-fan-in-fan-out",
  title: "Fan-in/fan-out",
  aliases: ["RS-DE-04"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  cacheVersion: "rust-use-fan-in-out-config-v2",
  configSchema: RsDe04Config,
  factorDefinitions: RS_DE_04_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    hub_fan_in_threshold: DEFAULT_HUB_FAN_IN_THRESHOLD,
    hub_fan_out_threshold: DEFAULT_HUB_FAN_OUT_THRESHOLD,
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsDe04Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: () => computeRsDe04Output(project, normalizedConfig),
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-DE-04-fan-in-fan-out", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.moduleCount === 0 || out.resolvedUseCount === 0 || out.hubCount === 0) return 1
    const hubRatioPenalty = Math.min(0.6, (out.hubCount / out.moduleCount) * 2)
    const hubPressurePenalty = Math.min(0.4, out.totalHubPressure / Math.max(1, out.moduleCount * 10))
    return Math.max(0, 1 - hubRatioPenalty - hubPressurePenalty)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-DE-04 found no Rust source files for fan-in/fan-out analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          moduleCount: out.moduleCount,
          useCount: out.useCount,
          resolvedUseCount: out.resolvedUseCount,
          analysisMode: out.analysisMode,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return out.hubs.slice(0, out.diagnosticLimit).map((module) => ({
      severity: "warn" as const,
      message: `Module ${module.module} is a coupling hub (fanIn=${module.fanIn}, fanOut=${module.fanOut})`,
      location: { file: module.file },
      data: {
        hash: hashModuleFan(module, out),
        module: module.module,
        fanIn: module.fanIn,
        fanOut: module.fanOut,
        hubPressure: module.hubPressure,
        hubFanInThreshold: out.hubFanInThreshold,
        hubFanOutThreshold: out.hubFanOutThreshold,
        analysisMode: out.analysisMode,
      },
    }))
  },
  outputMetadata: (out) =>
    rustAnalysisOutputMetadata({
      sourceFileCount: out.sourceFileCount,
      analyzedItemCount: out.moduleCount,
      evidenceItemCount: out.resolvedUseCount,
    }),
  factorLedger: () => makeRsDe04FactorLedger(),
}

type NormalizedRsDe04Config = RsDe04Config

const normalizeRsDe04Config = (config: RsDe04Config): NormalizedRsDe04Config => ({
  exclude_globs: config.exclude_globs,
  hub_fan_in_threshold: Number.isFinite(config.hub_fan_in_threshold)
    ? Math.max(1, Math.floor(config.hub_fan_in_threshold))
    : DEFAULT_HUB_FAN_IN_THRESHOLD,
  hub_fan_out_threshold: Number.isFinite(config.hub_fan_out_threshold)
    ? Math.max(1, Math.floor(config.hub_fan_out_threshold))
    : DEFAULT_HUB_FAN_OUT_THRESHOLD,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsDe04FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-DE-04-fan-in-fan-out", RS_DE_04_FACTOR_DEFINITIONS)

const hashModuleFan = (module: RustModuleFan, out: RsDe04Output): string =>
  computeDiagnosticHash(
    [
      module.module,
      module.fanIn,
      module.fanOut,
      module.hubPressure,
      out.hubFanInThreshold,
      out.hubFanOutThreshold,
    ].join("|"),
  )
