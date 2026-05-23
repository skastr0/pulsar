import { readdir, readFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { ROOT_PACKAGE_NAME, sortRootFirstPackages } from "@skastr0/pulsar-shared-signals"
import { Context, Effect, Layer } from "effect"
import { simpleGit } from "simple-git"
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
    const packages = yield* Effect.forEach(manifests, (manifestPath: string) =>
      Effect.gen(function* () {
        const packageDir = dirname(manifestPath)
        const rel = relative(rootDir, packageDir)
        return {
          name: rel === "" ? ROOT_PACKAGE_NAME : rel,
          path: packageDir,
          manifestPath,
          packageName: yield* readCargoPackageName(manifestPath),
          dependencies: yield* readCargoDependencies(manifestPath),
        }
      }),
    )
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

const readCargoPackageName = (
  manifestPath: string,
): Effect.Effect<string | undefined, unknown> =>
  Effect.tryPromise({
    try: async () => {
      const raw = await readFile(manifestPath, "utf8")
      let inPackage = false
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed.startsWith("[")) {
          inPackage = trimmed === "[package]"
          continue
        }
        if (!inPackage) continue
        const match = /^name\s*=\s*"([^"]+)"$/.exec(trimmed)
        if (match !== null) return match[1]!
      }
      return undefined
    },
    catch: (error: unknown) => error,
  })

const DEPENDENCY_SECTION_PATTERN =
  /^\[(?:target\.[^\]]+\.)?(?:dev-|build-)?dependencies\]$/
const DEPENDENCY_TABLE_SECTION_PATTERN =
  /^\[(?:target\.[^\]]+\.)?(?:dev-|build-)?dependencies\.([A-Za-z0-9_-]+)\]$/
const DEPENDENCY_KEY_PATTERN = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/

const readCargoDependencies = (
  manifestPath: string,
): Effect.Effect<ReadonlyArray<RustDependencyInfo>, unknown> =>
  Effect.tryPromise({
    try: async () => parseCargoDependencyNames(await readFile(manifestPath, "utf8")),
    catch: (error: unknown) => error,
  })

const parseCargoDependencyNames = (raw: string): ReadonlyArray<RustDependencyInfo> => {
  const dependencies = new Map<string, RustDependencyInfo>()
  let inDependencySection = false
  let tableAlias: string | undefined
  let tablePackageName: string | undefined

  const flushTableDependency = (): void => {
    if (tableAlias === undefined) return
    dependencies.set(tableAlias, {
      alias: tableAlias,
      packageName: tablePackageName ?? tableAlias,
    })
    tableAlias = undefined
    tablePackageName = undefined
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = stripTomlLineComment(line).trim()
    if (trimmed.length === 0) continue

    if (trimmed.startsWith("[")) {
      flushTableDependency()
      inDependencySection = DEPENDENCY_SECTION_PATTERN.test(trimmed)
      const tableMatch = DEPENDENCY_TABLE_SECTION_PATTERN.exec(trimmed)
      tableAlias = tableMatch?.[1]
      tablePackageName = undefined
      continue
    }

    if (tableAlias !== undefined) {
      const packageMatch = /^package\s*=\s*"([^"]+)"$/.exec(trimmed)
      if (packageMatch !== null) tablePackageName = packageMatch[1]
      continue
    }

    if (!inDependencySection) continue
    const dependencyMatch = DEPENDENCY_KEY_PATTERN.exec(trimmed)
    if (dependencyMatch === null) continue
    const alias = dependencyMatch[1]!
    const value = dependencyMatch[2]!.trim()
    const packageName = /(?:^|[,{]\s*)package\s*=\s*"([^"]+)"/.exec(value)?.[1] ?? alias
    dependencies.set(alias, { alias, packageName })
  }

  flushTableDependency()
  return [...dependencies.values()]
}

const stripTomlLineComment = (line: string): string => {
  let inString = false
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "\"") {
      inString = !inString
      continue
    }
    if (char === "#" && !inString) return line.slice(0, index)
  }
  return line
}

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
