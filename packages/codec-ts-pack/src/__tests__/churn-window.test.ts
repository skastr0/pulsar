import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SignalContextTag } from "@taste-codec/core"
import { Effect, Layer } from "effect"
import { SharedChurn01 } from "../signals/shared-churn-01.js"

let repo: string

const git = (args: Array<string>, env?: Record<string, string>): void => {
  const result = spawnSync("git", args, {
    cwd: repo,
    env: { ...process.env, ...(env ?? {}) },
    encoding: "utf-8",
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  }
}

const makeCommit = (path: string, content: string, dateIso: string): void => {
  writeFileSync(join(repo, path), content)
  git(["add", path])
  git(["commit", "-m", `edit ${path}`], {
    GIT_AUTHOR_DATE: dateIso,
    GIT_COMMITTER_DATE: dateIso,
  })
}

const writeFileSync = (path: string, content: string): void => {
  // bun's sync fs works fine; use the promise version to keep imports minimal
  require("node:fs").writeFileSync(path, content)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "taste-codec-churn-"))
  git(["init", "-q"])
  git(["config", "user.email", "test@example.com"])
  git(["config", "user.name", "Test"])
  await writeFile(join(repo, "seed.ts"), "export const seed = 0\n")
  git(["add", "seed.ts"])
  git(["commit", "-m", "seed", "-q"], {
    GIT_AUTHOR_DATE: "2024-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2024-01-01T00:00:00Z",
  })
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe("SHARED-CHURN-01 window anchoring", () => {
  test("window is relative to HEAD's date, not wall-clock now", async () => {
    // HEAD from Jan 2024. Churn files touched in Dec 2023 should be
    // visible under window_days=90. They must NOT be filtered by
    // real today's date.
    makeCommit("a.ts", "export const a = 1\n", "2023-12-15T00:00:00Z")
    makeCommit("a.ts", "export const a = 2\n", "2023-12-20T00:00:00Z")
    makeCommit("a.ts", "export const a = 3\n", "2024-01-05T00:00:00Z")

    const run = SharedChurn01.compute(
      { ...SharedChurn01.defaultConfig, window_days: 90 },
      new Map(),
    ).pipe(
      Effect.provide(
        Layer.succeed(SignalContextTag, {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [],
        }),
      ),
    )
    const out = await Effect.runPromise(run as Effect.Effect<any, any, never>)
    const aChurn = out.byFile.get(join(repo, "a.ts"))
    expect(aChurn).toBe(3)
  })

  test("commits outside the window are excluded", async () => {
    // Two edits long before the 90-day window from HEAD; should not count.
    makeCommit("b.ts", "1\n", "2020-01-01T00:00:00Z")
    makeCommit("b.ts", "2\n", "2020-02-01T00:00:00Z")
    // One edit inside the window (HEAD date is this commit's date).
    makeCommit("b.ts", "3\n", "2024-06-01T00:00:00Z")

    const run = SharedChurn01.compute(
      { ...SharedChurn01.defaultConfig, window_days: 90 },
      new Map(),
    ).pipe(
      Effect.provide(
        Layer.succeed(SignalContextTag, {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [],
        }),
      ),
    )
    const out = await Effect.runPromise(run as Effect.Effect<any, any, never>)
    const bChurn = out.byFile.get(join(repo, "b.ts"))
    expect(bChurn).toBe(1)
  })
})
