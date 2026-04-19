import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SignalContextTag } from "@taste-codec/core"
import { TsDe05 } from "../signals/ts-de-05-duplicate-versions.js"
import { createTempRepo, type TempRepo } from "./test-repo.js"

let repo: TempRepo

beforeEach(async () => {
  repo = await createTempRepo("taste-codec-ts-de-05-")
})

afterEach(async () => {
  await repo.cleanup()
})

const runCompute = async () =>
  Effect.runPromise(
    TsDe05.compute(TsDe05.defaultConfig, new Map()).pipe(
      Effect.provideService(SignalContextTag, {
        gitSha: "TEST",
        worktreePath: repo.root,
        changedHunks: [],
      }),
    ) as Effect.Effect<Awaited<ReturnType<typeof TsDe05.compute>> extends Effect.Effect<infer A, any, any> ? A : never, unknown, never>,
  )

describe("TS-DE-05 (duplicate dependency versions)", () => {
  test("reports no duplicates for a flat lockfile", async () => {
    await repo.write(
      "bun.lock",
      [
        "{",
        '  "lockfileVersion": 1,',
        '  "workspaces": { "": { "name": "workspace" } },',
        '  "packages": {',
        '    "alpha": ["alpha@1.0.0", "", {}, "hash"],',
        '    "beta": ["beta@2.0.0", "", {}, "hash"]',
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.duplicates).toHaveLength(0)
    expect(TsDe05.score(out)).toBe(1)
  })

  test("groups duplicate versions and records workspace pull-in chains", async () => {
    await repo.write(
      "bun.lock",
      [
        "{",
        '  "lockfileVersion": 1,',
        '  "workspaces": {',
        '    "packages/app": {',
        '      "name": "@repo/app",',
        '      "dependencies": { "alpha": "1.0.0", "wrapper": "1.0.0" }',
        "    }",
        "  },",
        '  "packages": {',
        '    "alpha": ["alpha@1.0.0", "", {}, "hash"],',
        '    "wrapper": ["wrapper@1.0.0", "", { "dependencies": { "alpha": "2.0.0" } }, "hash"],',
        '    "wrapper/alpha": ["alpha@2.0.0", "", {}, "hash"]',
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.duplicates).toHaveLength(1)
    expect(out.duplicates[0]?.name).toBe("alpha")
    expect(out.duplicates[0]?.versions).toEqual(["1.0.0", "2.0.0"])
    expect(out.duplicates[0]?.pullInChains).toContainEqual({
      version: "2.0.0",
      chain: ["@repo/app", "wrapper", "alpha"],
    })
  })

  test("unsupported lockfiles surface a not-yet-supported error", async () => {
    await repo.write("package-lock.json", "{}")
    await expect(runCompute()).rejects.toThrow(/not yet supported/i)
  })
})
