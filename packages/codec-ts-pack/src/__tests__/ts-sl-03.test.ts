import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "@taste-codec/core"
import { createTempRepo, runSignal } from "./test-repo.js"
import { TsSl03 } from "../signals/ts-sl-03-suppressions.js"
import { TsProjectLayer } from "../ts-project.js"
import type { TempRepo } from "./test-repo.js"

describe("TS-SL-03 Suppression growth", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("ts-sl-03-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("detects @ts-ignore without justification", async () => {
    await repo.write(
      "utils.ts",
      `
// @ts-ignore
const x: string = 123;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.length).toBe(1)
    expect(out.suppressions[0]?.kind).toBe("ts-ignore")
    expect(out.suppressions[0]?.justification).toBe("missing")
    expect(out.missingJustificationCount).toBe(1)
  })

  test("detects @ts-expect-error without justification", async () => {
    await repo.write(
      "utils.ts",
      `
// @ts-expect-error
const y: string = 123;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.some((s) => s.kind === "ts-expect-error")).toBe(true)
  })

  test("detects eslint-disable without justification", async () => {
    await repo.write(
      "utils.ts",
      `
// eslint-disable-next-line no-console
console.log("test");
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.some((s) => s.kind === "eslint-disable")).toBe(true)
  })

  test("accepts justified suppressions", async () => {
    await repo.write(
      "utils.ts",
      `
// taste-allow BUG-123 until:2026-12-01 temporary type mismatch during migration
// @ts-ignore
const z: string = 123;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.length).toBe(1)
    expect(out.suppressions[0]?.justification).toBe("active")
    expect(out.missingJustificationCount).toBe(0)
  })

  test("flags expired justifications", async () => {
    await repo.write(
      "utils.ts",
      `
// taste-allow BUG-123 until:2020-01-01 expired
// @ts-ignore
const w: string = 123;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions[0]?.justification).toBe("expired")
    expect(out.expiredCount).toBe(1)
  })

  test("score is 0 when unjustified suppressions exist", async () => {
    await repo.write(
      "utils.ts",
      `
// @ts-ignore
const x = 1;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(TsSl03.score(out)).toBe(0)
  })

  test("score is 1 when no suppressions", async () => {
    await repo.write(
      "utils.ts",
      `
const x = 1;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(TsSl03.score(out)).toBe(1)
  })

  test("diagnostics include hash for ratcheting", async () => {
    await repo.write(
      "utils.ts",
      `
// @ts-ignore
const x = 1;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    const diagnostics = TsSl03.diagnose(out)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.data?.hash).toBeDefined()
    expect(typeof diagnostics[0]?.data?.hash).toBe("string")
  })

  test("diff-aware: only flags suppressions in changed hunks", async () => {
    await repo.write(
      "utils.ts",
      `
const unchanged = 1;
// @ts-ignore
const changed = 2;
`,
    )

    const out = await Effect.runPromise(
      TsSl03.compute(
        TsSl03.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "TEST",
              worktreePath: repo.root,
              changedHunks: [
                { file: "utils.ts", oldStart: 3, oldLines: 0, newStart: 3, newLines: 2 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.scopeMode).toBe("changed-hunks")
  })
})