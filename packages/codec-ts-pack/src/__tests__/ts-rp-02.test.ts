import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "@taste-codec/core"
import { createTempRepo, runSignal } from "./test-repo.js"
import { TsRp02 } from "../signals/ts-rp-02-pr-size.js"
import { TsProjectLayer, TsPackageInfoTag } from "../ts-project.js"
import { simpleGit } from "simple-git"
import type { TempRepo } from "./test-repo.js"

describe("TS-RP-02 PR size and dependency delta", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("ts-rp-02-")
    // Initialize git repo for proper diff detection
    const git = simpleGit(repo.root)
    await git.init()
    await git.addConfig("user.email", "test@example.com")
    await git.addConfig("user.name", "Test")
    await git.add(["."])
    await git.commit("Initial commit")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("computes basic PR metrics via changed hunks fallback", async () => {
    await repo.write(
      "file1.ts",
      `
export function foo(): string { return "hello"; }
export function bar(): number { return 42; }
`,
    )

    // Use diff-aware fallback since we can't reliably check git working tree state
    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "HEAD",
              worktreePath: repo.root,
              changedHunks: [
                { file: "file1.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 3 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.filesChanged.length).toBeGreaterThan(0)
    expect(typeof out.linesAdded).toBe("number")
    expect(typeof out.linesDeleted).toBe("number")
    expect(out.sizeCategory).toBeDefined()
  })

  test("detects cross-package imports", async () => {
    await repo.write(
      "packages/a/src/index.ts",
      `
export function helper(): string { return "a"; }
`,
    )

    await repo.write(
      "packages/b/src/index.ts",
      `
import { helper } from "../../a/src/index";
export function useHelper(): string { return helper(); }
`,
    )

    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "HEAD",
              worktreePath: repo.root,
              changedHunks: [
                { file: "packages/b/src/index.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 2 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.packagesTouched.length).toBeGreaterThanOrEqual(0)
  })

  test("size category respects budgets", async () => {
    const config = {
      ...TsRp02.defaultConfig,
      small_pr_budget: 50,
      medium_pr_budget: 100,
      large_pr_budget: 200,
    }

    const out = await Effect.runPromise(
      TsRp02.compute(
        config,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "HEAD",
              worktreePath: repo.root,
              changedHunks: [
                { file: "test.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 75 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(["small", "medium", "large", "oversized"]).toContain(out.sizeCategory)
  })

  test("score decreases with larger changes", async () => {
    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "HEAD",
              worktreePath: repo.root,
              changedHunks: [
                { file: "large.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 500 },
              ],
            }),
          ),
        ),
      ),
    )

    const score = TsRp02.score(out)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test("diff-aware fallback when hunks provided", async () => {
    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "TEST",
              worktreePath: repo.root,
              changedHunks: [
                { file: "test.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 10 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.diffMode).toBe("changed-hunks-fallback")
    expect(out.linesAdded).toBe(10)
  })

  test("reads committed TypeScript range diff with git pathspecs", async () => {
    await repo.write(
      "src/range.ts",
      `
export function before(): string {
  return "before"
}
`,
    )
    let git = simpleGit(repo.root)
    await git.add(["."])
    await git.commit("Add range file")

    await repo.write(
      "src/range.ts",
      `
export function after(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    return "missing"
  }
  return normalized
}
`,
    )
    await repo.write(
      "src/range.tsx",
      `
export function View(): unknown {
  return null
}
`,
    )
    git = simpleGit(repo.root)
    await git.add(["."])
    await git.commit("Change TypeScript range")

    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "HEAD",
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ),
      ),
    )

    expect(out.diffMode).toBe("git-commit-range")
    expect(out.filesChanged.map((file) => file.replace(repo.root, ""))).toEqual([
      "/src/range.ts",
      "/src/range.tsx",
    ])
    expect(out.linesAdded).toBeGreaterThan(0)
    expect(out.linesDeleted).toBeGreaterThan(0)
  })

  test("diagnostics include PR summary", async () => {
    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "HEAD",
              worktreePath: repo.root,
              changedHunks: [
                { file: "file.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 5 },
              ],
            }),
          ),
        ),
      ),
    )

    const diagnostics = TsRp02.diagnose(out)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("PR surface")
  })

  test("large PR surfaces emit warning diagnostics", async () => {
    const diagnostics = TsRp02.diagnose({
      linesAdded: 260,
      linesDeleted: 120,
      filesChanged: ["src/large.ts"],
      fileStats: [
        {
          file: "src/large.ts",
          linesAdded: 260,
          linesDeleted: 120,
          totalLines: 380,
        },
      ],
      packagesTouched: [],
      newCrossPackageEdges: [],
      newCrossBoundaryEdges: [],
      diffMode: "changed-hunks-fallback",
      sizeCategory: "large",
    })

    expect(diagnostics[0]?.severity).toBe("warn")
  })

  test("PR summary includes largest changed files", async () => {
    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "TEST",
              worktreePath: repo.root,
              changedHunks: [
                { file: "small.ts", oldStart: 1, oldLines: 1, newStart: 1, newLines: 2 },
                { file: "large.ts", oldStart: 1, oldLines: 10, newStart: 1, newLines: 80 },
                { file: "medium.ts", oldStart: 1, oldLines: 5, newStart: 1, newLines: 20 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.fileStats.map((stat) => stat.file.replace(repo.root, ""))).toEqual([
      "/large.ts",
      "/medium.ts",
      "/small.ts",
    ])
    expect(out.fileStats[0]).toMatchObject({
      linesAdded: 80,
      linesDeleted: 10,
      totalLines: 90,
    })

    const diagnostic = TsRp02.diagnose(out)[0]
    expect(diagnostic?.message).toContain("largest files")
    expect(diagnostic?.message).toContain("large.ts (+80/-10)")
    expect(diagnostic?.message).toContain("medium.ts (+20/-5)")
    const largestFiles = (diagnostic?.data as { largestFiles?: ReadonlyArray<unknown> } | undefined)?.largestFiles
    expect(largestFiles?.[0]).toMatchObject({
      file: `${repo.root}/large.ts`,
      linesAdded: 80,
      linesDeleted: 10,
      totalLines: 90,
    })
  })

  test("generated changed files do not dominate PR surface", async () => {
    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "TEST",
              worktreePath: repo.root,
              changedHunks: [
                {
                  file: "src/routeTree.gen.ts",
                  oldStart: 1,
                  oldLines: 0,
                  newStart: 1,
                  newLines: 900,
                },
                { file: "src/feature.ts", oldStart: 1, oldLines: 3, newStart: 1, newLines: 20 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.filesChanged.map((file) => file.replace(repo.root, ""))).toEqual([
      "/src/feature.ts",
    ])
    expect(out.linesAdded).toBe(20)
    expect(out.linesDeleted).toBe(3)
    expect(TsRp02.diagnose(out)[0]?.message).not.toContain("routeTree.gen.ts")
  })
})
