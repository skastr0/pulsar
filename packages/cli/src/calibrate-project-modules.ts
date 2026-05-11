import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { Effect } from "effect"

export interface SuggestedProjectModule {
  readonly id: string
  readonly kind: "package"
  readonly packageName: string
  readonly evidence: ReadonlyArray<string>
}

const PACKAGE_JSON_SCAN_SKIP_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".svelte-kit",
  ".pulsar",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "gen",
  "generated",
  "node_modules",
  "out",
  "target",
  "vendor",
])

const PROJECT_MODULE_SUGGESTION_CATALOG = [
  {
    dependencyName: "convex",
    packageName: "@skastr0/pulsar-project-module-convex",
  },
  {
    dependencyName: "effect",
    packageName: "@skastr0/pulsar-project-module-effect",
  },
] as const

interface PackageJsonInfo {
  readonly relativePath: string
  readonly dependencies: ReadonlySet<string>
}

export const suggestProjectModules = (
  repoRoot: string,
): Effect.Effect<ReadonlyArray<SuggestedProjectModule>, Error, never> =>
  Effect.gen(function* () {
    const packageJsons = yield* collectPackageJsons(repoRoot)
    return PROJECT_MODULE_SUGGESTION_CATALOG.flatMap((module) => {
      const evidence = dependencyEvidence(packageJsons, module.dependencyName)
      if (evidence.length === 0) return []
      return [
        {
          id: module.packageName,
          kind: "package",
          packageName: module.packageName,
          evidence,
        } satisfies SuggestedProjectModule,
      ]
    }).sort((left, right) => left.id.localeCompare(right.id))
  })

const collectPackageJsons = (
  repoRoot: string,
): Effect.Effect<ReadonlyArray<PackageJsonInfo>, Error, never> =>
  Effect.gen(function* () {
    const paths = yield* findPackageJsonPaths(repoRoot)
    const infos = yield* Effect.forEach(
      paths,
      (path) => readPackageJsonInfo(repoRoot, path),
      { concurrency: 8 },
    )
    return infos.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  })

const findPackageJsonPaths = (
  root: string,
): Effect.Effect<ReadonlyArray<string>, Error, never> =>
  Effect.gen(function* () {
    const out: Array<string> = []
    const visit = (dir: string): Effect.Effect<void, Error, never> =>
      Effect.gen(function* () {
        const entries = yield* Effect.tryPromise({
          try: () => readdir(dir, { withFileTypes: true }),
          catch: (cause) => new Error(`Failed to read ${dir}: ${String(cause)}`),
        })
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
          if (shouldSkipDirectory(entry.name)) continue
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            yield* visit(fullPath)
          } else if (entry.isFile() && entry.name === "package.json") {
            out.push(fullPath)
          }
        }
      })

    yield* visit(root)
    return out.sort((left, right) => left.localeCompare(right))
  })

const shouldSkipDirectory = (name: string): boolean =>
  PACKAGE_JSON_SCAN_SKIP_DIRECTORIES.has(name)

const readPackageJsonInfo = (repoRoot: string, path: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (cause) => new Error(`Failed to read ${path}: ${String(cause)}`),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as Record<string, unknown>,
      catch: (cause) => new Error(`Failed to parse ${path}: ${String(cause)}`),
    })
    return {
      relativePath: relative(repoRoot, path),
      dependencies: collectDependencyNames(parsed),
    } satisfies PackageJsonInfo
  })

const collectDependencyNames = (packageJson: Record<string, unknown>): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const blockName of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const block = packageJson[blockName]
    if (typeof block !== "object" || block === null || Array.isArray(block)) continue
    for (const name of Object.keys(block).sort()) names.add(name)
  }
  return names
}

const dependencyEvidence = (
  packageJsons: ReadonlyArray<PackageJsonInfo>,
  dependencyName: string,
): ReadonlyArray<string> =>
  packageJsons
    .filter((info) => info.dependencies.has(dependencyName))
    .map((info) => `${info.relativePath} dependency ${dependencyName}`)
