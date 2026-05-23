import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SignalContextTag } from "@skastr0/pulsar-core/signal"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Layer, Schema } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import { SharedChurn01 } from "../index.js"

interface CommitOptions {
  readonly message: string
  readonly dateIso: string
}

interface GitFixture {
  readonly root: string
  readonly write: (relativePath: string, content: string) => Promise<void>
  readonly commitAll: (options: CommitOptions) => Promise<string>
  readonly rename: (fromRelativePath: string, toRelativePath: string, options: CommitOptions) => Promise<string>
  readonly revParse: (ref: string) => string
  readonly cleanup: () => Promise<void>
}

const createRepo = async (prefix: string): Promise<GitFixture> => {
  const root = await mkdtemp(join(tmpdir(), prefix))
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "test@example.com"])
  git(root, ["config", "user.name", "Pulsar Test"])
  git(root, ["config", "commit.gpgsign", "false"])
  return {
    root,
    write: async (relativePath, content) => {
      const fullPath = join(root, relativePath)
      await mkdir(join(fullPath, ".."), { recursive: true })
      await writeFile(fullPath, content, "utf8")
    },
    commitAll: async (options) => {
      git(root, ["add", "."])
      git(root, ["commit", "-q", "-m", options.message], commitEnv(options))
      return revParse(root, "HEAD")
    },
    rename: async (fromRelativePath, toRelativePath, options) => {
      const destination = join(root, toRelativePath)
      await mkdir(join(destination, ".."), { recursive: true })
      git(root, ["mv", fromRelativePath, toRelativePath])
      git(root, ["commit", "-q", "-m", options.message], commitEnv(options))
      return revParse(root, "HEAD")
    },
    revParse: (ref) => revParse(root, ref),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

const runRecentChurn = async (
  repo: GitFixture,
  config: Partial<typeof SharedChurn01.defaultConfig> = {},
) =>
  Effect.runPromise(
    SharedChurn01.compute(
      { ...SharedChurn01.defaultConfig, ...config },
      new Map(),
    ).pipe(
      Effect.provide(
        Layer.succeed(SignalContextTag, {
          gitSha: repo.revParse("HEAD"),
          worktreePath: repo.root,
          changedHunks: [],
        }),
      ),
    ) as Effect.Effect<any, any, never>,
  )

const normalizedFileChurn = (
  repo: GitFixture,
  output: Awaited<ReturnType<typeof runRecentChurn>>,
): ReadonlyArray<readonly [string, number]> =>
  [...output.byFile.entries()]
    .map(([file, count]) => [file.replace(repo.root, "$ROOT"), count] as const)
    .sort(([left], [right]) => left.localeCompare(right))

describe("SHARED-CHURN-01 recent churn", () => {
  test("declares identity, pack registration, config schema, cache, and factor ledger", async () => {
    const packRegistered = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-CHURN-01"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("SHARED-CHURN-01")
    const decoded = Schema.decodeUnknownSync(SharedChurn01.configSchema)(
      SharedChurn01.defaultConfig,
    )
    const factorLedger = registered?.factorLedger?.({
      byFile: new Map(),
      windowDays: SharedChurn01.defaultConfig.window_days,
      totalCommits: 0,
      maxCommits: SharedChurn01.defaultConfig.max_commits,
      sampled: false,
    })

    expect(SharedChurn01).toMatchObject({
      id: "SHARED-CHURN-01-recent-churn",
      title: "Recent churn",
      aliases: ["SHARED-CHURN-01"],
      tier: 1,
      category: "review-pain",
      kind: "legibility",
      cacheVersion: "provider-not-applicable-git-context-v1",
      cacheDependencies: ["git-revision-context"],
      inputs: [],
    })
    expect(decoded).toEqual(SharedChurn01.defaultConfig)
    expect(SharedChurn01.defaultConfig.include_extensions).toEqual([
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".rs",
    ])
    expect(registered?.id).toBe(SharedChurn01.id)
    expect(registered?.cacheVersion).toContain(SharedChurn01.cacheVersion)
    expect(registry.byId.get("SHARED-CHURN-01")?.id).toBe(SharedChurn01.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.window_days",
        value: 90,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.include_extensions",
        value: SharedChurn01.defaultConfig.include_extensions,
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
  })

  test("counts recent per-file churn from real git history", async () => {
    const repo = await createRepo("pulsar-shared-churn-01-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({ message: "a old", dateIso: "2024-02-01T00:00:00Z" })
      await repo.write("src/a.ts", "export const a = 2\n")
      await repo.commitAll({ message: "a recent", dateIso: "2024-03-15T00:00:00Z" })
      await repo.write("src/b.rs", "pub const B: i32 = 1;\n")
      await repo.commitAll({ message: "b recent", dateIso: "2024-03-20T00:00:00Z" })
      await repo.write("src/a.ts", "export const a = 3\n")
      await repo.commitAll({ message: "a head", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runRecentChurn(repo, { window_days: 30 })

      expect(normalizedFileChurn(repo, output)).toEqual([
        ["$ROOT/src/a.ts", 2],
        ["$ROOT/src/b.rs", 1],
      ])
      expect(output.windowDays).toBe(30)
      expect(output.totalCommits).toBe(3)
      expect(output.sampled).toBe(false)
      expect(SharedChurn01.score(output)).toBe(1)
      expect(SharedChurn01.diagnose(output)).toEqual([])
      expect(SharedChurn01.outputMetadata?.(output)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await repo.cleanup()
    }
  })

  test("includes TypeScript module extensions while excluding configured paths", async () => {
    const repo = await createRepo("pulsar-shared-churn-01-filter-")
    try {
      await repo.write("src/module.mts", "export const moduleValue = 1\n")
      await repo.write("src/common.cts", "export const commonValue = 1\n")
      await repo.write("src/app.tsx", "export const App = () => null\n")
      await repo.write("src/readme.md", "# nope\n")
      await repo.write("src/mydist/a.ts", "export const mydist = 1\n")
      await repo.write("dist/out.ts", "export const out = 1\n")
      await repo.write("target/lib.rs", "pub const OUT: i32 = 1;\n")
      await repo.commitAll({ message: "mixed files", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runRecentChurn(repo)

      expect(normalizedFileChurn(repo, output)).toEqual([
        ["$ROOT/src/app.tsx", 1],
        ["$ROOT/src/common.cts", 1],
        ["$ROOT/src/module.mts", 1],
        ["$ROOT/src/mydist/a.ts", 1],
      ])
      expect(output.totalCommits).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("rename commits follow the renamed path without old-path churn inflation", async () => {
    const repo = await createRepo("pulsar-shared-churn-01-rename-")
    try {
      await repo.write("src/original.ts", "export const value = 1\n")
      await repo.commitAll({ message: "original", dateIso: "2024-03-01T00:00:00Z" })
      await repo.rename("src/original.ts", "src/renamed.ts", {
        message: "rename",
        dateIso: "2024-04-01T00:00:00Z",
      })

      const output = await runRecentChurn(repo)

      expect(normalizedFileChurn(repo, output)).toEqual([
        ["$ROOT/src/original.ts", 1],
        ["$ROOT/src/renamed.ts", 1],
      ])
      expect(output.totalCommits).toBe(2)
    } finally {
      await repo.cleanup()
    }
  })

  test("empty include extensions produce empty churn facts without counting unrelated commits", async () => {
    const repo = await createRepo("pulsar-shared-churn-01-empty-ext-")
    try {
      await repo.write("README.md", "# docs\n")
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({ message: "mixed", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runRecentChurn(repo, { include_extensions: [] })

      expect(output.byFile.size).toBe(0)
      expect(output.totalCommits).toBe(0)
      expect(output.sampled).toBe(false)
    } finally {
      await repo.cleanup()
    }
  })

  test("max commits bounds history and marks sampled output", async () => {
    const repo = await createRepo("pulsar-shared-churn-01-sampled-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({ message: "a", dateIso: "2024-03-01T00:00:00Z" })
      await repo.write("src/b.ts", "export const b = 1\n")
      await repo.commitAll({ message: "b", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runRecentChurn(repo, { max_commits: 1 })

      expect(normalizedFileChurn(repo, output)).toEqual([["$ROOT/src/b.ts", 1]])
      expect(output.totalCommits).toBe(1)
      expect(output.maxCommits).toBe(1)
      expect(output.sampled).toBe(true)
    } finally {
      await repo.cleanup()
    }
  })

  test("normalizes invalid config before running git", async () => {
    const repo = await createRepo("pulsar-shared-churn-01-normalized-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({ message: "a", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runRecentChurn(repo, {
        window_days: Number.NaN,
        max_commits: Number.NEGATIVE_INFINITY,
      })
      expect(output.windowDays).toBe(SharedChurn01.defaultConfig.window_days)
      expect(output.maxCommits).toBe(SharedChurn01.defaultConfig.max_commits)
      expect(normalizedFileChurn(repo, output)).toEqual([["$ROOT/src/a.ts", 1]])
    } finally {
      await repo.cleanup()
    }
  })

  test("outputs are deterministic for equivalent repositories", async () => {
    const left = await createRepo("pulsar-shared-churn-01-left-")
    const right = await createRepo("pulsar-shared-churn-01-right-")
    try {
      for (const repo of [left, right]) {
        await repo.write("src/a.ts", "export const a = 1\n")
        await repo.commitAll({ message: "a", dateIso: "2024-03-01T00:00:00Z" })
        await repo.write("src/a.ts", "export const a = 2\n")
        await repo.commitAll({ message: "a again", dateIso: "2024-04-01T00:00:00Z" })
      }

      const leftOutput = await runRecentChurn(left)
      const rightOutput = await runRecentChurn(right)

      expect(normalizedFileChurn(left, leftOutput)).toEqual(
        normalizedFileChurn(right, rightOutput),
      )
      expect({
        windowDays: leftOutput.windowDays,
        totalCommits: leftOutput.totalCommits,
        maxCommits: leftOutput.maxCommits,
        sampled: leftOutput.sampled,
      }).toEqual({
        windowDays: rightOutput.windowDays,
        totalCommits: rightOutput.totalCommits,
        maxCommits: rightOutput.maxCommits,
        sampled: rightOutput.sampled,
      })
    } finally {
      await left.cleanup()
      await right.cleanup()
    }
  })
})

const commitEnv = (options: CommitOptions): Record<string, string> => ({
  ...process.env,
  GIT_AUTHOR_NAME: "Pulsar Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Pulsar Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_AUTHOR_DATE: options.dateIso,
  GIT_COMMITTER_DATE: options.dateIso,
} as Record<string, string>)

const git = (
  cwd: string,
  args: ReadonlyArray<string>,
  env?: Record<string, string>,
): void => {
  const result = spawnSync("git", [...args], {
    cwd,
    env: env === undefined ? undefined : { ...process.env, ...env },
    encoding: "utf8",
  })
  if (result.status === 0) return
  throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
}

const revParse = (cwd: string, ref: string): string => {
  const result = spawnSync("git", ["rev-parse", ref], {
    cwd,
    encoding: "utf8",
  })
  if (result.status !== 0) {
    throw new Error(`git rev-parse ${ref} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}
