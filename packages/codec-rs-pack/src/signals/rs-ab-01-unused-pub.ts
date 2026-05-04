import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { RustProjectTag } from "../project.js"
import { DEFAULT_RUST_EXCLUDE_GLOBS } from "./shared-rust-ast.js"
import {
  resolveCrateRelativePath,
  toLocalRelativeSegments,
} from "./shared-rust-resolution.js"
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
  readonly surface: "exported-api" | "internal-overpublic" | "non-library"
}

export interface RsAb01Output {
  readonly deadPublicItems: ReadonlyArray<UnusedPublicItem>
  readonly exportedApiItems: ReadonlyArray<UnusedPublicItem>
  readonly nonLibraryPublicItems: ReadonlyArray<UnusedPublicItem>
  readonly publicItemCount: number
  readonly analysisMode: "explicit-use-and-reexport-resolution"
}

export const RsAb01: Signal<RsAb01Config, RsAb01Output, RustProjectTag> = {
  id: "RS-AB-01",
  tier: 1,
  category: "abstraction-bloat",
  kind: "structural",
  cacheVersion: "rs-ab-01-public-surface-v2",
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
          const libraryCrates = new Set(
            project.cargoMetadata?.packages
              .filter((pkg) => workspaceCrates.has(pkg.name))
              .filter((pkg) => pkg.targets.some((target) => target.kind.includes("lib")))
              .map((pkg) => pkg.name) ?? [],
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
          const exportedRootModules = new Map<string, Set<string>>()
          for (const item of facts.items) {
            if (
              item.kind !== "mod" ||
              item.relativeModulePath !== "crate" ||
              item.visibility.kind !== "pub"
            ) {
              continue
            }
            const bucket = exportedRootModules.get(item.crateName) ?? new Set<string>()
            bucket.add(item.name)
            exportedRootModules.set(item.crateName, bucket)
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

          const publicSummaries = publicItems.map((item) => {
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
              surface: classifyPublicSurface(
                item,
                libraryCrates,
                exportedRootModules.get(item.crateName) ?? new Set<string>(),
              ),
            } satisfies UnusedPublicItem
          })

          return {
            deadPublicItems: publicSummaries
              .filter((item) =>
                item.surface === "internal-overpublic" &&
                item.crossCrateUses === 0 &&
                !item.reexported,
              )
              .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line),
            exportedApiItems: publicSummaries
              .filter((item) => item.surface === "exported-api")
              .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line),
            nonLibraryPublicItems: publicSummaries
              .filter((item) => item.surface === "non-library")
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
        surface: item.surface,
        analysisMode: out.analysisMode,
      },
    })),
}

const classifyPublicSurface = (
  item: { readonly crateName: string; readonly relativeModulePath: string },
  libraryCrates: ReadonlySet<string>,
  exportedRootModules: ReadonlySet<string>,
): UnusedPublicItem["surface"] => {
  if (!libraryCrates.has(item.crateName)) return "non-library"
  const segments = item.relativeModulePath.split("::")
  if (segments[0] !== "crate") return "non-library"
  const root = segments[1]
  if (root === undefined) return "exported-api"
  return exportedRootModules.has(root) ? "exported-api" : "internal-overpublic"
}
