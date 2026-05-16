import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SignalContextTag } from "@skastr0/pulsar-core/signal"
import { Effect, Layer } from "effect"
import { Shared07MachineFeedbackCoverage } from "../shared-07-machine-feedback-coverage.js"

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pulsar-feedback-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const runSignal = async () =>
  Effect.runPromise(
    Shared07MachineFeedbackCoverage.compute(
      Shared07MachineFeedbackCoverage.defaultConfig,
      new Map(),
    ).pipe(
      Effect.provide(
        Layer.succeed(SignalContextTag, {
          gitSha: "HEAD",
          worktreePath: tmp,
          changedHunks: [],
        }),
      ),
    ) as Effect.Effect<any, any, never>,
  )

describe("SHARED-07 machine feedback coverage", () => {
  test("detects local feedback from package scripts", async () => {
    await writeFile(
      join(tmp, "package.json"),
      JSON.stringify({
        scripts: {
          build: "tsc -b",
          typecheck: "tsc --noEmit",
          test: "bun test",
          lint: "eslint .",
        },
      }),
      "utf8",
    )

    const out = await runSignal()
    expect(out.state).toBe("present")
    expect(out.configuredClassCount).toBeGreaterThanOrEqual(4)
    expect(out.ciReachableClassCount).toBe(0)
    expect(out.classes.find((entry: any) => entry.class === "test")?.localCommands).toEqual(["test"])
  })

  test("resolves GitHub workflow commands through package script aliases", async () => {
    await writeFile(
      join(tmp, "package.json"),
      JSON.stringify({
        scripts: {
          verify: "bun run typecheck && bun run test && bun run build",
          coverage: "bun test --coverage",
        },
      }),
      "utf8",
    )
    await mkdir(join(tmp, ".github", "workflows"), { recursive: true })
    await writeFile(
      join(tmp, ".github", "workflows", "ci.yml"),
      ["name: CI", "jobs:", "  verify:", "    steps:", "      - run: bun run verify"].join("\n"),
      "utf8",
    )
    await writeFile(
      join(tmp, ".github", "workflows", "coverage.yml"),
      [
        "name: Coverage",
        "jobs:",
        "  coverage:",
        "    steps:",
        "      - run: |",
        "          bun install --frozen-lockfile",
        "          bun run coverage",
      ].join("\n"),
      "utf8",
    )

    const out = await runSignal()
    expect(out.classes.find((entry: any) => entry.class === "build")?.ciReachable).toBe(true)
    expect(out.classes.find((entry: any) => entry.class === "typecheck")?.ciReachable).toBe(true)
    expect(out.classes.find((entry: any) => entry.class === "test")?.ciReachable).toBe(true)
    expect(out.classes.find((entry: any) => entry.class === "coverage")?.ciReachable).toBe(true)
    expect(out.sourceFingerprint).toHaveLength(64)
  })

  test("malformed package metadata becomes unknown, not absent", async () => {
    await writeFile(join(tmp, "package.json"), "{", "utf8")

    const out = await runSignal()
    expect(out.state).toBe("unknown")
    expect(out.unknownClassCount).toBeGreaterThan(0)
  })

  test("missing manifests and workflows are explicit absence", async () => {
    const out = await runSignal()
    expect(out.state).toBe("absent")
    expect(out.missingClassCount).toBe(4)
  })
})
