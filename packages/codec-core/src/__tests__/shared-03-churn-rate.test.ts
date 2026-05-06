import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "../context.js"
import { Shared03ChurnRate } from "../shared-03-churn-rate.js"
import { createGitTestRepo } from "./git-test-repo.js"

describe("SHARED-03 churn rate", () => {
  test("treats unchanged lines as retained after the revert window", async () => {
    const repo = await createGitTestRepo("taste-codec-shared-03-retained-")
    try {
      await repo.write("src/retain.ts", "export const a = 1\nexport const b = 2\n")
      await repo.commitAll({
        message: "introduce lines",
        dateIso: "2024-01-01T00:00:00Z",
      })

      await repo.write("README.md", "noop\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await Effect.runPromise(
        Shared03ChurnRate.compute(Shared03ChurnRate.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.succeed(SignalContextTag, {
              gitSha: repo.revParse("HEAD"),
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ) as Effect.Effect<any, any, never>,
      )

      expect(output.insufficientHistory).toBe(false)
      expect(output.churnRate).toBe(0)
      expect(output.byFile.get(join(repo.root, "src/retain.ts"))).toEqual({
        introduced: 2,
        churned: 0,
        rate: 0,
      })
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("marks reverted lines as churned within the window", async () => {
    const repo = await createGitTestRepo("taste-codec-shared-03-reverted-")
    try {
      await repo.write("src/revert.ts", "export const doomed = 1\n")
      await repo.commitAll({
        message: "introduce doomed line",
        dateIso: "2024-01-01T00:00:00Z",
      })

      await repo.write("src/revert.ts", "")
      await repo.commitAll({
        message: "remove doomed line",
        dateIso: "2024-01-05T00:00:00Z",
      })

      await repo.write("README.md", "noop\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await Effect.runPromise(
        Shared03ChurnRate.compute(Shared03ChurnRate.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.succeed(SignalContextTag, {
              gitSha: repo.revParse("HEAD"),
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ) as Effect.Effect<any, any, never>,
      )

      expect(output.byFile.get(join(repo.root, "src/revert.ts"))).toEqual({
        introduced: 1,
        churned: 1,
        rate: 1,
      })
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("ignores uncommitted working-tree edits when measuring mature churn", async () => {
    const repo = await createGitTestRepo("taste-codec-shared-03-dirty-")
    try {
      await repo.write("src/dirty.ts", "export const stable = 1\n")
      await repo.commitAll({
        message: "introduce stable line",
        dateIso: "2024-01-01T00:00:00Z",
      })

      await repo.write("README.md", "noop\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      await repo.write("src/dirty.ts", "")

      const output = await Effect.runPromise(
        Shared03ChurnRate.compute(Shared03ChurnRate.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.succeed(SignalContextTag, {
              gitSha: repo.revParse("HEAD"),
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ) as Effect.Effect<any, any, never>,
      )

      expect(output.byFile.get(join(repo.root, "src/dirty.ts"))).toEqual({
        introduced: 1,
        churned: 0,
        rate: 0,
      })
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("handles renames and partial churn with similarity matching", async () => {
    const repo = await createGitTestRepo("taste-codec-shared-03-rename-")
    try {
      await repo.write(
        "src/original.ts",
        "export const stable = 1\nexport const mutable = 2\n",
      )
      await repo.commitAll({
        message: "introduce file",
        dateIso: "2024-01-01T00:00:00Z",
      })

      await repo.rename("src/original.ts", "src/renamed.ts", {
        message: "rename file",
        dateIso: "2024-01-05T00:00:00Z",
      })

      await repo.write(
        "src/renamed.ts",
        "export const stable = 10\nexport const replacement = 999\n",
      )
      await repo.commitAll({
        message: "modify one line and replace another",
        dateIso: "2024-01-10T00:00:00Z",
      })

      await repo.write("README.md", "noop\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await Effect.runPromise(
        Shared03ChurnRate.compute(Shared03ChurnRate.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.succeed(SignalContextTag, {
              gitSha: repo.revParse("HEAD"),
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ) as Effect.Effect<any, any, never>,
      )

      expect(output.byFile.get(join(repo.root, "src/renamed.ts"))).toEqual({
        introduced: 2,
        churned: 1,
        rate: 0.5,
      })
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("returns a neutral score when the repo has no mature window yet", async () => {
    const repo = await createGitTestRepo("taste-codec-shared-03-insufficient-")
    try {
      await repo.write("src/recent.ts", "export const recent = true\n")
      await repo.commitAll({
        message: "recent line",
        dateIso: "2024-01-10T00:00:00Z",
      })

      await repo.write("README.md", "noop\n")
      await repo.commitAll({
        message: "head still too recent",
        dateIso: "2024-01-15T00:00:00Z",
      })

      const output = await Effect.runPromise(
        Shared03ChurnRate.compute(Shared03ChurnRate.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.succeed(SignalContextTag, {
              gitSha: repo.revParse("HEAD"),
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ) as Effect.Effect<any, any, never>,
      )

      expect(output.insufficientHistory).toBe(true)
      expect(output.churnRate).toBe(0)
      expect(Shared03ChurnRate.score(output)).toBe(1)
      expect(Shared03ChurnRate.diagnose(output)[0]?.severity).toBe("info")
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("excludes tests and hidden metadata directories from default production churn pressure", async () => {
    const repo = await createGitTestRepo("taste-codec-shared-03-excludes-")
    try {
      await repo.write("src/production.ts", churnLines("production"))
      await repo.write("src/production.test.ts", churnLines("test"))
      await repo.write("examples/demo.ts", churnLines("example"))
      await repo.write("fixtures/case.ts", churnLines("fixture"))
      await repo.write("playground/src/demo.ts", churnLines("playground"))
      await repo.write("src/_generated/api.d.ts", churnLines("generated"))
      await repo.write(".metadata/messages/policy.ts", churnLines("metadata"))
      await repo.write(".tooling/tool/triage.ts", churnLines("tool"))
      await repo.write(".cache-runtime/extensions/files.ts", churnLines("runtime"))
      await repo.write("src/happydom.ts", churnLines("dom"))
      await repo.commitAll({
        message: "introduce production and harness lines",
        dateIso: "2024-01-01T00:00:00Z",
      })

      await repo.write("README.md", "noop\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await Effect.runPromise(
        Shared03ChurnRate.compute(Shared03ChurnRate.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.succeed(SignalContextTag, {
              gitSha: repo.revParse("HEAD"),
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ) as Effect.Effect<any, any, never>,
      )

      expect([...output.byFile.keys()]).toEqual([join(repo.root, "src/production.ts")])
      expect(output.introducedLineCount).toBe(3)
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("diagnostics rank by churned-line impact and include repo context", () => {
    const root = "/repo"
    const output = {
      churnedLineCount: 15,
      introducedLineCount: 40,
      churnRate: 0.375,
      windowDays: 14,
      insufficientHistory: false,
      byFile: new Map([
        [
          join(root, "tiny.ts"),
          {
            introduced: 1,
            churned: 1,
            rate: 1,
          },
        ],
        [
          join(root, "stable.ts"),
          {
            introduced: 100,
            churned: 0,
            rate: 0,
          },
        ],
        [
          join(root, "large.ts"),
          {
            introduced: 30,
            churned: 10,
            rate: 1 / 3,
          },
        ],
        [
          join(root, "medium.ts"),
          {
            introduced: 9,
            churned: 4,
            rate: 4 / 9,
          },
        ],
      ]),
    }

    const diagnostics = Shared03ChurnRate.diagnose(output)

    expect(diagnostics.map((diagnostic) => diagnostic.location?.file)).toEqual([
      join(root, "large.ts"),
      join(root, "medium.ts"),
      join(root, "tiny.ts"),
    ])
    expect(diagnostics[0]?.message).toContain("33% file churn")
    expect(diagnostics[0]?.message).toContain("38% repo churn")
    expect(diagnostics[0]?.data).toMatchObject({
      repoIntroduced: 40,
      repoChurned: 15,
      repoRate: 0.375,
    })
  })
})

const churnLines = (label: string): string =>
  [
    `export const ${label}A = 1`,
    `export const ${label}B = 2`,
    `export const ${label}C = 3`,
    "",
  ].join("\n")
