import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { canonical, sha256 } from "../jev-spike/model.ts"
import {
  buildPolicyClarityPlan,
  validatePolicyClarityPlan,
  type Condition,
} from "../jev-spike/policy-clarity.ts"
import {
  CASE_ORDER,
  buildFactorPolicyBoundaryCandidate,
  buildPolicyClarityCases,
} from "../jev-spike/policy-clarity-cases.ts"
import {
  cleanupRepoCopies,
  collectEvidence,
  type EvidenceReport,
} from "../jev-spike/policy-clarity-evidence.ts"
import { replay } from "../jev-policy-clarity.ts"

const REPO = resolve(import.meta.dir, "../..")
const FACTOR_LEDGER = "packages/core/src/factor-ledger.ts"

let evidenceReport: EvidenceReport | null = null
const evidence = (): EvidenceReport => {
  if (evidenceReport === null) throw new Error("Independent evidence was not collected")
  return evidenceReport
}

const temps: string[] = []

afterEach(() => {
  while (temps.length > 0) {
    const root = temps.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

// Evidence runs four tsc probes, two module loads and the pre-existing
// behavioral suite, so it is collected once rather than per test.
beforeAll(async () => {
  evidenceReport = await collectEvidence(REPO)
}, 300_000)

afterAll(() => {
  cleanupRepoCopies()
})

const materialize = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "jev-policy-clarity-"))
  temps.push(root)
  cpSync(join(REPO, "packages/core/src"), join(root, "packages/core/src"), { recursive: true })
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"))
  for (const [relative, content] of Object.entries(files)) writeFileSync(join(root, relative), content)
  return root
}

const leaves = (value: unknown): string[] => {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap(leaves)
  if (typeof value === "object") return Object.values(value).flatMap(leaves)
  return [String(value)]
}

const proseLeaves = (statement: string): string[] =>
  statement.split("\n").map((line) => {
    const separator = line.indexOf(": ")
    const value = line.slice(separator + 2)
    return value.startsWith("[") || value.startsWith("{") ? (JSON.parse(value) as unknown) : value
  }).flatMap(leaves)

describe("policy-clarity candidates", () => {
  test("preserves originals and fails closed on anchor drift", () => {
    const cases = buildPolicyClarityCases(REPO)
    expect(cases["observer-batch-protocol"].variants.a["packages/core/src/observer-execution.ts"]).toBe(
      readFileSync(join(REPO, "packages/core/src/observer-execution.ts"), "utf8"),
    )
    expect(cases["cache-lookup-representation"].variants.a["packages/core/src/cache.ts"]).toBe(
      readFileSync(join(REPO, "packages/core/src/cache.ts"), "utf8"),
    )
    expect(cases["factor-policy-boundary"].variants.a[FACTOR_LEDGER]).toBe(
      readFileSync(join(REPO, FACTOR_LEDGER), "utf8"),
    )

    const drifted = materialize({})
    writeFileSync(
      join(drifted, FACTOR_LEDGER),
      readFileSync(join(REPO, FACTOR_LEDGER), "utf8").replace("signalOverrideOf(signal, vector)?.config", "undefined"),
    )
    expect(() => buildFactorPolicyBoundaryCandidate(drifted)).toThrow(/Anchor drift/)
  })

  test("held-out variant b inlines the derivation and drops the named export", () => {
    const candidate = buildFactorPolicyBoundaryCandidate(REPO)
    const b = candidate.b[FACTOR_LEDGER]!
    expect(b).not.toContain("export const configFactorOverridesOf")
    expect(b).toContain("const overrideConfig = signalOverrideOf(signal, vector)?.config")
    expect(b).toContain("vectorConfigOverrides = overrides")
    // The derivation is still present; only the named boundary is gone.
    expect(b).toContain("read back")
    expect(candidate.evidence.productionCallSites).toHaveLength(1)
    expect(candidate.evidence.testCallSites).toHaveLength(1)
  })

  test("independent evidence: both modules compile, but only variant a keeps the existing test contract compiling", async () => {
    const report = evidence()
    const probe = (target: string, variant: "a" | "b") =>
      report.heldOut.compilerProbes.find((entry) => entry.target === target && entry.variant === variant)!
    expect(probe("module", "a").exitCode).toBe(0)
    expect(probe("module", "b").exitCode).toBe(0)
    expect(probe("existing_test_module", "a").exitCode).toBe(0)
    const failing = probe("existing_test_module", "b")
    expect(failing.exitCode).not.toBe(0)
    expect(failing.firstError).toContain("configFactorOverridesOf")
    expect(failing.firstError).toContain("TS2305")
  })

  test("independent evidence: runtime context is identical over the probed inputs, which is a probe and not a proof", async () => {
    const report = evidence()
    expect(report.heldOut.runtimeContextProbe.identical).toBe(true)
    expect(report.heldOut.runtimeContextProbe.probedInputs).toBe(5)
    expect(report.heldOut.runtimeContextProbe.sample).toContain("config.max_complexity")
    expect(report.limitations.join(" ")).toContain("finite probe")
    expect(report.heldOut.sourceInspection.inlinedVariantStillReadsBackFromResolvedConfig).toBe(true)
    expect(report.heldOut.sourceInspection.inlinedVariantDropsTheDocumentingComment).toBe(true)
  })

  test("independent evidence: development-case behavioral and compiler checks pass", async () => {
    const report = evidence()
    expect(report.development.existingBehavioralSuiteExitCode).toBe(0)
    expect(report.development.existingBehavioralSuiteSummary).toContain("0 fail")
    expect(report.development.representationConsumerCompileExitCodes).toEqual({ a: 0, b: 0 })
    expect(report.development.cacheLookupIdenticalOverProbedCases).toBe(true)
    expect(report.development.cacheLookupSample).toContain("effectiveConfidence")
  })

  test("annotations separate declared obligations from repository compatibility and mark the weak conflict fixture", async () => {
    const cases = buildPolicyClarityCases(REPO)
    const heldOut = cases["factor-policy-boundary"]
    expect(heldOut.authorExpectation.compatibility.b).toContain("not a verified applicable refactor")
    expect(heldOut.authorExpectation.compatibility.a).toContain("Independently verified applicable refactor")
    expect(heldOut.authorExpectation.deterministicRule).toContain("policy-sensitive rule application")
    expect(heldOut.authorExpectation.deterministicRule).not.toContain("no single deterministic rule resolves")
    expect(heldOut.conflictForcesIncompatibleOutcomes).toBe(false)
    expect(cases["observer-batch-protocol"].conflictForcesIncompatibleOutcomes).toBe(true)
    expect(cases["cache-lookup-representation"].conflictForcesIncompatibleOutcomes).toBe(true)
    const predictions = heldOut.authorExpectation.registeredPredictions
    expect(predictions).toHaveLength(1)
    expect(predictions[0]!.exploratoryFollowUp).toBe(true)
    expect(predictions[0]!.prediction).toContain("Exploratory follow-up")
    expect(cases["observer-batch-protocol"].authorExpectation.registeredPredictions[0]!.exploratoryFollowUp).toBe(false)
    // Every case states compatibility for both variants.
    for (const caseId of CASE_ORDER) {
      expect(cases[caseId].authorExpectation.compatibility.a.length).toBeGreaterThan(0)
      expect(cases[caseId].authorExpectation.compatibility.b.length).toBeGreaterThan(0)
    }
  })
})

describe("policy-clarity plan", () => {
  test("builds both scopes within budget with unique ids and matching hashes", () => {
    for (const scope of ["exploration", "frozen"] as const) {
      const plan = buildPolicyClarityPlan(REPO, "jev-latest", scope)
      expect(validatePolicyClarityPlan(plan)).toEqual(plan)
      expect(plan.requests.length).toBeGreaterThan(0)
      expect(plan.requests.length).toBeLessThanOrEqual(plan.maxRequests)
      expect(new Set(plan.requests.map((entry) => entry.id)).size).toBe(plan.requests.length)
      for (const entry of plan.requests) {
        expect(sha256(JSON.stringify(entry.request))).toBe(entry.requestHash)
        expect(Buffer.byteLength(JSON.stringify(entry.request))).toBeLessThanOrEqual(plan.maxRequestBytes)
      }
    }
  })

  test("exploration excludes the held-out case; frozen covers every case and condition", () => {
    const exploration = buildPolicyClarityPlan(REPO, "jev-latest", "exploration")
    expect(new Set(exploration.requests.map((entry) => entry.caseId))).toEqual(
      new Set(["observer-batch-protocol", "cache-lookup-representation"]),
    )
    const frozen = buildPolicyClarityPlan(REPO, "jev-latest", "frozen")
    expect(new Set(frozen.requests.map((entry) => entry.caseId))).toEqual(new Set(CASE_ORDER))
    const byCase = (caseId: string) => new Set(frozen.requests.filter((entry) => entry.caseId === caseId).map((entry) => entry.condition))
    expect(byCase("observer-batch-protocol").size).toBe(8)
    expect(byCase("cache-lookup-representation").size).toBe(7)
    expect(byCase("factor-policy-boundary").size).toBe(9)
    expect(byCase("cache-lookup-representation").has("opposing")).toBe(false)
    expect(byCase("cache-lookup-representation").has("opposing_single_callsite")).toBe(false)
  })

  test("the discriminating opposing batch touches only the held-out case", () => {
    const plan = buildPolicyClarityPlan(REPO, "jev-latest", "heldout_opposing")
    expect(new Set(plan.requests.map((entry) => entry.caseId))).toEqual(new Set(["factor-policy-boundary"]))
    expect(new Set(plan.requests.map((entry) => entry.condition))).toEqual(new Set(["opposing_single_callsite"]))
    expect(plan.requests).toHaveLength(2 * 4)
    const policy = plan.requests[0]!.request.state["policy"] as { statement: string }
    expect(policy.statement).toContain("more than one production call site uses it")
    expect(policy.statement).toContain("tests")
  })

  test("counterbalances candidate order and repeats each cell", () => {
    const frozen = buildPolicyClarityPlan(REPO, "jev-latest", "frozen")
    const cases = buildPolicyClarityCases(REPO)
    const cells = new Map<string, Set<string>>()
    for (const entry of frozen.requests) {
      expect(entry.labeling.a).not.toBe(entry.labeling.b)
      const key = `${entry.caseId}|${entry.condition}|o${entry.order}`
      const bucket = cells.get(key) ?? new Set<string>()
      bucket.add(`r${entry.repeat}`)
      cells.set(key, bucket)
      const variants = entry.request.state["variants"] as Record<string, { files: Record<string, string> }>
      expect(variants["a"]!.files).toEqual(cases[entry.caseId].variants[entry.labeling.a as "a" | "b"])
    }
    for (const bucket of cells.values()) expect(bucket.size).toBeGreaterThanOrEqual(2)
    // Every cell appears under both orders.
    const pairs = new Set([...cells.keys()].map((key) => key.replace(/o[01]$/, "")))
    for (const pair of pairs) {
      expect(cells.has(`${pair}o0`)).toBe(true)
      expect(cells.has(`${pair}o1`)).toBe(true)
    }
  })

  test("policy serialization preserves leaves; this does not establish whole-request equivalence", () => {
    const cases = buildPolicyClarityCases(REPO)
    for (const caseId of CASE_ORDER) {
      const definition = cases[caseId]
      for (const family of ["ambiguous", "precise"] as const) {
        const text = definition.policies[family]
        const structuredLeaves = leaves({
          scope: "pulsar-repository-research",
          status: "proposed-experiment-only-not-adopted",
          question: text.question,
          focus: text.focus,
          precedence: text.precedence,
          goal: text.goal,
          boundary_test: text.boundaryTest
            ? { what: text.boundaryTest.what, not_for: text.boundaryTest.notFor, examples: text.boundaryTest.examples }
            : null,
          preference: text.preference,
        }).sort()
        const prose = readProseStatement(caseId, family)
        expect([...proseLeaves(prose), "pulsar-repository-research", "proposed-experiment-only-not-adopted"].sort()).toEqual(
          structuredLeaves,
        )
      }
    }
  })

  test("keeps the expected verdict out of provider input", () => {
    const frozen = buildPolicyClarityPlan(REPO, "jev-latest", "frozen")
    const cases = buildPolicyClarityCases(REPO)
    for (const entry of frozen.requests) {
      const body = JSON.stringify(entry.request)
      expect(body).not.toContain("authorExpectation")
      expect(body).not.toContain("independentEvidence")
      expect(body).not.toContain("ground truth")
      const policy = entry.request.state["policy"] as unknown
      const serializedPolicy = canonical(policy)
      expect(serializedPolicy).not.toContain("variants.")
      for (const path of Object.keys(cases[entry.caseId].variants.a)) {
        expect(serializedPolicy).not.toContain(path)
      }
      const forbidden = ["reference_label", "expected_direction", "proposedExpectations", "annotator", "prior_model_outputs"]
      for (const key of forbidden) expect(body).not.toContain(key)
    }
  })

  test("no_policy supplies no criterion and conflict supplies two rules with no precedence", () => {
    const frozen = buildPolicyClarityPlan(REPO, "jev-latest", "frozen")
    const pick = (condition: Condition, caseId = "observer-batch-protocol") =>
      frozen.requests.find((entry) => entry.condition === condition && entry.caseId === caseId)!
    const noPolicy = pick("no_policy").request.state["policy"] as Record<string, unknown>
    expect(Object.keys(noPolicy).sort()).toEqual(["scope", "status"])
    const conflict = pick("conflict").request.state["policy"] as Record<string, unknown>
    expect(conflict["precedence"]).toBeNull()
    expect(conflict["boundary_test"]).toBeNull()
    const goal = String(conflict["goal"])
    expect(goal).toContain("Rule one")
    expect(goal).toContain("Rule two")
  })

  test("policy-only treatment varies the policy while holding the question constant", () => {
    const frozen = buildPolicyClarityPlan(REPO, "jev-latest", "frozen")
    const pick = (condition: Condition) =>
      frozen.requests.find((entry) => entry.condition === condition && entry.caseId === "observer-batch-protocol")!
    const ambiguous = pick("amb_prose")
    const policyOnly = pick("prec_policy_only")
    expect(policyOnly.request.questions["preference"]!.instructions).toEqual(
      ambiguous.request.questions["preference"]!.instructions,
    )
    expect(policyOnly.request.questions["preference"]!.criteria).toEqual(ambiguous.request.questions["preference"]!.criteria)
    expect(canonical(policyOnly.request.state["policy"])).not.toBe(canonical(ambiguous.request.state["policy"]))
  })

  test("ambiguous and precise share a direction; opposing flips it", () => {
    const cases = buildPolicyClarityCases(REPO)
    for (const caseId of CASE_ORDER) {
      const definition = cases[caseId]
      expect(definition.policies.ambiguous.goal).not.toBeNull()
      expect(definition.policies.ambiguous.boundaryTest).toBeNull()
      expect(definition.policies.precise.boundaryTest).not.toBeNull()
      expect(definition.policies.precise.precedence).not.toBeNull()
      const opposing = definition.policies.opposing
      if (opposing !== null) {
        expect(opposing.preference).not.toBe(definition.policies.precise.preference)
        expect(opposing.boundaryTest?.notFor).not.toBe(definition.policies.precise.boundaryTest?.notFor)
      }
    }
  })
})

describe("policy-clarity replay", () => {
  test("maps counterbalanced labels back to physical variants and aggregates per cell", () => {
    const plan = buildPolicyClarityPlan(REPO, "jev-latest", "exploration")
    const records = plan.requests.map((entry) => ({
      id: entry.id,
      status: "received" as const,
      receipt: {
        status: 200,
        raw: JSON.stringify(fakeResponse(entry.request, "a")),
        requestId: null,
        elapsedMs: 10,
      },
    }))
    const run = { schema: "pulsar.jev_policy_clarity_run.v1", plan, planHash: sha256(canonical(plan)), records }
    const bytes = JSON.stringify(run)
    const summary = replay(bytes, sha256(bytes), REPO)
    expect(summary.samples).toBe(plan.requests.length)
    for (const sample of summary.rawSamples) {
      // Every synthetic response selects label `a`, so the physical choice must
      // track the recorded labeling rather than the label.
      expect(sample.labelChoice).toBe("a")
      const entry = plan.requests.find((candidate) => candidate.id === sample.id)!
      expect(sample.physicalChoice).toBe(entry.labeling.a)
    }
    const physicalForOrder0 = new Set(
      summary.rawSamples.filter((sample) => sample.order === 0).map((sample) => sample.physicalChoice),
    )
    const physicalForOrder1 = new Set(
      summary.rawSamples.filter((sample) => sample.order === 1).map((sample) => sample.physicalChoice),
    )
    expect(physicalForOrder0).toEqual(new Set(["a"]))
    expect(physicalForOrder1).toEqual(new Set(["b"]))
    expect(summary.failures).toHaveLength(0)
    expect(summary.cells.length).toBeGreaterThan(0)
    expect(summary.cells[0]!.obligationsPreserved.yes).toBeGreaterThan(0)
  })

  test("rejects a run whose digest was altered", () => {
    const plan = buildPolicyClarityPlan(REPO, "jev-latest", "exploration")
    const bytes = JSON.stringify({ schema: "pulsar.jev_policy_clarity_run.v1", plan, planHash: sha256(canonical(plan)), records: [] })
    expect(() => replay(bytes, sha256("other"))).toThrow(/digest/)
  })
})

const fakeResponse = (request: { questions: Record<string, { type: string; criteria: Record<string, unknown> | ReadonlyArray<unknown> }> }, label: string) => {
  const answers: Record<string, unknown> = {}
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type === "noul") {
      answers[id] = { type: "noul", noul: 0.91 }
      continue
    }
    const keys = Array.isArray(question.criteria) ? question.criteria.map((_, index) => String(index)) : Object.keys(question.criteria)
    const probabilities: Record<string, number> = {}
    for (const key of keys) probabilities[key] = 0.02
    const chosen = keys.includes(label) ? label : keys[0]!
    probabilities[chosen] = 0.7
    const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0)
    for (const key of keys) probabilities[key] = probabilities[key]! / total
    answers[id] = { type: "choice", choice: chosen, probabilities, confidence: 0.72 }
  }
  return { model: "jev-test", answers, usage: { input_tokens: 10, output_tokens: 5 } }
}

const readProseStatement = (caseId: string, family: "ambiguous" | "precise"): string => {
  const condition: Condition = family === "ambiguous" ? "amb_prose" : "prec_prose"
  const plans = [
    buildPolicyClarityPlan(REPO, "jev-latest", "exploration"),
    buildPolicyClarityPlan(REPO, "jev-latest", "frozen"),
  ]
  for (const plan of plans) {
    const entry = plan.requests.find((candidate) => candidate.caseId === caseId && candidate.condition === condition)
    if (entry !== undefined) {
      const policy = entry.request.state["policy"] as { statement: string }
      return policy.statement
    }
  }
  throw new Error(`No prose request for ${caseId}/${family}`)
}
