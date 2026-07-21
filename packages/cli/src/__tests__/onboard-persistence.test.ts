import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  computeObserverConfigHash,
  createBaseline,
  decodeBaselineSync,
} from "@skastr0/pulsar-core/scoring"
import { decodePulsarVector } from "@skastr0/pulsar-core/vector"
import { Effect } from "effect"
import { loadProjectModuleCalibrationContext } from "../runtime-calibration.js"
import { observeWorktree } from "../runtime.js"
import {
  compileOnboardPlan,
  parseOnboardAnswers,
  previewOnboardPlan,
  scanResultOf,
  writeOnboardPlan,
  type OnboardCatalogEntry,
  type OnboardPlan,
} from "../onboard-persistence.js"

const repos: string[] = []

afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })))
})

const sh = (cmd: string, args: ReadonlyArray<string>, cwd: string): string => {
  const result = spawnSync(cmd, args as string[], { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}

const makeRepo = async (): Promise<string> => {
  const repo = await mkdtemp(join(tmpdir(), "pulsar-onboard-persistence-"))
  repos.push(repo)
  await mkdir(join(repo, "src"), { recursive: true })
  await writeFile(
    join(repo, "package.json"),
    `${JSON.stringify({ name: "fixture", private: true, devDependencies: { typescript: "^5.8.0" } }, null, 2)}\n`,
  )
  await writeFile(
    join(repo, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }, null, 2)}\n`,
  )
  await writeFile(
    join(repo, "src/index.ts"),
    [
      "export function branchy(n: number): number {",
      ...Array.from({ length: 25 }, (_, index) => `  if (n === ${index}) return ${index}`),
      "  return -1",
      "}",
      "",
    ].join("\n"),
  )
  sh("git", ["init", "-q", "-b", "main"], repo)
  sh("git", ["config", "user.email", "pulsar@example.test"], repo)
  sh("git", ["config", "user.name", "Pulsar Test"], repo)
  sh("git", ["add", "."], repo)
  sh("git", ["commit", "-qm", "fixture"], repo)
  return repo
}

const option = (calibrationKind: OnboardCatalogEntry["options"][number]["calibrationKind"]) => ({
  label: calibrationKind,
  summary: calibrationKind,
  calibrationKind,
  calibrationTarget: `display-only ${calibrationKind} target / no executable value`,
  framing: calibrationKind === "keep-default" ? "keep" as const : "sharpen" as const,
})

const catalogEntry = (
  id: string,
  calibrationKind: OnboardCatalogEntry["options"][number]["calibrationKind"],
): OnboardCatalogEntry => ({
  id,
  title: id,
  options: [option(calibrationKind)],
})

const catalog: ReadonlyArray<OnboardCatalogEntry> = [
  catalogEntry("TS-LD-01", "vector-config"),
  catalogEntry("TS-LD-02", "vector-config"),
  catalogEntry("TS-DE-04", "vector-config"),
  catalogEntry("TS-SL-04", "vector-active"),
  catalogEntry("TS-RP-01", "vector-weight"),
  catalogEntry("TS-LD-03", "keep-default"),
  catalogEntry("TS-LD-04", "conventions"),
  catalogEntry("TS-SEC-03", "baseline-accept"),
]

const plan = (overrides: Partial<OnboardPlan> = {}): OnboardPlan => ({
  choices: [],
  enabledPacks: [],
  baseline: "not-provided",
  seed: { shape: "app" },
  ...overrides,
})

describe("onboarding persistence", () => {
  test("headless answer decoding rejects untyped and non-finite values", () => {
    expect(() => parseOnboardAnswers({ choices: [{ signalId: "TS-LD-01", optionIndex: 1, action: {} }] })).toThrow(
      "tagged action",
    )
    expect(() =>
      parseOnboardAnswers({
        choices: [
          {
            signalId: "TS-LD-01",
            optionIndex: 1,
            action: { kind: "vector-weight", value: Number.POSITIVE_INFINITY },
          },
        ],
      }),
    ).toThrow("finite numeric weight")
    expect(() => parseOnboardAnswers({ baseline: true })).toThrow("accept, reject, or not-provided")
  })

  test("persists exact typed vector actions while omitting keep and unsupported actions", async () => {
    const repo = await makeRepo()
    const selected = plan({
      choices: [
        { signalId: "TS-LD-01", optionIndex: 0, action: { kind: "vector-config", key: "max_complexity", value: 30 } },
        { signalId: "TS-LD-02", optionIndex: 0, action: { kind: "vector-config", key: "exclude_globs", value: ["**/generated/**"] } },
        { signalId: "TS-DE-04", optionIndex: 0, action: { kind: "vector-config", key: "dependency_aliases", value: { "@app/*": "packages/app/*" } } },
        { signalId: "TS-SL-04", optionIndex: 0, action: { kind: "vector-active", value: false } },
        { signalId: "TS-RP-01", optionIndex: 0, action: { kind: "vector-weight", value: 1.25 } },
        { signalId: "TS-LD-03", optionIndex: 0, action: { kind: "keep-default" } },
        { signalId: "TS-LD-04", optionIndex: 0, action: { kind: "unsupported", reason: "typed conventions action unavailable" } },
      ],
      baseline: "reject",
    })

    const result = await writeOnboardPlan(repo, selected, catalog)
    const vector = JSON.parse(await readFile(join(repo, ".pulsar/vector.json"), "utf8")) as {
      signal_overrides: Record<string, unknown>
    }

    expect(vector.signal_overrides).toEqual({
      "TS-DE-04": { config: { dependency_aliases: { "@app/*": "packages/app/*" } } },
      "TS-LD-01": { config: { max_complexity: 30 } },
      "TS-LD-02": { config: { exclude_globs: ["**/generated/**"] } },
      "TS-RP-01": { weight: 1.25 },
      "TS-SL-04": { active: false },
    })
    expect(vector.signal_overrides["TS-LD-03"]).toBeUndefined()
    expect(vector.signal_overrides["TS-LD-04"]).toBeUndefined()
    expect(result.receipts.find((receipt) => receipt.signalId === "TS-LD-03")?.status).toBe("kept")
    expect(result.receipts.find((receipt) => receipt.signalId === "TS-LD-04")).toMatchObject({
      status: "unapplied",
      detail: "typed conventions action unavailable",
    })
    expect(result.baseline).toBe("reject")
    expect(existsSync(join(repo, "pulsar-baseline.json"))).toBe(false)
  }, 120_000)

  test("validates exact catalog/action identity and the target signal schema before any write", async () => {
    const repo = await makeRepo()
    const invalid = plan({
      choices: [
        {
          signalId: "TS-LD-01",
          optionIndex: 0,
          action: { kind: "vector-config", key: "max_complexity", value: "thirty" },
        },
      ],
    })

    await expect(writeOnboardPlan(repo, invalid, catalog)).rejects.toThrow("TS-LD-01.config.max_complexity")
    expect(existsSync(join(repo, ".pulsar/vector.json"))).toBe(false)

    await expect(
      writeOnboardPlan(
        repo,
        plan({ choices: [{ signalId: "TS-LD-01", optionIndex: 0, action: { kind: "vector-config", key: "unknown", value: 1 } }] }),
        catalog,
      ),
    ).rejects.toThrow("unknown config key")
    expect(existsSync(join(repo, ".pulsar/vector.json"))).toBe(false)
  }, 120_000)

  test("compilation is deterministic and never invents an empty keep override", async () => {
    const repo = await makeRepo()
    const selected = plan({
      choices: [
        { signalId: "TS-LD-03", optionIndex: 0, action: { kind: "keep-default" } },
        { signalId: "TS-RP-01", optionIndex: 0, action: { kind: "vector-weight", value: 0.75 } },
      ],
    })

    const first = await compileOnboardPlan(repo, selected, catalog)
    const second = await compileOnboardPlan(repo, selected, catalog)
    expect(first).toEqual(second)
    expect(first.vector.signal_overrides).toEqual({ "TS-RP-01": { weight: 0.75 } })
  }, 120_000)

  test("baseline acceptance uses the production schema, hash, and hard-gate snapshot", async () => {
    const repo = await makeRepo()
    const result = await writeOnboardPlan(
      repo,
      plan({
        choices: [{ signalId: "TS-SEC-03", optionIndex: 0, action: { kind: "baseline-accept" } }],
        baseline: "accept",
      }),
      catalog,
      { createdAt: "2026-07-21T12:00:00.000Z" },
    )
    const baseline = decodeBaselineSync(JSON.parse(await readFile(join(repo, "pulsar-baseline.json"), "utf8")))

    expect(result.baseline).toBe("accept")
    expect(baseline.schema_version).toBe(1)
    expect(baseline.created_at).toBe("2026-07-21T12:00:00.000Z")
    expect(baseline.baseline_sha).toBe(sh("git", ["rev-parse", "HEAD"], repo))
    expect(baseline.vector_id).toBe("repo")
    expect(baseline.vector_trust_boundary).toBe("repo-local")
    expect(baseline.observer_config_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(baseline.violations).toBeDefined()
  }, 120_000)

  test("pack-enabled preview and baseline match the persisted manifest runtime exactly", async () => {
    const repo = await makeRepo()
    const packCatalog: ReadonlyArray<OnboardCatalogEntry> = [
      {
        ...catalogEntry("TS-AD-04", "project-module"),
        packGate: "nextjs",
      },
    ]
    const selected = plan({
      choices: [
        {
          signalId: "TS-AD-04",
          optionIndex: 0,
          action: { kind: "enable-pack", packId: "nextjs" },
        },
      ],
      enabledPacks: ["nextjs"],
      baseline: "accept",
    })

    const preview = await previewOnboardPlan(repo, selected, packCatalog)
    await writeOnboardPlan(repo, selected, packCatalog, {
      createdAt: "2026-07-21T12:00:00.000Z",
    })
    const vector = await Effect.runPromise(
      decodePulsarVector(JSON.parse(await readFile(join(repo, ".pulsar/vector.json"), "utf8"))),
    )
    const persistedRun = await Effect.runPromise(observeWorktree(repo, vector))
    const persistedContext = await Effect.runPromise(loadProjectModuleCalibrationContext(repo))
    const baseline = decodeBaselineSync(
      JSON.parse(await readFile(join(repo, "pulsar-baseline.json"), "utf8")),
    )

    expect(preview.after).toEqual(scanResultOf(persistedRun))
    expect(persistedContext?.activeModules.map((module) => module.id)).toEqual([
      "@skastr0/pulsar-project-module-nextjs",
    ])
    expect(persistedContext?.processors.length).toBeGreaterThan(0)
    expect(persistedContext?.repoFacts.detectedFrameworks?.[0]?.activation).toBe("explicit-active")
    const observerConfigHash = computeObserverConfigHash(
        persistedRun.registry,
        vector,
        persistedContext?.fingerprint,
      )
    expect(baseline.observer_config_hash).toBe(observerConfigHash)
    expect(baseline).toEqual(
      createBaseline({
        baselineSha: persistedRun.gitSha,
        createdAt: "2026-07-21T12:00:00.000Z",
        vectorId: vector.id,
        vectorSource: ".pulsar/vector.json",
        vectorTrustBoundary: "repo-local",
        observerConfigHash,
        canonicalSignalId: persistedRun.registry.canonicalIdOf,
        violations: persistedRun.result.hard_gate_violations,
      }),
    )
  }, 120_000)

  test("reject and absent baseline decisions never create a baseline", async () => {
    for (const decision of ["reject", "not-provided"] as const) {
      const repo = await makeRepo()
      await writeOnboardPlan(repo, plan({ baseline: decision }), catalog)
      expect(existsSync(join(repo, "pulsar-baseline.json"))).toBe(false)
    }
  }, 120_000)

  test("preview is a real observer run under the proposed vector, not a fabricated floor", async () => {
    const repo = await makeRepo()
    const preview = await previewOnboardPlan(
      repo,
      plan({
        choices: [
          { signalId: "TS-LD-01", optionIndex: 0, action: { kind: "vector-config", key: "max_complexity", value: 100 } },
        ],
      }),
      catalog,
    )
    const before = preview.before.signals.find((signal) => signal.id === "TS-LD-01-cyclomatic-complexity")
    const after = preview.after.signals.find((signal) => signal.id === "TS-LD-01-cyclomatic-complexity")

    expect(before).toBeDefined()
    expect(after).toBeDefined()
    expect(after!.score).toBeGreaterThan(before!.score)
    expect(after!.score).toBe(1)
    expect(after!.score).not.toBe(0.7)
    expect(existsSync(join(repo, ".pulsar/vector.json"))).toBe(false)
  }, 120_000)

  test("preview before-state honors the repo-owned current vector", async () => {
    const repo = await makeRepo()
    await mkdir(join(repo, ".pulsar"), { recursive: true })
    await writeFile(
      join(repo, ".pulsar/vector.json"),
      `${JSON.stringify({
        id: "current",
        domain: "app",
        signal_overrides: { "TS-LD-01": { config: { max_complexity: 100 } } },
      }, null, 2)}\n`,
    )
    const preview = await previewOnboardPlan(
      repo,
      plan({
        choices: [
          { signalId: "TS-LD-01", optionIndex: 0, action: { kind: "vector-config", key: "max_complexity", value: 1 } },
        ],
      }),
      catalog,
    )
    const before = preview.before.signals.find((signal) => signal.id === "TS-LD-01-cyclomatic-complexity")
    const after = preview.after.signals.find((signal) => signal.id === "TS-LD-01-cyclomatic-complexity")

    expect(before?.score).toBe(1)
    expect(after?.score).toBeLessThan(before!.score)
  }, 120_000)

  test("guards existing repo-owned config and baseline in an explicit preview directory", async () => {
    const repo = await makeRepo()
    await mkdir(join(repo, ".pulsar"), { recursive: true })
    await writeFile(join(repo, ".pulsar/vector.json"), '{"existing":true}\n')
    await writeFile(join(repo, "pulsar-baseline.json"), '{"existing":true}\n')

    const result = await writeOnboardPlan(repo, plan(), catalog)

    expect(await readFile(join(repo, ".pulsar/vector.json"), "utf8")).toBe('{"existing":true}\n')
    expect(await readFile(join(repo, "pulsar-baseline.json"), "utf8")).toBe('{"existing":true}\n')
    expect(result.written).toEqual([join(repo, ".pulsar/onboard-preview/vector.json")])
  }, 120_000)

  test("an existing baseline alone keeps a new vector inactive in the preview directory", async () => {
    const repo = await makeRepo()
    await writeFile(join(repo, "pulsar-baseline.json"), '{"existing":true}\n')

    const result = await writeOnboardPlan(repo, plan({ baseline: "reject" }), catalog)

    expect(await readFile(join(repo, "pulsar-baseline.json"), "utf8")).toBe('{"existing":true}\n')
    expect(result.written).toEqual([join(repo, ".pulsar/onboard-preview/vector.json")])
    expect(existsSync(join(repo, ".pulsar/vector.json"))).toBe(false)
  }, 120_000)
})
