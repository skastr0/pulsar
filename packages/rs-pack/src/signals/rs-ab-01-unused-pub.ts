import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts, type RustAnalysis, type RustItemFact } from "../rust-analysis.js"
import { RustProjectTag, type RustProject } from "../project.js"
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
  id: "RS-AB-01-unused-public-items",
  title: "Unused public items",
  aliases: ["RS-AB-01"],
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
        try: () => computeUnusedPublicItems(project, config),
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-AB-01-unused-public-items", message: String(cause), cause }),
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

const computeUnusedPublicItems = async (
  project: RustProject,
  config: RsAb01Config,
): Promise<RsAb01Output> => {
  const facts = await collectRustProjectFacts(project)
  const workspaceCrates = collectWorkspaceCrates(project)
  const libraryCrates = collectLibraryCrates(project, workspaceCrates)
  const rootNamesByCrate = collectRootNamesByCrate(facts)
  const exportedRootModules = collectExportedRootModules(facts)
  const publicItems = collectPublicItems(facts, config)
  const publicItemKeys = new Set(publicItems.map(publicItemKey))
  const usage = collectPublicUsage({
    facts,
    publicItemKeys,
    rootNamesByCrate,
    workspaceCrates,
    excludeGlobs: config.exclude_globs,
  })
  const publicSummaries = summarizePublicItems({
    publicItems,
    usage,
    libraryCrates,
    exportedRootModules,
  })

  return {
    deadPublicItems: sortByLocation(
      publicSummaries.filter(
        (item) =>
          item.surface === "internal-overpublic" &&
          item.crossCrateUses === 0 &&
          !item.reexported,
      ),
    ),
    exportedApiItems: sortByLocation(
      publicSummaries.filter((item) => item.surface === "exported-api"),
    ),
    nonLibraryPublicItems: sortByLocation(
      publicSummaries.filter((item) => item.surface === "non-library"),
    ),
    publicItemCount: publicItems.length,
    analysisMode: "explicit-use-and-reexport-resolution",
  }
}

const collectWorkspaceCrates = (project: RustProject): ReadonlySet<string> =>
  new Set(
    project.manifests
      .map((manifest) => manifest.packageName)
      .filter((name): name is string => name !== undefined),
  )

const collectLibraryCrates = (
  project: RustProject,
  workspaceCrates: ReadonlySet<string>,
): ReadonlySet<string> =>
  new Set(
    project.cargoMetadata?.packages
      .filter((pkg) => workspaceCrates.has(pkg.name))
      .filter((pkg) => pkg.targets.some((target) => target.kind.includes("lib")))
      .map((pkg) => pkg.name) ?? [],
  )

const collectRootNamesByCrate = (facts: RustAnalysis): ReadonlyMap<string, ReadonlySet<string>> => {
  const rootNamesByCrate = new Map<string, Set<string>>()
  for (const module of facts.modules) {
    const segments = module.relativeModulePath.split("::")
    addRootName(rootNamesByCrate, module.crateName, segments[0], segments[1])
  }
  for (const item of facts.items) {
    if (item.relativeModulePath === "crate") {
      addRootName(rootNamesByCrate, item.crateName, "crate", item.name)
    }
  }
  return rootNamesByCrate
}

const addRootName = (
  roots: Map<string, Set<string>>,
  crateName: string,
  prefix: string | undefined,
  root: string | undefined,
): void => {
  if (prefix !== "crate" || root === undefined) return
  const bucket = roots.get(crateName) ?? new Set<string>()
  bucket.add(root)
  roots.set(crateName, bucket)
}

const collectExportedRootModules = (facts: RustAnalysis): ReadonlyMap<string, ReadonlySet<string>> => {
  const exportedRootModules = new Map<string, Set<string>>()
  for (const item of facts.items) {
    if (item.kind !== "mod" || item.relativeModulePath !== "crate" || item.visibility.kind !== "pub") {
      continue
    }
    const bucket = exportedRootModules.get(item.crateName) ?? new Set<string>()
    bucket.add(item.name)
    exportedRootModules.set(item.crateName, bucket)
  }
  return exportedRootModules
}

const collectPublicItems = (
  facts: RustAnalysis,
  config: RsAb01Config,
): ReadonlyArray<RustItemFact> =>
  facts.items.filter(
    (item) => item.visibility.kind === "pub" && !isExcluded(item.file, config.exclude_globs),
  )

interface PublicUsage {
  readonly crossCrateUses: ReadonlyMap<string, number>
  readonly reexports: ReadonlySet<string>
}

const collectPublicUsage = (input: {
  readonly facts: RustAnalysis
  readonly publicItemKeys: ReadonlySet<string>
  readonly rootNamesByCrate: ReadonlyMap<string, ReadonlySet<string>>
  readonly workspaceCrates: ReadonlySet<string>
  readonly excludeGlobs: ReadonlyArray<string>
}): PublicUsage => {
  const crossCrateUses = new Map<string, number>()
  const reexports = new Set<string>()

  for (const useFact of input.facts.uses) {
    if (isExcluded(useFact.file, input.excludeGlobs)) continue
    const [root] = useFact.segments
    if (root === undefined) continue
    if (input.workspaceCrates.has(root) && root !== useFact.crateName) {
      recordCrossCrateUse(input.facts, input.publicItemKeys, crossCrateUses, root, useFact.segments)
      continue
    }
    if (useFact.visibility.kind !== "pub") continue
    const relativeSegments = toLocalRelativeSegments(
      useFact,
      input.rootNamesByCrate.get(useFact.crateName) ?? new Set(),
    )
    if (relativeSegments === undefined) continue
    const key = resolvedPublicItemKey(input.facts, useFact.crateName, relativeSegments)
    if (key !== undefined && input.publicItemKeys.has(key)) reexports.add(key)
  }

  return { crossCrateUses, reexports }
}

const recordCrossCrateUse = (
  facts: RustAnalysis,
  publicItemKeys: ReadonlySet<string>,
  crossCrateUses: Map<string, number>,
  crateName: string,
  segments: ReadonlyArray<string>,
): void => {
  const key = resolvedPublicItemKey(facts, crateName, segments.slice(1))
  if (key === undefined || !publicItemKeys.has(key)) return
  crossCrateUses.set(key, (crossCrateUses.get(key) ?? 0) + 1)
}

const resolvedPublicItemKey = (
  facts: RustAnalysis,
  crateName: string,
  segments: ReadonlyArray<string>,
): string | undefined => {
  const resolved = resolveCrateRelativePath(crateName, segments, facts)
  return resolved?.item !== undefined
    ? publicItemKey(resolved.item)
    : resolved?.key
}

const summarizePublicItems = (input: {
  readonly publicItems: ReadonlyArray<RustItemFact>
  readonly usage: PublicUsage
  readonly libraryCrates: ReadonlySet<string>
  readonly exportedRootModules: ReadonlyMap<string, ReadonlySet<string>>
}): ReadonlyArray<UnusedPublicItem> =>
  input.publicItems.map((item) => {
    const key = publicItemKey(item)
    return {
      crate: item.crateName,
      module: item.modulePath,
      name: item.name,
      kind: item.kind,
      file: item.file,
      line: item.line,
      reexported: input.usage.reexports.has(key),
      crossCrateUses: input.usage.crossCrateUses.get(key) ?? 0,
      surface: classifyPublicSurface(
        item,
        input.libraryCrates,
        input.exportedRootModules.get(item.crateName) ?? new Set<string>(),
      ),
    }
  })

const publicItemKey = (item: { readonly modulePath: string; readonly name: string }): string =>
  `${item.modulePath}::${item.name}`

const sortByLocation = (
  items: ReadonlyArray<UnusedPublicItem>,
): ReadonlyArray<UnusedPublicItem> =>
  items.slice().sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)

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
