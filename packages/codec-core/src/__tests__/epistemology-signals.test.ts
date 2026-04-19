import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "../context.js"
import { loadEpistemologySignals } from "../epistemology-signals.js"
import { buildRegistry } from "../registry.js"
import { observe } from "../observer.js"

describe("epistemology auto-signals", () => {
  test("loads rule ids from policy config and recorded policy packets", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "taste-epist-"))
    try {
      await mkdir(join(repoPath, ".opencode"), { recursive: true })
      await mkdir(join(repoPath, ".agents", "messages"), { recursive: true })
      await writeFile(
        join(repoPath, ".opencode", "policy.toml"),
        `[[rules]]\nid = "no-raw-sql"\n\n[[rules]]\nid = "no-force-push"\n`,
        "utf8",
      )
      await writeFile(
        join(
          repoPath,
          ".agents",
          "messages",
          "2026-04-19T10-00-00-000Z-epistemology-framework-policy-no-raw-sql.json",
        ),
        `${JSON.stringify(
          {
            content: {
              data: {
                rule_id: "no-raw-sql",
                message: "raw sql detected",
                paths: ["src/db.ts"],
              },
            },
            metadata: {
              timestamp: "2026-04-19T10:00:00.000Z",
              schema_id: "epistemology-framework/policy-violation/v1",
              blocking: true,
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      )

      const signals = await Effect.runPromise(loadEpistemologySignals(repoPath))
      expect(signals.map((signal) => signal.id)).toEqual([
        "EPIST-no-force-push",
        "EPIST-no-raw-sql",
      ])

      const registry = await Effect.runPromise(buildRegistry(signals))
      const output = await Effect.runPromise(
        Effect.provide(
          observe(registry, undefined),
          Layer.succeed(SignalContextTag, {
            gitSha: "abc123",
            worktreePath: repoPath,
            changedHunks: [],
          }),
        ) as Effect.Effect<any, never, never>,
      )

      expect(output.categories["generated-slop"].signals["EPIST-no-raw-sql"]).toBeLessThan(1)
      expect(output.categories["generated-slop"].signals["EPIST-no-force-push"]).toBe(1)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })
})
