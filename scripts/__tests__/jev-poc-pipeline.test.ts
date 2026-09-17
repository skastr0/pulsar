import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { canonical, Response, sha256, type Request } from "../jev-spike/model.ts"
import { aggregate, judgmentMachine, replay, type CallRecord, type Finding, type Plan, type Run, type Step } from "../jev-poc/pipeline.ts"
import { decodePolicy, loadSemanticPolicy } from "../jev-poc/policy.ts"
import { decisive, factsRequest, QUESTION_VERSION } from "../jev-poc/questions.ts"
import repoPolicy from "../../.pulsar/modules/semantic-policy.ts"

function plan(): Plan {
  const pointer = { file: "src/rule.ts", startLine: 1, endLine: 3, extentSource: "parser" as const, extentComplete: true, fileSha256: "file", snippet: "function rule(x) { return x > 3 }", snippetLines: 3, snippetSha256: "snippet", clipped: false }
  return {
    schema: "pulsar.semantic-plan.v1alpha1", questionVersion: QUESTION_VERSION, model: "test", inputFingerprint: "input", policyFingerprint: "policy",
    structural: { score: 100, complete: true, hardGateCount: 0 }, policy: decodePolicy(repoPolicy), selections: { one: ["single-rule-owner"] },
    discovery: {
      schema: "pulsar.jev_poc_discovery.v1", repoRoot: "/repo",
      candidates: [{ id: "one", kind: "clone-group", signalId: "signal", provenance: { signalId: "signal", outputPath: "output.groups[0]", sourceRank: 0, signalScore: 0.5 }, semanticStatus: "not_assessed", primary: pointer, members: [pointer], context: [], facts: {}, limitations: [] }],
      coverage: {
        complete: true, coversWholeRepo: false,
        scope: { include: ["src/**/*.ts"], exclude: [], scoped: true, inScopeCandidates: 1, outOfScopeCount: 0, outOfScope: [] },
        signals: [],
        baseline: { cloneGroupsAvailable: 1, cloneFunctionsAnalyzed: 1, cloneGroupsBeyondSignalDiagnosticLimit: 0, signalDiagnosticLimit: 5, complexityFunctionsAvailable: 0, complexityOverThreshold: 0, complexityThreshold: 10, inScopeCloneGroups: 1, inScopeComplexityFunctions: 0 },
        sourceScan: { filesScanned: 1, filesSkipped: 0, filesSizeCapped: 0, filesUnreadable: 0, importSpecifierCaps: 0, bytesRead: 50, truncated: false, unresolvedImportSpecifiers: 0 },
        context: { clippedCandidates: 0, omittedPointers: 0 },
        extents: { resolver: "not_needed", requested: 0, resolved: 0, missing: 0, filesOpened: 0, filesConsulted: 0, truncated: false, failureReason: null },
        totalCandidates: 1, selectedCandidates: 1, omittedCount: 0, duplicatesRemoved: 0, omitted: [], rejected: [], limitations: [], limits: { maxCandidates: 8, maxSnippetLines: 160, maxContextBytes: 24000 },
      },
    },
  }
}
function answer(request: Request, choices: Record<string, string> = {}): Response {
  return Schema.decodeUnknownSync(Response)({ model: "test", usage: { input_tokens: 5, output_tokens: 2 }, answers: Object.fromEntries(Object.entries(request.questions).map(([id, q]) => {
    if (q.type !== "choice") throw new Error("Only choice expected")
    const choice = choices[id] ?? ({ readiness: "sufficient", relationship: "shared_rule", refinement: "independent_owners", verdict: "violated", direction: "consolidate_rule" }[id])
    if (!choice || !Object.hasOwn(q.criteria, choice)) throw new Error(`Missing choice ${id}`)
    return [id, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map((key) => [key, key === choice ? 1 : 0])) }]
  })) })
}
function run(p = plan(), choose: (step: Step) => Record<string, string> = () => ({})): Run {
  const machine = judgmentMachine(p)
  const records: CallRecord[] = []
  let next = machine.next()
  while (!next.done) {
    const response = answer(next.value.request, choose(next.value))
    records.push({ ...next.value, requestHash: sha256(JSON.stringify(next.value.request)), receipt: { status: 200, raw: JSON.stringify(response), requestId: null, elapsedMs: 1 }, failure: null })
    next = machine.next(response)
  }
  return { plan: p, records, summary: next.value }
}
const finding = (verdict: Finding["verdict"], penaltyPoints: number): Finding => ({ candidateId: "one", ruleId: "rule", penaltyPoints, verdict, relationship: null, refinement: null, direction: null, reason: "test" })

describe("autonomous semantic machine", () => {
  test("clone relationships do not compete with single-function responsibility labels", () => {
    const candidate = plan().discovery.candidates[0]!
    const clone = factsRequest(candidate, "test")
    const fn = factsRequest({ ...candidate, kind: "complexity-function" }, "test")
    expect(Object.keys(clone.questions.relationship!.criteria).sort()).toEqual(["independent_rules", "insufficient_evidence", "mechanical_similarity", "shared_rule"])
    expect(Object.keys(fn.questions.relationship!.criteria)).not.toContain("shared_rule")
    expect(clone.questions.readiness!.instructions).toMatchObject({ task: expect.stringContaining("domain decision") })
    expect(fn.questions.readiness!.instructions).toMatchObject({ task: expect.stringContaining("primary function") })
  })
  test("chains source-only facts, semantic refinement, then explicit repo policy", () => {
    const result = run()
    expect(result.records.map((r) => r.stage)).toEqual(["facts", "refinement", "policy"])
    expect(JSON.stringify(result.records[0]!.request)).not.toContain(repoPolicy.rules[0].criterion)
    expect(result.records[2]!.request.state.repository_rule).toEqual({ id: "single-rule-owner", criterion: repoPolicy.rules[0].criterion })
    expect(result.summary.semantic).toMatchObject({ score: 80, interval: [80, 80], color: "red", knownPenalty: 20, complete: true })
    expect(replay(result)).toEqual(result.summary)
  })
  test("unclear facts stop later calls and do not purchase green", () => {
    const result = run(plan(), () => ({ readiness: "insufficient_evidence" }))
    expect(result.records).toHaveLength(1)
    expect(result.summary.semantic).toMatchObject({ interval: [80, 100], color: "amber", unresolvedPenalty: 20, complete: false })
  })
  test("call budget and partial discovery cannot purchase green", () => {
    const p = plan()
    const limited = { ...p, policy: { ...p.policy, budgets: { ...p.policy.budgets, maxCalls: 2 } } }
    const result = run(limited)
    expect(result.records).toHaveLength(2)
    expect(result.summary.findings[0]!.reason).toBe("call_budget_exhausted")
    const partial = { ...p, discovery: { ...p.discovery, coverage: { ...p.discovery.coverage, complete: false } } }
    expect(run(partial, () => ({ verdict: "satisfied" })).summary.semantic).toMatchObject({ interval: [0, 100], color: "amber" })
  })
  test("fixed penalties survive clean padding and preserve asymmetric unknown bounds", () => {
    const p = plan()
    const initial = [finding("violated", 35), finding("unknown", 10)]
    expect(aggregate(p, initial, 0).semantic.interval).toEqual([55, 65])
    expect(aggregate(p, [...initial, ...Array.from({ length: 100 }, () => finding("satisfied", 5))], 0).semantic.interval).toEqual([55, 65])
    expect(aggregate(p, [finding("violated", 97), finding("unknown", 10)], 0).semantic.interval).toEqual([0, 3])
    expect(aggregate(p, [finding("violated", 110)], 0).semantic.interval).toEqual([0, 0])
  })
  test("no semantic pass can compensate for a deterministic hard gate", () => {
    const p = { ...plan(), structural: { score: 100, complete: true, hardGateCount: 1 } }
    const result = run(p, () => ({ verdict: "satisfied" }))
    expect(result.summary.semantic.color).toBe("green")
    expect(result.summary.health.color).toBe("red")
  })
  test("duplicate detector observations with identical members are counted once", () => {
    const p = plan()
    const duplicate = { ...p.discovery.candidates[0]!, id: "two" }
    const result = run({ ...p, selections: { ...p.selections, two: ["single-rule-owner"] }, discovery: { ...p.discovery, candidates: [...p.discovery.candidates, duplicate] } })
    expect(result.summary.findings).toHaveLength(1)
    expect(result.summary.semantic.knownPenalty).toBe(20)
  })
  test("replay rejects initial hash, composed-request, missing/extra receipt and summary tampering", () => {
    const result = run()
    for (const index of [0, 1, 2]) {
      const bad = structuredClone(result)
      ;(bad.records[index] as { requestHash: string }).requestHash = "tampered"
      expect(() => replay(bad)).toThrow("Request integrity")
      const changed = structuredClone(result)
      ;(changed.records[index]!.request as { state: object }).state = {}
      expect(() => replay(changed)).toThrow("Request integrity")
    }
    expect(() => replay({ ...result, records: result.records.slice(1) })).toThrow()
    expect(() => replay({ ...result, records: [...result.records, result.records[0]!] })).toThrow("extra receipt")
    expect(() => replay({ ...result, summary: { ...result.summary, calls: 0 } })).toThrow("Summary integrity")
    const badRaw = structuredClone(result)
    ;(badRaw.records[0]!.receipt as { raw: string }).raw = "unparseable"
    expect(() => replay(badRaw)).toThrow()
  })
  test("confidence and margin each gate consumption, including a tie", () => {
    const response = answer(run().records[0]!.request)
    const readiness = response.answers.readiness
    if (readiness?.type !== "choice") throw new Error("choice")
    const withProb = (p: number) => ({ ...response, answers: { ...response.answers, readiness: { ...readiness, probabilities: { sufficient: p, insufficient_evidence: 1 - p } } } })
    expect(decisive(withProb(0.59), "readiness", { minProbability: 0.6, minMargin: 0.1 })).toBeNull()
    expect(decisive(withProb(0.6), "readiness", { minProbability: 0.6, minMargin: 0.25 })).toBeNull()
    expect(decisive(withProb(0.6), "readiness", { minProbability: 0.6, minMargin: 0.15 })).toBe("sufficient")
    expect(decisive(withProb(0.5), "readiness", { minProbability: 0.5, minMargin: 0.01 })).toBeNull()
  })
  test("policy load requires repo-local source and explicit trust; dependency edits change identity", async () => {
    const root = mkdtempSync(join(tmpdir(), "semantic-policy-"))
    try {
      await expect(Effect.runPromise(loadSemanticPolicy(root, true))).rejects.toThrow()
      mkdirSync(join(root, ".pulsar/modules"), { recursive: true })
      writeFileSync(join(root, ".pulsar/modules/helper.ts"), "export const n = 20\n")
      writeFileSync(join(root, ".pulsar/modules/semantic-policy.ts"), `import { n } from './helper.ts'; export default {...${JSON.stringify(repoPolicy)}, selectRules: () => n > 0 ? ['single-rule-owner'] : []}`)
      await expect(Effect.runPromise(loadSemanticPolicy(root, false))).rejects.toThrow()
      const first = await Effect.runPromise(loadSemanticPolicy(root, true))
      expect(first.verifySource()).toBe(true)
      expect(first.selectRules(plan().discovery.candidates[0]!)).toHaveLength(1)
      writeFileSync(join(root, ".pulsar/modules/helper.ts"), "export const n = 0\n")
      expect(first.verifySource()).toBe(false)
      const second = await Effect.runPromise(loadSemanticPolicy(root, true))
      expect(second.fingerprint).not.toBe(first.fingerprint)
      expect(canonical(second.policy)).toBe(canonical(first.policy))
      expect(second.selectRules(plan().discovery.candidates[0]!)).toHaveLength(0)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
