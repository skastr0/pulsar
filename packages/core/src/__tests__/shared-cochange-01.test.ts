import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "../context.js"
import { SharedCochange01, cochangePairKey } from "../shared-cochange-01.js"
import { createGitTestRepo } from "./git-test-repo.js"

const runCochange = async (
  repo: Awaited<ReturnType<typeof createGitTestRepo>>,
  config: Partial<typeof SharedCochange01.defaultConfig> = {},
) =>
  Effect.runPromise(
    SharedCochange01.compute(
      { ...SharedCochange01.defaultConfig, ...config },
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

describe("SHARED-COCHANGE-01 logical coupling", () => {
  test("emits sorted repeated co-change pairs with support and confidence", async () => {
    const repo = await createGitTestRepo("pulsar-cochange-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.write("src/b.ts", "export const b = 1\n")
      await repo.commitAll({ message: "a and b", dateIso: "2024-01-01T00:00:00Z" })
      await repo.write("src/a.ts", "export const a = 2\n")
      await repo.write("src/b.ts", "export const b = 2\n")
      await repo.commitAll({ message: "a and b again", dateIso: "2024-01-02T00:00:00Z" })
      await repo.write("src/a.ts", "export const a = 3\n")
      await repo.commitAll({ message: "a only", dateIso: "2024-01-03T00:00:00Z" })

      const out = await runCochange(repo)
      const leftFile = join(repo.root, "src/a.ts")
      const rightFile = join(repo.root, "src/b.ts")
      expect(out.pairs).toHaveLength(1)
      expect(out.pairs[0]).toEqual({
        leftFile,
        rightFile,
        coChangeCount: 2,
        leftTouchCount: 3,
        rightTouchCount: 2,
        support: 2 / 3,
        confidence: 2 / 3,
        lastCoChangedAt: "2024-01-02T00:00:00.000Z",
      })
      expect(out.byPair.get(cochangePairKey(rightFile, leftFile))).toBe(out.pairs[0])
    } finally {
      await repo.cleanup()
    }
  })

  test("single-file commits do not produce pairs and filters apply", async () => {
    const repo = await createGitTestRepo("pulsar-cochange-filter-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({ message: "a", dateIso: "2024-01-01T00:00:00Z" })
      await repo.write("src/a.test.ts", "test('x', () => {})\n")
      await repo.write("src/b.ts", "export const b = 1\n")
      await repo.commitAll({ message: "test and b", dateIso: "2024-01-02T00:00:00Z" })
      await repo.write("src/only.test.ts", "test('only', () => {})\n")
      await repo.commitAll({ message: "test only", dateIso: "2024-01-03T00:00:00Z" })

      const out = await runCochange(repo, { min_co_change_count: 1 })
      expect(out.pairs).toEqual([])
      expect(out.totalCommits).toBe(2)
    } finally {
      await repo.cleanup()
    }
  })

  test("max commits marks sampled history", async () => {
    const repo = await createGitTestRepo("pulsar-cochange-sampled-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.write("src/b.ts", "export const b = 1\n")
      await repo.commitAll({ message: "a b", dateIso: "2024-01-01T00:00:00Z" })
      await repo.write("src/a.ts", "export const a = 2\n")
      await repo.write("src/b.ts", "export const b = 2\n")
      await repo.commitAll({ message: "a b 2", dateIso: "2024-01-02T00:00:00Z" })

      const out = await runCochange(repo, { max_commits: 1, min_co_change_count: 1 })
      expect(out.totalCommits).toBe(1)
      expect(out.sampled).toBe(true)
    } finally {
      await repo.cleanup()
    }
  })

  test("diagnostics honor top_n_diagnostics", async () => {
    const repo = await createGitTestRepo("pulsar-cochange-topn-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.write("src/b.ts", "export const b = 1\n")
      await repo.commitAll({ message: "a b", dateIso: "2024-01-01T00:00:00Z" })

      const out = await runCochange(repo, {
        min_co_change_count: 1,
        top_n_diagnostics: 0,
      })
      expect(out.pairs).toHaveLength(1)
      expect(SharedCochange01.diagnose(out)).toEqual([])
    } finally {
      await repo.cleanup()
    }
  })
})
