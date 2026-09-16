#!/usr/bin/env bun

import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const clone = resolve(import.meta.dir, "..")
const fixtures = join(import.meta.dir, "fixtures/agent-consumer")
const stubId = "TS-SL-04-unfinished-implementations"
const repair = `let total = 0
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
        !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      throw new Error("Invalid order line")
    }
    total += line.quantity * line.unitPriceCents
    if (!Number.isSafeInteger(total)) throw new Error("Order total overflow")
  }
  return total`

export async function createConsumer(root: string, withPolicy = true) {
  const repo = join(root, "orders")
  const put = async (path: string, content: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true })
    await writeFile(join(repo, path), content)
  }
  for (const [source, target] of [
    ["service.ts", "src/service.ts"],
    ["service.test.ts.txt", "src/service.test.ts"],
    ["vector.json", ".pulsar/vector.json"],
    ["project-modules.json", ".pulsar/project-modules.json"],
    ["orders.ts", ".pulsar/modules/orders.ts"],
  ]) {
    if (!withPolicy && target!.startsWith(".pulsar/")) continue
    await put(target!, await readFile(join(fixtures, source!), "utf8"))
  }
  await put("package.json", JSON.stringify({ name: "order-service", private: true, type: "module", scripts: { test: "bun test" } }))
  await put("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler" }, include: ["src"] }))
  await put("README.md", "# Order service\nQuotes order quantities in integer cents. Run `bun test`.\n")
  const env = {
    ...process.env, CI: "1", NO_COLOR: "1",
    HOME: join(root, "home"), PULSAR_STATE_HOME: join(root, "state"),
    PULSAR_SMOKE_IMPORT_MARKER: join(root, "imported"),
    PULSAR_SMOKE_PROCESSOR_MARKER: join(root, "processed"),
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "commit.gpgsign", GIT_CONFIG_VALUE_0: "false",
  }
  await mkdir(env.HOME, { recursive: true })
  const run = async (command: string[], cwd = repo) => {
    const process = Bun.spawn(command, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
    ])
    return { stdout, stderr, code }
  }
  for (const args of [["init", "-b", "main"], ["add", "."], ["-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "test: initial order service"]]) {
    const out = await run(["git", ...args])
    assert.equal(out.code, 0, out.stderr)
  }
  const fix = async () => {
    const path = join(repo, "src/service.ts")
    await writeFile(path, (await readFile(path, "utf8")).replace('throw new Error("Not implemented")', repair))
  }
  return { repo, run, fix, env }
}

async function policyFiles(repo: string) {
  const result: Record<string, string> = {}
  const visit = async (path: string) => {
    for (const entry of await readdir(join(repo, path), { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else result[child] = await readFile(join(repo, child), "utf8")
    }
  }
  await visit(".pulsar")
  return result
}

export async function smoke(cli?: string, fixtureOnly = false) {
  const root = await mkdtemp(join(tmpdir(), "pulsar-agent-consumer-"))
  try {
    const { repo, run, fix, env } = await createConsumer(root)
    assert.notEqual((await run([process.execPath, "test"])).code, 0, "unfinished service must fail its own tests")
    if (fixtureOnly) {
      // The legacy CLI lacks --module-dependency-root. This is fixture proof only.
      await symlink(join(clone, "node_modules"), join(repo, "node_modules"), "dir")
      const manifest = JSON.parse(await readFile(join(repo, "package.json"), "utf8"))
      manifest.devDependencies = { effect: "4.0.0-rc.112", "@skastr0/pulsar-project-module-sdk": "0.2.1" }
      await writeFile(join(repo, "package.json"), JSON.stringify(manifest))
      const committed = await run(["git", "-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-am", "test: legacy module dependency declarations"])
      assert.equal(committed.code, 0, committed.stderr)
      const before = await run([process.execPath, join(clone, "scripts/pulsar-dev.ts"), "score", repo])
      assert.equal(before.code, 0, before.stderr)
      assert.match(before.stdout, /TS-SL-04-unfinished-implementations BLOCK/)
      assert.ok(existsSync(env.PULSAR_SMOKE_PROCESSOR_MARKER), "engine must consume the SDK size processor")
      await fix()
      const tests = await run([process.execPath, "test"])
      assert.equal(tests.code, 0, tests.stderr)
      const after = await run([process.execPath, join(clone, "scripts/pulsar-dev.ts"), "score", repo])
      assert.equal(after.code, 0, after.stderr)
      assert.doesNotMatch(after.stdout, /TS-SL-04-unfinished-implementations BLOCK/)
      console.log("PASS fixture: real failing/passing service tests, engine stub BLOCK resolved, SDK processor consumed. Agent contract NOT exercised.")
      return
    }
    const command = cli ? [resolve(cli)] : [process.execPath, join(clone, "scripts/pulsar-dev.ts")]
    const fresh = await createConsumer(join(root, "zero-config"), false)
    const initial = await fresh.run([...command, "agent", "score", fresh.repo], root)
    assert.equal(initial.code, 2, initial.stdout + initial.stderr)
    const defaults = JSON.parse(initial.stdout)
    assert.equal(defaults.schema, "pulsar/agent/v1alpha1")
    assert.equal(defaults.status, "completed")
    assert.equal(defaults.result.policy.vector.trust_boundary, "built-in-defaults")
    assert.equal(defaults.result.assessment.hard_gate_status, "fail")
    assert.ok(defaults.result.findings.some((finding: { signal_id: string }) => finding.signal_id === stubId))
    assert.ok(!existsSync(join(fresh.repo, ".pulsar/vector.json")), "first assessment generated policy")
    assert.ok(!existsSync(join(fresh.repo, ".pulsar/project-modules.json")), "first assessment generated modules")
    // Deliberately invoke from outside both the consumer and the Pulsar clone.
    const call = async (operation: string, args: string[] = [], code = 0) => {
      const out = await run([...command, "agent", operation, repo, ...args], root)
      assert.equal(out.code, code, `${operation}: ${out.stdout}\n${out.stderr}`)
      const envelope = JSON.parse(out.stdout)
      assert.equal(envelope.schema, "pulsar/agent/v1alpha1")
      assert.equal(envelope.operation, operation)
      assert.equal(envelope.status, code === 1 ? "error" : "completed")
      if (code === 1) {
        assert.equal(typeof envelope.error.code, "string")
        assert.equal(typeof envelope.error.message, "string")
        return envelope.error
      }
      return envelope.result
    }
    const trusted = ["--module-dependency-root", clone, "--trust-project-code"]
    const original = await policyFiles(repo)
    const catalog = JSON.stringify(await call("catalog"))
    assert.ok(catalog.includes(stubId) && catalog.includes("typescript.size-policy"))
    assert.ok(JSON.stringify(await call("catalog", ["--signal", "TS-SL-04"])).includes("hard_gate_production"))
    assert.ok(JSON.stringify(await call("catalog", ["--slot", "typescript.size-policy"])).includes("typescript.size-policy"))
    await call("config", ["--module-dependency-root", clone], 1)
    await call("score", ["--module-dependency-root", clone], 1)
    assert.ok(!existsSync(env.PULSAR_SMOKE_IMPORT_MARKER), "untrusted module executed before refusal")
    const vectorPath = join(repo, ".pulsar/vector.json")
    const vector = JSON.parse(await readFile(vectorPath, "utf8"))
    for (const invalid of [
      { ...vector, signal_overrides: { "TS-SL-04": { config: { unknown_smoke_option: true } } } },
      { ...vector, signal_overrides: { "TS-SL-04": { weight: -1 } } },
    ]) {
      await writeFile(join(root, "candidate.json"), JSON.stringify(invalid))
      await call("config", [...trusted, "--vector", "candidate.json"], 1)
    }
    await writeFile(join(root, "candidate.json"), JSON.stringify(vector))
    await writeFile(join(root, "modules.json"), await readFile(join(repo, ".pulsar/project-modules.json")))
    const preview = await call("config", [...trusted, "--vector", "candidate.json", "--modules", "modules.json"])
    assert.equal(typeof preview.policy.fingerprint, "string")
    assert.deepEqual(await policyFiles(repo), original, "preview mutated shared policy")
    const config = await call("config", trusted)
    const fingerprint = config.policy.fingerprint
    assert.equal(typeof fingerprint, "string")
    assert.ok(fingerprint.length > 0)
    const scoreArgs = [...trusted, "--expect-policy", fingerprint, "--full"]
    const before = await call("score", scoreArgs, 2)
    assert.equal(before.policy.fingerprint, fingerprint)
    assert.equal(before.assessment.hard_gate_status, "fail")
    assert.equal(before.signals[stubId].weight, 1.8, "nondefault weight must reach assessment")
    assert.equal(typeof before.assessment.weighted_mean, "number")
    assert.equal(typeof before.assessment.evidence_complete, "boolean")
    assert.ok(before.findings.some((finding: { signal_id: string }) => finding.signal_id === stubId))
    assert.ok(existsSync(env.PULSAR_SMOKE_PROCESSOR_MARKER), "registered processor was never consumed")
    const alternateWeights = structuredClone(vector)
    alternateWeights.signal_overrides["TS-SL-04"].weight = 0.2
    await writeFile(join(root, "weights.json"), JSON.stringify(alternateWeights))
    const reweighted = await call("score", [...trusted, "--vector", "weights.json", "--full"], 2)
    assert.equal(reweighted.signals[stubId].score, before.signals[stubId].score, "weight changed detector evidence")
    assert.notEqual(reweighted.assessment.weighted_mean, before.assessment.weighted_mean, "weight did not affect aggregation")
    assert.deepEqual(await policyFiles(repo), original, "weight preview mutated adopted policy")
    const filtered = await call("score", [...trusted, "--expect-policy", fingerprint, "--signal", "TS-LD-02", "--limit", "1"], 2)
    assert.deepEqual(filtered.assessment, before.assessment, "detail filtering changed verdict or scoring")
    await fix()
    const tests = await run([process.execPath, "test"])
    assert.equal(tests.code, 0, tests.stderr)
    // This fresh service has no history, glossary or coverage artifacts. Repair
    // must clear the proven block without pretending those evidence gaps vanished.
    const after = await call("score", scoreArgs, 3)
    assert.equal(after.assessment.counts.failed, 0)
    assert.ok(after.assessment.counts.insufficient_evidence > 0)
    assert.equal(after.assessment.evidence_complete, false)
    assert.equal(after.policy.fingerprint, fingerprint)
    assert.equal(after.assessment.hard_gate_status, "pass")
    assert.ok(!after.findings.some((finding: { signal_id: string }) => finding.signal_id === stubId))
    assert.notEqual(after.repository.input_fingerprint, before.repository.input_fingerprint)
    const stable = (result: typeof after) => ({ policy: result.policy.fingerprint, input: result.repository.input_fingerprint, assessment: result.assessment, findings: result.findings, signals: result.signals })
    assert.deepEqual(stable(await call("score", scoreArgs, 3)), stable(after), "warm parity")
    await rm(env.PULSAR_STATE_HOME, { recursive: true, force: true })
    assert.deepEqual(stable(await call("score", scoreArgs, 3)), stable(after), "cold parity")
    assert.deepEqual(await policyFiles(repo), original, "assessment mutated policy or baseline")
    vector.signal_overrides["TS-SL-04"].weight = 1.9
    await writeFile(vectorPath, JSON.stringify(vector))
    assert.equal((await call("score", scoreArgs, 1)).code, "POLICY_MISMATCH")
    await writeFile(vectorPath, original[".pulsar/vector.json"]!)
    const modulePath = ".pulsar/modules/orders.ts"
    await writeFile(join(repo, modulePath), original[modulePath]!.replace("? 250 : 40", "? 240 : 5"))
    assert.equal((await call("score", scoreArgs, 1)).code, "POLICY_MISMATCH")
    const recalibrated = await call("score", [...trusted, "--full"], 3)
    const sizeId = "TS-LD-02-function-size-distribution"
    assert.notEqual(recalibrated.signals[sizeId].score, after.signals[sizeId].score, "executable calibration did not change size interpretation")
    assert.ok(JSON.stringify(recalibrated.signals[sizeId].factors).includes("order-service.reviewable-size.v1"), "calibration rule attribution missing")
    await writeFile(join(repo, modulePath), original[modulePath]!)
    assert.deepEqual(await policyFiles(repo), original)
    console.log("PASS agent consumer: zero-config assessment, catalog, validation, pre-import trust, preview, effective weights/processors, block→repair→gate-pass (evidence gaps preserved), detail-only filters, policy guards, no mutations, attributed cold/warm parity")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const cliIndex = args.indexOf("--cli")
  if (cliIndex >= 0 && !args[cliIndex + 1]) throw new Error("--cli requires an executable path")
  await smoke(cliIndex >= 0 ? args[cliIndex + 1] : undefined, args.includes("--fixture-only"))
}
