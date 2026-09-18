import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Redacted } from "effect"
import { loadOwnershipFacts } from "@skastr0/pulsar-core/reference-data"
import { executeOwnershipJudgment, ownershipJudgmentPreview, prepareOwnershipJudgment } from "../agent-judge.js"
import { jevClientLayer, type JevClientOptions } from "../jev/index.js"

let root: string
const policy = (ids = ["rule-a"]) => ({
  schema_version: 1, preference: "shared_domain_rule", target: 1,
  anchors: [
    { id: "contrary", value: 0, description: "The same rule is copied across callers." },
    { id: "mixed", value: 0.5, description: "Some callers delegate; others copy the rule." },
    { id: "meets", value: 1, description: "All callers delegate the rule to one owner." },
  ],
  allowed_classifiers: [{ id: "pulsar.jev.ownership", version: "2", model_id: "jev-1.13.0", prompt_id: "pulsar.ownership.choice.v2" }],
  groups: ids.map((id) => ({ id, owner_paths: ["rule.ts"], caller_paths: ["caller.ts"], context_paths: ["context.ts"] })),
})
const writePolicy = (value: unknown = policy()) => writeFile(join(root, ".pulsar/ownership.json"), JSON.stringify(value))
const response = (choice = "mixed", probability = 1) => new Response(JSON.stringify({
  model: "jev-1.13.0",
  answers: { ownership: { type: "choice", choice, confidence: 0.23,
    probabilities: { contrary: 0, mixed: 0, meets: 0, unknown: 1 - probability, not_applicable: 0, [choice]: probability },
  } }, usage: { input_tokens: 120, output_tokens: 58 },
}), { status: 200 })
const run = async (fetcher: NonNullable<JevClientOptions["fetcher"]>) => {
  const plan = await Effect.runPromise(prepareOwnershipJudgment(root))
  return Effect.runPromise(executeOwnershipJudgment(plan).pipe(Effect.provide(jevClientLayer({ apiKey: Redacted.make("test"), fetcher }))))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pulsar-judge-"))
  await mkdir(join(root, ".pulsar"))
  await writeFile(join(root, "rule.ts"), "export const permits = (n: number) => n > 7\n")
  await writeFile(join(root, "caller.ts"), "import { permits } from './rule'; export const call = permits\n")
  await writeFile(join(root, "context.ts"), "export const threshold = 7\n")
  await writePolicy()
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

test("dry-run plan exposes exact egress size and paths without writes or provider credentials", async () => {
  const plan = await Effect.runPromise(prepareOwnershipJudgment(root))
  const preview = ownershipJudgmentPreview(plan)
  expect(preview.calls_planned).toBe(1)
  expect(preview.groups[0]!.paths).toEqual(["caller.ts", "context.ts", "rule.ts"])
  expect(preview.groups[0]!.source_bytes).toBeGreaterThan(80)
  expect(preview.groups[0]!.request_bytes).toBeGreaterThan(preview.groups[0]!.source_bytes)
  expect(await readdir(join(root, ".pulsar"))).toEqual(["ownership.json"])
})

test("judge adopts replayable host numbers without weighting by confidence; context bytes invalidate replay", async () => {
  const result = await run(async () => response())
  expect(result.applicability).toBe("applicable")
  expect(result.aggregate?.attainment).toBe(0.5)
  expect(result.aggregate?.score).toBe(0.5)
  expect(result.usage).toEqual({ input_tokens: 120, output_tokens: 58 })
  const facts = await loadOwnershipFacts(root)
  expect(facts.labels[0]!.label.confidence).toBe(0.23)
  expect(facts.labels[0]!.input.source_paths).toContain("context.ts")
  expect((await readdir(join(root, result.receipts))).sort()).toEqual(["00000.request.json", "00000.response.json"])
  const receipt = JSON.parse(await readFile(join(root, result.receipts, "00000.response.json"), "utf8"))
  expect(JSON.parse(receipt.rawResponse).answers.ownership.choice).toBe("mixed")
  expect(receipt.requestSha256).toHaveLength(64)
  await writeFile(join(root, "context.ts"), "export const threshold = 9\n")
  const changed = await loadOwnershipFacts(root)
  expect(changed.aggregate?.applicability).toBe("insufficient_evidence")
  expect(changed.aggregate?.attainment).toBeUndefined()
})

test("identical model requests for distinct declared groups retain distinct artifact identities", async () => {
  await writePolicy(policy(["rule-a", "rule-b"]))
  const result = await run(async () => response("meets"))
  expect(result.aggregate?.resolvedGroupIds).toEqual(["rule-a", "rule-b"])
  expect(result.aggregate?.histogram).toEqual({ meets: 2 })
  const facts = await loadOwnershipFacts(root)
  expect(new Set(facts.labels.map((label) => label.artifact_id)).size).toBe(2)
})

test("low-margin raw winner is retained but cannot earn a score", async () => {
  const result = await run(async () => response("meets", 0.6))
  expect(result.applicability).toBe("insufficient_evidence")
  expect(result.aggregate?.attainment).toBeUndefined()
  expect(result.aggregate?.unresolvedGroupIds).toEqual(["rule-a"])
  const artifact = JSON.parse(await readFile(join(root, ".pulsar/ownership-assessment.json"), "utf8"))
  expect(artifact.labels[0].label.value.anchor_id).toBeUndefined()
  expect(artifact.labels[0].label.value.distribution.find((entry: { anchor_id: string }) => entry.anchor_id === "unknown").probability).toBe(0.4)
})

test("failed calls replace old evidence with explicitly incomplete assessment, without retry", async () => {
  await run(async () => response("meets"))
  let calls = 0
  const result = await run(async () => { calls++; return new Response("unavailable", { status: 503 }) })
  expect(calls).toBe(1)
  expect(result.calls_completed).toBe(0)
  expect(result.failures).toHaveLength(1)
  expect(result.applicability).toBe("insufficient_evidence")
  expect(result.aggregate?.missingGroupIds).toEqual(["rule-a"])
  expect((await readdir(join(root, result.receipts))).sort()).toEqual(["00000.failure.json", "00000.request.json"])
})

test("source edits during inference retain receipts but never replace the prior assessment", async () => {
  await run(async () => response("contrary"))
  const before = await readFile(join(root, ".pulsar/ownership-assessment.json"), "utf8")
  await expect(run(async () => {
    await writeFile(join(root, "rule.ts"), "export const permits = (n: number) => n > 8\n")
    return response("meets")
  })).rejects.toThrow("changed during inference")
  expect(await readFile(join(root, ".pulsar/ownership-assessment.json"), "utf8")).toBe(before)
})

test("outbound sources reject parent symlink escapes and oversized requests before any calls", async () => {
  await symlink(tmpdir(), join(root, "outside"))
  const invalid = policy()
  invalid.groups[0]!.caller_paths = ["outside/not-ours.ts"]
  await writePolicy(invalid)
  await expect(Effect.runPromise(prepareOwnershipJudgment(root))).rejects.toThrow("could not be prepared")
  await writePolicy()
  await writeFile(join(root, "rule.ts"), "//" + "a".repeat(121_000))
  await expect(Effect.runPromise(prepareOwnershipJudgment(root))).rejects.toThrow("could not be prepared")
  expect(await readdir(join(root, ".pulsar"))).toEqual(["ownership.json"])
})
