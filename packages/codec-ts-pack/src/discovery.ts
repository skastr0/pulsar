import { readdir } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { Effect } from "effect"
import { simpleGit } from "simple-git"

export interface PackageInfo {
  readonly name: string
  readonly path: string
  readonly tsconfigPath: string
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
    const tsconfigs = yield* findTsconfigs(rootDir)
    const packages = tsconfigs.map((tsconfigPath) => {
      const packageDir = dirname(tsconfigPath)
      const rel = relative(rootDir, packageDir)
      return {
        name: rel === "" ? "(root)" : rel,
        path: packageDir,
        tsconfigPath,
      }
    })
    return packages.slice().sort((a, b) => {
      if (a.name === "(root)") return -1
      if (b.name === "(root)") return 1
      return a.name.localeCompare(b.name)
    })
  })

const findTsconfigs = (rootDir: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const gitFiles = yield* getGitTrackedFiles(rootDir)
    if (gitFiles.length > 0) {
      return gitFiles
        .filter((f) => f.endsWith("tsconfig.json") && !f.includes("node_modules"))
        .map((f) => join(rootDir, f))
    }
    return yield* Effect.promise(() => walkForTsconfigs(rootDir))
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
