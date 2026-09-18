import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { simpleGit } from "simple-git"
import { agentInputFingerprint, agentReferencePolicyFingerprint } from "../agent-identity.js"

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pulsar-ownership-identity-"))
  await simpleGit(root).init()
  await mkdir(join(root, ".pulsar"))
  await writeFile(join(root, "rules.ts"), "export const allowed = (n: number) => n > 4\n")
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

test("ownership policy identity changes independently from source and assessment evidence", async () => {
  const policyPath = join(root, ".pulsar/ownership.json")
  await writeFile(policyPath, '{"preference":"shared_domain_rule"}')
  const first = await Effect.runPromise(agentReferencePolicyFingerprint(root))
  await writeFile(join(root, "rules.ts"), "export const allowed = (n: number) => n > 6\n")
  await writeFile(join(root, ".pulsar/ownership-assessment.json"), '{"labels":[]}')
  expect(await Effect.runPromise(agentReferencePolicyFingerprint(root))).toBe(first)
  await writeFile(policyPath, '{"preference":"caller_local"}')
  const changed = await Effect.runPromise(agentReferencePolicyFingerprint(root))
  expect(changed).not.toBe(first)
  await writeFile(policyPath, '{ "preference": "caller_local" }\n')
  expect(await Effect.runPromise(agentReferencePolicyFingerprint(root))).not.toBe(changed)
})

test("raw ownership receipts are disposable but the adopted assessment remains scoring input", async () => {
  const first = await Effect.runPromise(agentInputFingerprint(root))
  await mkdir(join(root, ".pulsar/ownership-runs"))
  await writeFile(join(root, ".pulsar/ownership-runs/receipt.json"), '{"usage":{"input_tokens":19}}')
  expect(await Effect.runPromise(agentInputFingerprint(root))).toBe(first)
  await writeFile(join(root, ".pulsar/ownership-assessment.json"), '{"labels":[]}')
  expect(await Effect.runPromise(agentInputFingerprint(root))).not.toBe(first)
})
