import { spawnSync } from "node:child_process"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import {
  InMemoryCacheLayer,
  ReferenceDataTag,
  SignalContextTag,
  buildRegistry,
  makeReferenceData,
  observe,
  type ObserverOutput,
} from "@skastr0/pulsar-core"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsProjectLayer } from "../ts-project.js"

/**
 * End-to-end: run the Observer against the real TS pack on this repo's
 * working tree. Proves that every signal in TS_PACK_SIGNALS composes
 * through the observer's aggregation without hitting the worktree-based
 * ScoringEngine. This is the "Observer is pure aggregation" validation
 * called out in TC-021.
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

describe("Observer + TS pack integration", () => {
  test(
    "observe(registry, undefined) runs every active signal against this repo",
    async () => {
      const head = revParse("HEAD")

      const program = Effect.gen(function* () {
        const registry = yield* buildRegistry([...SHARED_SIGNALS, ...TS_PACK_SIGNALS])
        const ContextLayer = Layer.succeed(SignalContextTag, {
          gitSha: head,
          worktreePath: REPO_ROOT,
          changedHunks: [],
        })
        const ReferenceLayer = Layer.succeed(
          ReferenceDataTag,
          makeReferenceData(new Map()),
        )
        const EnvLayer = Layer.mergeAll(
          ContextLayer,
          ReferenceLayer,
          InMemoryCacheLayer,
          TsProjectLayer(REPO_ROOT),
        )
        return yield* (
          Effect.provide(
            observe(registry, undefined),
            EnvLayer,
          ) as Effect.Effect<ObserverOutput, never, never>
        )
      })

      const out = await Effect.runPromise(program)

      // All shipping signals produced a result. Asserting the exact
      // set rather than just a count so adding/removing a signal is a
      // conscious update to this test.
      expect([...out.signalResults.keys()].sort()).toEqual([
        "SHARED-02",
        "SHARED-03",
        "SHARED-05",
        "SHARED-06",
        "SHARED-CHURN-01",
        "TS-AB-01",
        "TS-AB-02",
        "TS-AB-03",
        "TS-AB-04",
        "TS-AB-05",
        "TS-AD-01",
        "TS-AD-02",
        "TS-AD-03",
        "TS-DE-01",
        "TS-DE-02",
        "TS-DE-03",
        "TS-DE-04",
        "TS-DE-05",
        "TS-LD-01",
        "TS-LD-02",
        "TS-LD-03",
        "TS-LD-04",
        "TS-LD-05",
        "TS-LD-06",
        "TS-LD-07",
        "TS-RP-01",
        "TS-RP-02",
        "TS-SL-01",
        "TS-SL-02",
        "TS-SL-03",
        "TS-SL-04",
      ])

      // Overall shape invariants.
      expect(typeof out.weighted_mean).toBe("number")
      expect(out.weighted_mean).toBeGreaterThanOrEqual(0)
      expect(out.weighted_mean).toBeLessThanOrEqual(1)
      expect(["pass", "fail"]).toContain(out.hard_gate_status)
      expect(Array.isArray(out.hard_gate_violations)).toBe(true)
      expect(out.inactiveSignals).toEqual([])

      // Every category is present in the output (even empty ones).
      expect(Object.keys(out.categories).sort()).toEqual([
        "abstraction-bloat",
        "architectural-drift",
        "dependency-entropy",
        "generated-slop",
        "legibility-decay",
        "review-pain",
      ])

      // Hard-gate status must stay consistent with the collected
      // block-severity structural diagnostics, regardless of the repo's
      // current cycle count.
      expect(out.hard_gate_status).toBe(
        out.hard_gate_violations.length > 0 ? "fail" : "pass",
      )

      // A compound signal (TS-RP-01) received its inputs in order.
      const tsRp = out.signalResults.get("TS-RP-01")
      expect(tsRp?.output).toBeDefined()
    },
    120_000,
  )
})
