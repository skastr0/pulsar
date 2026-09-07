import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"
import { decodePulsarVector } from "@skastr0/pulsar-core/vector"
import { resolvePulsarRepoStateDir } from "@skastr0/pulsar-core/scoring"
import { NEXTJS_PROJECT_MODULE_ID } from "@skastr0/pulsar-project-module-nextjs"
import type { ProjectModuleManifest } from "@skastr0/pulsar-project-module-sdk"
import { type AgentStaticPolicy } from "../agent-contract.js"
import { prepareAgentPolicy, runAgentAssessment } from "../agent-runtime.js"
import { agentInputFingerprint } from "../agent-identity.js"
import { buildPulsarRegistry } from "../runtime.js"
import { loadProjectModuleCalibrationContext } from "../runtime-calibration.js"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(resolvePulsarRepoStateDir(root), { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})
const write = async (root: string, path: string, content: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}
const git = (root: string, ...args: string[]) => {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", ...args], { cwd: root, encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr)
}
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "pulsar-agent-runtime-"))
  roots.push(root)
  git(root, "init")
  await write(root, "package.json", '{"name":"consumer","type":"module"}')
  await write(root, "tsconfig.json", '{"compilerOptions":{"target":"ES2022","strict":true},"include":["src/**/*.ts"]}')
  await write(root, "src/index.ts", "export const value = 1\n")
  git(root, "add", ".")
  git(root, "commit", "-m", "fixture")
  return root
}
const staticPolicy = async (repoRoot: string, manifest?: ProjectModuleManifest): Promise<AgentStaticPolicy> => {
  const registry = await Effect.runPromise(buildPulsarRegistry(repoRoot))
  const vector = await Effect.runPromise(decodePulsarVector({
    id: "fixture", domain: "fixture", signal_overrides: Object.fromEntries(registry.sorted.map((s) => [s.id, { active: ["TS-SL-04-unfinished-implementations", "TS-LD-02-function-size-distribution"].includes(s.id) }])),
  }))
  return {
    repoRoot, registry, vector, manifest, manifestSource: undefined, moduleDependencyRoot: undefined, explanation: {},
    vectorSelection: { vector, source: "fallback", trustBoundary: "built-in-defaults", path: undefined, label: "fixture", sourceLabel: "fixture" },
  }
}
const manifest: ProjectModuleManifest = {
  schema: "pulsar/project-modules/v1", modules: [{ id: "fixture", kind: "repo-local", enabled: true, path: ".pulsar/module.ts" }],
}
const moduleSource = `
import { defineProjectModule, defineProcessor } from "@skastr0/pulsar-project-module-sdk"
import { Effect } from "effect"
import { limit } from "./helper.ts"
export default () => {
  globalThis.__pulsarAgentLoads = (globalThis.__pulsarAgentLoads ?? 0) + 1
  return defineProjectModule({ id: "fixture", version: "1", scope: "repository", processors: [defineProcessor({
    id: "size", slot: "typescript.size-policy", role: "factor-policy", fingerprint: "size-v1",
    process: current => Effect.succeed({ ...current, value: { ...current.value, maxLoc: limit } })
  })] })
}
`
const prepare = (policy: AgentStaticPolicy, trusted = false) => Effect.runPromise(prepareAgentPolicy(policy, {
  repoPath: policy.repoRoot, trustProjectCode: trusted, moduleDependencyRoot: resolve(import.meta.dir, "../../../.."),
}))

test("trust refusal precedes import/materialization and names refs/recovery", async () => {
  const root = await fixture()
  await write(root, ".pulsar/module.ts", `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(join(root, "marker"))}, 'executed'); export default {}`)
  const policy = await staticPolicy(root, manifest)
  await expect(prepare(policy)).rejects.toMatchObject({ code: "PROJECT_CODE_TRUST_REQUIRED", issues: [{ path: "modules.fixture" }], recovery: expect.any(Array) })
  expect(existsSync(join(root, "marker"))).toBe(false)
  expect(existsSync(resolvePulsarRepoStateDir(root))).toBe(false)
})

test("static absent/candidate manifest cannot reread newly installed project code; explicit empty context reaches observer", async () => {
  const root = await fixture()
  const policy = await staticPolicy(root)
  await write(root, ".pulsar/project-modules.json", JSON.stringify(manifest))
  await write(root, ".pulsar/module.ts", "throw new Error('must not import');")
  const prepared = await prepare(policy)
  expect(prepared.calibrationContext.processors).toEqual([])
  const assessment = await Effect.runPromise(runAgentAssessment(policy, prepared))
  expect(assessment.observation.calibrationContext).toBe(prepared.calibrationContext)
  expect(assessment.observation.timeSeries).toBeUndefined()
  expect(await readFile(join(root, ".pulsar/project-modules.json"), "utf8")).toBe(JSON.stringify(manifest))
  expect(existsSync(join(root, ".pulsar/vector.json"))).toBe(false)
}, 30000)

test("default Next detection survives and code-only route edits do not change policy", async () => {
  const root = await fixture()
  await write(root, "package.json", '{"dependencies":{"next":"^16.0.0"}}')
  await write(root, "app/page.tsx", "export default function Page() { return null }\n")
  const policy = await staticPolicy(root)
  const before = await prepare(policy)
  expect(before.calibrationContext.activeModules.map((m) => m.id)).toEqual([NEXTJS_PROJECT_MODULE_ID])
  await write(root, "app/page.tsx", "export default function Page() { return <main>Fixed</main> }\n")
  expect((await prepare(policy)).fingerprint).toBe(before.fingerprint)
  await write(root, "app/fixed/page.tsx", "export default function Page() { return null }\n")
  expect((await prepare(policy)).fingerprint).toBe(before.fingerprint)
})

test("external consumer processor resolves SDK via dependency root, loads once, and helper/source changes bust identity and execution cache", async () => {
  const root = await fixture()
  await write(root, "src/index.ts", `export function large() {\n${Array.from({ length: 180 }, (_, i) => `  const x${i} = ${i}`).join("\n")}\n  return x0\n}\n`)
  await write(root, ".pulsar/module.ts", moduleSource)
  await write(root, ".pulsar/helper.ts", "export const limit = 100\n")
  await write(root, ".pulsar/project-modules.json", JSON.stringify({ modules: [{ id: "wrong", kind: "repo-local", path: "must-not-load.ts" }] }))
  const policy = await staticPolicy(root, manifest)
  const before = await prepare(policy, true)
  const loads = () => (globalThis as typeof globalThis & { __pulsarAgentLoads: number }).__pulsarAgentLoads
  const count = loads()
  const sizeInput = { signalId: "TS-LD-02-function-size-distribution", findingId: "fixture", file: "src/index.ts", kind: "file" as const, loc: 200, defaultMaxLoc: 50, maxLoc: 50, visible: true, severity: "warn" as const, penaltyWeight: 1, factorPathPrefix: "size" }
  expect((await Effect.runPromise(before.calibrationContext.runSlot("typescript.size-policy", sizeInput))).value.maxLoc).toBe(100)
  const cold = await Effect.runPromise(runAgentAssessment(policy, before))
  const warm = await Effect.runPromise(runAgentAssessment(policy, before))
  expect(loads()).toBe(count)
  expect(warm.inputFingerprint).toBe(cold.inputFingerprint)
  expect(warm.observation.result.categories).toEqual(cold.observation.result.categories)
  expect(warm.observation.result.weighted_mean).toBe(cold.observation.result.weighted_mean)
  expect([...warm.observation.result.signalResults].map(([id, r]) => [id, r.score, r.diagnostics])).toEqual([...cold.observation.result.signalResults].map(([id, r]) => [id, r.score, r.diagnostics]))
  await write(root, ".pulsar/helper.ts", "export const limit = 300\n")
  const changed = await prepare(policy, true)
  expect(changed.fingerprint).not.toBe(before.fingerprint)
  expect((await Effect.runPromise(changed.calibrationContext.runSlot("typescript.size-policy", sizeInput))).value.maxLoc).toBe(300)
  const reassessed = await Effect.runPromise(runAgentAssessment(policy, changed))
  expect(reassessed.observation.result.signalResults.get("TS-LD-02-function-size-distribution")!.score).not.toBe(cold.observation.result.signalResults.get("TS-LD-02-function-size-distribution")!.score)
  await write(root, ".pulsar/module.ts", moduleSource + "\n// owned source change\n")
  expect((await prepare(policy, true)).fingerprint).not.toBe(changed.fingerprint)
}, 30000)

test("repair/untracked bytes change input not policy; weight changes policy; commits/cache do not change byte identity", async () => {
  const root = await fixture()
  const policy = await staticPolicy(root)
  const before = await prepare(policy)
  const input = await Effect.runPromise(agentInputFingerprint(root))
  await write(root, "src/index.ts", "export const value = 2\n")
  const repaired = await Effect.runPromise(agentInputFingerprint(root))
  expect(repaired).not.toBe(input)
  expect((await prepare(policy)).fingerprint).toBe(before.fingerprint)
  git(root, "add", ".")
  git(root, "commit", "-m", "repair")
  expect(await Effect.runPromise(agentInputFingerprint(root))).toBe(repaired)
  await write(root, "src/new.ts", "export const extra = true\n")
  const untracked = await Effect.runPromise(agentInputFingerprint(root))
  expect(untracked).not.toBe(repaired)
  await write(root, ".pulsar/cache/disposable.ts", "ignored")
  expect(await Effect.runPromise(agentInputFingerprint(root))).toBe(untracked)
  const vector = await Effect.runPromise(decodePulsarVector({ ...policy.vector, signal_overrides: { ...policy.vector?.signal_overrides, "TS-SL-04-unfinished-implementations": { active: true, weight: 0.5 } } }))
  expect((await prepare({ ...policy, vector })).fingerprint).not.toBe(before.fingerprint)
  expect(await Effect.runPromise(loadProjectModuleCalibrationContext(root))).toBeUndefined()
})

test("repository author identity rules change policy, not just input identity", async () => {
  const root = await fixture()
  const policy = await staticPolicy(root)
  const before = await prepare(policy)
  await write(root, ".pulsar/author-aliases.json", JSON.stringify({ "bot@example.com": "Team" }))
  const aliased = await prepare(policy)
  expect(aliased.fingerprint).not.toBe(before.fingerprint)
  await write(root, ".pulsar/author-aliases.json", JSON.stringify({ "bot@example.com": "Other team" }))
  const after = await prepare(policy)
  expect(after.fingerprint).not.toBe(aliased.fingerprint)
  await write(root, ".mailmap", "Team <team@example.com> Bot <bot@example.com>\n")
  expect((await prepare(policy)).fingerprint).not.toBe(after.fingerprint)
})

test("unfinished implementation repair changes evaluated score and input but preserves policy, including zero weights", async () => {
  const root = await fixture()
  await write(root, "src/index.ts", "export function calculate(value: number): number { throw new Error('not implemented') }\n")
  git(root, "add", ".")
  git(root, "commit", "-m", "existing stub")
  const original = await staticPolicy(root)
  const id = "TS-SL-04-unfinished-implementations"
  const vector = await Effect.runPromise(decodePulsarVector({ ...original.vector, signal_overrides: { ...original.vector?.signal_overrides, [id]: { active: true, weight: 0 } } }))
  const policy = { ...original, vector }
  const prepared = await prepare(policy)
  const before = await Effect.runPromise(runAgentAssessment(policy, prepared))
  expect(before.observation.result.signalResults.has(id)).toBe(true)
  await write(root, "package.json", '{"name":"consumer","type":"module","description":"unrelated edit"}')
  const unrelated = await Effect.runPromise(runAgentAssessment(policy, prepared))
  expect(unrelated.observation.result.signalResults.get(id)!.score).toBe(before.observation.result.signalResults.get(id)!.score)
  expect(unrelated.observation.result.signalResults.get(id)!.diagnostics).toEqual(before.observation.result.signalResults.get(id)!.diagnostics)
  await write(root, "src/index.ts", "export function calculate(value: number): number { return value * 2 }\n")
  const next = await prepare(policy)
  const after = await Effect.runPromise(runAgentAssessment(policy, next))
  expect(next.fingerprint).toBe(prepared.fingerprint)
  expect(after.inputFingerprint).not.toBe(before.inputFingerprint)
  expect(after.observation.result.signalResults.get(id)!.score).toBeGreaterThan(before.observation.result.signalResults.get(id)!.score)
}, 30000)

test("owned module identity is checkout-stable; invalid exports fail through prepare", async () => {
  const fingerprints: string[] = []
  for (let i = 0; i < 2; i++) {
    const root = await fixture()
    await write(root, ".pulsar/module.ts", moduleSource)
    await write(root, ".pulsar/helper.ts", "export const limit = 100\n")
    const policy = await staticPolicy(root, manifest)
    fingerprints.push((await prepare(policy, true)).fingerprint)
    await write(root, ".pulsar/module.ts", 'export default { id: "fixture", version: "1", scope: "repository", processors: [{ id: "p", slot: "wrong", role: "factor-policy", fingerprint: "1", process: () => {} }] }')
    await expect(prepare(policy, true)).rejects.toMatchObject({ _tag: "ProjectModuleLoadError" })
  }
  expect(fingerprints[0]).toBe(fingerprints[1])
})
