import { spawnSync } from "node:child_process"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ScoringEngineLayer, ScoringEngineTag, buildRegistry } from "@skastr0/pulsar-core/scoring"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
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

const revListCount = (fromSha: string, toSha: string): number => {
  const out = spawnSync("git", ["rev-list", "--count", `${fromSha}..${toSha}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
  if (out.status !== 0) {
    throw new Error(`git rev-list --count ${fromSha}..${toSha} failed: ${out.stderr.trim()}`)
  }
  return Number.parseInt(out.stdout.trim(), 10)
}

describe("ScoringEngine + TS pack integration", () => {
  test(
    "scoreCommit(TS-RP-01) at HEAD produces a score and tears down the worktree",
    async () => {
      const { existsSync, readdirSync } = await import("node:fs")
      const { tmpdir } = await import("node:os")
      const { join } = await import("node:path")

      const head = revParse("HEAD")
      const prefix = `pulsar-worktree-${head.slice(0, 12)}-`
      const preexisting = new Set(
        readdirSync(tmpdir()).filter(
          (name) => name.startsWith(prefix) && existsSync(join(tmpdir(), name)),
        ),
      )
      const program = Effect.gen(function* () {
        const registry = yield* buildRegistry([...SHARED_SIGNALS, ...TS_PACK_SIGNALS])
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
      expect(result.signalId).toBe("TS-RP-01-hotspots")
      expect(typeof result.score).toBe("number")
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1)
      expect(result.output).toBeDefined()
      expect(Array.isArray(result.diagnostics)).toBe(true)

      // No worktree dirs should linger in tmpdir with our HEAD prefix.
      const lingering = await waitForNoNewWorktrees(prefix, preexisting)
      expect(lingering.length).toBe(0)
    },
    120_000,
  )

  test(
    "scoreRange across a recent range on main — all get scored, concurrency 2",
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
      const expectedCount = revListCount(fromSha, head)

      const program = Effect.gen(function* () {
        const registry = yield* buildRegistry([...SHARED_SIGNALS, ...TS_PACK_SIGNALS])
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
      expect(results.length).toBe(expectedCount)
      for (const r of results) {
        expect(r.sha).toMatch(/^[0-9a-f]{7,}$/)
        expect(r.result.signalId).toBe("TS-RP-01-hotspots")
        expect(typeof r.result.score).toBe("number")
      }
    },
    300_000,
  )

  test(
    "scoreCommit twice at the same HEAD returns stable cached-compatible results",
    async () => {
      const head = revParse("HEAD")
      const program = Effect.gen(function* () {
        const registry = yield* buildRegistry([...SHARED_SIGNALS, ...TS_PACK_SIGNALS])
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

        const r1 = yield* engine.scoreCommit(REPO_ROOT, head, "TS-RP-01")
        const r2 = yield* engine.scoreCommit(REPO_ROOT, head, "TS-RP-01")

        return { r1, r2 }
      })

      const { r1, r2 } = await Effect.runPromise(program)
      expect(r1.score).toBe(r2.score)
      expect(r1.output).toEqual(r2.output)
      expect(r1.diagnostics).toEqual(r2.diagnostics)
    },
    120_000,
  )
})

const waitForNoNewWorktrees = async (
  prefix: string,
  preexisting: ReadonlySet<string>,
): Promise<ReadonlyArray<string>> => {
  const { existsSync, readdirSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")

  let lingering: Array<string> = []
  for (let attempt = 0; attempt < 50; attempt += 1) {
    lingering = readdirSync(tmpdir()).filter(
      (name) =>
        name.startsWith(prefix) &&
        !preexisting.has(name) &&
        existsSync(join(tmpdir(), name)),
    )
    if (lingering.length === 0) return []
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return lingering
}
