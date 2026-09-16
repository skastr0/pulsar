import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Schema } from "effect"
import bankJson from "../../docs/explorations/jev-spike-question-bank.json"
import { canonical, compile, sha256, summarize, validateBank, validateResponse, type Case, type Response as JevResponse } from "../jev-spike/model.ts"
import { evaluatePlan, prepare, replay, smokeRequest, validateCurrentInputs, validatePlan } from "../jev-spike.ts"
import { ENDPOINT, JudgmentProvider, jevLayer } from "../jev-spike/transport.ts"

const bank = validateBank(bankJson)
const fixture: Case = {
  id: "test", lineage: "test", questionIds: ["JQ-04"], proposedExpectations: { "JQ-04": "same_invariant" },
  state: {
    focus: { subject: "two adapters", criterion: "shared domain invariant" },
    code: { related: [{ path: "a.ts", content: "export const a = 1" }] },
    relationships: [], contracts: [], policy: { principle: "Share domain rules, not independent protocols" },
    context_manifest: { missing: [] },
  },
}
const smokeAnswer = {
  model: "jev-test", usage: { input_tokens: 123, output_tokens: 12 },
  answers: {
    color: { type: "choice", choice: "red", probabilities: { red: 0.8, blue: 0.15, unknown: 0.05 }, confidence: 0.6 },
    count: { type: "score", score: 2.5, probabilities: { "0": 0, "1": 0.1, "2": 0.3, "3": 0.6 }, legend: { "0": "Zero balls", "1": "One ball", "2": "Two balls", "3": "Three balls" }, confidence: 0.7 },
    blue: { type: "noul", noul: 0.01 },
  },
} satisfies JevResponse

describe("Jev research contract", () => {
  test("validates all 24 templates and compiles readiness without labels or metadata", () => {
    expect(Object.keys(bank.templates)).toHaveLength(24)
    const request = compile(bank, fixture, "jev-latest")
    expect(Object.keys(request.questions)).toEqual(["JQ-01", "JQ-02", "JQ-04"])
    expect(JSON.stringify(request)).not.toContain("proposedExpectations")
    for (const question of Object.values(request.questions)) {
      expect(question.instructions.startsWith(bank.common_instructions)).toBe(true)
      expect(Object.keys(question).sort()).toEqual(["criteria", "instructions", "type"])
    }
    expect(JSON.stringify(request.state.focus)).toContain("code.related")
  })

  test("readiness preserves explicitly declared evidence beyond selected templates", () => {
    const request = compile(bank, { ...fixture, questionIds: ["JQ-22"], state: {
      ...fixture.state, contracts: null,
      focus: { subject: "adapters", criterion: "contract preservation", required_evidence: ["contracts"] },
    } }, "jev-latest")
    const focus = Schema.decodeUnknownSync(Schema.JsonObject)(request.state.focus)
    expect(focus.required_evidence).toContain("contracts")
  })

  test("rejects missing required paths, leaked labels, and invalid catalog references", () => {
    expect(() => compile(bank, { ...fixture, state: { ...fixture.state, code: {} } }, "jev-latest")).toThrow("Unbound evidence")
    expect(() => compile(bank, { ...fixture, state: { ...fixture.state, reference_label: "healthy" } }, "jev-latest")).toThrow("Local-only")
    const altered = structuredClone(bankJson)
    altered.templates["JQ-04"].experiments.push("E43")
    expect(() => validateBank(altered)).toThrow("Invalid experiment/case")
    altered.templates["JQ-04"].experiments.pop()
    altered.templates["JQ-06"].illustrative_utility.pop()
    expect(() => validateBank(altered)).toThrow("utility")
  })

  test("validates all answer types with an asymmetric weighted score", () => {
    expect(validateResponse(smokeRequest, smokeAnswer)).toEqual(smokeAnswer)
    expect(canonical({ z: [2, 1], a: "x" })).toBe('{"a":"x","z":[2,1]}')
  })

  test("accepts independently rounded Score, but rejects differences beyond rounding", () => {
    const rounded = { ...smokeAnswer, answers: { ...smokeAnswer.answers, count: {
      ...smokeAnswer.answers.count, score: 2.99, probabilities: { "0": 0, "1": 0, "2": 0, "3": 1 },
    } } }
    expect(validateResponse(smokeRequest, rounded).answers.count).toEqual(rounded.answers.count)
    expect(() => validateResponse(smokeRequest, { ...rounded, answers: { ...rounded.answers, count: { ...rounded.answers.count, score: 2.95 } } })).toThrow("inconsistent score")
  })

  test("rejects missing answers, nonfinite values, invented keys, bad sums, wrong choice and legend", () => {
    const variants = [
      { ...smokeAnswer, answers: { ...smokeAnswer.answers, extra: { type: "noul", noul: 0.5 } } },
      { ...smokeAnswer, answers: { ...smokeAnswer.answers, blue: { type: "noul", noul: NaN } } },
      { ...smokeAnswer, answers: { ...smokeAnswer.answers, blue: { type: "noul", noul: 1.01 } } },
      { ...smokeAnswer, answers: { ...smokeAnswer.answers, color: { type: "choice", choice: "blue", probabilities: { red: 0.8, blue: 0.15, unknown: 0.05 }, confidence: 0.5 } } },
      { ...smokeAnswer, answers: { ...smokeAnswer.answers, color: { type: "choice", choice: "red", probabilities: { red: 0.8, blue: 0.3, unknown: 0.05 }, confidence: 0.5 } } },
      { ...smokeAnswer, answers: { ...smokeAnswer.answers, count: { ...smokeAnswer.answers.count, score: 1.5 } } },
      { ...smokeAnswer, answers: { ...smokeAnswer.answers, count: { ...smokeAnswer.answers.count, legend: { "0": "changed" } } } },
    ]
    for (const value of variants) expect(() => validateResponse(smokeRequest, value)).toThrow()
    expect(() => validateResponse(smokeRequest, { ...smokeAnswer, answers: {} })).toThrow()
  })

  test("missing nested evidence cannot become healthy even if readiness claims sufficient", () => {
    const request = compile(bank, { ...fixture, state: { ...fixture.state, code: { related: null } } }, "jev-latest")
    const response: JevResponse = {
      model: "mock", usage: { input_tokens: 0, output_tokens: 0 }, answers: {
        "JQ-01": { type: "choice", choice: "sufficient", probabilities: { sufficient: 1 }, confidence: 1 },
        "JQ-02": { type: "choice", choice: "defined", probabilities: { defined: 1 }, confidence: 1 },
      },
    }
    expect(summarize(request, response).consumption).toBe("unconsumed")
    expect(summarize(compile(bank, fixture, "jev-latest"), response).consumption).toBe("descriptive_only")
  })

  test("hard budgets and request identities reject modified plans", () => {
    const plan = prepare("smoke")
    expect(validatePlan(plan)).toEqual(plan)
    expect(() => validatePlan({ ...plan, maxRequests: 100 })).toThrow("budget")
    expect(() => validatePlan({ ...plan, requests: [{ ...plan.requests[0], requestHash: "forged" }] })).toThrow("hash")
    expect(() => validatePlan({ ...plan, requests: Array(33).fill(plan.requests[0]) })).toThrow("budget")
  })

  test("development plan freezes repeats, strips verdict examples, and swaps candidate references", () => {
    const plan = prepare("development")
    expect(plan.requests).toHaveLength(25)
    const first = plan.requests[0]!
    const repeats = plan.requests.filter((entry) => entry.id.startsWith(`${first.id}-repeat-`))
    expect(repeats).toHaveLength(4)
    expect(repeats.every((entry) => entry.requestHash === first.requestHash)).toBe(true)
    for (const entry of plan.requests) {
      expect(JSON.stringify(entry.request)).not.toContain("approved_examples")
      expect(JSON.stringify(entry.request)).not.toContain("proposedExpectations")
    }
    const original = plan.requests.find((entry) => entry.id === "C16-reject-superclass")!
    const swapped = plan.requests.find((entry) => entry.id === "C16-reject-superclass-swapped")!
    expect(Schema.decodeUnknownSync(Schema.JsonObject)(swapped.request.state.focus).candidate).toBe("a")
    expect(Schema.decodeUnknownSync(Schema.JsonObject)(swapped.request.state.alternatives).a)
      .toEqual(Schema.decodeUnknownSync(Schema.JsonObject)(original.request.state.alternatives).b)
    const omitted = plan.requests.find((entry) => entry.id === "C11-omitted-contracts")!
    expect(Schema.decodeUnknownSync(Schema.JsonObject)(omitted.request.state.focus).required_evidence).toContain("contracts")
  })

  test("rejects stale evidence and altered policy even with self-consistent request hashes", () => {
    const plan = prepare("smoke")
    expect(() => validateCurrentInputs(plan)).not.toThrow()
    expect(() => validateCurrentInputs({ ...plan, casesHash: "old-source" })).toThrow("changed")
    expect(() => validateCurrentInputs({ ...plan, policy: { ...plan.policy, retries: 4 } })).toThrow("changed")
    const request = { ...plan.requests[0]!.request, state: { reference_label: "leaked" } }
    const forged = { ...plan, requests: [{ ...plan.requests[0]!, request, requestHash: sha256(JSON.stringify(request)) }] }
    expect(() => validateCurrentInputs(forged)).toThrow("changed")
  })

  test("executes the actual Pulsar scoring candidate against the existing test obligation", async () => {
    const plan = prepare("pulsar-regression")
    const code = Schema.decodeUnknownSync(Schema.JsonObject)(plan.requests[0]!.request.state.code)
    const before = Schema.decodeUnknownSync(Schema.Struct({ content: Schema.String }))(code.before)
    const after = Schema.decodeUnknownSync(Schema.Struct({ content: Schema.String }))(code.after)
    const original = await import(`data:text/javascript;base64,${Buffer.from(`export const signal = { ${before.content} }`).toString("base64")}`)
    const candidate = await import(`data:text/javascript;base64,${Buffer.from(`export const signal = { ${after.content} }`).toString("base64")}`)
    const input = { moduleCount: 14, resolvedUseCount: 7, hubCount: 1, totalHubPressure: 3 }
    expect(original.signal.score(input)).toBeCloseTo(0.8357142857, 9)
    expect(candidate.signal.score(input)).toBeCloseTo(0.7857142857, 9)
    expect(candidate.signal.score(input)).not.toBeCloseTo(0.8357142857, 9)
  })

  test("records exact receipts and replays offline; trusted digest detects tampering", async () => {
    const temp = mkdtempSync(join(tmpdir(), "jev-spike-"))
    try {
      const plan = prepare("smoke")
      const out = join(temp, "run")
      const mock = Layer.succeed(JudgmentProvider, { evaluate: () => Effect.succeed({ status: 200, raw: JSON.stringify(smokeAnswer), requestId: "mock", elapsedMs: 12 }) })
      await Effect.runPromise(evaluatePlan(plan, out).pipe(Effect.provide(mock)))
      const bytes = readFileSync(join(out, "run.json"), "utf8")
      const hash = sha256(bytes)
      const originalFetch = globalThis.fetch
      globalThis.fetch = Object.assign(() => { throw new Error("Network forbidden") }, { preconnect: originalFetch.preconnect })
      try {
        const result = replay(bytes, hash)
        expect(result.inputTokens).toBe(123)
        expect(result.results[0]?.status).toBe("valid")
        expect(replay(bytes, hash)).toEqual(result)
        expect(() => replay(bytes.replace("jev-test", "forged"), hash)).toThrow("trusted receipt")
      } finally { globalThis.fetch = originalFetch }
      await expect(Effect.runPromise(evaluatePlan(plan, out).pipe(Effect.provide(mock)))).rejects.toThrow()
    } finally { rmSync(temp, { recursive: true, force: true }) }
  })

  test.each([401, 422, 429, 529])("HTTP %i remains a receipt, without retries", async (status) => {
    let calls = 0
    const fetcher = (async (url, options) => {
      calls++
      expect(url).toBe(ENDPOINT)
      expect(options?.redirect).toBe("error")
      expect(options?.body).toBe(JSON.stringify(smokeRequest))
      return new globalThis.Response('{"error":"fixture"}', { status })
    }) as typeof fetch
    const call = Effect.gen(function* () { return yield* (yield* JudgmentProvider).evaluate(smokeRequest) })
    const receipt = await Effect.runPromise(call.pipe(Effect.provide(jevLayer("test-only", fetcher))))
    expect(receipt.status).toBe(status)
    expect(calls).toBe(1)
  })

  test("timeouts abort transport and errors cannot echo credentials", async () => {
    let aborted = false
    const fetcher = ((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("Bearer test-secret")) })
    })) as typeof fetch
    const call = Effect.gen(function* () { return yield* (yield* JudgmentProvider).evaluate(smokeRequest) })
    try {
      await Effect.runPromise(call.pipe(Effect.provide(jevLayer("test-secret", fetcher, 5))))
      throw new Error("Expected timeout")
    } catch (error) {
      expect(String(error)).not.toContain("test-secret")
      expect(aborted).toBe(true)
    }
  })
})
