import { beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { assertGroundTruth, assessResponse, collectSources, MODEL, prepareScenario, readPlan, replaceNormalizer, scenarioRequest, SIGNAL } from "../jev-one-scenario.ts"
import { canonical, sha256 } from "../jev-spike/model.ts"

const ROOT = resolve(import.meta.dir, "../..")
let plan: ReturnType<typeof prepareScenario>
beforeAll(() => { plan = prepareScenario() }, 60_000)

const response = (choice: string, probabilities = { supported: 0.03, contradicted: 0.94, not_established: 0.03 }) => ({
  model: MODEL, answers: { preservation: { type: "choice" as const, choice, probabilities, confidence: 0.87 } },
  usage: { input_tokens: 1723, output_tokens: 41 },
})

describe("one Jev scenario: Infinity diagnostic suppression", () => {
  test("actual production execution proves the counterexample and preserving extraction", () => {
    const { original, replacement, preservingExtraction } = plan.verification.observations
    expect(original[0]).toEqual({ input: "Infinity", normalizedLimit: 0, availableChains: 3, diagnosticFiles: [] })
    expect(replacement[0]).toEqual({ input: "Infinity", normalizedLimit: 10, availableChains: 3, diagnosticFiles: ["src/a.ts", "src/b.ts", "src/c.ts"] })
    expect(preservingExtraction).toEqual(original)
    expect(original[3]).toEqual({ input: "1.8", normalizedLimit: 1, availableChains: 3, diagnosticFiles: ["src/a.ts"] })
    expect(replacement[3]).toEqual(original[3])
    const checks = plan.verification.checks
    expect(Object.keys(checks)).toHaveLength(9)
    expect(checks["original:contract"]?.exitCode).toBe(0)
    expect(checks["replacement:contract"]?.exitCode).toBe(1)
    expect(checks["preservingExtraction:contract"]?.exitCode).toBe(0)
    for (const arm of ["original", "replacement", "preservingExtraction"]) {
      expect(checks[`${arm}:typecheck`]?.exitCode).toBe(0)
    }
    expect(collectSources()).toEqual(plan.sources) // Worktree source was not patched.
  })

  test("source excerpts match actual files and exact line ranges, including the existing contract", () => {
    for (const source of Object.values(plan.sources)) {
      const full = readFileSync(join(ROOT, source.file), "utf8")
      expect(sha256(full)).toBe(source.fileSha256)
      expect(full.split("\n").slice(source.startLine - 1, source.endLine).join("\n").trimEnd()).toBe(source.content)
    }
    expect(plan.sources.contract?.content).toContain("expect(TsAd03.diagnose(infiniteLimit)).toEqual([])")
    expect(plan.sources.selection?.content).toContain("if (limit <= 0) return []")
  })

  test("one bounded question, pinned model, no evaluator labels or control-arm results in state", () => {
    const request = scenarioRequest(plan.sources, plan.verification)
    expect(request).toEqual(plan.request)
    expect(request.model).toBe("jev-1.13.0")
    expect(Object.keys(request.questions)).toEqual(["preservation"])
    expect(Object.keys(request.state).sort()).toEqual(["evidence", "observations", "proposed_change", "scope"])
    const state = JSON.stringify(request.state)
    for (const privateValue of ["contradicted", "preservingExtraction", "reference", "checks", "exitCode", "1 fail", "1723"]) {
      expect(state).not.toContain(JSON.stringify(privateValue))
    }
    expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThan(24_000)
    // Extra evaluator annotations cannot accidentally enter the explicitly selected request fields.
    expect(scenarioRequest({ ...plan.sources, gold: { ...plan.sources.original!, content: "contradicted" } }, plan.verification)).toEqual(request)
  })

  test("the mutation changes only normalization binding and rejects stale or ambiguous anchors", () => {
    const source = readFileSync(join(ROOT, SIGNAL), "utf8")
    const local = plan.sources.original!.content
    const mutated = replaceNormalizer(source)
    expect(mutated).toBe('import { normalizeDiagnosticLimit } from "./trust-signal-helpers.js"\n' + source.replace(local, ""))
    expect(() => replaceNormalizer(source.replace(local, ""))).toThrow("anchor drift")
    expect(() => replaceNormalizer(source + "\n" + local)).toThrow("anchor drift")
  })

  test("symlinked source parents cannot escape the allowed repository", () => {
    const root = mkdtempSync(join(tmpdir(), "jev-source-boundary-"))
    try {
      mkdirSync(join(root, "packages"))
      symlinkSync(join(ROOT, "packages/ts-pack"), join(root, "packages/ts-pack"))
      expect(() => collectSources(root)).toThrow("escapes repository")
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test.each([
    ["expect(infiniteLimit.diagnosticLimit).toBe(0)", "expect(infiniteLimit.diagnosticLimit).toBe(10)"],
    ["top_n_diagnostics: Infinity", "top_n_diagnostics: 0"],
  ])("contract change %s needs adjudication, even when old assertions survive", (before, after) => {
    const root = mkdtempSync(join(tmpdir(), "jev-contract-drift-"))
    try {
      for (const source of Object.values(plan.sources)) {
        const path = join(root, source.file)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, readFileSync(join(ROOT, source.file), "utf8").replace(before, after))
      }
      expect(() => collectSources(root)).toThrow("new adjudication")
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test("empty fixture, altered observations, missing execution and failed positive control are rejected", () => {
    const v = plan.verification
    const variants = [
      { ...v, observations: { ...v.observations, original: v.observations.original.map(r => ({ ...r, availableChains: 0 })) } },
      { ...v, observations: { ...v.observations, replacement: v.observations.original } },
      { ...v, observations: { ...v.observations, preservingExtraction: v.observations.replacement } },
      { ...v, checks: {} },
      { ...v, checks: { ...v.checks, "replacement:contract": { ...v.checks["replacement:contract"]!, stderr: "test runner crashed" } } },
    ]
    for (const changed of variants) expect(() => assertGroundTruth(changed)).toThrow()
  })

  test("offline replay checks trusted digest, request reconstruction and implementation manifest", () => {
    const bytes = JSON.stringify(plan)
    expect(readPlan(bytes, sha256(bytes))).toEqual(plan)
    expect(() => readPlan(bytes + " ", sha256(bytes))).toThrow("digest")
    for (const changed of [
      { ...plan, requestSha256: "modified" },
      { ...plan, implementation: {} },
      { ...plan, implementation: { ...plan.implementation, "scripts/jev-one-scenario.ts": "modified" } },
      { ...plan, request: { ...plan.request, state: { ...plan.request.state, reference: "contradicted" } } },
    ]) {
      const altered = JSON.stringify(changed)
      expect(() => readPlan(altered, sha256(altered))).toThrow()
    }
  })

  test("agreement, disagreement, abstention and exact ties remain distinct; confidence is not truth", () => {
    const correct = response("contradicted")
    const result = assessResponse(plan, JSON.stringify(correct))
    expect(result.outcome).toBe("agrees_with_counterexample")
    expect(result.answer).toEqual(correct.answers.preservation)
    expect(result.usage).toEqual(correct.usage)
    const wrong = response("supported", { supported: 1, contradicted: 0, not_established: 0 })
    wrong.answers.preservation.confidence = 1
    expect(assessResponse(plan, JSON.stringify(wrong)).outcome).toBe("disagrees_with_counterexample")
    expect(assessResponse(plan, JSON.stringify(response("not_established", { supported: 0.01, contradicted: 0.02, not_established: 0.97 }))).outcome).toBe("unresolved")
    const tied = assessResponse(plan, JSON.stringify(response("contradicted", { supported: 0.5, contradicted: 0.5, not_established: 0 })))
    expect(tied.tied).toBe(true)
    expect(tied.outcome).toBe("unresolved")
  })

  test("malformed responses, invented options and different models cannot be assessed", () => {
    const good = response("contradicted")
    for (const bad of [
      { ...good, model: "jev-latest" },
      { ...good, answers: {} },
      response("supported"), // Not a maximum.
      response("contradicted", { supported: 0.8, contradicted: 0.9, not_established: 0 }),
      { ...good, answers: { preservation: { ...good.answers.preservation, probabilities: { contradicted: 1, mystery: 0 } } } },
    ]) expect(() => assessResponse(plan, JSON.stringify(bad))).toThrow()
    expect(() => assessResponse(plan, "HTTP error, not JSON")).toThrow()
  })

  test("assessment CLI requires both digests and never changes its input artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "jev-offline-assess-"))
    try {
      const bytes = JSON.stringify(plan)
      const raw = JSON.stringify(response("contradicted"))
      const planPath = join(root, "plan.json"), responsePath = join(root, "response.json")
      writeFileSync(planPath, bytes)
      writeFileSync(responsePath, raw)
      const command = ["bun", "scripts/jev-one-scenario.ts", "assess", planPath, sha256(bytes), responsePath, sha256(raw)]
      const result = Bun.spawnSync({ cmd: command, cwd: ROOT, stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout.toString()).outcome).toBe("agrees_with_counterexample")
      expect(canonical(JSON.parse(readFileSync(planPath, "utf8")))).toBe(canonical(plan))
      command[command.length - 1] = "wrong-digest"
      const rejected = Bun.spawnSync({ cmd: command, cwd: ROOT, stdout: "pipe", stderr: "pipe" })
      expect(rejected.exitCode).not.toBe(0)
      expect(rejected.stderr.toString()).toContain("Receipt digest mismatch")
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
