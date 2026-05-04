import { readFile, readdir } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { Effect } from "effect"
import { simpleGit } from "simple-git"

export interface PackageManifest {
  readonly name: string | undefined
  readonly version: string | undefined
  readonly private: boolean
  readonly scripts: Readonly<Record<string, string>>
  readonly bin: Readonly<Record<string, string>>
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly optionalDependencies: Readonly<Record<string, string>>
  readonly entrypoints: ReadonlyArray<string>
}

export interface PackageInfo {
  readonly name: string
  readonly path: string
  readonly tsconfigPath: string
  readonly packageJsonPath: string | undefined
  readonly manifest: PackageManifest | undefined
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
])

export const discoverPackages = (rootDir: string): Effect.Effect<ReadonlyArray<PackageInfo>> =>
  Effect.gen(function* () {
    const files = yield* getDiscoverableFiles(rootDir)
    const tsconfigs = files.length > 0
      ? files
        .filter((f) => f.endsWith("tsconfig.json") && !isIgnoredPath(f))
        .map((f) => join(rootDir, f))
      : yield* Effect.promise(() => walkForTsconfigs(rootDir))
    const tsconfigPackages = yield* Effect.forEach(tsconfigs, (tsconfigPath) =>
      Effect.promise(() => toTsconfigPackageInfo(rootDir, tsconfigPath)),
    )
    const tsconfigPackagePaths = new Set(tsconfigPackages.map((pkg) => pkg.path))
    const packageJsonOnlyPackages = yield* Effect.forEach(
      manifestOnlyPackageJsons(rootDir, files, tsconfigPackages, tsconfigPackagePaths),
      ({ packageJsonPath, inheritedTsconfigPath }) =>
        Effect.promise(() =>
          toManifestOnlyPackageInfo(rootDir, packageJsonPath, inheritedTsconfigPath),
        ),
    )

    return [...tsconfigPackages, ...packageJsonOnlyPackages].sort((a, b) => {
      if (a.name === "(root)") return -1
      if (b.name === "(root)") return 1
      return a.name.localeCompare(b.name)
    })
  })

const toTsconfigPackageInfo = async (rootDir: string, tsconfigPath: string): Promise<PackageInfo> => {
  const packageDir = dirname(tsconfigPath)
  const rel = relative(rootDir, packageDir)
  const packageJsonPath = join(packageDir, "package.json")
  const manifest = await readPackageManifest(packageJsonPath)

  return {
    name: rel === "" ? "(root)" : rel,
    path: packageDir,
    tsconfigPath,
    packageJsonPath: manifest === undefined ? undefined : packageJsonPath,
    manifest,
  }
}

const toManifestOnlyPackageInfo = async (
  rootDir: string,
  packageJsonPath: string,
  inheritedTsconfigPath: string,
): Promise<PackageInfo> => {
  const packageDir = dirname(packageJsonPath)
  const rel = relative(rootDir, packageDir)
  const manifest = await readPackageManifest(packageJsonPath)

  return {
    name: rel === "" ? "(root)" : rel,
    path: packageDir,
    tsconfigPath: inheritedTsconfigPath,
    packageJsonPath: manifest === undefined ? undefined : packageJsonPath,
    manifest,
  }
}

const readPackageManifest = async (
  packageJsonPath: string,
): Promise<PackageManifest | undefined> => {
  try {
    const raw = await readFile(packageJsonPath, "utf8")
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      name: asOptionalString(parsed.name),
      version: asOptionalString(parsed.version),
      private: parsed.private === true,
      scripts: asStringRecord(parsed.scripts),
      bin: asBinRecord(parsed.bin),
      dependencies: asDependencyRecord(parsed.dependencies),
      devDependencies: asDependencyRecord(parsed.devDependencies),
      peerDependencies: asDependencyRecord(parsed.peerDependencies),
      optionalDependencies: asDependencyRecord(parsed.optionalDependencies),
      entrypoints: collectManifestEntrypoints(parsed),
    }
  } catch {
    return undefined
  }
}

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

const asDependencyRecord = (value: unknown): Readonly<Record<string, string>> => {
  return asStringRecord(value)
}

const asStringRecord = (value: unknown): Readonly<Record<string, string>> => {
  if (value === null || typeof value !== "object") {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

const asBinRecord = (value: unknown): Readonly<Record<string, string>> => {
  if (typeof value === "string" && value.length > 0) {
    return { "(default)": value }
  }
  return asStringRecord(value)
}

const collectManifestEntrypoints = (manifest: Record<string, unknown>): ReadonlyArray<string> => {
  const entrypoints = new Set<string>()
  for (const key of ["main", "module", "types", "typings", "browser"]) {
    addEntrypoint(entrypoints, manifest[key])
  }
  addEntrypoint(entrypoints, manifest.bin)
  addEntrypoint(entrypoints, manifest.exports)
  return [...entrypoints].sort((left, right) => left.localeCompare(right))
}

const addEntrypoint = (entrypoints: Set<string>, value: unknown): void => {
  if (typeof value === "string") {
    if (value.length > 0) entrypoints.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      addEntrypoint(entrypoints, item)
    }
    return
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      addEntrypoint(entrypoints, item)
    }
  }
}

const getDiscoverableFiles = (rootDir: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const gitFiles = yield* getGitTrackedFiles(rootDir)
    if (gitFiles.length > 0) return gitFiles
    return yield* Effect.promise(() => walkForDiscoverableFiles(rootDir, rootDir))
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
        .filter((f) => f.length > 0)
    },
    catch: () => new Error("not a git repo"),
  }).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))

const manifestOnlyPackageJsons = (
  rootDir: string,
  files: ReadonlyArray<string>,
  tsconfigPackages: ReadonlyArray<PackageInfo>,
  tsconfigPackagePaths: ReadonlySet<string>,
): ReadonlyArray<{ readonly packageJsonPath: string; readonly inheritedTsconfigPath: string }> => {
  if (files.length === 0) return []

  const packageJsonPaths = new Set(
    files
      .filter((file) => file.endsWith("package.json") && !isIgnoredPath(file))
      .map((file) => join(rootDir, file)),
  )
  const hasTsSource = new Set<string>()
  for (const file of files) {
    if (isIgnoredPath(file)) continue
    if (!/\.(?:cts|mts|ts|tsx)$/.test(file)) continue
    const fullFile = join(rootDir, file)
    const packagePath = nearestPackageJsonPath(rootDir, dirname(fullFile), packageJsonPaths)
    if (packagePath !== undefined) {
      hasTsSource.add(dirname(packagePath))
    }
  }

  return [...packageJsonPaths]
    .filter((packageJsonPath) => {
      const packagePath = dirname(packageJsonPath)
      return !tsconfigPackagePaths.has(packagePath) && hasTsSource.has(packagePath)
    })
    .flatMap((packageJsonPath) => {
      const inherited = nearestTsconfigPackage(dirname(packageJsonPath), tsconfigPackages)
      return inherited === undefined ? [] : [{ packageJsonPath, inheritedTsconfigPath: inherited.tsconfigPath }]
    })
    .sort((left, right) => left.packageJsonPath.localeCompare(right.packageJsonPath))
}

const nearestPackageJsonPath = (
  rootDir: string,
  fromDir: string,
  packageJsons: ReadonlySet<string>,
): string | undefined => {
  let current = fromDir
  while (current.startsWith(rootDir)) {
    const candidate = join(current, "package.json")
    if (packageJsons.has(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

const nearestTsconfigPackage = (
  packagePath: string,
  tsconfigPackages: ReadonlyArray<PackageInfo>,
): PackageInfo | undefined =>
  tsconfigPackages
    .slice()
    .sort((left, right) => right.path.length - left.path.length)
    .find((pkg) => packagePath === pkg.path || packagePath.startsWith(`${pkg.path}/`))

const isIgnoredPath = (file: string): boolean =>
  file.split(/[\\/]+/).some((part) => IGNORE_DIRS.has(part))

const walkForTsconfigs = async (dir: string): Promise<Array<string>> => {
  const results: Array<string> = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue
        results.push(...(await walkForTsconfigs(join(dir, entry.name))))
      } else if (entry.name === "tsconfig.json") {
        results.push(join(dir, entry.name))
      }
    }
  } catch {
    // Ignore permission errors, etc.
  }
  return results
}

const walkForDiscoverableFiles = async (rootDir: string, dir: string): Promise<Array<string>> => {
  const results: Array<string> = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue
        results.push(...(await walkForDiscoverableFiles(rootDir, fullPath)))
      } else if (
        entry.name === "package.json" ||
        entry.name === "tsconfig.json" ||
        /\.(?:cts|mts|ts|tsx)$/.test(entry.name)
      ) {
        results.push(relative(rootDir, fullPath))
      }
    }
  } catch {
    // Ignore permission errors, etc.
  }
  return results
}
