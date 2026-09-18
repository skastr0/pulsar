import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Effect, Schema } from "effect"
import { simpleGit } from "simple-git"
import { buildAgentCatalog, agentSlotExample } from "../agent-catalog.js"
import { loadAgentPolicy } from "../agent-policy.js"
import { AgentCommandError } from "../agent-contract.js"
import { buildPulsarRegistry } from "../runtime-registry.js"
import { makeResolvedCalibrationContext, type TypeScriptSizePolicyValue } from "@skastr0/pulsar-core/calibration"
import type { DefinedProjectModule } from "@skastr0/pulsar-project-module-sdk"

let repo: string
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "pulsar-agent-policy-"))
  await simpleGit(repo).init()
  await mkdir(join(repo, ".pulsar"))
  await writeFile(join(repo, "index.ts"), "export const value = 1\n")
})
afterEach(async () => { await rm(repo, { recursive: true, force: true }) })
const vector = (signal_overrides: Record<string, unknown>) => ({ id: "repo", domain: "general", signal_overrides })
const save = async (value: unknown, name = ".pulsar/vector.json") => {
  const path = join(repo, name)
  await writeFile(path, JSON.stringify(value))
  return path
}
const load = () => Effect.runPromise(loadAgentPolicy({ repoPath: repo }))
const failure = async (effect: Effect.Effect<unknown, unknown>) => {
  const result = await Effect.runPromise(Effect.result(effect))
  expect(result._tag).toBe("Failure")
  if (result._tag !== "Failure") throw new Error("Expected failure")
  expect(result.failure).toBeInstanceOf(AgentCommandError)
  return result.failure as AgentCommandError
}

describe("strict static policy", () => {
  test("default vector is undefined; detected registry is not full registry", async () => {
    const policy = await load()
    expect(policy.vector).toBeUndefined()
    expect(policy.vectorSelection.source).toBe("fallback")
    expect(policy.registry.sorted).toHaveLength(51)
    expect(JSON.parse(JSON.stringify(policy.explanation)).signals).toHaveLength(75)
  })

  test("rejects raw excess vector, override and config keys before they can disappear", async () => {
    for (const value of [
      { ...vector({}), signal_override: {} },
      vector({ "TS-LD-02": { weigth: 1 } }),
      vector({ "TS-LD-02": { config: { max_file_lco: 900 } } }),
      vector({ "TS-LD-02": { config: { max_file_loc: "bad" }, factors: { "config.max_file_loc": 600 } } }),
    ]) {
      await save(value)
      const error = await failure(loadAgentPolicy({ repoPath: repo }))
      expect(error.code).toBe("INVALID_CONFIG")
      expect(error.issues.length).toBeGreaterThan(0)
      expect(error.recovery.length).toBeGreaterThan(0)
    }
  })

  test("weights are finite 0..2", async () => {
    for (const weight of [-1, 2.01, "1", null]) {
      await save(vector({ "TS-LD-02": { weight } }))
      expect((await failure(loadAgentPolicy({ repoPath: repo }))).code).toBe("INVALID_CONFIG")
    }
    await writeFile(join(repo, ".pulsar/vector.json"), '{"id":"r","domain":"general","signal_overrides":{"TS-LD-02":{"weight":1e400}}}')
    expect((await failure(loadAgentPolicy({ repoPath: repo }))).code).toBe("INVALID_CONFIG")
  })

  test("canonicalizes aliases, rejects collisions and unknown signals", async () => {
    const registry = await Effect.runPromise(buildPulsarRegistry())
    const id = registry.canonicalIdOf("TS-LD-02")!
    await save(vector({ "TS-LD-02": { weight: 0 } }))
    const policy = await load()
    expect(Object.keys(policy.vector!.signal_overrides)).toEqual([id])
    const explanation = JSON.parse(JSON.stringify(policy.explanation))
    expect(explanation.signals.find((s: { id: string }) => s.id === id)).toMatchObject({ active: true, selected: true, weight: 0 })
    await save(vector({ "TS-LD-02": {}, [id]: {} }))
    expect((await failure(loadAgentPolicy({ repoPath: repo }))).message).toContain("Competing")
    await save(vector({ "TS-NO-SUCH-SIGNAL": {} }))
    expect((await failure(loadAgentPolicy({ repoPath: repo }))).code).toBe("UNKNOWN_SIGNAL")
  })

  test("validates installed undetected overrides without force-selecting their pack", async () => {
    await save(vector({ "RS-LD-01": { weight: 0.5, active: true } }))
    const policy = await load()
    const id = (await Effect.runPromise(buildPulsarRegistry())).canonicalIdOf("RS-LD-01")!
    expect(policy.registry.has(id)).toBe(false)
    expect(policy.vector!.signal_overrides[id]?.weight).toBe(0.5)
    const explanation = JSON.parse(JSON.stringify(policy.explanation))
    expect(explanation.signals.find((s: { id: string }) => s.id === id)).toMatchObject({ selected: false, active: true, weight: 0.5 })
  })

  test("exact defaults/config/factor precedence and source labels", async () => {
    await save(vector({ "TS-LD-02": { config: { max_file_loc: 450 }, factors: { "config.max_file_loc": 600 } } }))
    const policy = await load()
    const explanation = JSON.parse(JSON.stringify(policy.explanation))
    const signal = explanation.signals.find((s: { id: string }) => s.id.startsWith("TS-LD-02"))
    expect(signal.config.max_file_loc).toBe(600)
    expect(signal.config.max_function_loc).toBe(50)
    expect(signal.sources.config.max_file_loc).toBe("repo-local .pulsar/vector.json:factors.config.max_file_loc")
    expect(signal.sources.config.max_function_loc).toBe("signal-default")
    const explicit = await save(vector({}), "explicit.json")
    expect((await Effect.runPromise(loadAgentPolicy({ repoPath: repo, vectorPath: explicit }))).vectorSelection.source).toBe("explicit")
  })

  test("organization fallback is attributed and repo/explicit vectors override it", async () => {
    const home = join(repo, "home")
    await mkdir(join(home, ".config/pulsar"), { recursive: true })
    await writeFile(join(home, ".config/pulsar/vector.json"), JSON.stringify({ ...vector({}), id: "org" }))
    const discover = async (vectorPath?: string) => {
      const program = `import {Effect} from ${JSON.stringify(import.meta.resolve("effect"))};
        import {loadAgentPolicy} from ${JSON.stringify(resolve(import.meta.dir, "../agent-policy.ts"))};
        console.log(JSON.stringify((await Effect.runPromise(loadAgentPolicy(${JSON.stringify({ repoPath: repo, ...(vectorPath === undefined ? {} : { vectorPath }) })}))).vectorSelection));`
      const child = Bun.spawn([process.execPath, "-e", program], { env: { ...process.env, HOME: home }, stdout: "pipe", stderr: "pipe" })
      const output = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      return JSON.parse(output)
    }
    expect(await discover()).toMatchObject({ source: "organization", trustBoundary: "organization-standard-fallback", label: "org", sourceLabel: "organization fallback ~/.config/pulsar/vector.json" })
    await save(vector({}))
    expect(await discover()).toMatchObject({ source: "worktree", label: "repo" })
    const explicit = await save({ ...vector({}), id: "explicit" }, "explicit.json")
    expect(await discover(explicit)).toMatchObject({ source: "explicit", label: "explicit" })
  })

  test("only real non-config controls are accepted; ledger-only filtering is rejected", async () => {
    await save(vector({ "TS-SL-04": { factors: { "stub_kinds.empty-body.penalty_weight": 0.1, "budget.expected_clean_function_ratio": 0.05 } } }))
    expect((await load()).vector).toBeDefined()
    for (const factors of [
      { "filtering.include_test_stubs": true },
      { "filtering.production_only_score": false },
      { "stub_kinds.empty-body.confidence": "maybe" },
      { "stub_kinds.empty-body.score_cap": 2 },
      { "budget.expected_clean_function_ratio": 0 },
      { "config.include_test_stubs": "yes" },
    ]) {
      await save(vector({ "TS-SL-04": { factors } }))
      expect((await failure(loadAgentPolicy({ repoPath: repo }))).code).toBe("INVALID_CONFIG")
    }
  })

  test("strict manifests, duplicate refs, explicit missing files and cwd-relative roots", async () => {
    const ref = { id: "repo.policy", kind: "repo-local", path: ".pulsar/policy.ts" }
    for (const manifest of [{ modules: [ref, ref] }, { modules: [{ ...ref, enabld: true }] }, { modules: [], typo: true }]) {
      await save(manifest, ".pulsar/project-modules.json")
      expect((await failure(loadAgentPolicy({ repoPath: repo }))).code).toBe("INVALID_CONFIG")
    }
    await save({ modules: [ref] }, ".pulsar/project-modules.json")
    const path = await save({ modules: [] }, "custom.json")
    const policy = await Effect.runPromise(loadAgentPolicy({ repoPath: repo, modulesPath: path, moduleDependencyRoot: "packages" }))
    expect(policy.manifest?.modules).toEqual([])
    expect(policy.manifestSource).toBe(path)
    expect(policy.moduleDependencyRoot).toBe(resolve("packages"))
    for (const options of [{ vectorPath: join(repo, "missing.json") }, { modulesPath: join(repo, "missing.json") }]) {
      expect((await failure(loadAgentPolicy({ repoPath: repo, ...options }))).code).toBe("INVALID_CONFIG")
    }
  })

  test("catalog and static load never import custom project modules, even with trust true", async () => {
    await save({ modules: [{ id: "danger", kind: "repo-local", path: ".pulsar/danger.ts" }] }, ".pulsar/project-modules.json")
    await writeFile(join(repo, ".pulsar/danger.ts"), 'throw new Error("PROJECT CODE EXECUTED")')
    expect((await Effect.runPromise(loadAgentPolicy({ repoPath: repo, trustProjectCode: true }))).manifest?.modules).toHaveLength(1)
    expect((await Effect.runPromise(buildAgentCatalog({ repoPath: repo }))).installedCount).toBe(75)
  })
})

describe("agent catalog", () => {
  test("75 signal registry parity, schema documents/defaults serialize without losing definitions", async () => {
    const registry = await Effect.runPromise(buildPulsarRegistry())
    const catalog = JSON.parse(JSON.stringify(await Effect.runPromise(buildAgentCatalog({ repoPath: repo }))))
    expect(catalog.signals.map((s: { id: string }) => s.id)).toEqual(registry.sorted.map((s) => s.id))
    expect(catalog.signals.filter((s: { id: string }) => s.id.startsWith("TS-"))).toHaveLength(39)
    expect(catalog.signals.filter((s: { id: string }) => s.id.startsWith("RS-"))).toHaveLength(24)
    for (const signal of registry.sorted) {
      const detail = await Effect.runPromise(buildAgentCatalog({ repoPath: repo, signalId: signal.id }))
      expect(JSON.parse(JSON.stringify(detail.configSchema))).toEqual(JSON.parse(JSON.stringify(Schema.toJsonSchemaDocument(signal.configSchema))))
      expect(detail.defaults).toEqual(signal.defaultConfig)
    }
  }, 30_000)

  test("unknown and conflicting details fail; invalid policy does not hide discovery", async () => {
    for (const options of [{ signalId: "unknown" }, { slotId: "unknown" }, { signalId: "TS-LD-02", slotId: "typescript.size-policy" }]) {
      await failure(buildAgentCatalog({ repoPath: repo, ...options }))
    }
    await save({ ...vector({}), typo: true })
    const catalog = await Effect.runPromise(buildAgentCatalog({ repoPath: repo }))
    expect(catalog.installedCount).toBe(75)
    expect(catalog.policyError).toBeString()
  })

  test("size slot example executes with SDK and preserves real typed values and attribution", async () => {
    const example = agentSlotExample("typescript.size-policy")
    const modulePath = join(repo, "example.ts")
    await writeFile(modulePath, example
      .replace('from "effect"', `from ${JSON.stringify(import.meta.resolve("effect"))}`)
      .replace('from "@skastr0/pulsar-project-module-sdk"', `from ${JSON.stringify(import.meta.resolve("@skastr0/pulsar-project-module-sdk"))}`))
    const module: DefinedProjectModule = (await import(modulePath)).default
    const context = makeResolvedCalibrationContext({ repoFacts: { repoRoot: repo, fingerprint: "fixture", detectedTechnologies: [], sourceExtensions: [".ts"] }, activeModules: [module.activeModule], processors: module.processors })
    const input: TypeScriptSizePolicyValue = { signalId: "TS-LD-02", findingId: "file", file: "src/adapters/http.ts", kind: "file", loc: 500, defaultMaxLoc: 300, maxLoc: 300, visible: true, severity: "warn", penaltyWeight: 1, factorPathPrefix: "file" }
    const result = await Effect.runPromise(context.runSlot("typescript.size-policy", input))
    expect(result.value.maxLoc).toBe(600)
    expect(result.decisions[0]?.ruleId).toBe("repo.adapter-file-size")
    const unchanged = await Effect.runPromise(context.runSlot("typescript.size-policy", { ...input, file: "src/core.ts" }))
    expect(unchanged.value.maxLoc).toBe(300)
    const detail = await Effect.runPromise(buildAgentCatalog({ repoPath: repo, slotId: "typescript.size-policy" }))
    expect(detail.example).toBe(example)
    const consumer = await readFile(resolve(import.meta.dir, "../../../ts-pack/src/signals/ts-ld-02-thresholds.ts"), "utf8")
    expect(consumer).toContain('runSlot("typescript.size-policy"')
  })
})
