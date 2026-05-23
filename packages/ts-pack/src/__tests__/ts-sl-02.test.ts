import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { SignalContextTag } from "@skastr0/pulsar-core/signal"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TsSl02, normalizeTsSl02Config } from "../signals/ts-sl-02-inconsistent-clones.js"
import { TsSl01 } from "../signals/ts-sl-01-duplication.js"
import type { TsSl01Output } from "../signals/ts-sl-01-model.js"
import { TS_PACK_SIGNALS } from "../pack.js"

const git = (repo: string, args: Array<string>, env?: Record<string, string>): void => {
  const result = spawnSync("git", args, {
    cwd: repo,
    env: { ...process.env, ...(env ?? {}) },
    encoding: "utf-8",
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  }
}

const makeCommit = (repo: string, path: string, content: string, dateIso: string): void => {
  writeFileSync(join(repo, path), content)
  git(repo, ["add", path])
  git(repo, ["commit", "-m", `edit ${path}`, "-q"], {
    GIT_AUTHOR_DATE: dateIso,
    GIT_COMMITTER_DATE: dateIso,
  })
}

const makeCommitMany = (
  repo: string,
  files: ReadonlyArray<{ path: string; content: string }>,
  dateIso: string,
): void => {
  for (const file of files) {
    writeFileSync(join(repo, file.path), file.content)
    git(repo, ["add", file.path])
  }
  git(repo, ["commit", "-m", "edit clone group", "-q"], {
    GIT_AUTHOR_DATE: dateIso,
    GIT_COMMITTER_DATE: dateIso,
  })
}

const runTsSl02 = async (
  repo: string,
  inputs: ReadonlyMap<string, unknown>,
  options: {
    readonly config?: typeof TsSl02.defaultConfig
    readonly gitSha?: string
  } = {},
) =>
  Effect.runPromise(
    TsSl02.compute(options.config ?? TsSl02.defaultConfig, inputs).pipe(
      Effect.provide(
        Layer.succeed(SignalContextTag, {
          gitSha: options.gitSha ?? "HEAD",
          worktreePath: repo,
          changedHunks: [],
        }),
      ),
    ),
  )

describe("TS-SL-02 Inconsistent clone detection", () => {
  let repo: string

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "ts-sl-02-"))
    git(repo, ["init", "-q"])
    git(repo, ["config", "user.email", "test@example.com"])
    git(repo, ["config", "user.name", "Test"])

    await import("node:fs/promises").then((fs) =>
      fs.writeFile(join(repo, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022" } })),
    )
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(join(repo, "package.json"), JSON.stringify({ name: "test" })),
    )
  })

  afterEach(async () => {
    await import("node:fs/promises").then((fs) => fs.rm(repo, { recursive: true, force: true }))
  })

  test("returns empty when no clone groups from TS-SL-01", async () => {
    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: [],
          totalFunctionsAnalyzed: 0,
          scoreBudgetFunctions: 0,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    const out = await Effect.runPromise(
      TsSl02.compute(TsSl02.defaultConfig, inputs).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )

    expect(out.divergentGroups.length).toBe(0)
    expect(out.totalGroups).toBe(0)
    expect(out.analyzedGroups).toBe(0)
    expect(out.analysisLimitHit).toBe(false)
    expect(TsSl02.score(out)).toBe(1)
    expect(TsSl02.outputMetadata?.(out)).toEqual({ applicability: "not_applicable" })
  })

  test("declares identity, pack registration, config schema, cache, and factor ledger", async () => {
    const packRegistered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-SL-02"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([TsSl01, packRegistered!]))
    const registered = registry.byId.get("TS-SL-02")
    const decoded = Schema.decodeUnknownSync(TsSl02.configSchema)(TsSl02.defaultConfig)

    expect(TsSl02).toMatchObject({
      id: "TS-SL-02-inconsistent-clones",
      title: "Inconsistent clones",
      aliases: ["TS-SL-02"],
      tier: 1.5,
      category: "generated-slop",
      kind: "compound",
      cacheVersion: "history-context-normalized-config-v1",
      cacheDependencies: ["git-revision-context"],
    })
    expect(TsSl02.inputs).toEqual([
      {
        id: "TS-SL-01-duplication",
        cacheFingerprint: "ts-sl-02-duplication-input-v1",
      },
    ])
    expect(decoded).toEqual(TsSl02.defaultConfig)
    expect(registered?.id).toBe(TsSl02.id)
    expect(registered?.cacheVersion).toContain(TsSl02.cacheVersion)
    expect(registry.byId.get("TS-SL-02")?.id).toBe(TsSl02.id)

    const factorLedger = registered?.factorLedger?.({
      totalGroups: 1,
      candidateGroups: 1,
      analyzedGroups: 1,
      analysisLimitHit: false,
      analysisLimitScoreCap: 0.95,
      divergentGroups: [],
      divergenceDistribution: { min: 0, max: 0, mean: 0, median: 0 },
    })
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.analysis_limit_score_cap",
        value: 0.95,
        source: "signal-default",
        affectsScore: false,
        scoreRole: "score-cap",
      }),
    )
  })

  test("normalizes unsafe config values before analysis and diagnostics", () => {
    const normalized = normalizeTsSl02Config({
      divergence_threshold: 1.4,
      min_window_days: Number.NaN,
      top_n_diagnostics: -1,
      max_groups_analyzed: 2.9,
      max_members_per_group: 0,
      analysis_limit_score_cap: Number.POSITIVE_INFINITY,
    })

    expect(normalized).toEqual({
      divergence_threshold: 1,
      min_window_days: TsSl02.defaultConfig.min_window_days,
      top_n_diagnostics: 0,
      max_groups_analyzed: 2,
      max_members_per_group: TsSl02.defaultConfig.max_members_per_group,
      analysis_limit_score_cap: TsSl02.defaultConfig.analysis_limit_score_cap,
    })
    expect(TsSl02.diagnose({
      totalGroups: 1,
      candidateGroups: 1,
      analyzedGroups: 1,
      analysisLimitHit: false,
      diagnosticLimit: -1,
      divergentGroups: [
        {
          groupId: "hidden",
          divergenceScore: 1,
          lastModifiedWindow: 1,
          members: [],
        },
      ],
      divergenceDistribution: { min: 1, max: 1, mean: 1, median: 1 },
    })).toEqual([])
  })

  test("does not mark two-member clones from the same commit as divergent", async () => {
    const cloneGroups = [
      {
        groupId: "same-commit",
        kind: "structural" as const,
        tokenCount: 60,
        members: [
          { file: join(repo, "handler-a.ts"), name: "handleA", startLine: 1, endLine: 3 },
          { file: join(repo, "handler-b.ts"), name: "handleB", startLine: 1, endLine: 3 },
        ],
        structuralHash: "hash123",
      },
    ]

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 2,
          scoreBudgetFunctions: 2,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    makeCommitMany(
      repo,
      [
        { path: "handler-a.ts", content: "export function handleA() {\n  return 1\n}\n" },
        { path: "handler-b.ts", content: "export function handleB() {\n  return 1\n}\n" },
      ],
      new Date().toISOString(),
    )

    const out = await Effect.runPromise(
      TsSl02.compute(TsSl02.defaultConfig, inputs).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )

    expect(out.totalGroups).toBe(1)
    expect(out.analyzedGroups).toBe(1)
    expect(out.analysisLimitHit).toBe(false)
    expect(out.divergentGroups).toEqual([])
    expect(out.divergenceDistribution).toEqual({ min: 0, max: 0, mean: 0, median: 0 })
    expect(TsSl02.score(out)).toBe(1)
  })

  test("ignores clone groups excluded by TS-SL-01 policy", async () => {
    const cloneGroups = [
      {
        groupId: "excluded-integration",
        kind: "structural" as const,
        tokenCount: 60,
        members: [
          { file: join(repo, "handler-a.ts"), name: "handleA", startLine: 1, endLine: 3 },
          { file: join(repo, "handler-b.ts"), name: "handleB", startLine: 1, endLine: 3 },
        ],
        structuralHash: "hash123",
        policy: {
          action: "exclude" as const,
          factor: 0,
          visible: true,
          severity: "info" as const,
          penaltyWeight: 0,
        },
      },
    ]

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 2,
          scoreBudgetFunctions: 2,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    makeCommitMany(
      repo,
      [
        { path: "handler-a.ts", content: "export function handleA() {\n  return 1\n}\n" },
        { path: "handler-b.ts", content: "export function handleB() {\n  return 2\n}\n" },
      ],
      "2024-06-01T00:00:00Z",
    )

    const out = await Effect.runPromise(
      TsSl02.compute(TsSl02.defaultConfig, inputs).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )

    expect(out.totalGroups).toBe(0)
    expect(out.candidateGroups).toBe(0)
    expect(out.analyzedGroups).toBe(0)
    expect(out.divergentGroups).toEqual([])
    expect(TsSl02.score(out)).toBe(1)
  })

  test("does not treat exact clones with different blame history as inconsistent clones", async () => {
    const cloneGroups = [
      {
        groupId: "exact-helper",
        kind: "exact" as const,
        tokenCount: 31,
        members: [
          { file: join(repo, "record-a.ts"), name: "asRecordA", startLine: 1, endLine: 5 },
          { file: join(repo, "record-b.ts"), name: "asRecordB", startLine: 1, endLine: 5 },
          { file: join(repo, "record-c.ts"), name: "asRecordC", startLine: 1, endLine: 5 },
        ],
        structuralHash: "exact-helper-hash",
      },
    ]

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 3,
          scoreBudgetFunctions: 3,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    const exactBody = (name: string) =>
      `export function ${name}(value: unknown): Record<string, unknown> | null {\n` +
      `  return value && typeof value === "object" && !Array.isArray(value)\n` +
      `    ? (value as Record<string, unknown>)\n` +
      `    : null\n` +
      `}\n`
    makeCommit(repo, "record-a.ts", exactBody("asRecordA"), "2024-06-01T00:00:00Z")
    makeCommit(repo, "record-b.ts", exactBody("asRecordB"), "2024-06-10T00:00:00Z")
    makeCommit(repo, "record-c.ts", exactBody("asRecordC"), "2024-06-20T00:00:00Z")

    const out = await Effect.runPromise(
      TsSl02.compute(TsSl02.defaultConfig, inputs).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )

    expect(out.totalGroups).toBe(1)
    expect(out.analyzedGroups).toBe(0)
    expect(out.divergentGroups).toEqual([])
    expect(TsSl02.outputMetadata?.(out)).toEqual({ applicability: "not_applicable" })
    expect(TsSl02.score(out)).toBe(1)
  })

  test("detects divergent clones with different modification history", async () => {
    const cloneGroups = [
      {
        groupId: "test-1",
        kind: "structural" as const,
        tokenCount: 60,
        members: [
          { file: join(repo, "handler-a.ts"), name: "handleA", startLine: 1, endLine: 10 },
          { file: join(repo, "handler-b.ts"), name: "handleB", startLine: 1, endLine: 10 },
        ],
        structuralHash: "hash123",
      },
    ]

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 2,
          scoreBudgetFunctions: 2,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    makeCommit(repo, "seed.ts", "export const seed = 1;", "2024-01-01T00:00:00Z")
    makeCommit(repo, "handler-a.ts", "export function handleA() { return 1; }", "2024-06-01T00:00:00Z")
    makeCommit(repo, "handler-b.ts", "export function handleB() { return 2; }", "2024-07-01T00:00:00Z")

    const out = await Effect.runPromise(
      TsSl02.compute(TsSl02.defaultConfig, inputs).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )

    expect(out.totalGroups).toBe(1)
    expect(out.analyzedGroups).toBe(1)
    expect(out.divergenceDistribution).toBeDefined()
    expect(out.divergentGroups).toHaveLength(1)
    expect(out.divergentGroups[0]).toMatchObject({
      groupId: "test-1",
      kind: "structural",
      tokenCount: 60,
      sampledMemberCount: 2,
      totalMemberCount: 2,
      divergenceScore: 1,
    })
    expect(TsSl02.score(out)).toBeLessThan(1)
  })

  test("invalid gitSha falls back to HEAD time without wall-clock nondeterminism", async () => {
    const cloneGroups = [
      {
        groupId: "fallback-head-time",
        kind: "structural" as const,
        tokenCount: 60,
        members: [
          { file: join(repo, "handler-a.ts"), name: "handleA", startLine: 1, endLine: 10 },
          { file: join(repo, "handler-b.ts"), name: "handleB", startLine: 1, endLine: 10 },
        ],
        structuralHash: "hash123",
      },
    ]
    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 2,
          scoreBudgetFunctions: 2,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    const body = (name: string, value: number) =>
      Array.from({ length: 10 }, (_, index) =>
        index === 0 ? `export function ${name}() { return ${value}; }` : `export const ${name}${index} = ${index}`,
      ).join("\n")
    makeCommit(repo, "handler-a.ts", body("handleA", 1), "2024-06-01T00:00:00Z")
    makeCommit(repo, "handler-b.ts", body("handleB", 2), "2024-06-20T00:00:00Z")

    const out = await runTsSl02(repo, inputs, {
      gitSha: "not-a-real-ref",
    })

    expect(out.divergentGroups).toHaveLength(1)
    expect(out.divergentGroups[0]?.groupId).toBe("fallback-head-time")
  })

  test("does not treat unknown blame history as divergent clone evidence", async () => {
    const cloneGroups = [
      {
        groupId: "partial-history",
        kind: "structural" as const,
        tokenCount: 60,
        members: [
          { file: join(repo, "handler-a.ts"), name: "handleA", startLine: 1, endLine: 3 },
          { file: join(repo, "missing-handler.ts"), name: "handleB", startLine: 1, endLine: 3 },
        ],
        structuralHash: "hash123",
      },
    ]

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 2,
          scoreBudgetFunctions: 2,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    makeCommit(repo, "handler-a.ts", "export function handleA() {\n  return 1\n}\n", new Date().toISOString())

    const out = await Effect.runPromise(
      TsSl02.compute(TsSl02.defaultConfig, inputs).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )

    expect(out.totalGroups).toBe(1)
    expect(out.analyzedGroups).toBe(1)
    expect(out.divergentGroups).toEqual([])
    expect(TsSl02.score(out)).toBe(1)
  })

  test("ignores tiny structural clone groups even when AI vectors lower TS-SL-01 token floor", async () => {
    const cloneGroups = [
      {
        groupId: "tiny-format-helper",
        kind: "structural" as const,
        tokenCount: 17,
        members: [
          { file: join(repo, "format-a.ts"), name: "formatA", startLine: 1, endLine: 5 },
          { file: join(repo, "format-b.ts"), name: "formatB", startLine: 1, endLine: 5 },
        ],
        structuralHash: "tiny",
      },
    ]

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 2,
          scoreBudgetFunctions: 2,
          scopeMode: "changed-hunks",
        } as TsSl01Output,
      ],
    ])

    const out = await Effect.runPromise(
      TsSl02.compute(TsSl02.defaultConfig, inputs).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )

    expect(out.analyzedGroups).toBe(0)
    expect(out.divergentGroups).toEqual([])
    expect(TsSl02.outputMetadata?.(out)).toEqual({ applicability: "not_applicable" })
    expect(TsSl02.score(out)).toBe(1)
  })

  test("structural candidates are analyzed before exact clone groups consume the budget", async () => {
    const cloneGroups = [
      {
        groupId: "exact-helper",
        kind: "exact" as const,
        tokenCount: 80,
        members: [
          { file: join(repo, "exact-a.ts"), name: "exactA", startLine: 1, endLine: 3 },
          { file: join(repo, "exact-b.ts"), name: "exactB", startLine: 1, endLine: 3 },
        ],
        structuralHash: "exact",
      },
      {
        groupId: "structural-provider",
        kind: "structural" as const,
        tokenCount: 60,
        members: [
          { file: join(repo, "provider-a.ts"), name: "providerA", startLine: 1, endLine: 3 },
          { file: join(repo, "provider-b.ts"), name: "providerB", startLine: 1, endLine: 3 },
        ],
        structuralHash: "structural",
      },
    ]

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 4,
          scoreBudgetFunctions: 4,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    makeCommitMany(
      repo,
      [
        { path: "exact-a.ts", content: "export function exactA() {\n  return 1\n}\n" },
        { path: "exact-b.ts", content: "export function exactB() {\n  return 1\n}\n" },
      ],
      "2024-05-01T00:00:00Z",
    )
    makeCommit(repo, "provider-a.ts", "export function providerA() {\n  return 1\n}\n", "2024-06-01T00:00:00Z")
    makeCommit(repo, "provider-b.ts", "export function providerB() {\n  return 2\n}\n", "2024-06-20T00:00:00Z")

    const out = await Effect.runPromise(
      TsSl02.compute(
        {
          ...TsSl02.defaultConfig,
          max_groups_analyzed: 1,
        },
        inputs,
      ).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )

    expect(out.analyzedGroups).toBe(1)
    expect(out.divergentGroups.map((group) => group.groupId)).toEqual(["structural-provider"])
  })

  test("does not double count nested structural clone groups over the same members", async () => {
    const cloneGroups = [
      {
        groupId: "outer-provider",
        kind: "structural" as const,
        tokenCount: 80,
        members: [
          { file: join(repo, "provider-a.ts"), name: "providerA", startLine: 1, endLine: 20 },
          { file: join(repo, "provider-b.ts"), name: "providerB", startLine: 1, endLine: 20 },
        ],
        structuralHash: "outer",
      },
      {
        groupId: "inner-callback",
        kind: "structural" as const,
        tokenCount: 35,
        members: [
          { file: join(repo, "provider-a.ts"), name: "callbackA", startLine: 5, endLine: 12 },
          { file: join(repo, "provider-b.ts"), name: "callbackB", startLine: 5, endLine: 12 },
        ],
        structuralHash: "inner",
      },
    ]

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 4,
          scoreBudgetFunctions: 4,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    makeCommit(repo, "provider-a.ts", Array.from({ length: 20 }, (_, i) => `export const a${i} = ${i}`).join("\n"), "2024-06-01T00:00:00Z")
    makeCommit(repo, "provider-b.ts", Array.from({ length: 20 }, (_, i) => `export const b${i} = ${i}`).join("\n"), "2024-06-20T00:00:00Z")

    const out = await Effect.runPromise(
      TsSl02.compute(
        {
          ...TsSl02.defaultConfig,
          max_groups_analyzed: 4,
        },
        inputs,
      ).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )

    expect(out.analyzedGroups).toBe(1)
    expect(out.divergentGroups.map((group) => group.groupId)).toEqual(["outer-provider"])
  })

  test("nested structural clone de-duplication is independent of input order", async () => {
    const outer = {
      groupId: "outer-provider",
      kind: "structural" as const,
      tokenCount: 80,
      members: [
        { file: join(repo, "provider-a.ts"), name: "providerA", startLine: 1, endLine: 20 },
        { file: join(repo, "provider-b.ts"), name: "providerB", startLine: 1, endLine: 20 },
      ],
      structuralHash: "outer",
    }
    const inner = {
      groupId: "inner-callback",
      kind: "structural" as const,
      tokenCount: 35,
      members: [
        { file: join(repo, "provider-a.ts"), name: "callbackA", startLine: 5, endLine: 12 },
        { file: join(repo, "provider-b.ts"), name: "callbackB", startLine: 5, endLine: 12 },
      ],
      structuralHash: "inner",
    }

    makeCommit(repo, "provider-a.ts", Array.from({ length: 20 }, (_, i) => `export const a${i} = ${i}`).join("\n"), "2024-06-01T00:00:00Z")
    makeCommit(repo, "provider-b.ts", Array.from({ length: 20 }, (_, i) => `export const b${i} = ${i}`).join("\n"), "2024-06-20T00:00:00Z")

    const outputForGroups = async (groups: ReadonlyArray<typeof outer | typeof inner>) =>
      runTsSl02(
        repo,
        new Map<string, unknown>([
          [
            "TS-SL-01",
            {
              groups,
              totalFunctionsAnalyzed: 4,
              scoreBudgetFunctions: 4,
              scopeMode: "whole-tree",
            } as TsSl01Output,
          ],
        ]),
        {
          config: {
            ...TsSl02.defaultConfig,
            max_groups_analyzed: 4,
          },
        },
      )

    const outerFirst = await outputForGroups([outer, inner])
    const innerFirst = await outputForGroups([inner, outer])

    expect(outerFirst.analyzedGroups).toBe(1)
    expect(innerFirst.analyzedGroups).toBe(1)
    expect(outerFirst.divergentGroups.map((group) => group.groupId)).toEqual(["outer-provider"])
    expect(innerFirst.divergentGroups.map((group) => group.groupId)).toEqual(["outer-provider"])
    expect(innerFirst.divergenceDistribution).toEqual(outerFirst.divergenceDistribution)
  })

  test("bounds history analysis to the configured group and member budgets", async () => {
    const cloneGroups = Array(4)
      .fill(0)
      .map((_, i) => ({
        groupId: `group-${i}`,
        kind: "structural" as const,
        tokenCount: 60,
        members: Array(4)
          .fill(0)
          .map((_, memberIndex) => ({
            file: `file-${i}-${memberIndex}.ts`,
            name: `fn${i}${memberIndex}`,
            startLine: 1,
            endLine: 3,
          })),
        structuralHash: `hash-${i}`,
      }))

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 16,
          scoreBudgetFunctions: 16,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    const out = await Effect.runPromise(
      TsSl02.compute(
        {
          ...TsSl02.defaultConfig,
          max_groups_analyzed: 2,
          max_members_per_group: 2,
        },
        inputs,
      ).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )

    expect(out.totalGroups).toBe(4)
    expect(out.analyzedGroups).toBe(2)
    expect(out.analysisLimitHit).toBe(true)
  })

  test("zero analysis budget is uncertainty, not a perfect score", async () => {
    const cloneGroups = [
      {
        groupId: "candidate-behind-zero-budget",
        kind: "structural" as const,
        tokenCount: 60,
        members: [
          { file: join(repo, "handler-a.ts"), name: "handleA", startLine: 1, endLine: 3 },
          { file: join(repo, "handler-b.ts"), name: "handleB", startLine: 1, endLine: 3 },
        ],
        structuralHash: "hash123",
      },
    ]
    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 2,
          scoreBudgetFunctions: 2,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    makeCommitMany(
      repo,
      [
        { path: "handler-a.ts", content: "export function handleA() {\n  return 1\n}\n" },
        { path: "handler-b.ts", content: "export function handleB() {\n  return 2\n}\n" },
      ],
      "2024-06-01T00:00:00Z",
    )

    const out = await runTsSl02(repo, inputs, {
      config: {
        ...TsSl02.defaultConfig,
        max_groups_analyzed: 0,
        analysis_limit_score_cap: 0.4,
      },
    })
    const diagnostics = TsSl02.diagnose(out)
    const factorLedger = TsSl02.factorLedger?.(out)

    expect(out.candidateGroups).toBe(1)
    expect(out.analyzedGroups).toBe(0)
    expect(out.analysisLimitHit).toBe(true)
    expect(TsSl02.score(out)).toBe(0.4)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("analyzed 0/1 candidate groups")
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.analysis_limit_score_cap",
        value: 0.4,
        source: "vector",
        affectsScore: true,
      }),
    )
  })

  test("default budget reaches divergent groups behind stable boilerplate", async () => {
    const cloneGroups = Array(5)
      .fill(0)
      .map((_, i) => ({
        groupId: i === 4 ? "late-divergent" : `stable-boilerplate-${i}`,
        kind: "structural" as const,
        tokenCount: 60,
        members: [
          { file: join(repo, `late-${i}-a.ts`), name: `lateA${i}`, startLine: 1, endLine: 5 },
          { file: join(repo, `late-${i}-b.ts`), name: `lateB${i}`, startLine: 1, endLine: 5 },
        ],
        structuralHash: `late-${i}`,
      }))

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 10,
          scoreBudgetFunctions: 10,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    for (let i = 0; i < 4; i += 1) {
      makeCommitMany(
        repo,
        [
          { path: `late-${i}-a.ts`, content: `export function lateA${i}() {\n  return ${i}\n}\n` },
          { path: `late-${i}-b.ts`, content: `export function lateB${i}() {\n  return ${i}\n}\n` },
        ],
        "2024-06-01T00:00:00Z",
      )
    }
    makeCommit(repo, "late-4-a.ts", "export function lateA4() {\n  return 1\n}\n", "2024-06-01T00:00:00Z")
    makeCommit(repo, "late-4-b.ts", "export function lateB4() {\n  return 2\n}\n", "2024-06-20T00:00:00Z")

    const out = await Effect.runPromise(
      TsSl02.compute(TsSl02.defaultConfig, inputs).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )

    expect(out.analyzedGroups).toBe(5)
    expect(out.analysisLimitHit).toBe(false)
    expect(out.divergentGroups.map((group) => group.groupId)).toContain("late-divergent")
  })

  test("score decreases with more divergent groups", async () => {
    const cloneGroups = Array(5)
      .fill(0)
      .map((_, i) => ({
        groupId: `group-${i}`,
        kind: "structural" as const,
        tokenCount: 60,
        members: [
          { file: `file-${i}-a.ts`, name: `func${i}A`, startLine: 1, endLine: 5 },
          { file: `file-${i}-b.ts`, name: `func${i}B`, startLine: 1, endLine: 5 },
        ],
        structuralHash: `hash-${i}`,
      }))

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 10,
          scoreBudgetFunctions: 10,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    const out = await Effect.runPromise(
      TsSl02.compute(TsSl02.defaultConfig, inputs).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )

    const score = TsSl02.score(out)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test("borderline info-level divergence does not lower score", () => {
    const score = TsSl02.score({
      totalGroups: 2,
      analyzedGroups: 2,
      analysisLimitHit: false,
      divergentGroups: [
        {
          groupId: "borderline",
          divergenceScore: 0.5,
          lastModifiedWindow: 1,
          members: [],
        },
      ],
      divergenceDistribution: { min: 0.5, max: 0.5, mean: 0.5, median: 0.5 },
    })

    expect(score).toBe(1)
  })

  test("analysis limit hit caps an otherwise clean clone-drift score", () => {
    const score = TsSl02.score({
      totalGroups: 12,
      candidateGroups: 12,
      analyzedGroups: 2,
      analysisLimitHit: true,
      analysisLimitScoreCap: 0.95,
      divergentGroups: [],
      divergenceDistribution: { min: 0, max: 0, mean: 0, median: 0 },
    })

    expect(score).toBe(0.95)
  })

  test("analysis limit score cap is clamped to score bounds", () => {
    expect(TsSl02.score({
      totalGroups: 12,
      candidateGroups: 12,
      analyzedGroups: 0,
      analysisLimitHit: true,
      analysisLimitScoreCap: 1.2,
      divergentGroups: [],
      divergenceDistribution: { min: 0, max: 0, mean: 0, median: 0 },
    })).toBe(1)

    expect(TsSl02.score({
      totalGroups: 12,
      candidateGroups: 12,
      analyzedGroups: 0,
      analysisLimitHit: true,
      analysisLimitScoreCap: -0.1,
      divergentGroups: [],
      divergenceDistribution: { min: 0, max: 0, mean: 0, median: 0 },
    })).toBe(0)
  })

  test("analysis limit cap is configurable and diagnosed when no divergent groups are found", () => {
    const output = {
      totalGroups: 20,
      candidateGroups: 12,
      analyzedGroups: 8,
      analysisLimitHit: true,
      analysisLimitScoreCap: 0.98,
      divergentGroups: [],
      divergenceDistribution: { min: 0, max: 0, mean: 0, median: 0 },
    }

    const diagnostics = TsSl02.diagnose(output)
    const factorLedger = TsSl02.factorLedger?.(output)

    expect(TsSl02.score(output)).toBe(0.98)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe("info")
    expect(diagnostics[0]?.message).toContain("analyzed 8/12 candidate groups")
    expect(diagnostics[0]?.data).toMatchObject({
      candidateGroups: 12,
      analyzedGroups: 8,
      analysisLimitScoreCap: 0.98,
    })
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "analysis.limit_hit",
        value: true,
        scoreRole: "score-cap",
        affectsScore: true,
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.analysis_limit_score_cap",
        value: 0.98,
        source: "vector",
        scoreRole: "score-cap",
        affectsScore: true,
      }),
    )
  })

  test("single severe divergent clone creates drag without collapsing the signal", () => {
    const score = TsSl02.score({
      totalGroups: 12,
      analyzedGroups: 2,
      analysisLimitHit: true,
      divergentGroups: [
        {
          groupId: "worst-actionable",
          divergenceScore: 1,
          lastModifiedWindow: 45,
          members: [],
        },
      ],
      divergenceDistribution: { min: 1, max: 1, mean: 1, median: 1 },
    })

    expect(score).toBeGreaterThan(0.6)
    expect(score).toBeLessThan(0.7)
  })

  test("medium-confidence parallel families create less pressure and info diagnostics", () => {
    const output = {
      totalGroups: 12,
      analyzedGroups: 2,
      analysisLimitHit: true,
      divergentGroups: [
        {
          groupId: "provider-family",
          kind: "structural" as const,
          tokenCount: 140,
          confidence: "medium" as const,
          evidenceKind: "parallel-family" as const,
          divergenceScore: 1,
          lastModifiedWindow: 45,
          sampledMemberCount: 3,
          totalMemberCount: 3,
          members: [
            {
              file: "src/image-generation/provider-registry.ts",
              name: "buildProviderMaps",
              startLine: 31,
              endLine: 59,
              lastModifiedSha: "a".repeat(40),
              lastModifiedAt: "2026-01-01T00:00:00.000Z",
              historyStatus: "ok" as const,
            },
            {
              file: "src/music-generation/provider-registry.ts",
              name: "buildProviderMaps",
              startLine: 31,
              endLine: 59,
              lastModifiedSha: "b".repeat(40),
              lastModifiedAt: "2026-01-02T00:00:00.000Z",
              historyStatus: "ok" as const,
            },
            {
              file: "src/video-generation/provider-registry.ts",
              name: "buildProviderMaps",
              startLine: 31,
              endLine: 59,
              lastModifiedSha: "c".repeat(40),
              lastModifiedAt: "2026-01-03T00:00:00.000Z",
              historyStatus: "ok" as const,
            },
          ],
        },
      ],
      divergenceDistribution: { min: 1, max: 1, mean: 1, median: 1 },
    }

    const score = TsSl02.score(output)
    const diagnostics = TsSl02.diagnose(output)

    expect(score).toBeGreaterThan(0.9)
    expect(score).toBeLessThan(0.95)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe("info")
    expect(diagnostics[0]?.message).toContain("confidence=medium")
    expect(diagnostics[0]?.message).toContain("evidence=parallel-family")
    expect(diagnostics[0]?.data?.confidence).toBe("medium")
  })

  test("two-member parallel variants create medium-confidence drift evidence", async () => {
    const cloneGroups = [
      {
        groupId: "walker-pair",
        kind: "structural" as const,
        tokenCount: 109,
        members: [
          { file: join(repo, "cargo.ts"), name: "walkForCargoTomls", startLine: 1, endLine: 10 },
          { file: join(repo, "tsconfig.ts"), name: "walkForTsconfigs", startLine: 1, endLine: 10 },
        ],
        structuralHash: "walker",
      },
    ]

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 2,
          scoreBudgetFunctions: 2,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    makeCommit(repo, "cargo.ts", "export function walkForCargoTomls() {\n  return []\n}\n", "2024-06-01T00:00:00Z")
    makeCommit(repo, "tsconfig.ts", "export function walkForTsconfigs() {\n  return []\n}\n", "2024-06-20T00:00:00Z")

    const out = await Effect.runPromise(
      TsSl02.compute(TsSl02.defaultConfig, inputs).pipe(
        Effect.provide(
          Layer.succeed(SignalContextTag, {
            gitSha: "HEAD",
            worktreePath: repo,
            changedHunks: [],
          }),
        ),
      ),
    )
    const diagnostics = TsSl02.diagnose(out)

    expect(out.divergentGroups[0]?.confidence).toBe("medium")
    expect(out.divergentGroups[0]?.evidenceKind).toBe("paired-variant")
    expect(diagnostics[0]?.severity).toBe("info")
    expect(diagnostics[0]?.message).toContain("evidence=paired-variant")
  })

  test("score is not diluted when vector config analyzes more groups", () => {
    const divergentGroups = [
      {
        groupId: "worst-actionable",
        divergenceScore: 1,
        lastModifiedWindow: 45,
        members: [],
      },
      {
        groupId: "secondary-actionable",
        divergenceScore: 0.8,
        lastModifiedWindow: 32,
        members: [],
      },
    ]
    const narrowScore = TsSl02.score({
      totalGroups: 12,
      analyzedGroups: 2,
      analysisLimitHit: true,
      divergentGroups,
      divergenceDistribution: { min: 0.8, max: 1, mean: 0.9, median: 0.9 },
    })
    const broadScore = TsSl02.score({
      totalGroups: 12,
      analyzedGroups: 8,
      analysisLimitHit: true,
      divergentGroups,
      divergenceDistribution: { min: 0.8, max: 1, mean: 0.9, median: 0.9 },
    })

    expect(broadScore).toBe(narrowScore)
    expect(broadScore).toBeGreaterThan(0.5)
    expect(broadScore).toBeLessThan(0.65)
  })

  test("additional actionable divergent groups increase pressure", () => {
    const oneGroupScore = TsSl02.score({
      totalGroups: 12,
      analyzedGroups: 2,
      analysisLimitHit: true,
      divergentGroups: [
        {
          groupId: "worst-actionable",
          divergenceScore: 1,
          lastModifiedWindow: 45,
          members: [],
        },
      ],
      divergenceDistribution: { min: 1, max: 1, mean: 1, median: 1 },
    })
    const twoGroupScore = TsSl02.score({
      totalGroups: 12,
      analyzedGroups: 2,
      analysisLimitHit: true,
      divergentGroups: [
        {
          groupId: "worst-actionable",
          divergenceScore: 1,
          lastModifiedWindow: 45,
          members: [],
        },
        {
          groupId: "secondary-actionable",
          divergenceScore: 0.9,
          lastModifiedWindow: 32,
          members: [],
        },
      ],
      divergenceDistribution: { min: 0.9, max: 1, mean: 0.95, median: 0.95 },
    })

    expect(twoGroupScore).toBeLessThan(oneGroupScore)
  })

  test("diagnostics include divergence scores", async () => {
    const cloneGroups = [
      {
        groupId: "high-divergence",
        kind: "structural" as const,
        tokenCount: 60,
        members: [
          { file: "a.ts", name: "fnA", startLine: 1, endLine: 10 },
          { file: "b.ts", name: "fnB", startLine: 1, endLine: 10 },
          { file: "c.ts", name: "fnC", startLine: 1, endLine: 10 },
        ],
        structuralHash: "hash",
      },
    ]

    const inputs = new Map<string, unknown>([
      [
        "TS-SL-01",
        {
          groups: cloneGroups,
          totalFunctionsAnalyzed: 3,
          scoreBudgetFunctions: 3,
          scopeMode: "whole-tree",
        } as TsSl01Output,
      ],
    ])

    const body = (name: string, value: number) =>
      [
        `export function ${name}() {`,
        `  const value = ${value}`,
        "  if (value > 0) {",
        "    return value",
        "  }",
        "  return 0",
        "}",
        "",
        "export const marker = true",
        "",
      ].join("\n")
    makeCommit(repo, "a.ts", body("fnA", 1), "2024-06-01T00:00:00Z")
    makeCommit(repo, "b.ts", body("fnB", 2), "2024-07-01T00:00:00Z")
    makeCommit(repo, "c.ts", body("fnC", 3), "2024-07-15T00:00:00Z")

    const out = await runTsSl02(repo, inputs)

    const diagnostics = TsSl02.diagnose(out)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(diagnostics[0]?.message).toContain("divergence=1.00")
    expect(diagnostics[0]?.data).toMatchObject({
      groupId: "high-divergence",
      divergenceScore: 1,
      lastModifiedWindow: 44,
    })
  })

  test("diagnostics include clone member names and locations", () => {
    const diagnostics = TsSl02.diagnose({
      totalGroups: 1,
      analyzedGroups: 1,
      analysisLimitHit: false,
      divergentGroups: [
        {
          groupId: "provider-triplicate",
          kind: "structural",
          tokenCount: 92,
          divergenceScore: 1,
          lastModifiedWindow: 45,
          sampledMemberCount: 3,
          totalMemberCount: 3,
          members: [
            {
              file: "src/providers/anthropic.ts",
              name: "resolveAnthropicProvider",
              startLine: 12,
              endLine: 40,
              lastModifiedSha: "a".repeat(40),
              lastModifiedAt: "2026-01-01T00:00:00.000Z",
              historyStatus: "ok",
            },
            {
              file: "src/providers/openai.ts",
              name: "resolveOpenAiProvider",
              startLine: 18,
              endLine: 46,
              lastModifiedSha: "b".repeat(40),
              lastModifiedAt: "2026-02-01T00:00:00.000Z",
              historyStatus: "ok",
            },
          ],
        },
      ],
      divergenceDistribution: { min: 1, max: 1, mean: 1, median: 1 },
    })

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).not.toContain("provider-triplicate")
    expect(diagnostics[0]?.message).toContain("92 tokens")
    expect(diagnostics[0]?.message).toContain("src/providers/anthropic.ts:12 resolveAnthropicProvider")
    expect(diagnostics[0]?.message).toContain("src/providers/openai.ts:18 resolveOpenAiProvider")
    expect(diagnostics[0]?.data?.kind).toBe("structural")
    expect(diagnostics[0]?.data?.tokenCount).toBe(92)
  })

  test("diagnostics honor configured top_n_diagnostics", () => {
    const diagnostics = TsSl02.diagnose({
      totalGroups: 2,
      analyzedGroups: 2,
      analysisLimitHit: false,
      diagnosticLimit: 1,
      divergentGroups: [
        {
          groupId: "first",
          divergenceScore: 1,
          lastModifiedWindow: 45,
          members: [],
        },
        {
          groupId: "second",
          divergenceScore: 1,
          lastModifiedWindow: 45,
          members: [],
        },
      ],
      divergenceDistribution: { min: 1, max: 1, mean: 1, median: 1 },
    })

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.data?.groupId).toBe("first")
  })
})
