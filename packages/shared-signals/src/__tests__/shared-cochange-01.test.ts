import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { SignalContextTag } from "@skastr0/pulsar-core/signal"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Layer, Schema } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import { SharedCochange01, type SharedCochange01Output } from "../index.js"

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

type CoChangePairValue = SharedCochange01Output["pairs"][number]

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
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, content, "utf8")
    },
    commitAll: async (options) => {
      git(root, ["add", "."])
      git(root, ["commit", "-q", "-m", options.message], commitEnv(options))
      return revParse(root, "HEAD")
    },
    rename: async (fromRelativePath, toRelativePath, options) => {
      await mkdir(dirname(join(root, toRelativePath)), { recursive: true })
      git(root, ["mv", fromRelativePath, toRelativePath])
      git(root, ["commit", "-q", "-m", options.message], commitEnv(options))
      return revParse(root, "HEAD")
    },
    revParse: (ref) => revParse(root, ref),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

const runCochange = async (
  repo: GitFixture,
  config: Partial<typeof SharedCochange01.defaultConfig> = {},
): Promise<SharedCochange01Output> =>
  Effect.runPromise(
    SharedCochange01.compute(
      { ...SharedCochange01.defaultConfig, ...config },
      new Map(),
    ).pipe(
      Effect.provide(
        Layer.succeed(SignalContextTag, {
          gitSha: repo.revParse("HEAD"),
          worktreePath: repo.root,
          changedHunks: [],
        }),
      ),
    ) as Effect.Effect<SharedCochange01Output, any, never>,
  )

const normalizedPairs = (
  repo: GitFixture,
  output: Awaited<ReturnType<typeof runCochange>>,
): ReadonlyArray<readonly [string, string, number, number, number, number, number, string]> =>
  output.pairs.map((pair) => [
    pair.leftFile.replace(repo.root, "$ROOT"),
    pair.rightFile.replace(repo.root, "$ROOT"),
    pair.coChangeCount,
    pair.leftTouchCount,
    pair.rightTouchCount,
    Number(pair.support.toFixed(6)),
    Number(pair.confidence.toFixed(6)),
    pair.lastCoChangedAt,
  ] as const)

const filesInPairs = (
  repo: GitFixture,
  output: Awaited<ReturnType<typeof runCochange>>,
): ReadonlyArray<string> =>
  [...new Set(output.pairs.flatMap((pair) => [pair.leftFile, pair.rightFile]))]
    .map((file) => file.replace(repo.root, "$ROOT"))
    .sort((left, right) => left.localeCompare(right))

describe("SHARED-COCHANGE-01 logical coupling", () => {
  test("declares identity, pack registration, config schema, cache, and factor ledger", async () => {
    const packRegistered = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-COCHANGE-01"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("SHARED-COCHANGE-01")
    const decoded = Schema.decodeUnknownSync(SharedCochange01.configSchema)(
      SharedCochange01.defaultConfig,
    )
    const factorLedger = registered?.factorLedger?.({} as SharedCochange01Output)

    expect(SharedCochange01).toMatchObject({
      id: "SHARED-COCHANGE-01-logical-coupling",
      title: "Logical coupling",
      aliases: ["SHARED-COCHANGE-01"],
      tier: 1,
      category: "architectural-drift",
      kind: "legibility",
      cacheVersion: "history-pairs-normalized-config-v1",
      cacheDependencies: ["git-revision-context"],
      inputs: [],
    })
    expect(decoded).toEqual(SharedCochange01.defaultConfig)
    expect(SharedCochange01.defaultConfig.include_extensions).toEqual([
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".rs",
    ])
    expect(registered?.id).toBe(SharedCochange01.id)
    expect(registered?.cacheVersion).toContain(SharedCochange01.cacheVersion)
    expect(registry.byId.get("SHARED-COCHANGE-01")?.id).toBe(SharedCochange01.id)
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
        path: "config.min_co_change_count",
        value: 2,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.include_extensions",
        value: SharedCochange01.defaultConfig.include_extensions,
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
  })

  test("emits repeated co-change pairs with support and confidence", async () => {
    const repo = await createRepo("pulsar-shared-cochange-01-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.write("src/b.ts", "export const b = 1\n")
      await repo.commitAll({ message: "a and b", dateIso: "2024-03-01T00:00:00Z" })
      await repo.write("src/a.ts", "export const a = 2\n")
      await repo.write("src/b.ts", "export const b = 2\n")
      await repo.commitAll({ message: "a and b again", dateIso: "2024-03-02T00:00:00Z" })
      await repo.write("src/a.ts", "export const a = 3\n")
      await repo.commitAll({ message: "a only", dateIso: "2024-03-03T00:00:00Z" })

      const output = await runCochange(repo)
      const leftFile = join(repo.root, "src/a.ts")
      const rightFile = join(repo.root, "src/b.ts")

      expect(output.pairs).toHaveLength(1)
      expect(output.pairs[0]).toEqual({
        leftFile,
        rightFile,
        coChangeCount: 2,
        leftTouchCount: 3,
        rightTouchCount: 2,
        support: 2 / 3,
        confidence: 2 / 3,
        lastCoChangedAt: "2024-03-02T00:00:00.000Z",
      })
      expect(output.byPair.get(pairKey(rightFile, leftFile))).toBe(output.pairs[0])
      expect(SharedCochange01.score(output)).toBe(1)
      expect(SharedCochange01.outputMetadata?.(output)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await repo.cleanup()
    }
  })

  test("includes TS module and Rust extensions while excluding generated, test, and configured paths", async () => {
    const repo = await createRepo("pulsar-shared-cochange-01-filter-")
    try {
      await repo.write("src/module.mts", "export const moduleValue = 1\n")
      await repo.write("src/common.cts", "export const commonValue = 1\n")
      await repo.write("src/app.tsx", "export const App = () => null\n")
      await repo.write("src/lib.rs", "pub const VALUE: i32 = 1;\n")
      await repo.write("src/readme.md", "# nope\n")
      await repo.write("src/mydist/a.ts", "export const mydist = 1\n")
      await repo.write("dist/out.ts", "export const out = 1\n")
      await repo.write("target/lib.rs", "pub const OUT: i32 = 1;\n")
      await repo.write("src/a.test.ts", "test('x', () => {})\n")
      await repo.write("src/module.test.mts", "test('module', () => {})\n")
      await repo.write("src/common.spec.cts", "test('common', () => {})\n")
      await repo.write("src/auto.generated.mts", "export const generated = 1\n")
      await repo.write("src/auto.gen.cts", "export const generated = 1\n")
      await repo.write("src/_generated/api.ts", "export const generated = 1\n")
      await repo.write("src/skip.ts", "export const skip = 1\n")
      await repo.commitAll({ message: "mixed files", dateIso: "2024-04-01T00:00:00Z" })
      await repo.write("src/module.mts", "export const moduleValue = 2\n")
      await repo.write("src/common.cts", "export const commonValue = 2\n")
      await repo.commitAll({ message: "module pair again", dateIso: "2024-04-02T00:00:00Z" })

      const output = await runCochange(repo, {
        exclude_globs: [...SharedCochange01.defaultConfig.exclude_globs, "**/skip.ts"],
        min_co_change_count: 1,
      })

      expect(filesInPairs(repo, output)).toEqual([
        "$ROOT/src/app.tsx",
        "$ROOT/src/common.cts",
        "$ROOT/src/lib.rs",
        "$ROOT/src/module.mts",
        "$ROOT/src/mydist/a.ts",
      ])
      expect(output.totalCommits).toBe(2)
    } finally {
      await repo.cleanup()
    }
  })

  test("clean negative filters produce empty provider facts", async () => {
    const repo = await createRepo("pulsar-shared-cochange-01-negative-")
    try {
      await repo.write("src/old-a.ts", "export const oldA = 1\n")
      await repo.write("src/old-b.ts", "export const oldB = 1\n")
      await repo.commitAll({ message: "old pair", dateIso: "2024-01-01T00:00:00Z" })
      await repo.write("README.md", "# docs\n")
      await repo.commitAll({ message: "docs", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runCochange(repo, { window_days: 30 })

      expect(output.pairs).toEqual([])
      expect(output.byPair.size).toBe(0)
      expect(output.totalCommits).toBe(0)
      expect(output.sampled).toBe(false)
      expect(SharedCochange01.score(output)).toBe(1)
      expect(SharedCochange01.diagnose(output)).toEqual([])
      expect(SharedCochange01.outputMetadata?.(output)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await repo.cleanup()
    }
  })

  test("empty include extensions return empty facts without counting unrelated commits", async () => {
    const repo = await createRepo("pulsar-shared-cochange-01-empty-ext-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.write("src/b.ts", "export const b = 1\n")
      await repo.commitAll({ message: "mixed", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runCochange(repo, { include_extensions: [] })

      expect(output.pairs).toEqual([])
      expect(output.totalCommits).toBe(0)
      expect(output.sampled).toBe(false)
    } finally {
      await repo.cleanup()
    }
  })

  test("max commits bounds history and marks sampled output", async () => {
    const repo = await createRepo("pulsar-shared-cochange-01-sampled-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.write("src/b.ts", "export const b = 1\n")
      await repo.commitAll({ message: "a b", dateIso: "2024-03-01T00:00:00Z" })
      await repo.write("src/a.ts", "export const a = 2\n")
      await repo.write("src/b.ts", "export const b = 2\n")
      await repo.commitAll({ message: "a b again", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runCochange(repo, { max_commits: 1, min_co_change_count: 1 })

      expect(normalizedPairs(repo, output).map((pair) => pair.slice(0, 3))).toEqual([
        ["$ROOT/src/a.ts", "$ROOT/src/b.ts", 1],
      ])
      expect(output.totalCommits).toBe(1)
      expect(output.maxCommits).toBe(1)
      expect(output.sampled).toBe(true)
    } finally {
      await repo.cleanup()
    }
  })

  test("normalizes invalid config before running git and reporting output", async () => {
    const repo = await createRepo("pulsar-shared-cochange-01-normalized-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.write("src/b.ts", "export const b = 1\n")
      await repo.commitAll({ message: "a b", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runCochange(repo, {
        window_days: Number.NaN,
        max_commits: Number.NEGATIVE_INFINITY,
        min_co_change_count: 0,
        top_n_diagnostics: Number.NaN,
      })

      expect(output.windowDays).toBe(SharedCochange01.defaultConfig.window_days)
      expect(output.maxCommits).toBe(SharedCochange01.defaultConfig.max_commits)
      expect(output.topDiagnostics).toBe(0)
      expect(normalizedPairs(repo, output).map((pair) => pair.slice(0, 3))).toEqual([
        ["$ROOT/src/a.ts", "$ROOT/src/b.ts", 1],
      ])
    } finally {
      await repo.cleanup()
    }
  })

  test("diagnostics expose ordered pair payloads and caps", () => {
    const output: SharedCochange01Output = {
      pairs: [
        pair({ leftFile: "src/a.ts", rightFile: "src/b.ts", coChangeCount: 4 }),
        pair({ leftFile: "src/c.ts", rightFile: "src/d.ts", coChangeCount: 2 }),
        pair({ leftFile: "src/e.ts", rightFile: "src/f.ts", coChangeCount: 1 }),
      ],
      byPair: new Map(),
      windowDays: 90,
      totalCommits: 7,
      maxCommits: 500,
      sampled: false,
      topDiagnostics: 2,
      compositeConsumers: ["architecture blast radius"],
      cacheContributors: ["git-revision-context"],
      calibrationSurface:
        "config thresholds only; language-aware structural-edge interpretation belongs to downstream composites",
      enforcementCeiling: ["soft-warning", "trend"],
    }

    const diagnostics = SharedCochange01.diagnose(output)

    expect(diagnostics.map((diagnostic) => diagnostic.location?.file)).toEqual([
      "src/a.ts",
      "src/c.ts",
    ])
    expect(diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(["warn", "info"])
    expect(diagnostics[0]).toMatchObject({
      severity: "warn",
      message:
        "Logical coupling candidate: src/a.ts and src/b.ts changed together 4 times in 90 days",
      data: expect.objectContaining({
        leftFile: "src/a.ts",
        rightFile: "src/b.ts",
        coChangeCount: 4,
      }),
    })
  })

  test("rename history and equivalent repositories produce deterministic output", async () => {
    const renameRepo = await createRepo("pulsar-shared-cochange-01-rename-")
    const left = await createRepo("pulsar-shared-cochange-01-left-")
    const right = await createRepo("pulsar-shared-cochange-01-right-")
    try {
      await renameRepo.write("src/original.ts", "export const value = 1\n")
      await renameRepo.write("src/companion.ts", "export const companion = 1\n")
      await renameRepo.commitAll({ message: "original pair", dateIso: "2024-03-01T00:00:00Z" })
      await renameRepo.rename("src/original.ts", "src/renamed.ts", {
        message: "rename only",
        dateIso: "2024-04-01T00:00:00Z",
      })
      const renameOutput = await runCochange(renameRepo, { min_co_change_count: 1 })
      expect(normalizedPairs(renameRepo, renameOutput).map((pair) => pair.slice(0, 3))).toEqual([
        ["$ROOT/src/companion.ts", "$ROOT/src/original.ts", 1],
      ])

      for (const repo of [left, right]) {
        await repo.write("src/a.ts", "export const a = 1\n")
        await repo.write("src/b.ts", "export const b = 1\n")
        await repo.commitAll({ message: "a b", dateIso: "2024-03-01T00:00:00Z" })
        await repo.write("src/a.ts", "export const a = 2\n")
        await repo.write("src/b.ts", "export const b = 2\n")
        await repo.commitAll({ message: "a b again", dateIso: "2024-04-01T00:00:00Z" })
      }

      const leftOutput = await runCochange(left)
      const rightOutput = await runCochange(right)
      expect(normalizedPairs(left, leftOutput)).toEqual(normalizedPairs(right, rightOutput))
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
      await renameRepo.cleanup()
      await left.cleanup()
      await right.cleanup()
    }
  })
})

const pair = (overrides: Partial<CoChangePairValue>): CoChangePairValue => ({
  leftFile: "src/a.ts",
  rightFile: "src/b.ts",
  coChangeCount: 1,
  leftTouchCount: 1,
  rightTouchCount: 1,
  support: 1,
  confidence: 1,
  lastCoChangedAt: "2024-04-01T00:00:00.000Z",
  ...overrides,
})

const pairKey = (leftFile: string, rightFile: string): string =>
  leftFile.localeCompare(rightFile) <= 0
    ? `${leftFile}\0${rightFile}`
    : `${rightFile}\0${leftFile}`

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
