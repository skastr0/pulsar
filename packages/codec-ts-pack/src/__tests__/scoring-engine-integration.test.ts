import { spawnSync } from "node:child_process"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import {
  ScoringEngineLayer,
  ScoringEngineTag,
  buildRegistry,
} from "@taste-codec/core"
import { TsProjectLayer } from "../ts-project.js"
import { TS_PACK_SIGNALS } from "../pack.js"

/**
 * Integration tests for the ScoringEngine wired against the real TS
 * signal pack and this repository's git history. These are slow (each
 * scored commit rebuilds a ts-morph Project over a fresh worktree) —
 * they are the end-to-end assertion that the engine's Scope-bound
 * worktree lifecycle and the ts-morph layer compose cleanly.
 */
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname

const revParse = (ref: string): string => {
  const out = spawnSync("git", ["rev-parse", ref], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
  if (out.status !== 0) {
    throw new Error(`git rev-parse ${ref} failed: ${out.stderr.trim()}`)
  }
  return out.stdout.trim()
}

describe("ScoringEngine + TS pack integration", () => {
  test(
    "scoreCommit(TS-RP-01) at HEAD produces a score and tears down the worktree",
    async () => {
      const { existsSync, readdirSync } = await import("node:fs")
      const { tmpdir } = await import("node:os")
      const { join } = await import("node:path")

      const head = revParse("HEAD")
      const program = Effect.gen(function* () {
        const registry = yield* buildRegistry(TS_PACK_SIGNALS)
        const EngineLayer = ScoringEngineLayer(
          registry,
          (worktreePath) => TsProjectLayer(worktreePath),
        )
        const engine = yield* (
          ScoringEngineTag.pipe(Effect.provide(EngineLayer)) as Effect.Effect<
            typeof ScoringEngineTag.Service,
            never,
            never
          >
        )
        return yield* engine.scoreCommit(REPO_ROOT, head, "TS-RP-01")
      })

      const result = await Effect.runPromise(program)
      expect(result.signalId).toBe("TS-RP-01")
      expect(typeof result.score).toBe("number")
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1)
      expect(result.output).toBeDefined()
      expect(Array.isArray(result.diagnostics)).toBe(true)

      // No worktree dirs should linger in tmpdir with our HEAD prefix.
      const prefix = `taste-codec-worktree-${head.slice(0, 12)}-`
      const lingering = readdirSync(tmpdir()).filter(
        (name) => name.startsWith(prefix) && existsSync(join(tmpdir(), name)),
      )
      expect(lingering.length).toBe(0)
    },
    120_000,
  )

  test(
    "scoreRange across the last 5 commits on main — all get scored, concurrency 2",
    async () => {
      const head = revParse("HEAD")
      let fromSha: string
      try {
        fromSha = revParse("HEAD~5")
      } catch {
        // Not enough history for HEAD~5 — skip. This keeps the test
        // green on fresh shallow clones.
        console.warn("Skipping scoreRange integration — not enough history")
        return
      }

      const program = Effect.gen(function* () {
        const registry = yield* buildRegistry(TS_PACK_SIGNALS)
        const EngineLayer = ScoringEngineLayer(
          registry,
          (worktreePath) => TsProjectLayer(worktreePath),
        )
        const engine = yield* (
          ScoringEngineTag.pipe(Effect.provide(EngineLayer)) as Effect.Effect<
            typeof ScoringEngineTag.Service,
            never,
            never
          >
        )
        return yield* engine.scoreRange(
          REPO_ROOT,
          fromSha,
          head,
          "TS-RP-01",
          { concurrency: 2 },
        )
      })

      const results = await Effect.runPromise(program)
      expect(results.length).toBe(5)
      for (const r of results) {
        expect(r.sha).toMatch(/^[0-9a-f]{7,}$/)
        expect(r.result.signalId).toBe("TS-RP-01")
        expect(typeof r.result.score).toBe("number")
      }
    },
    300_000,
  )

  test(
    "scoreCommit twice at the same HEAD hits the cache (second call is much faster)",
    async () => {
      const head = revParse("HEAD")
      const program = Effect.gen(function* () {
        const registry = yield* buildRegistry(TS_PACK_SIGNALS)
        const EngineLayer = ScoringEngineLayer(
          registry,
          (worktreePath) => TsProjectLayer(worktreePath),
        )
        const engine = yield* (
          ScoringEngineTag.pipe(Effect.provide(EngineLayer)) as Effect.Effect<
            typeof ScoringEngineTag.Service,
            never,
            never
          >
        )

        const t1 = Date.now()
        const r1 = yield* engine.scoreCommit(REPO_ROOT, head, "TS-RP-01")
        const d1 = Date.now() - t1

        const t2 = Date.now()
        const r2 = yield* engine.scoreCommit(REPO_ROOT, head, "TS-RP-01")
        const d2 = Date.now() - t2

        return { r1, r2, d1, d2 }
      })

      const { r1, r2, d1, d2 } = await Effect.runPromise(program)
      expect(r1.score).toBe(r2.score)
      // Second call should be dramatically faster — no worktree, no
      // ts-morph Project. Use a generous multiplier to avoid flakes on
      // fast machines where both calls complete sub-second.
      expect(d2).toBeLessThan(Math.max(100, d1 / 5))
    },
    120_000,
  )
})
