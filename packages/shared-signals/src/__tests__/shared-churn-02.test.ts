import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { SignalContextTag } from "@skastr0/pulsar-core/signal"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Layer, Schema } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import { SharedChurn02, type SharedChurn02Output } from "../index.js"

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

const runWeightedChurn = async (
  repo: GitFixture,
  config: Partial<typeof SharedChurn02.defaultConfig> = {},
) =>
  Effect.runPromise(
    SharedChurn02.compute(
      { ...SharedChurn02.defaultConfig, ...config },
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

const normalizedWeightedChurn = (
  repo: GitFixture,
  output: Awaited<ReturnType<typeof runWeightedChurn>>,
): ReadonlyArray<readonly [string, number, number, string]> =>
  [...output.byFile.entries()]
    .map(([file, churn]) => [
      file.replace(repo.root, "$ROOT"),
      churn.rawWindowChurn,
      Number(churn.weightedChurn.toFixed(6)),
      churn.lastTouchedAt,
    ] as const)
    .sort(([left], [right]) => left.localeCompare(right))

describe("SHARED-CHURN-02 recency-weighted churn", () => {
  test("declares identity, pack registration, config schema, cache, and factor ledger", async () => {
    const packRegistered = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-CHURN-02"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("SHARED-CHURN-02")
    const decoded = Schema.decodeUnknownSync(SharedChurn02.configSchema)(
      SharedChurn02.defaultConfig,
    )
    const factorLedger = registered?.factorLedger?.({} as SharedChurn02Output)

    expect(SharedChurn02).toMatchObject({
      id: "SHARED-CHURN-02-recency-weighted-churn",
      title: "Recency-weighted churn",
      aliases: ["SHARED-CHURN-02"],
      tier: 1,
      category: "review-pain",
      kind: "legibility",
      cacheVersion: "exponential-decay-normalized-history-v1",
      cacheDependencies: ["git-revision-context"],
      inputs: [],
    })
    expect(decoded).toEqual(SharedChurn02.defaultConfig)
    expect(SharedChurn02.defaultConfig.include_extensions).toEqual([
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".rs",
    ])
    expect(registered?.id).toBe(SharedChurn02.id)
    expect(registered?.cacheVersion).toContain(SharedChurn02.cacheVersion)
    expect(registry.byId.get("SHARED-CHURN-02")?.id).toBe(SharedChurn02.id)
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
        path: "config.half_life_days",
        value: 14,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.max_commits",
        value: 500,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.include_extensions",
        value: SharedChurn02.defaultConfig.include_extensions,
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
  })

  test("weights recent touches more heavily while preserving raw churn facts", async () => {
    const repo = await createRepo("pulsar-shared-churn-02-")
    try {
      await repo.write("src/old.ts", "export const oldValue = 1\n")
      await repo.commitAll({ message: "old", dateIso: "2024-02-01T00:00:00Z" })
      await repo.write("src/new.ts", "export const newValue = 1\n")
      await repo.commitAll({ message: "new", dateIso: "2024-03-01T00:00:00Z" })

      const output = await runWeightedChurn(repo, { half_life_days: 14 })
      const oldChurn = output.byFile.get(join(repo.root, "src/old.ts"))
      const newChurn = output.byFile.get(join(repo.root, "src/new.ts"))

      expect(oldChurn?.rawWindowChurn).toBe(1)
      expect(newChurn?.rawWindowChurn).toBe(1)
      expect(newChurn?.weightedChurn).toBeCloseTo(1, 6)
      expect(newChurn?.weightedChurn).toBeGreaterThan(oldChurn?.weightedChurn ?? 0)
      expect(newChurn?.lastTouchedAt).toBe("2024-03-01T00:00:00.000Z")
      expect(output.windowDays).toBe(90)
      expect(output.halfLifeDays).toBe(14)
      expect(output.totalCommits).toBe(2)
      expect(output.sampled).toBe(false)
      expect(SharedChurn02.score(output)).toBe(1)
      expect(SharedChurn02.outputMetadata?.(output)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await repo.cleanup()
    }
  })

  test("half-life config changes the deterministic weighted output", async () => {
    const repo = await createRepo("pulsar-shared-churn-02-half-life-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({ message: "a", dateIso: "2024-02-01T00:00:00Z" })
      await repo.write("src/head.ts", "export const head = 1\n")
      await repo.commitAll({ message: "head", dateIso: "2024-03-01T00:00:00Z" })

      const shortHalfLife = await runWeightedChurn(repo, { half_life_days: 7 })
      const longHalfLife = await runWeightedChurn(repo, { half_life_days: 28 })
      const file = join(repo.root, "src/a.ts")
      expect(longHalfLife.byFile.get(file)?.weightedChurn).toBeGreaterThan(
        shortHalfLife.byFile.get(file)?.weightedChurn ?? 0,
      )
    } finally {
      await repo.cleanup()
    }
  })

  test("includes TS module extensions while excluding generated, test, and configured paths", async () => {
    const repo = await createRepo("pulsar-shared-churn-02-filter-")
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
      await repo.write("src/_generated/api.ts", "export const generated = 1\n")
      await repo.write("src/skip.ts", "export const skip = 1\n")
      await repo.commitAll({ message: "mixed files", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runWeightedChurn(repo, {
        exclude_globs: [...SharedChurn02.defaultConfig.exclude_globs, "**/skip.ts"],
      })

      expect(normalizedWeightedChurn(repo, output).map(([file]) => file)).toEqual([
        "$ROOT/src/app.tsx",
        "$ROOT/src/common.cts",
        "$ROOT/src/lib.rs",
        "$ROOT/src/module.mts",
        "$ROOT/src/mydist/a.ts",
      ])
      expect(output.totalCommits).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("clean negative filters produce empty provider facts", async () => {
    const repo = await createRepo("pulsar-shared-churn-02-negative-")
    try {
      await repo.write("src/old.ts", "export const oldValue = 1\n")
      await repo.commitAll({ message: "old", dateIso: "2024-01-01T00:00:00Z" })
      await repo.write("README.md", "# docs\n")
      await repo.commitAll({ message: "docs", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runWeightedChurn(repo, { window_days: 30 })

      expect(output.byFile.size).toBe(0)
      expect(output.totalCommits).toBe(0)
      expect(output.sampled).toBe(false)
      expect(SharedChurn02.score(output)).toBe(1)
      expect(SharedChurn02.diagnose(output)).toEqual([])
      expect(SharedChurn02.outputMetadata?.(output)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await repo.cleanup()
    }
  })

  test("empty include extensions return empty facts without counting unrelated commits", async () => {
    const repo = await createRepo("pulsar-shared-churn-02-empty-ext-")
    try {
      await repo.write("README.md", "# docs\n")
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({ message: "mixed", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runWeightedChurn(repo, { include_extensions: [] })

      expect(output.byFile.size).toBe(0)
      expect(output.totalCommits).toBe(0)
      expect(output.sampled).toBe(false)
    } finally {
      await repo.cleanup()
    }
  })

  test("max commits bounds history and marks sampled output", async () => {
    const repo = await createRepo("pulsar-shared-churn-02-sampled-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({ message: "a", dateIso: "2024-03-01T00:00:00Z" })
      await repo.write("src/b.ts", "export const b = 1\n")
      await repo.commitAll({ message: "b", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runWeightedChurn(repo, { max_commits: 1 })

      expect(normalizedWeightedChurn(repo, output).map(([file]) => file)).toEqual([
        "$ROOT/src/b.ts",
      ])
      expect(output.totalCommits).toBe(1)
      expect(output.maxCommits).toBe(1)
      expect(output.sampled).toBe(true)
    } finally {
      await repo.cleanup()
    }
  })

  test("normalizes invalid config before running git and reporting output", async () => {
    const repo = await createRepo("pulsar-shared-churn-02-normalized-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({ message: "a", dateIso: "2024-04-01T00:00:00Z" })

      const output = await runWeightedChurn(repo, {
        window_days: Number.NaN,
        half_life_days: Number.NEGATIVE_INFINITY,
        max_commits: Number.NEGATIVE_INFINITY,
        top_n_diagnostics: Number.NaN,
      })

      expect(output.windowDays).toBe(SharedChurn02.defaultConfig.window_days)
      expect(output.halfLifeDays).toBe(SharedChurn02.defaultConfig.half_life_days)
      expect(output.maxCommits).toBe(SharedChurn02.defaultConfig.max_commits)
      expect(output.topDiagnostics).toBe(0)
      expect(normalizedWeightedChurn(repo, output).map(([file]) => file)).toEqual([
        "$ROOT/src/a.ts",
      ])
    } finally {
      await repo.cleanup()
    }
  })

  test("diagnostics expose ordered weighted churn payloads and caps", () => {
    const output: SharedChurn02Output = {
      byFile: new Map([
        ["src/b.ts", churn({ weightedChurn: 2 })],
        ["src/a.ts", churn({ weightedChurn: 2 })],
        ["src/c.ts", churn({ weightedChurn: 1 })],
      ]),
      windowDays: 90,
      halfLifeDays: 14,
      totalCommits: 3,
      maxCommits: 500,
      sampled: false,
      topDiagnostics: 3,
      compositeConsumers: ["risk hotspot"],
      cacheContributors: ["git-revision-context"],
      calibrationSurface: "config thresholds only; downstream composites decide risk meaning",
      enforcementCeiling: ["soft-warning", "trend"],
    }

    const diagnostics = SharedChurn02.diagnose(output)

    expect(diagnostics.map((diagnostic) => diagnostic.location?.file)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ])
    expect(diagnostics.map((diagnostic) => diagnostic.severity)).toEqual([
      "warn",
      "warn",
      "info",
    ])
    expect(diagnostics[0]).toMatchObject({
      severity: "warn",
      message: "Recency-weighted churn: src/a.ts has 2.00 weighted touches (1 raw)",
      data: expect.objectContaining({ weightedChurn: 2, rawWindowChurn: 1 }),
    })
    expect(SharedChurn02.diagnose({ ...output, topDiagnostics: 2 })).toHaveLength(2)
  })

  test("rename history and equivalent repositories produce deterministic output", async () => {
    const renameRepo = await createRepo("pulsar-shared-churn-02-rename-")
    const left = await createRepo("pulsar-shared-churn-02-left-")
    const right = await createRepo("pulsar-shared-churn-02-right-")
    try {
      await renameRepo.write("src/original.ts", "export const value = 1\n")
      await renameRepo.commitAll({ message: "original", dateIso: "2024-03-01T00:00:00Z" })
      await renameRepo.rename("src/original.ts", "src/renamed.ts", {
        message: "rename",
        dateIso: "2024-04-01T00:00:00Z",
      })
      const renameOutput = await runWeightedChurn(renameRepo)
      expect(normalizedWeightedChurn(renameRepo, renameOutput).map(([file]) => file)).toEqual([
        "$ROOT/src/original.ts",
        "$ROOT/src/renamed.ts",
      ])

      for (const repo of [left, right]) {
        await repo.write("src/a.ts", "export const a = 1\n")
        await repo.commitAll({ message: "a", dateIso: "2024-03-01T00:00:00Z" })
        await repo.write("src/a.ts", "export const a = 2\n")
        await repo.commitAll({ message: "a again", dateIso: "2024-04-01T00:00:00Z" })
      }

      const leftOutput = await runWeightedChurn(left)
      const rightOutput = await runWeightedChurn(right)
      expect(leftOutput.byFile.get(join(left.root, "src/a.ts"))?.rawWindowChurn).toBe(2)
      expect(normalizedWeightedChurn(left, leftOutput)).toEqual(
        normalizedWeightedChurn(right, rightOutput),
      )
      expect({
        windowDays: leftOutput.windowDays,
        halfLifeDays: leftOutput.halfLifeDays,
        totalCommits: leftOutput.totalCommits,
        maxCommits: leftOutput.maxCommits,
        sampled: leftOutput.sampled,
      }).toEqual({
        windowDays: rightOutput.windowDays,
        halfLifeDays: rightOutput.halfLifeDays,
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

const churn = (
  overrides: Partial<SharedChurn02Output["byFile"] extends ReadonlyMap<string, infer Value> ? Value : never>,
): SharedChurn02Output["byFile"] extends ReadonlyMap<string, infer Value> ? Value : never => ({
  touchCount: 1,
  rawWindowChurn: 1,
  weightedChurn: 1,
  lastTouchedAt: "2024-04-01T00:00:00.000Z",
  ...overrides,
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
