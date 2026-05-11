import {
  type Diagnostic,
  type Signal,
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

export interface RustModuleFan {
  readonly module: string
  readonly file: string
  readonly fanIn: number
  readonly fanOut: number
}

export interface RsDe04Output {
  readonly modules: ReadonlyArray<RustModuleFan>
  readonly byModule: ReadonlyMap<string, { readonly fanIn: number; readonly fanOut: number }>
  readonly hubs: ReadonlyArray<RustModuleFan>
  readonly analysisMode: "explicit-use-resolution"
}

export const RsDe04: Signal<RsDe04Config, RsDe04Output, RustProjectTag> = {
  id: "RS-DE-04-fan-in-fan-out",
  title: "Fan-in/fan-out",
  aliases: ["RS-DE-04"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  configSchema: RsDe04Config,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    hub_fan_in_threshold: 6,
    hub_fan_out_threshold: 4,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
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
          const modules = facts.modules.filter((module) => !isExcluded(module.file, config.exclude_globs))
          for (const module of modules) {
            incoming.set(module.modulePath, new Set())
            outgoing.set(module.modulePath, new Set())
          }

          for (const useFact of facts.uses) {
            if (isExcluded(useFact.file, config.exclude_globs)) continue
            const target = resolveLocalUseTarget(useFact, facts, rootNamesByCrate)
            if (target === undefined || target === useFact.modulePath) continue
            outgoing.get(useFact.modulePath)?.add(target)
            incoming.get(target)?.add(useFact.modulePath)
          }

          const summaries = modules
            .map((module) => ({
              module: module.modulePath,
              file: module.file,
              fanIn: incoming.get(module.modulePath)?.size ?? 0,
              fanOut: outgoing.get(module.modulePath)?.size ?? 0,
            }))
            .sort((left, right) => right.fanIn + right.fanOut - (left.fanIn + left.fanOut) || left.module.localeCompare(right.module))

          return {
            modules: summaries,
            byModule: new Map(
              summaries.map((module) => [module.module, { fanIn: module.fanIn, fanOut: module.fanOut }]),
            ),
            hubs: summaries.filter(
              (module) =>
                module.fanIn >= config.hub_fan_in_threshold &&
                module.fanOut >= config.hub_fan_out_threshold,
            ),
            analysisMode: "explicit-use-resolution",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-DE-04-fan-in-fan-out", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.modules.length === 0) return 1
    return Math.max(0, 1 - (out.hubs.length / out.modules.length) * 3)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.hubs.slice(0, 10).map((module) => ({
      severity: "warn" as const,
      message: `Module ${module.module} is a coupling hub (fanIn=${module.fanIn}, fanOut=${module.fanOut})`,
      location: { file: module.file },
      data: {
        module: module.module,
        fanIn: module.fanIn,
        fanOut: module.fanOut,
        analysisMode: out.analysisMode,
      },
    })),
}

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
