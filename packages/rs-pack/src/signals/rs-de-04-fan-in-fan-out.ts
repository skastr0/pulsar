import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
import { computeDiagnosticHash } from "@skastr0/pulsar-core/reference-data"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts, type RustUseFact } from "../rust-analysis.js"
import { RustProjectTag } from "../project.js"
import {
  resolveCrateRelativePath,
  toLocalRelativeSegments,
} from "./shared-rust-resolution.js"
import { DEFAULT_RUST_EXCLUDE_GLOBS } from "./shared-rust-ast.js"
import { isExcluded } from "./shared-globs.js"

const RsDe04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  hub_fan_in_threshold: Schema.Number,
  hub_fan_out_threshold: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type RsDe04Config = typeof RsDe04Config.Type

interface RustModuleFan {
  readonly module: string
  readonly file: string
  readonly fanIn: number
  readonly fanOut: number
  readonly hubPressure: number
}

interface RsDe04Output {
  readonly modules: ReadonlyArray<RustModuleFan>
  readonly byModule: ReadonlyMap<string, { readonly fanIn: number; readonly fanOut: number }>
  readonly hubs: ReadonlyArray<RustModuleFan>
  readonly moduleCount: number
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly useCount: number
  readonly resolvedUseCount: number
  readonly hubCount: number
  readonly totalHubPressure: number
  readonly hubFanInThreshold: number
  readonly hubFanOutThreshold: number
  readonly diagnosticLimit: number
  readonly analysisMode: "explicit-use-resolution"
}

const DEFAULT_HUB_FAN_IN_THRESHOLD = 6
const DEFAULT_HUB_FAN_OUT_THRESHOLD = 4
const DEFAULT_TOP_N_DIAGNOSTICS = 10

const RsDe04FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
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
  factorDefinitions: RsDe04FactorDefinitions,
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
        try: async (): Promise<RsDe04Output> => {
          const facts = await collectRustProjectFacts(project)
          const rootNamesByCrate = new Map<string, Set<string>>()
          for (const module of facts.modules) {
            const bucket = rootNamesByCrate.get(module.crateName) ?? new Set<string>()
            const segments = module.relativeModulePath.split("::")
            const root = segments[1]
            if (segments[0] === "crate" && root !== undefined) bucket.add(root)
            rootNamesByCrate.set(module.crateName, bucket)
          }
          for (const item of facts.items) {
            if (item.relativeModulePath !== "crate") continue
            const bucket = rootNamesByCrate.get(item.crateName) ?? new Set<string>()
            bucket.add(item.name)
            rootNamesByCrate.set(item.crateName, bucket)
          }

          const incoming = new Map<string, Set<string>>()
          const outgoing = new Map<string, Set<string>>()
          const analyzedFiles = new Set(
            project.sourceFiles.filter((file) => !isExcluded(file, normalizedConfig.exclude_globs)),
          )
          const modules = facts.modules.filter((module) =>
            !isExcluded(module.file, normalizedConfig.exclude_globs)
          )
          const analyzedModulePaths = new Set(modules.map((module) => module.modulePath))
          for (const module of modules) {
            incoming.set(module.modulePath, new Set())
            outgoing.set(module.modulePath, new Set())
          }

          let useCount = 0
          const resolvedEdges = new Set<string>()
          for (const useFact of facts.uses) {
            if (isExcluded(useFact.file, normalizedConfig.exclude_globs)) continue
            useCount += 1
            const target = resolveLocalUseTarget(useFact, facts, rootNamesByCrate)
            if (target === undefined || target === useFact.modulePath) continue
            if (!analyzedModulePaths.has(useFact.modulePath) || !analyzedModulePaths.has(target)) {
              continue
            }
            outgoing.get(useFact.modulePath)?.add(target)
            incoming.get(target)?.add(useFact.modulePath)
            resolvedEdges.add(`${useFact.modulePath}->${target}`)
          }

          const summaries = modules
            .map((module) => {
              const fanIn = incoming.get(module.modulePath)?.size ?? 0
              const fanOut = outgoing.get(module.modulePath)?.size ?? 0
              return {
                module: module.modulePath,
                file: module.file,
                fanIn,
                fanOut,
                hubPressure: hubPressure(fanIn, fanOut, normalizedConfig),
              }
            })
            .sort(compareModuleFan)
          const hubs = summaries.filter(
            (module) =>
              module.fanIn >= normalizedConfig.hub_fan_in_threshold &&
              module.fanOut >= normalizedConfig.hub_fan_out_threshold,
          )
          const totalHubPressure = hubs.reduce((sum, module) => sum + module.hubPressure, 0)

          return {
            modules: summaries,
            byModule: new Map(
              summaries.map((module) => [module.module, { fanIn: module.fanIn, fanOut: module.fanOut }]),
            ),
            hubs,
            moduleCount: summaries.length,
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedFiles.size,
            useCount,
            resolvedUseCount: resolvedEdges.size,
            hubCount: hubs.length,
            totalHubPressure,
            hubFanInThreshold: normalizedConfig.hub_fan_in_threshold,
            hubFanOutThreshold: normalizedConfig.hub_fan_out_threshold,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            analysisMode: "explicit-use-resolution",
          }
        },
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
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.moduleCount === 0 || out.resolvedUseCount === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
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
  makeFactorLedger(
    "RS-DE-04-fan-in-fan-out",
    RsDe04FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const hubPressure = (
  fanIn: number,
  fanOut: number,
  config: NormalizedRsDe04Config,
): number => {
  if (
    fanIn < config.hub_fan_in_threshold ||
    fanOut < config.hub_fan_out_threshold
  ) {
    return 0
  }
  return (
    Math.max(0, fanIn - config.hub_fan_in_threshold + 1) +
    Math.max(0, fanOut - config.hub_fan_out_threshold + 1)
  )
}

const compareModuleFan = (left: RustModuleFan, right: RustModuleFan): number =>
  right.hubPressure - left.hubPressure ||
  right.fanIn + right.fanOut - (left.fanIn + left.fanOut) ||
  right.fanIn - left.fanIn ||
  right.fanOut - left.fanOut ||
  left.module.localeCompare(right.module)

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

const resolveLocalUseTarget = (
  useFact: RustUseFact,
  facts: Awaited<ReturnType<typeof collectRustProjectFacts>>,
  rootNamesByCrate: ReadonlyMap<string, ReadonlySet<string>>,
): string | undefined => {
  const relativeSegments = toLocalRelativeSegments(
    useFact,
    rootNamesByCrate.get(useFact.crateName) ?? new Set(),
  )
  if (relativeSegments === undefined) return undefined
  const resolved = resolveCrateRelativePath(useFact.crateName, relativeSegments, facts)
  return resolved?.item?.modulePath ?? resolved?.module?.modulePath
}
