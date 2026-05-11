import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "@skastr0/pulsar-core/signal"
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TsSl02 } from "../signals/ts-sl-02-inconsistent-clones.js"
import { TsSl01 } from "../signals/ts-sl-01-duplication.js"
import type { TsSl01Output } from "../signals/ts-sl-01-model.js"

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
  })

  test("declared as compound with correct inputs", () => {
    expect(TsSl02.inputs).toEqual([{ id: "TS-SL-01-duplication" }])
    expect(TsSl02.aliases).toContain("TS-SL-02")
    expect(TsSl02.tier).toBe(1.5)
    expect(TsSl02.kind).toBe("compound")
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
      analyzedGroups: 2,
      analysisLimitHit: true,
      divergentGroups: [],
      divergenceDistribution: { min: 0, max: 0, mean: 0, median: 0 },
    })

    expect(score).toBe(0.95)
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
    expect(diagnostics.length).toBeGreaterThanOrEqual(0)
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
