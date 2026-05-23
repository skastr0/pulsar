import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import {
  appendCalibrationDecision,
  CalibrationContextTag,
  defineCalibrationProcessor,
} from "../calibration-model.js"
import { makeResolvedCalibrationContext } from "../calibration-context.js"
import { SignalContextTag } from "../context.js"
import {
  Shared03ChurnRate,
  type Shared03ChurnRateOutput,
} from "../shared-03-churn-rate.js"
import { createGitTestRepo } from "./git-test-repo.js"

describe("SHARED-03 churn rate", () => {
  test("treats unchanged lines as retained after the revert window", async () => {
    const repo = await createGitTestRepo("pulsar-shared-03-retained-")
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
    const repo = await createGitTestRepo("pulsar-shared-03-reverted-")
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

  test("project modules can neutralize churn pressure with factor provenance", async () => {
    const repo = await createGitTestRepo("pulsar-shared-03-policy-")
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

      const processor = defineCalibrationProcessor({
        id: "active-cleanup-churn",
        moduleId: "acme.project",
        moduleVersion: "1.0.0",
        slot: "shared.churn-rate-policy",
        role: "factor-policy",
        priority: 10,
        fingerprint: "active-cleanup-churn-v1",
        process: (current) =>
          Effect.succeed(
            appendCalibrationDecision(
              current,
              {
                moduleId: "acme.project",
                processorId: "active-cleanup-churn",
                slot: "shared.churn-rate-policy",
                action: "tune-active-cleanup-churn",
                confidence: "high",
                reason: "Project module marks this churn as intentional cleanup pressure",
                ruleId: "acme.shared.churn.active-cleanup",
                factorPaths: [
                  `${current.value.factorPathPrefix}.penalty_weight`,
                  `${current.value.factorPathPrefix}.severity`,
                ],
                before: current.value,
                after: { ...current.value, penaltyWeight: 0, severity: "info" as const },
                evidence: [{ kind: "path", value: current.value.file }],
              },
              { ...current.value, penaltyWeight: 0, severity: "info" },
            ),
          ),
      })
      const calibrationContext = makeResolvedCalibrationContext({
        repoFacts: {
          repoRoot: repo.root,
          fingerprint: "repo-facts-v1",
          detectedTechnologies: ["typescript"],
          sourceExtensions: [".ts"],
        },
        processors: [processor],
      })

      const output: Shared03ChurnRateOutput = await Effect.runPromise(
        Shared03ChurnRate.compute(Shared03ChurnRate.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(CalibrationContextTag, calibrationContext),
              Layer.succeed(SignalContextTag, {
                gitSha: repo.revParse("HEAD"),
                worktreePath: repo.root,
                changedHunks: [],
              }),
            ),
          ),
        ) as Effect.Effect<Shared03ChurnRateOutput, unknown, never>,
      )

      const filePath = join(repo.root, "src/revert.ts")
      const effective = output.effectiveFiles?.find((entry) => entry.file === filePath)
      expect(Shared03ChurnRate.score(output)).toBe(1)
      expect(Shared03ChurnRate.diagnose(output)).toEqual([])
      expect(effective?.penaltyWeight).toBe(0)
      expect(effective?.policyDecisions[0]?.ruleId).toBe(
        "acme.shared.churn.active-cleanup",
      )
      expect(output.factorLedger?.entries).toContainEqual(
        expect.objectContaining({
          path: `${effective?.factorPathPrefix}.penalty_weight`,
          value: 0,
          source: "module",
          attribution: expect.objectContaining({
            moduleId: "acme.project",
            processorId: "active-cleanup-churn",
          }),
        }),
      )
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("ignores uncommitted working-tree edits when measuring mature churn", async () => {
    const repo = await createGitTestRepo("pulsar-shared-03-dirty-")
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
    const repo = await createGitTestRepo("pulsar-shared-03-rename-")
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

  test("counts mature files deleted before HEAD as fully churned", async () => {
    const repo = await createGitTestRepo("pulsar-shared-03-deleted-")
    try {
      await repo.write("src/deleted.ts", churnLines("deleted"))
      await repo.commitAll({
        message: "introduce deleted file",
        dateIso: "2024-01-01T00:00:00Z",
      })

      await rm(join(repo.root, "src/deleted.ts"))
      await repo.commitAll({
        message: "delete file",
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

      expect(output.byFile.get(join(repo.root, "src/deleted.ts"))).toEqual({
        introduced: 3,
        churned: 3,
        rate: 1,
      })
      expect(output.churnRate).toBe(1)
      expect(Shared03ChurnRate.score(output)).toBe(0)
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  test("remaps mature lines when rename and edit happen in the same commit", async () => {
    const repo = await createGitTestRepo("pulsar-shared-03-rename-edit-")
    try {
      await repo.write("src/original.ts", longChurnLines("rename", 10))
      await repo.commitAll({
        message: "introduce original file",
        dateIso: "2024-01-01T00:00:00Z",
      })

      runGit(repo.root, ["mv", "src/original.ts", "src/renamed.ts"])
      await repo.write(
        "src/renamed.ts",
        longChurnLines("rename", 9) + "export const replacement = 999\n",
      )
      await repo.commitAll({
        message: "rename and edit",
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

  test("returns a neutral score when the repo has no mature window yet", async () => {
    const repo = await createGitTestRepo("pulsar-shared-03-insufficient-")
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
    const repo = await createGitTestRepo("pulsar-shared-03-excludes-")
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

  test("max mature commit cap counts source commits instead of docs-only commits", async () => {
    const repo = await createGitTestRepo("pulsar-shared-03-source-cap-")
    try {
      await repo.write("src/source.ts", churnLines("source"))
      await repo.commitAll({
        message: "introduce source lines",
        dateIso: "2024-01-01T00:00:00Z",
      })

      for (let index = 0; index < 3; index += 1) {
        await repo.write("README.md", `docs ${index}\n`)
        await repo.commitAll({
          message: `docs ${index}`,
          dateIso: `2024-01-0${index + 2}T00:00:00Z`,
        })
      }

      await repo.write("README.md", "head\n")
      await repo.commitAll({
        message: "advance head",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const output = await Effect.runPromise(
        Shared03ChurnRate.compute(
          { ...Shared03ChurnRate.defaultConfig, max_mature_commits: 1 },
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

  test("diagnostics rank by churned-line impact and include repo context", () => {
    const root = "/repo"
    const output = {
      churnedLineCount: 15,
      introducedLineCount: 40,
      churnRate: 0.375,
      windowDays: 14,
      topDiagnostics: 10,
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

const longChurnLines = (label: string, count: number): string =>
  Array.from({ length: count }, (_, index) => `export const ${label}${index} = ${index}`).join(
    "\n",
  ) + "\n"

const runGit = (cwd: string, args: ReadonlyArray<string>): void => {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
}
