import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { SignalContextTag, summarize } from "@skastr0/pulsar-core/signal"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Layer, Schema } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import { Shared03ChurnRate, type Shared03ChurnRateOutput } from "../index.js"

interface CommitOptions {
  readonly message: string
  readonly authorName?: string
  readonly authorEmail?: string
  readonly dateIso: string
}

interface GitFixture {
  readonly root: string
  readonly write: (relativePath: string, content: string) => Promise<void>
  readonly commitAll: (options: CommitOptions) => Promise<string>
  readonly rename: (
    fromRelativePath: string,
    toRelativePath: string,
    options: CommitOptions,
  ) => Promise<string>
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

const sourceLines = (label: string, count = 10): string =>
  Array.from({ length: count }, (_, index) => `export const ${label}${index} = ${index}`).join(
    "\n",
  ) + "\n"

const runChurnRate = async (
  repo: GitFixture,
  config: Partial<typeof Shared03ChurnRate.defaultConfig> = {},
): Promise<Shared03ChurnRateOutput> =>
  Effect.runPromise(
    Shared03ChurnRate.compute(
      { ...Shared03ChurnRate.defaultConfig, ...config },
      new Map(),
    ).pipe(
      Effect.provide(
        Layer.succeed(SignalContextTag, {
          gitSha: repo.revParse("HEAD"),
          worktreePath: repo.root,
          changedHunks: [],
        }),
      ),
    ) as Effect.Effect<Shared03ChurnRateOutput, any, never>,
  )

const normalizedFiles = (
  repo: GitFixture,
  output: Shared03ChurnRateOutput,
): ReadonlyArray<string> =>
  [...output.byFile.keys()]
    .map((file) => file.replace(repo.root, "$ROOT"))
    .sort((left, right) => left.localeCompare(right))

describe("SHARED-03 churn rate", () => {
  test("declares identity, pack registration, config schema, cache, and factor ledger", async () => {
    const packRegistered = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-03"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("SHARED-03")
    const decoded = Schema.decodeUnknownSync(Shared03ChurnRate.configSchema)(
      Shared03ChurnRate.defaultConfig,
    )
    const factorLedger = registered?.factorLedger?.({} as Shared03ChurnRateOutput)

    expect(Shared03ChurnRate).toMatchObject({
      id: "SHARED-03-churn-rate",
      title: "Churn rate",
      aliases: ["SHARED-03"],
      tier: 1.5,
      category: "review-pain",
      kind: "legibility",
      cacheVersion: "applicability-v4-deleted-files-excluded",
      cacheDependencies: ["git-revision-context"],
      inputs: [],
    })
    expect(decoded).toEqual(Shared03ChurnRate.defaultConfig)
    expect(Shared03ChurnRate.defaultConfig.include_extensions).toEqual([
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".rs",
    ])
    expect(registered?.id).toBe(Shared03ChurnRate.id)
    expect(registered?.cacheVersion).toContain(Shared03ChurnRate.cacheVersion)
    expect(registry.byId.get("SHARED-03")?.id).toBe(Shared03ChurnRate.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.window_days",
        value: 14,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.similarity_threshold",
        value: 0.8,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.include_extensions",
        value: Shared03ChurnRate.defaultConfig.include_extensions,
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
  })

  test("computes mature line churn pressure from real git history", async () => {
    const repo = await createRepo("pulsar-shared-03-")
    try {
      await repo.write("src/rewrite.ts", sourceLines("line", 10))
      await repo.commitAll({
        message: "introduce lines",
        dateIso: "2024-01-01T00:00:00Z",
      })
      await repo.write("src/rewrite.ts", sourceLines("line", 9))
      await repo.commitAll({
        message: "remove one mature line",
        dateIso: "2024-01-05T00:00:00Z",
      })
      await repo.write("README.md", "advance\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await runChurnRate(repo)
      const filePath = join(repo.root, "src/rewrite.ts")

      expect(output.insufficientHistory).toBe(false)
      expect(output.churnRate).toBe(0.1)
      expect(output.byFile.get(filePath)).toEqual({
        introduced: 10,
        churned: 1,
        rate: 0.1,
      })
      expect(output.effectiveFiles?.[0]).toMatchObject({
        file: filePath,
        visible: true,
        severity: "info",
      })
      expect(output.effectiveFiles?.[0]?.penaltyWeight).toBeCloseTo(1 / 3)
      expect(output.topDiagnostics).toBe(10)
      expect(Shared03ChurnRate.score(output)).toBeCloseTo(2 / 3)
      expect(Shared03ChurnRate.outputMetadata?.(output)).toBeUndefined()
      expect(Shared03ChurnRate.diagnose(output)[0]?.message).toContain("Recent churn candidate")
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("stable mature lines stay score-neutral for the same substrate", async () => {
    const stable = await createRepo("pulsar-shared-03-stable-")
    const noisy = await createRepo("pulsar-shared-03-noisy-")
    try {
      await stable.write("src/service.ts", sourceLines("stable", 10))
      await stable.commitAll({
        message: "introduce stable lines",
        dateIso: "2024-01-01T00:00:00Z",
      })
      await stable.write("README.md", "advance\n")
      await stable.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      await noisy.write("src/service.ts", sourceLines("noisy", 10))
      await noisy.commitAll({
        message: "introduce noisy lines",
        dateIso: "2024-01-01T00:00:00Z",
      })
      await noisy.write("src/service.ts", sourceLines("noisy", 7))
      await noisy.commitAll({
        message: "remove three mature lines",
        dateIso: "2024-01-05T00:00:00Z",
      })
      await noisy.write("README.md", "advance\n")
      await noisy.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const stableOutput = await runChurnRate(stable)
      const noisyOutput = await runChurnRate(noisy)

      expect(stableOutput.churnRate).toBe(0)
      expect(Shared03ChurnRate.score(stableOutput)).toBe(1)
      expect(noisyOutput.churnRate).toBe(0.3)
      expect(Shared03ChurnRate.score(noisyOutput)).toBeLessThan(
        Shared03ChurnRate.score(stableOutput),
      )
      expect(Shared03ChurnRate.score(noisyOutput)).toBe(0)
    } finally {
      await stable.cleanup()
      await noisy.cleanup()
    }
  }, 120_000)

  test("includes TS module and Rust extensions while excluding generated, test, and configured paths", async () => {
    const repo = await createRepo("pulsar-shared-03-filter-")
    try {
      await repo.write("src/module.mts", sourceLines("module", 3))
      await repo.write("src/common.cts", sourceLines("common", 3))
      await repo.write("src/view.tsx", sourceLines("view", 3))
      await repo.write("src/lib.rs", sourceLines("rust", 3))
      await repo.write("dist/out.ts", sourceLines("dist", 3))
      await repo.write("target/lib.rs", sourceLines("target", 3))
      await repo.write("src/a.test.ts", sourceLines("test", 3))
      await repo.write("src/module.test.mts", sourceLines("moduleTest", 3))
      await repo.write("src/common.spec.cts", sourceLines("commonSpec", 3))
      await repo.write("src/auto.generated.mts", sourceLines("generatedMts", 3))
      await repo.write("src/auto.gen.cts", sourceLines("generatedCts", 3))
      await repo.write("src/_generated/api.ts", sourceLines("generated", 3))
      await repo.write("src/skip.ts", sourceLines("skip", 3))
      await repo.commitAll({
        message: "mixed mature files",
        dateIso: "2024-01-01T00:00:00Z",
      })
      await repo.write("README.md", "advance\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await runChurnRate(repo, {
        exclude_globs: [...Shared03ChurnRate.defaultConfig.exclude_globs, "**/skip.ts"],
      })

      expect(normalizedFiles(repo, output)).toEqual([
        "$ROOT/src/common.cts",
        "$ROOT/src/lib.rs",
        "$ROOT/src/module.mts",
        "$ROOT/src/view.tsx",
      ])
      expect(output.introducedLineCount).toBe(12)
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("clean negative filters produce insufficient evidence instead of pressure", async () => {
    const repo = await createRepo("pulsar-shared-03-clean-")
    try {
      await repo.write("README.md", "docs only\n")
      await repo.write("src/only.test.ts", sourceLines("test", 3))
      await repo.commitAll({
        message: "non-production mature lines",
        dateIso: "2024-01-01T00:00:00Z",
      })
      await repo.write("README.md", "advance\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await runChurnRate(repo)

      expect(output.insufficientHistory).toBe(true)
      expect(output.byFile.size).toBe(0)
      expect(Shared03ChurnRate.score(output)).toBe(1)
      expect(Shared03ChurnRate.outputMetadata?.(output)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(Shared03ChurnRate.diagnose(output)[0]?.severity).toBe("info")
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("empty include extensions return empty facts without walking unrelated history", async () => {
    const repo = await createRepo("pulsar-shared-03-empty-include-")
    try {
      for (let index = 0; index < 3; index += 1) {
        await repo.write("src/service.ts", sourceLines(`service${index}`, 3))
        await repo.commitAll({
          message: `source ${index}`,
          dateIso: `2024-01-0${index + 1}T00:00:00Z`,
        })
      }
      await repo.write("README.md", "advance\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await runChurnRate(repo, {
        include_extensions: [],
        max_mature_commits: 1,
      })

      expect(output.insufficientHistory).toBe(true)
      expect(output.introducedLineCount).toBe(0)
      expect(output.byFile.size).toBe(0)
      expect(output.skippedReason).toContain("no included source extensions")
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("max mature commits sample source history, not docs-only commits", async () => {
    const repo = await createRepo("pulsar-shared-03-source-cap-")
    try {
      await repo.write("src/source.ts", sourceLines("source", 3))
      await repo.commitAll({
        message: "introduce source",
        dateIso: "2024-01-01T00:00:00Z",
      })
      for (let index = 0; index < 3; index += 1) {
        await repo.write("README.md", `docs ${index}\n`)
        await repo.commitAll({
          message: `docs ${index}`,
          dateIso: `2024-01-0${index + 2}T00:00:00Z`,
        })
      }
      await repo.write("README.md", "advance\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await runChurnRate(repo, { max_mature_commits: 1 })

      expect(output.insufficientHistory).toBe(false)
      expect(output.byFile.get(join(repo.root, "src/source.ts"))).toEqual({
        introduced: 3,
        churned: 0,
        rate: 0,
      })
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("deleted mature files leave the churn ratio and surface as a count", async () => {
    const repo = await createRepo("pulsar-shared-03-deleted-")
    try {
      await repo.write("src/deleted.ts", sourceLines("deleted", 3))
      await repo.commitAll({
        message: "introduce deleted file",
        dateIso: "2024-01-01T00:00:00Z",
      })
      await rm(join(repo.root, "src/deleted.ts"))
      await repo.commitAll({
        message: "delete file",
        dateIso: "2024-01-05T00:00:00Z",
      })
      await repo.write("README.md", "advance\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await runChurnRate(repo)

      // Whole-file deletion is cleanup, not rework: the file is excluded
      // from the ratio (no diagnostic can cite the nonexistent path) and
      // reported through deletedFileCount instead.
      expect(output.byFile.get(join(repo.root, "src/deleted.ts"))).toBeUndefined()
      expect(output.deletedFileCount).toBe(1)
      expect(output.insufficientHistory).toBe(true)
      expect(Shared03ChurnRate.score(output)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("rename and edit in the same mature commit preserves old-path evidence", async () => {
    const repo = await createRepo("pulsar-shared-03-rename-edit-")
    try {
      await repo.write("src/original.ts", sourceLines("rename", 10))
      await repo.commitAll({
        message: "introduce original file",
        dateIso: "2024-01-01T00:00:00Z",
      })
      git(repo.root, ["mv", "src/original.ts", "src/renamed.ts"])
      await repo.write(
        "src/renamed.ts",
        sourceLines("rename", 9) + "export const replacement = 999\n",
      )
      await repo.commitAll({
        message: "rename and edit",
        dateIso: "2024-01-05T00:00:00Z",
      })
      await repo.write("README.md", "advance\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await runChurnRate(repo)

      expect(output.byFile.has(join(repo.root, "src/original.ts"))).toBe(false)
      expect(output.byFile.get(join(repo.root, "src/renamed.ts"))).toEqual({
        introduced: 11,
        churned: 1,
        rate: 1 / 11,
      })
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("normalizes invalid config before matching lines and reporting diagnostics", async () => {
    const repo = await createRepo("pulsar-shared-03-normalized-")
    try {
      await repo.write("src/rewrite.ts", sourceLines("line", 5))
      await repo.commitAll({
        message: "introduce lines",
        dateIso: "2024-01-01T00:00:00Z",
      })
      await repo.write("src/rewrite.ts", sourceLines("line", 4))
      await repo.commitAll({
        message: "remove one line",
        dateIso: "2024-01-05T00:00:00Z",
      })
      await repo.write("README.md", "advance\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await runChurnRate(repo, {
        window_days: -1,
        max_mature_commits: Number.NaN,
        similarity_threshold: 0,
        top_n_diagnostics: -10,
      })

      expect(output.windowDays).toBe(Shared03ChurnRate.defaultConfig.window_days)
      expect(output.topDiagnostics).toBe(0)
      expect(output.byFile.get(join(repo.root, "src/rewrite.ts"))?.churned).toBe(1)
      expect(Shared03ChurnRate.score(output)).toBeGreaterThanOrEqual(0)
      expect(Shared03ChurnRate.score(output)).toBeLessThanOrEqual(1)
      expect(Shared03ChurnRate.diagnose(output)).toEqual([])
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("diagnostics expose ordered churn payloads and caps", () => {
    const root = "/repo"
    const output: Shared03ChurnRateOutput = {
      churnedLineCount: 15,
      introducedLineCount: 40,
      churnRate: 0.375,
      windowDays: 14,
      topDiagnostics: 2,
      insufficientHistory: false,
      byFile: new Map([
        [join(root, "tiny.ts"), { introduced: 1, churned: 1, rate: 1 }],
        [join(root, "stable.ts"), { introduced: 100, churned: 0, rate: 0 }],
        [join(root, "large.ts"), { introduced: 30, churned: 10, rate: 1 / 3 }],
        [join(root, "medium.ts"), { introduced: 9, churned: 4, rate: 4 / 9 }],
      ]),
    }

    const diagnostics = Shared03ChurnRate.diagnose(output)

    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.map((diagnostic) => diagnostic.location?.file)).toEqual([
      join(root, "large.ts"),
      join(root, "medium.ts"),
    ])
    expect(diagnostics[0]?.message).toContain("33% file churn")
    expect(diagnostics[0]?.message).toContain("38% repo churn")
    expect(diagnostics[0]?.data).toMatchObject({
      introduced: 30,
      churned: 10,
      rate: 1 / 3,
      repoIntroduced: 40,
      repoChurned: 15,
      repoRate: 0.375,
    })
  })

  test("equivalent repositories produce deterministic output", async () => {
    const left = await createRepo("pulsar-shared-03-left-")
    const right = await createRepo("pulsar-shared-03-right-")
    try {
      for (const repo of [left, right]) {
        await repo.write("src/rewrite.ts", sourceLines("line", 5))
        await repo.commitAll({
          message: "introduce lines",
          dateIso: "2024-01-01T00:00:00Z",
        })
        await repo.write("src/rewrite.ts", sourceLines("line", 4))
        await repo.commitAll({
          message: "remove one line",
          dateIso: "2024-01-05T00:00:00Z",
        })
        await repo.write("README.md", "advance\n")
        await repo.commitAll({
          message: "advance head",
          dateIso: "2024-01-20T00:00:00Z",
        })
      }

      const leftOutput = await runChurnRate(left)
      const rightOutput = await runChurnRate(right)

      expect({
        churnedLineCount: leftOutput.churnedLineCount,
        introducedLineCount: leftOutput.introducedLineCount,
        churnRate: leftOutput.churnRate,
        byFile: normalizedFiles(left, leftOutput),
        byFileSummary: summarize([...leftOutput.byFile.values()].map((entry) => entry.rate)),
      }).toEqual({
        churnedLineCount: rightOutput.churnedLineCount,
        introducedLineCount: rightOutput.introducedLineCount,
        churnRate: rightOutput.churnRate,
        byFile: normalizedFiles(right, rightOutput),
        byFileSummary: summarize([...rightOutput.byFile.values()].map((entry) => entry.rate)),
      })
    } finally {
      await left.cleanup()
      await right.cleanup()
    }
  }, 120_000)
})

const commitEnv = (options: CommitOptions): Record<string, string> => {
  const authorName = options.authorName ?? "Pulsar Test"
  const authorEmail = options.authorEmail ?? "test@example.com"

  return {
    ...process.env,
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: authorName,
    GIT_COMMITTER_EMAIL: authorEmail,
    GIT_AUTHOR_DATE: options.dateIso,
    GIT_COMMITTER_DATE: options.dateIso,
  } as Record<string, string>
}

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
