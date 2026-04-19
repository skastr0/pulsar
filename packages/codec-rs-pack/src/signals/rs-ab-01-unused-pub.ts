import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts, type RustUseFact } from "../rust-analysis.js"
import { RustProjectTag } from "../project.js"
import { DEFAULT_RUST_EXCLUDE_GLOBS } from "./shared-rust-ast.js"
import { resolveCrateRelativePath } from "./shared-rust-resolution.js"
import { isExcluded } from "./shared-globs.js"

export const RsAb01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type RsAb01Config = typeof RsAb01Config.Type

export interface UnusedPublicItem {
  readonly crate: string
  readonly module: string
  readonly name: string
  readonly kind: string
  readonly file: string
  readonly line: number
  readonly reexported: boolean
  readonly crossCrateUses: number
}

export interface RsAb01Output {
  readonly deadPublicItems: ReadonlyArray<UnusedPublicItem>
  readonly publicItemCount: number
  readonly analysisMode: "explicit-use-and-reexport-resolution"
}

export const RsAb01: Signal<RsAb01Config, RsAb01Output, RustProjectTag> = {
  id: "RS-AB-01",
  tier: 1,
  category: "abstraction-bloat",
  kind: "structural",
  configSchema: RsAb01Config,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsAb01Output> => {
          const facts = await collectRustProjectFacts(project)
          const workspaceCrates = new Set(
            project.manifests
              .map((manifest) => manifest.packageName)
              .filter((name): name is string => name !== undefined),
          )
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

          const publicItems = facts.items.filter(
            (item) => item.visibility.kind === "pub" && !isExcluded(item.file, config.exclude_globs),
          )
          const publicItemKeys = new Set(publicItems.map((item) => `${item.modulePath}::${item.name}`))
          const crossCrateUses = new Map<string, number>()
          const reexports = new Set<string>()

          for (const useFact of facts.uses) {
            if (isExcluded(useFact.file, config.exclude_globs)) continue
            const [root] = useFact.segments
            if (root === undefined) continue

            if (workspaceCrates.has(root) && root !== useFact.crateName) {
              const resolved = resolveCrateRelativePath(root, useFact.segments.slice(1), facts)
              const key = resolved?.item !== undefined ? `${resolved.item.modulePath}::${resolved.item.name}` : resolved?.key
              if (key !== undefined && publicItemKeys.has(key)) {
                crossCrateUses.set(key, (crossCrateUses.get(key) ?? 0) + 1)
              }
              continue
            }

            if (useFact.visibility.kind !== "pub") continue
            const relativeSegments = toLocalRelativeSegments(
              useFact,
              rootNamesByCrate.get(useFact.crateName) ?? new Set(),
            )
            if (relativeSegments === undefined) continue
            const resolved = resolveCrateRelativePath(useFact.crateName, relativeSegments, facts)
            const key = resolved?.item !== undefined ? `${resolved.item.modulePath}::${resolved.item.name}` : resolved?.key
            if (key !== undefined && publicItemKeys.has(key)) {
              reexports.add(key)
            }
          }

          return {
            deadPublicItems: publicItems
              .map((item) => {
                const key = `${item.modulePath}::${item.name}`
                return {
                  crate: item.crateName,
                  module: item.modulePath,
                  name: item.name,
                  kind: item.kind,
                  file: item.file,
                  line: item.line,
                  reexported: reexports.has(key),
                  crossCrateUses: crossCrateUses.get(key) ?? 0,
                } satisfies UnusedPublicItem
              })
              .filter((item) => item.crossCrateUses === 0 && !item.reexported)
              .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line),
            publicItemCount: publicItems.length,
            analysisMode: "explicit-use-and-reexport-resolution",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-AB-01", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.publicItemCount === 0) return 1
    return Math.max(0, 1 - out.deadPublicItems.length / out.publicItemCount)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.deadPublicItems.slice(0, 20).map((item) => ({
      severity: "warn" as const,
      message: `Public ${item.kind} ${item.name} is not referenced from other workspace crates`,
      location: { file: item.file, line: item.line },
      data: {
        crate: item.crate,
        module: item.module,
        name: item.name,
        kind: item.kind,
        analysisMode: out.analysisMode,
      },
    })),
}

const toLocalRelativeSegments = (
  useFact: RustUseFact,
  rootNames: ReadonlySet<string>,
): ReadonlyArray<string> | undefined => {
  const [head, ...rest] = useFact.segments
  if (head === undefined) return undefined
  const current = useFact.relativeModulePath.split("::")
  switch (head) {
    case useFact.crateName:
    case "crate":
      return rest
    case "self":
      return [...current.slice(1), ...rest]
    case "super":
      return [...current.slice(1, -1), ...rest]
    default:
      return rootNames.has(head) ? useFact.segments : undefined
  }
}
