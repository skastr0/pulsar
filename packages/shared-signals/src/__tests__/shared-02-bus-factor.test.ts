import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { SignalContextTag, summarize } from "@skastr0/pulsar-core/signal"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Layer, Schema } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import { Shared02BusFactor, type Shared02BusFactorOutput } from "../index.js"

interface CommitOptions {
  readonly message: string
  readonly authorName: string
  readonly authorEmail?: string
  readonly dateIso: string
}

interface GitFixture {
  readonly root: string
  readonly write: (relativePath: string, content: string) => Promise<void>
  readonly writeJson: (relativePath: string, value: unknown) => Promise<void>
  readonly commitAll: (options: CommitOptions) => Promise<string>
  readonly rename: (fromRelativePath: string, toRelativePath: string, options: CommitOptions) => Promise<string>
  readonly revParse: (ref: string) => string
  readonly cleanup: () => Promise<void>
}

const longFile = (label: string, lineCount = 60): string =>
  Array.from({ length: lineCount }, (_, index) => `export const ${label}${index} = ${index}`).join(
    "\n",
  ) + "\n"

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
    writeJson: async (relativePath, value) => {
      const fullPath = join(root, relativePath)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, JSON.stringify(value, null, 2), "utf8")
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

const runBusFactor = async (
  repo: GitFixture,
  config: Partial<typeof Shared02BusFactor.defaultConfig> = {},
): Promise<Shared02BusFactorOutput> =>
  Effect.runPromise(
    Shared02BusFactor.compute(
      { ...Shared02BusFactor.defaultConfig, ...config },
      new Map(),
    ).pipe(
      Effect.provide(
        Layer.succeed(SignalContextTag, {
          gitSha: repo.revParse("HEAD"),
          worktreePath: repo.root,
          changedHunks: [],
        }),
      ),
    ) as Effect.Effect<Shared02BusFactorOutput, any, never>,
  )

const normalizedFiles = (
  repo: GitFixture,
  output: Shared02BusFactorOutput,
): ReadonlyArray<string> =>
  [...output.byFile.keys()]
    .map((file) => file.replace(repo.root, "$ROOT"))
    .sort((left, right) => left.localeCompare(right))

describe("SHARED-02 bus factor", () => {
  test("declares identity, pack registration, config schema, cache, and factor ledger", async () => {
    const packRegistered = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-02"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("SHARED-02")
    const decoded = Schema.decodeUnknownSync(Shared02BusFactor.configSchema)(
      Shared02BusFactor.defaultConfig,
    )
    const factorLedger = registered?.factorLedger?.({} as Shared02BusFactorOutput)

    expect(Shared02BusFactor).toMatchObject({
      id: "SHARED-02-bus-factor",
      title: "Bus factor",
      aliases: ["SHARED-02"],
      tier: 1.5,
      category: "review-pain",
      kind: "legibility",
      cacheVersion: "bounded-history-v5-normalized-config-git-context-factor-policy",
      cacheDependencies: ["git-revision-context"],
      inputs: [],
    })
    expect(decoded).toEqual(Shared02BusFactor.defaultConfig)
    expect(Shared02BusFactor.defaultConfig.include_extensions).toEqual([
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".rs",
    ])
    expect(registered?.id).toBe(Shared02BusFactor.id)
    expect(registered?.cacheVersion).toContain(Shared02BusFactor.cacheVersion)
    expect(registry.byId.get("SHARED-02")?.id).toBe(Shared02BusFactor.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.window_days",
        value: 180,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.min_loc",
        value: 50,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.include_extensions",
        value: Shared02BusFactor.defaultConfig.include_extensions,
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
  })

  test("computes single-author ownership pressure from real git history", async () => {
    const repo = await createRepo("pulsar-shared-02-")
    try {
      await repo.write("src/solo.ts", longFile("solo"))
      await repo.commitAll({
        message: "solo",
        authorName: "Alice",
        dateIso: "2024-04-01T00:00:00Z",
      })

      const output = await runBusFactor(repo)
      const soloPath = join(repo.root, "src/solo.ts")

      expect(output.touchedFileCount).toBe(1)
      expect(output.byFile.get(soloPath)).toEqual({
        busFactor: 1,
        primaryAuthor: "Alice",
        primaryShare: 1,
        authors: ["Alice"],
        loc: 60,
      })
      expect(output.siloed).toEqual([{ file: soloPath, author: "Alice", loc: 60 }])
      expect(output.effectiveSiloed?.[0]).toMatchObject({
        file: soloPath,
        visible: true,
        severity: "info",
        penaltyWeight: 0.45,
      })
      expect(output.topDiagnostics).toBe(10)
      expect(Shared02BusFactor.score(output)).toBe(0.65)
      expect(Shared02BusFactor.outputMetadata?.(output)).toBeUndefined()
      expect(Shared02BusFactor.diagnose(output)[0]?.message).toContain("single-author corpus")
    } finally {
      await repo.cleanup()
    }
  })

  test("multi-author ownership removes silo pressure for the same file", async () => {
    const solo = await createRepo("pulsar-shared-02-solo-")
    const shared = await createRepo("pulsar-shared-02-shared-")
    try {
      await solo.write("src/service.ts", longFile("service"))
      await solo.commitAll({
        message: "solo service",
        authorName: "Alice",
        dateIso: "2024-04-01T00:00:00Z",
      })

      await shared.write("src/service.ts", longFile("service"))
      await shared.commitAll({
        message: "alice service",
        authorName: "Alice",
        dateIso: "2024-04-01T00:00:00Z",
      })
      await shared.write("src/service.ts", longFile("service") + "export const bob = 1\n")
      await shared.commitAll({
        message: "bob service",
        authorName: "Bob",
        dateIso: "2024-04-02T00:00:00Z",
      })

      const soloOutput = await runBusFactor(solo)
      const sharedOutput = await runBusFactor(shared)

      expect(soloOutput.siloed).toHaveLength(1)
      expect(sharedOutput.siloed).toEqual([])
      expect(sharedOutput.repoAuthors).toEqual(["Alice", "Bob"])
      expect(sharedOutput.byFile.get(join(shared.root, "src/service.ts"))?.busFactor).toBe(2)
      expect(Shared02BusFactor.score(sharedOutput)).toBeGreaterThan(
        Shared02BusFactor.score(soloOutput),
      )
      expect(Shared02BusFactor.score(sharedOutput)).toBe(1)
    } finally {
      await solo.cleanup()
      await shared.cleanup()
    }
  })

  test("includes TS module and Rust extensions while excluding generated, test, and configured paths", async () => {
    const repo = await createRepo("pulsar-shared-02-filter-")
    try {
      await repo.write("src/module.mts", longFile("module"))
      await repo.write("src/common.cts", longFile("common"))
      await repo.write("src/app.tsx", longFile("app"))
      await repo.write("src/lib.rs", longFile("rust"))
      await repo.write("src/mydist/a.ts", longFile("mydist"))
      await repo.write("dist/out.ts", longFile("dist"))
      await repo.write("target/lib.rs", longFile("target"))
      await repo.write("src/a.test.ts", longFile("test"))
      await repo.write("src/module.test.mts", longFile("moduleTest"))
      await repo.write("src/common.spec.cts", longFile("commonSpec"))
      await repo.write("src/auto.generated.mts", longFile("generatedMts"))
      await repo.write("src/auto.gen.cts", longFile("generatedCts"))
      await repo.write("src/_generated/api.ts", longFile("generated"))
      await repo.write("src/skip.ts", longFile("skip"))
      await repo.commitAll({
        message: "mixed files",
        authorName: "Alice",
        dateIso: "2024-04-01T00:00:00Z",
      })

      const output = await runBusFactor(repo, {
        exclude_globs: [...Shared02BusFactor.defaultConfig.exclude_globs, "**/skip.ts"],
      })

      expect(normalizedFiles(repo, output)).toEqual([
        "$ROOT/src/app.tsx",
        "$ROOT/src/common.cts",
        "$ROOT/src/lib.rs",
        "$ROOT/src/module.mts",
        "$ROOT/src/mydist/a.ts",
      ])
    } finally {
      await repo.cleanup()
    }
  })

  test("clean negative filters produce insufficient evidence instead of pressure", async () => {
    const repo = await createRepo("pulsar-shared-02-negative-")
    try {
      await repo.write("src/old.ts", longFile("old"))
      await repo.commitAll({
        message: "old source",
        authorName: "Alice",
        dateIso: "2024-01-01T00:00:00Z",
      })
      await repo.write("README.md", "# docs\n")
      await repo.commitAll({
        message: "docs",
        authorName: "Bob",
        dateIso: "2024-04-01T00:00:00Z",
      })

      const output = await runBusFactor(repo, { window_days: 30 })

      expect(output.touchedFileCount).toBe(0)
      expect(output.touchedLoc).toBe(0)
      expect(output.siloed).toEqual([])
      expect(output.effectiveSiloed).toEqual([])
      expect(Shared02BusFactor.score(output)).toBe(1)
      expect(Shared02BusFactor.outputMetadata?.(output)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(Shared02BusFactor.diagnose(output)[0]?.message).toContain("no relevant files")
    } finally {
      await repo.cleanup()
    }
  })

  test("empty include extensions return empty facts without walking history", async () => {
    const repo = await createRepo("pulsar-shared-02-empty-ext-")
    try {
      await repo.write("src/a.ts", longFile("a"))
      await repo.commitAll({
        message: "source",
        authorName: "Alice",
        dateIso: "2024-04-01T00:00:00Z",
      })

      const output = await runBusFactor(repo, { include_extensions: [] })

      expect(output.touchedFileCount).toBe(0)
      expect(output.touchedLoc).toBe(0)
      expect(output.topDiagnostics).toBe(Shared02BusFactor.defaultConfig.top_n_diagnostics)
      expect(Shared02BusFactor.score(output)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("max commits bounds history to the newest author evidence", async () => {
    const repo = await createRepo("pulsar-shared-02-sampled-")
    try {
      await repo.write("src/owned.ts", longFile("owned"))
      await repo.commitAll({
        message: "alice owns",
        authorName: "Alice",
        dateIso: "2024-03-01T00:00:00Z",
      })
      await repo.write("src/owned.ts", longFile("owned") + "export const bob = 1\n")
      await repo.commitAll({
        message: "bob newest",
        authorName: "Bob",
        dateIso: "2024-04-01T00:00:00Z",
      })

      const output = await runBusFactor(repo, { max_commits: 1 })

      expect(output.maxCommits).toBe(1)
      expect(output.byFile.get(join(repo.root, "src/owned.ts"))?.authors).toEqual(["Bob"])
      expect(output.repoAuthors).toEqual(["Bob"])
    } finally {
      await repo.cleanup()
    }
  })

  test("max commits sample the newest relevant source commit, not docs-only commits", async () => {
    const repo = await createRepo("pulsar-shared-02-source-sampled-")
    try {
      await repo.write("src/owned.ts", longFile("owned"))
      await repo.commitAll({
        message: "source",
        authorName: "Alice",
        dateIso: "2024-03-01T00:00:00Z",
      })
      await repo.write("README.md", "# docs\n")
      await repo.commitAll({
        message: "docs",
        authorName: "Bob",
        dateIso: "2024-04-01T00:00:00Z",
      })

      const output = await runBusFactor(repo, { max_commits: 1 })

      expect(normalizedFiles(repo, output)).toEqual(["$ROOT/src/owned.ts"])
      expect(output.byFile.get(join(repo.root, "src/owned.ts"))?.authors).toEqual(["Alice"])
      expect(output.repoAuthors).toEqual(["Alice"])
    } finally {
      await repo.cleanup()
    }
  })

  test("rename-only commits do not create ownership evidence for the renamer", async () => {
    const repo = await createRepo("pulsar-shared-02-rename-")
    try {
      await repo.write("src/original.ts", longFile("original"))
      await repo.commitAll({
        message: "source",
        authorName: "Alice",
        dateIso: "2024-03-01T00:00:00Z",
      })
      await repo.rename("src/original.ts", "src/renamed.ts", {
        message: "rename",
        authorName: "Bob",
        dateIso: "2024-04-01T00:00:00Z",
      })

      const output = await runBusFactor(repo)

      expect(normalizedFiles(repo, output)).toEqual(["$ROOT/src/renamed.ts"])
      expect(output.byFile.get(join(repo.root, "src/renamed.ts"))?.authors).toEqual(["Alice"])
      expect(output.repoAuthors).toEqual(["Alice"])
    } finally {
      await repo.cleanup()
    }
  })

  test("normalizes invalid config before running git and reporting output", async () => {
    const repo = await createRepo("pulsar-shared-02-normalized-")
    try {
      await repo.write("src/owned.ts", longFile("owned"))
      await repo.commitAll({
        message: "source",
        authorName: "Alice",
        dateIso: "2024-04-01T00:00:00Z",
      })

      const output = await runBusFactor(repo, {
        window_days: Number.NaN,
        max_commits: Number.NEGATIVE_INFINITY,
        min_loc: Number.NaN,
        top_n_diagnostics: Number.NaN,
      })

      expect(output.windowDays).toBe(Shared02BusFactor.defaultConfig.window_days)
      expect(output.maxCommits).toBe(Shared02BusFactor.defaultConfig.max_commits)
      expect(output.topDiagnostics).toBe(0)
      expect(normalizedFiles(repo, output)).toEqual(["$ROOT/src/owned.ts"])
    } finally {
      await repo.cleanup()
    }
  })

  test("diagnostics expose ordered silo payloads and caps", () => {
    const output: Shared02BusFactorOutput = {
      byFile: new Map(),
      siloed: [
        { file: "src/big.ts", author: "Alice", loc: 240 },
        { file: "src/small.ts", author: "Bob", loc: 60 },
      ],
      effectiveSiloed: [
        effectiveSilo({ file: "src/big.ts", author: "Alice", loc: 240, severity: "warn" }),
        effectiveSilo({ file: "src/small.ts", author: "Bob", loc: 60, severity: "info" }),
      ],
      distribution: summarize([1, 1]),
      windowDays: 180,
      maxCommits: 5000,
      touchedFileCount: 2,
      touchedLoc: 300,
      repoAuthors: ["Alice", "Bob"],
      topDiagnostics: 1,
    }

    const diagnostics = Shared02BusFactor.diagnose(output)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      severity: "warn",
      message:
        "Knowledge silo candidate: src/big.ts is single-author in the last 180 days (Alice, 240 LOC)",
      location: { file: "src/big.ts" },
      data: expect.objectContaining({
        author: "Alice",
        loc: 240,
        penaltyWeight: 0.3,
      }),
    })
  })

  test("equivalent repositories produce deterministic output", async () => {
    const left = await createRepo("pulsar-shared-02-left-")
    const right = await createRepo("pulsar-shared-02-right-")
    try {
      for (const repo of [left, right]) {
        await repo.write("src/a.ts", longFile("a"))
        await repo.commitAll({
          message: "a",
          authorName: "Alice",
          dateIso: "2024-03-01T00:00:00Z",
        })
        await repo.write("src/b.ts", longFile("b"))
        await repo.commitAll({
          message: "b",
          authorName: "Bob",
          dateIso: "2024-04-01T00:00:00Z",
        })
      }

      const leftOutput = await runBusFactor(left)
      const rightOutput = await runBusFactor(right)

      expect(normalizedFiles(left, leftOutput)).toEqual(normalizedFiles(right, rightOutput))
      expect(leftOutput.siloed.map((entry) => ({
        ...entry,
        file: entry.file.replace(left.root, "$ROOT"),
      }))).toEqual(rightOutput.siloed.map((entry) => ({
        ...entry,
        file: entry.file.replace(right.root, "$ROOT"),
      })))
      expect({
        windowDays: leftOutput.windowDays,
        maxCommits: leftOutput.maxCommits,
        touchedFileCount: leftOutput.touchedFileCount,
        touchedLoc: leftOutput.touchedLoc,
        repoAuthors: leftOutput.repoAuthors,
      }).toEqual({
        windowDays: rightOutput.windowDays,
        maxCommits: rightOutput.maxCommits,
        touchedFileCount: rightOutput.touchedFileCount,
        touchedLoc: rightOutput.touchedLoc,
        repoAuthors: rightOutput.repoAuthors,
      })
    } finally {
      await left.cleanup()
      await right.cleanup()
    }
  })
})

const effectiveSilo = (
  overrides: Partial<NonNullable<Shared02BusFactorOutput["effectiveSiloed"]>[number]>,
): NonNullable<Shared02BusFactorOutput["effectiveSiloed"]>[number] => ({
  file: "src/file.ts",
  author: "Alice",
  loc: 60,
  visible: true,
  severity: "info",
  penaltyWeight: 0.3,
  factorPathPrefix: "bus_factor.file_ts",
  policyDecisions: [],
  ...overrides,
})

const commitEnv = (options: CommitOptions): Record<string, string> => ({
  ...process.env,
  GIT_AUTHOR_NAME: options.authorName,
  GIT_AUTHOR_EMAIL: options.authorEmail ?? `${options.authorName.toLowerCase()}@example.com`,
  GIT_COMMITTER_NAME: options.authorName,
  GIT_COMMITTER_EMAIL: options.authorEmail ?? `${options.authorName.toLowerCase()}@example.com`,
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
