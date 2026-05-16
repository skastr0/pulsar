import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "../context.js"
import { SharedChurn02 } from "../shared-churn-02.js"
import { createGitTestRepo } from "./git-test-repo.js"

const runWeightedChurn = async (
  repo: Awaited<ReturnType<typeof createGitTestRepo>>,
  config: Partial<typeof SharedChurn02.defaultConfig> = {},
) =>
  Effect.runPromise(
    SharedChurn02.compute(
      { ...SharedChurn02.defaultConfig, ...config },
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

describe("SHARED-CHURN-02 recency-weighted churn", () => {
  test("newer touches carry more weight while raw churn remains visible", async () => {
    const repo = await createGitTestRepo("pulsar-weighted-churn-")
    try {
      await repo.write("src/old.ts", "export const oldValue = 1\n")
      await repo.commitAll({ message: "old", dateIso: "2024-02-01T00:00:00Z" })
      await repo.write("src/new.ts", "export const newValue = 1\n")
      await repo.commitAll({ message: "new", dateIso: "2024-03-01T00:00:00Z" })

      const out = await runWeightedChurn(repo, { half_life_days: 14 })
      const oldChurn = out.byFile.get(join(repo.root, "src/old.ts"))
      const newChurn = out.byFile.get(join(repo.root, "src/new.ts"))
      expect(oldChurn?.rawWindowChurn).toBe(1)
      expect(newChurn?.rawWindowChurn).toBe(1)
      expect(newChurn?.weightedChurn).toBeGreaterThan(oldChurn?.weightedChurn ?? 0)
      expect(newChurn?.lastTouchedAt).toBe("2024-03-01T00:00:00.000Z")
    } finally {
      await repo.cleanup()
    }
  })

  test("half-life config changes the deterministic weighted output", async () => {
    const repo = await createGitTestRepo("pulsar-weighted-churn-half-life-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({ message: "a", dateIso: "2024-02-01T00:00:00Z" })
      await repo.write("src/head.ts", "export const head = 1\n")
      await repo.commitAll({ message: "head", dateIso: "2024-03-01T00:00:00Z" })

      const shortHalfLife = await runWeightedChurn(repo, { half_life_days: 7 })
      const longHalfLife = await runWeightedChurn(repo, { half_life_days: 28 })
      const file = join(repo.root, "src/a.ts")
      expect(longHalfLife.byFile.get(file)?.weightedChurn).toBeGreaterThan(
        shortHalfLife.byFile.get(file)?.weightedChurn ?? 0,
      )
    } finally {
      await repo.cleanup()
    }
  })

  test("excludes test and generated paths from churn and commit counts", async () => {
    const repo = await createGitTestRepo("pulsar-weighted-churn-filter-")
    try {
      await repo.write("src/a.test.ts", "test('x', () => {})\n")
      await repo.write("src/_generated/api.ts", "export const generated = 1\n")
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({ message: "files", dateIso: "2024-03-01T00:00:00Z" })
      await repo.write("src/only.test.ts", "test('only', () => {})\n")
      await repo.commitAll({ message: "test only", dateIso: "2024-03-02T00:00:00Z" })

      const out = await runWeightedChurn(repo)
      expect([...out.byFile.keys()]).toEqual([join(repo.root, "src/a.ts")])
      expect(out.totalCommits).toBe(1)
      expect(out.sampled).toBe(false)
    } finally {
      await repo.cleanup()
    }
  })

  test("diagnostics honor top_n_diagnostics", async () => {
    const repo = await createGitTestRepo("pulsar-weighted-churn-topn-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({ message: "a", dateIso: "2024-03-01T00:00:00Z" })

      const out = await runWeightedChurn(repo, { top_n_diagnostics: 0 })
      expect(out.byFile.size).toBe(1)
      expect(SharedChurn02.diagnose(out)).toEqual([])
    } finally {
      await repo.cleanup()
    }
  })
})
