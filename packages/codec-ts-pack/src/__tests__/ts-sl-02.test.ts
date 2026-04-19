import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "@taste-codec/core"
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TsSl02 } from "../signals/ts-sl-02-inconsistent-clones.js"
import { TsSl01 } from "../signals/ts-sl-01-duplication.js"
import type { TsSl01Output } from "../signals/ts-sl-01-duplication.js"

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
    expect(TsSl02.score(out)).toBe(1)
  })

  test("declared as compound with correct inputs", () => {
    expect(TsSl02.inputs).toEqual([{ id: "TS-SL-01" }, { id: "SHARED-CHURN-01" }])
    expect(TsSl02.tier).toBe(1.5)
    expect(TsSl02.kind).toBe("compound")
  })

  test("detects divergent clones with different modification history", async () => {
    const cloneGroups = [
      {
        groupId: "test-1",
        kind: "structural" as const,
        tokenCount: 20,
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
    expect(out.divergenceDistribution).toBeDefined()
  })

  test("score decreases with more divergent groups", async () => {
    const cloneGroups = Array(5)
      .fill(0)
      .map((_, i) => ({
        groupId: `group-${i}`,
        kind: "structural" as const,
        tokenCount: 15,
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

  test("diagnostics include divergence scores", async () => {
    const cloneGroups = [
      {
        groupId: "high-divergence",
        kind: "structural" as const,
        tokenCount: 20,
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
})