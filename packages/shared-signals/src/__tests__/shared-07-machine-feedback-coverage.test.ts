import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { SignalContextTag } from "@skastr0/pulsar-core/signal"
import { Effect, Layer, Schema } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import {
  Shared07MachineFeedbackCoverage,
  type Shared07MachineFeedbackCoverageOutput,
} from "../shared-07-machine-feedback-coverage.js"

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pulsar-feedback-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const runSignal = async (
  config: Partial<typeof Shared07MachineFeedbackCoverage.defaultConfig> = {},
  repoRoot = tmp,
): Promise<Shared07MachineFeedbackCoverageOutput> =>
  Effect.runPromise(
    Shared07MachineFeedbackCoverage.compute(
      { ...Shared07MachineFeedbackCoverage.defaultConfig, ...config },
      new Map(),
    ).pipe(
      Effect.provide(
        Layer.succeed(SignalContextTag, {
          gitSha: "HEAD",
          worktreePath: repoRoot,
          changedHunks: [],
        }),
      ),
    ) as Effect.Effect<Shared07MachineFeedbackCoverageOutput, unknown, never>,
  )

const classFact = (
  out: Shared07MachineFeedbackCoverageOutput,
  feedbackClass: string,
) => out.classes.find((entry) => entry.class === feedbackClass)

describe("SHARED-07 machine feedback coverage", () => {
  test("declares identity, config schema, cache, and factor ledger", async () => {
    const packRegistered = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-07"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("SHARED-07")
    const decoded = Schema.decodeUnknownSync(Shared07MachineFeedbackCoverage.configSchema)(
      Shared07MachineFeedbackCoverage.defaultConfig,
    )
    const factorLedger = registered?.factorLedger?.({} as Shared07MachineFeedbackCoverageOutput)

    expect(Shared07MachineFeedbackCoverage).toMatchObject({
      id: "SHARED-07-machine-feedback-coverage",
      title: "Machine feedback coverage",
      aliases: ["SHARED-07"],
      tier: 1,
      category: "review-pain",
      kind: "legibility",
      cacheVersion: "scripts-and-github-workflows-v2-yaml-parser-stable-fingerprint",
      inputs: [],
    })
    expect(decoded).toEqual({
      required_classes: ["build", "typecheck", "test", "static_analysis"],
      top_n_diagnostics: 10,
    })
    expect(registered?.id).toBe(Shared07MachineFeedbackCoverage.id)
    expect(registered?.cacheVersion).toContain(Shared07MachineFeedbackCoverage.cacheVersion)
    expect(registry.byId.get("SHARED-07")?.id).toBe(Shared07MachineFeedbackCoverage.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.required_classes",
        value: ["build", "typecheck", "test", "static_analysis"],
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("detects local feedback from package scripts and keeps fact-provider scoring neutral", async () => {
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
    expect(out.missingClassCount).toBe(0)
    expect(classFact(out, "test")?.localCommands).toEqual(["test"])
    expect(Shared07MachineFeedbackCoverage.score(out)).toBe(1)
    expect(Shared07MachineFeedbackCoverage.outputMetadata?.(out)).toEqual({
      applicability: "not_applicable",
    })
    expect(Shared07MachineFeedbackCoverage.diagnose(out).map((diagnostic) => diagnostic.severity)).toEqual([
      "info",
      "info",
      "info",
      "info",
    ])
  })

  test("normalizes required classes before collecting missing counts", async () => {
    await writeFile(
      join(tmp, "package.json"),
      JSON.stringify({
        scripts: {
          test: "bun test",
        },
      }),
      "utf8",
    )

    const out = await runSignal({
      required_classes: ["test", "test", "build"],
    })

    expect(out.requiredClasses).toEqual(["build", "test"])
    expect(out.missingClassCount).toBe(1)
    expect(classFact(out, "build")?.state).toBe("absent")
    expect(classFact(out, "test")?.state).toBe("present")
    expect(Shared07MachineFeedbackCoverage.diagnose(out).map((diagnostic) => diagnostic.message)).toEqual([
      "Machine feedback build: absent",
      "Machine feedback test: present",
    ])
  })

  test("resolves GitHub workflow commands through package script aliases deterministically", async () => {
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

    const first = await runSignal()
    const second = await runSignal()

    expect(classFact(first, "build")?.ciReachable).toBe(true)
    expect(classFact(first, "typecheck")?.ciReachable).toBe(true)
    expect(classFact(first, "test")?.ciReachable).toBe(true)
    expect(classFact(first, "coverage")?.ciReachable).toBe(true)
    expect(first.sourceFingerprint).toHaveLength(64)
    expect(second).toEqual(first)
  })

  test("source fingerprint is stable across identical repositories in different paths", async () => {
    const other = await mkdtemp(join(tmpdir(), "pulsar-feedback-peer-"))
    try {
      const writeFixture = async (repoRoot: string) => {
        await mkdir(join(repoRoot, ".github", "workflows"), { recursive: true })
        await writeFile(
          join(repoRoot, "package.json"),
          JSON.stringify({
            scripts: {
              verify: "bun run typecheck && bun run test",
              typecheck: "tsc --noEmit",
              test: "bun test",
            },
          }),
          "utf8",
        )
        await writeFile(
          join(repoRoot, ".github", "workflows", "ci.yml"),
          ["name: CI", "jobs:", "  verify:", "    steps:", "      - run: bun run verify"].join("\n"),
          "utf8",
        )
      }

      await writeFixture(tmp)
      await writeFixture(other)

      const first = await runSignal()
      const second = await runSignal({}, other)

      expect(second.sourceFingerprint).toBe(first.sourceFingerprint)
      expect(second.classes.map((entry) => ({
        class: entry.class,
        state: entry.state,
        localCommands: entry.localCommands,
        ciReachable: entry.ciReachable,
      }))).toEqual(first.classes.map((entry) => ({
        class: entry.class,
        state: entry.state,
        localCommands: entry.localCommands,
        ciReachable: entry.ciReachable,
      })))
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  test("workflow YAML is parsed before run commands are trusted", async () => {
    await writeFile(
      join(tmp, "package.json"),
      JSON.stringify({
        scripts: {
          verify: "bun run typecheck && bun run test",
          typecheck: "tsc --noEmit",
          test: "bun test",
        },
      }),
      "utf8",
    )
    await mkdir(join(tmp, ".github", "workflows"), { recursive: true })
    await writeFile(
      join(tmp, ".github", "workflows", "broken.yml"),
      [
        "name: Broken",
        "jobs:",
        "  verify:",
        "    steps:",
        "      - run: bun run verify",
        "      - [unterminated",
      ].join("\n"),
      "utf8",
    )

    const out = await runSignal()

    expect(out.state).toBe("unknown")
    expect(out.ciReachableClassCount).toBe(0)
    expect(classFact(out, "typecheck")?.ciReachable).toBe(false)
    expect(classFact(out, "typecheck")?.state).toBe("unknown")
    expect(Shared07MachineFeedbackCoverage.diagnose(out)[0]?.data).toMatchObject({
      class: "build",
      state: "unknown",
      evidence: [
        expect.objectContaining({
          kind: "parse-error",
          path: join(tmp, ".github", "workflows", "broken.yml"),
        }),
      ],
    })
  })

  test("GitHub workflow block-scalar command forms are reachable", async () => {
    await writeFile(
      join(tmp, "package.json"),
      JSON.stringify({
        scripts: {
          verify: "bun run typecheck && bun run test && bun run build",
          typecheck: "tsc --noEmit",
          test: "bun test",
          build: "tsc -b",
        },
      }),
      "utf8",
    )
    await mkdir(join(tmp, ".github", "workflows"), { recursive: true })
    await writeFile(
      join(tmp, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "jobs:",
        "  verify:",
        "    steps:",
        "      - run: |-",
        "          bun install --frozen-lockfile",
        "          bun run verify",
      ].join("\n"),
      "utf8",
    )

    const out = await runSignal()

    expect(classFact(out, "build")?.ciReachable).toBe(true)
    expect(classFact(out, "typecheck")?.ciReachable).toBe(true)
    expect(classFact(out, "test")?.ciReachable).toBe(true)
  })

  test("malformed package metadata becomes unknown, not absent", async () => {
    await writeFile(join(tmp, "package.json"), "{", "utf8")

    const out = await runSignal()
    const diagnostics = Shared07MachineFeedbackCoverage.diagnose(out)

    expect(out.state).toBe("unknown")
    expect(out.unknownClassCount).toBeGreaterThan(0)
    expect(out.missingClassCount).toBe(0)
    expect(classFact(out, "build")?.state).toBe("unknown")
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(diagnostics[0]?.data).toMatchObject({
      class: "build",
      state: "unknown",
      evidence: [
        expect.objectContaining({
          kind: "parse-error",
          path: join(tmp, "package.json"),
        }),
      ],
    })
  })

  test("missing manifests and workflows are explicit absence", async () => {
    const out = await runSignal()
    const diagnostics = Shared07MachineFeedbackCoverage.diagnose(out)

    expect(out.state).toBe("absent")
    expect(out.configuredClassCount).toBe(0)
    expect(out.missingClassCount).toBe(4)
    expect(out.unknownClassCount).toBe(0)
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Machine feedback build: absent",
      "Machine feedback typecheck: absent",
      "Machine feedback test: absent",
      "Machine feedback static_analysis: absent",
    ])
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "warn")).toBe(true)
  })

  test("normalizes diagnostic limits and orders warnings before optional present facts", async () => {
    await writeFile(
      join(tmp, "package.json"),
      JSON.stringify({
        scripts: {
          coverage: "bun test --coverage",
        },
      }),
      "utf8",
    )

    const capped = await runSignal({ top_n_diagnostics: 2.9 })
    const hiddenNaN = await runSignal({ top_n_diagnostics: Number.NaN })
    const hiddenNegative = await runSignal({ top_n_diagnostics: -1 })
    const hiddenInfinity = await runSignal({ top_n_diagnostics: Number.POSITIVE_INFINITY })

    expect(capped.topDiagnostics).toBe(2)
    expect(Shared07MachineFeedbackCoverage.diagnose(capped).map((diagnostic) => diagnostic.message)).toEqual([
      "Machine feedback build: absent",
      "Machine feedback typecheck: absent",
    ])
    expect(hiddenNaN.topDiagnostics).toBe(0)
    expect(hiddenNegative.topDiagnostics).toBe(0)
    expect(hiddenInfinity.topDiagnostics).toBe(0)
    expect(Shared07MachineFeedbackCoverage.diagnose(hiddenNaN)).toEqual([])
    expect(Shared07MachineFeedbackCoverage.diagnose(hiddenNegative)).toEqual([])
    expect(Shared07MachineFeedbackCoverage.diagnose(hiddenInfinity)).toEqual([])
  })

  test("empty required class lists are a measured fact-provider no-op", async () => {
    const out = await runSignal({ required_classes: [] })

    expect(out.requiredClasses).toEqual([])
    expect(out.missingClassCount).toBe(0)
    expect(out.unknownClassCount).toBe(0)
    expect(Shared07MachineFeedbackCoverage.score(out)).toBe(1)
    expect(Shared07MachineFeedbackCoverage.outputMetadata?.(out)).toEqual({
      applicability: "not_applicable",
    })
    expect(Shared07MachineFeedbackCoverage.diagnose(out)).toEqual([])
  })

  test("empty required class lists do not hide malformed evidence", async () => {
    await writeFile(join(tmp, "package.json"), "{", "utf8")

    const out = await runSignal({ required_classes: [] })

    expect(out.state).toBe("unknown")
    expect(out.requiredClasses).toEqual([])
    expect(out.missingClassCount).toBe(0)
    expect(out.unknownClassCount).toBe(0)
    expect(classFact(out, "build")?.state).toBe("unknown")
    expect(Shared07MachineFeedbackCoverage.diagnose(out)[0]?.message).toBe(
      "Machine feedback build: unknown",
    )
  })
})
