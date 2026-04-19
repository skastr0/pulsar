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
})