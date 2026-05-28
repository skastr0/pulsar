import { readdir, readFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { ROOT_PACKAGE_NAME, sortRootFirstPackages } from "@skastr0/pulsar-shared-signals"
import { Context, Effect, Layer } from "effect"
import { simpleGit } from "simple-git"
import {
  readCargoManifestFacts,
  type CargoManifestFacts,
  type ParsedRustDependencyInfo,
} from "./cargo-manifest-facts.js"
import { loadCargoMetadata, type CargoMetadata } from "./cargo-metadata.js"
import { parseCargoLock, type CargoLockfile } from "./lock-file.js"

export interface RustManifestInfo {
  readonly name: string
  readonly path: string
  readonly manifestPath: string
  readonly packageName: string | undefined
  readonly dependencies?: ReadonlyArray<RustDependencyInfo>
}

export interface RustDependencyInfo {
  readonly alias: string
  readonly packageName: string
}

export interface RustProject {
  readonly worktreePath: string
  readonly manifests: ReadonlyArray<RustManifestInfo>
  readonly sourceFiles: ReadonlyArray<string>
  readonly cargoLockPath: string | undefined
  readonly cargoLock: CargoLockfile | undefined
  readonly cargoMetadata: CargoMetadata | undefined
}

export class RustProjectTag extends Context.Tag("@skastr0/pulsar-rs-pack/RustProject")<
  RustProjectTag,
  RustProject
>() {}

export const isRustSignalPath = (file: string): boolean => {
  if (!(file.endsWith(".rs") || file.endsWith("Cargo.toml") || file.endsWith("Cargo.lock"))) {
    return false
  }
  return !(
    file.includes("/__tests__/fixtures/") ||
    file.includes("/dist/") ||
    file.includes("/target/") ||
    file.includes("/node_modules/")
  )
}

const IGNORE_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".turbo",
  ".cache",
  "target",
])

const PACKAGE_SOURCE_DIRS = ["src", "tests", "examples", "benches"] as const

export const discoverRustManifests = (
  rootDir: string,
): Effect.Effect<ReadonlyArray<RustManifestInfo>, unknown> =>
  Effect.gen(function* () {
    const manifests = yield* findCargoTomls(rootDir)
    const parsedManifests = yield* Effect.forEach(manifests, (manifestPath: string) =>
      Effect.gen(function* () {
        const packageDir = dirname(manifestPath)
        const rel = relative(rootDir, packageDir)
        const facts = yield* readCargoManifestFacts(manifestPath)
        return {
          name: rel === "" ? ROOT_PACKAGE_NAME : rel,
          path: packageDir,
          manifestPath,
          facts,
        }
      }),
    )
    const workspaceDependencies = collectWorkspaceDependencies(parsedManifests)
    const packages = parsedManifests.map((manifest) => ({
      name: manifest.name,
      path: manifest.path,
      manifestPath: manifest.manifestPath,
      packageName: manifest.facts.packageName,
      dependencies: resolveWorkspaceDependencies(
        manifest.facts.dependencies,
        workspaceDependencies,
      ),
    }))
    return sortRootFirstPackages(packages)
  })

export const makeRustProject = (
  worktreePath: string,
): Effect.Effect<RustProject, unknown> =>
  Effect.gen(function* () {
    const manifests = yield* discoverRustManifests(worktreePath)
    const sourceFiles = yield* discoverRustSourceFiles(manifests)
    const cargoLockPath = join(worktreePath, "Cargo.lock")
    const cargoLockRaw = yield* maybeReadUtf8(cargoLockPath)
    const cargoMetadata = yield* Effect.promise(() => loadCargoMetadata(worktreePath))

    return {
      worktreePath,
      manifests,
      sourceFiles,
      cargoLockPath: cargoLockRaw === undefined ? undefined : cargoLockPath,
      cargoLock: cargoLockRaw === undefined ? undefined : parseCargoLock(cargoLockRaw),
      cargoMetadata,
    }
  })

export const RustProjectLayer = (worktreePath: string): Layer.Layer<RustProjectTag, unknown> =>
  Layer.effect(RustProjectTag, makeRustProject(worktreePath))

const findCargoTomls = (rootDir: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const gitFiles = yield* getGitTrackedFiles(rootDir)
    if (gitFiles.length > 0) {
      return gitFiles
        .filter((file: string) => file.endsWith("Cargo.toml") && !file.includes("node_modules"))
        .map((file: string) => join(rootDir, file))
    }
    return yield* Effect.promise(() => walkForCargoTomls(rootDir))
  })

const discoverRustSourceFiles = (
  manifests: ReadonlyArray<RustManifestInfo>,
): Effect.Effect<ReadonlyArray<string>, unknown> =>
  Effect.promise(async () => {
    const files = new Set<string>()
    for (const manifest of manifests) {
      if (manifest.packageName === undefined) continue
      for (const dirName of PACKAGE_SOURCE_DIRS) {
        for (const file of await walkForRustSources(join(manifest.path, dirName))) {
          files.add(file)
        }
      }
    }
    return [...files].sort()
  })

const getGitTrackedFiles = (rootDir: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.tryPromise({
    try: async () => {
      const git = simpleGit(rootDir)
      const raw = await git.raw([
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
      ])
      return raw
        .trim()
        .split("\n")
        .filter((file: string) => file.length > 0)
    },
    catch: () => new Error("not a git repo"),
  }).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))

const walkForCargoTomls = async (dir: string): Promise<Array<string>> => {
  const results: Array<string> = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue
        results.push(...(await walkForCargoTomls(join(dir, entry.name))))
      } else if (entry.name === "Cargo.toml") {
        results.push(join(dir, entry.name))
      }
    }
  } catch {
    // Ignore permission errors and transient filesystem entries.
  }
  return results
}

const walkForRustSources = async (dir: string): Promise<Array<string>> => {
  const results: Array<string> = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue
        results.push(...(await walkForRustSources(join(dir, entry.name))))
      } else if (entry.name.endsWith(".rs")) {
        results.push(join(dir, entry.name))
      }
    }
  } catch {
    // Ignore missing package folders or transient filesystem entries.
  }
  return results
}

const collectWorkspaceDependencies = (
  manifests: ReadonlyArray<{ readonly facts: CargoManifestFacts }>,
): ReadonlyMap<string, RustDependencyInfo> => {
  const dependencies = new Map<string, RustDependencyInfo>()
  for (const manifest of manifests) {
    for (const dependency of manifest.facts.workspaceDependencies) {
      dependencies.set(dependency.alias, {
        alias: dependency.alias,
        packageName: dependency.packageName,
      })
    }
  }
  return dependencies
}

const resolveWorkspaceDependencies = (
  dependencies: ReadonlyArray<ParsedRustDependencyInfo>,
  workspaceDependencies: ReadonlyMap<string, RustDependencyInfo>,
): ReadonlyArray<RustDependencyInfo> =>
  dependencies.map((dependency) => {
    if (!dependency.inheritedFromWorkspace) {
      return {
        alias: dependency.alias,
        packageName: dependency.packageName,
      }
    }
    return {
      alias: dependency.alias,
      packageName:
        workspaceDependencies.get(dependency.alias)?.packageName ?? dependency.packageName,
    }
  })

const maybeReadUtf8 = (
  filePath: string,
): Effect.Effect<string | undefined, unknown> =>
  Effect.tryPromise({
    try: () => readFile(filePath, "utf8"),
    catch: (error: unknown) => error,
  }).pipe(
    Effect.catchAll((error: unknown) => {
      const code =
        typeof error === "object" && error !== null
          ? (error as { code?: string }).code
          : undefined
      if (code === "ENOENT") return Effect.succeed(undefined)
      return Effect.fail(error)
    }),
  )
