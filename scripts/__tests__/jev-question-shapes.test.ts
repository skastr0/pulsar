import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Schema } from "effect"
import { evaluatePlan, prepare, replay, validatePlan } from "../jev-spike.ts"
import { canonical, sha256, validateResponse, type Request, type Response } from "../jev-spike/model.ts"
import { describeFields, summarizeQuestions } from "../jev-spike/question-shapes.ts"
import { JudgmentProvider } from "../jev-spike/transport.ts"

test("fixed 12 requests preserve physical variants, identical repeat, and local-only dependencies", () => {
  const plan = prepare("question-shapes")
  expect(plan.requests).toHaveLength(12)
  expect(plan.maxRequests).toBe(12)
  expect(() => validatePlan({ ...plan, requests: [...plan.requests, plan.requests[0]] })).toThrow("budget")
  for (const family of ["extraction", "consolidation", "representation"]) {
    const flat = plan.requests.find((e) => e.id === `${family}-flat`)!
    const swapped = plan.requests.find((e) => e.id === `${family}-swapped`)!
    const structured = plan.requests.find((e) => e.id === `${family}-structured`)!
    const variants = Schema.decodeUnknownSync(Schema.JsonObject)(flat.request.state.variants)
    const swappedVariants = Schema.decodeUnknownSync(Schema.JsonObject)(swapped.request.state.variants)
    expect(swappedVariants.a).toEqual(variants.b)
    expect(swappedVariants.b).toEqual(variants.a)
    expect(swapped.request.questions).toEqual(flat.request.questions)
    expect(structured.request.state).toEqual(flat.request.state)
    for (const [id, question] of Object.entries(structured.request.questions)) {
      const original = flat.request.questions[id]!
      expect(original.instructions).toBe(describeFields(Schema.decodeUnknownSync(Schema.JsonObject)(question.instructions), false))
      if (question.type === "score" && original.type === "score") {
        expect(original.criteria).toEqual(question.criteria.map((v) => describeFields(Schema.decodeUnknownSync(Schema.JsonObject)(v), false)))
      } else if (question.type === "choice" && original.type === "choice") {
        expect(original.criteria).toEqual(Object.fromEntries(Object.entries(question.criteria).map(([key, value]) => [key, describeFields(Schema.decodeUnknownSync(Schema.JsonObject)(value), false)])))
      }
    }
    for (const v of ["a", "b"]) {
      const choice = structured.request.questions[`dimension_choice_${v}`]!
      const score = structured.request.questions[`dimension_score_${v}`]!
      if (choice.type !== "choice" || score.type !== "score") throw new Error("Missing matched primitives")
      expect(choice.instructions).toEqual(score.instructions)
      expect([choice.criteria.level_0, choice.criteria.level_1, choice.criteria.level_2]).toEqual([...score.criteria])
    }
  }
  expect(plan.requests[11]!.requestHash).toBe(plan.requests[3]!.requestHash)
  const noPolicy = plan.requests[10]!.request
  expect(noPolicy.state.policy).toEqual({})
  expect(JSON.stringify(noPolicy)).not.toContain("selected_criterion\":")
  expect(JSON.stringify(noPolicy)).not.toContain("pulsar-self.ts")
  for (const entry of plan.requests) {
    expect(Buffer.byteLength(JSON.stringify(entry.request))).toBeLessThan(100_001)
    expect(JSON.stringify(entry.request)).not.toContain("$variant")
    expect(Object.hasOwn(entry.request, "dependencies")).toBe(false)
    expect(Object.hasOwn(entry.request.state, "dependencies")).toBe(false)
    expect(Object.keys(entry.dependencies!)).toEqual(Object.keys(entry.request.questions))
  }
})

const readiness: Response = {
  model: "fixture", usage: { input_tokens: 1, output_tokens: 1 }, answers: {
    evidence_readiness: { type: "choice", choice: "sufficient", probabilities: { sufficient: 1 }, confidence: 1 },
    policy_readiness: { type: "choice", choice: "defined", probabilities: { defined: 1 }, confidence: 1 },
  },
}

test("missing policy masks only preference even when model invents a defined policy", () => {
  const entry = prepare("question-shapes").requests[10]!
  const result = summarizeQuestions(entry.request, readiness, entry.dependencies!)
  expect(result.questionConsumption.preference).toBe("unconsumed")
  expect(result.questionConsumption.protocol_form_a).toBe("descriptive_only")
  const broken: Request = { ...entry.request, state: { ...entry.request.state,
    context_manifest: { missing: ["variants.a.files"] },
  } }
  const masked = summarizeQuestions(broken, readiness, entry.dependencies!)
  expect(masked.questionConsumption.protocol_form_a).toBe("unconsumed")
  expect(masked.questionConsumption.protocol_form_b).toBe("descriptive_only")
})

test("structured Score legends are validated without converting descriptions to prose", () => {
  const request: Request = { model: "test", state: {}, questions: {
    dimension: { type: "score", instructions: { task: "Classify the ownership" }, criteria: [{ what: "none" }, { what: "partial" }, { what: "all" }] },
  } }
  const response = { model: "test", usage: { input_tokens: 2, output_tokens: 3 }, answers: {
    dimension: { type: "score", score: 1.7, confidence: 0.5, probabilities: { "0": 0.1, "1": 0.1, "2": 0.8 }, legend: { "0": { what: "none" }, "1": { what: "partial" }, "2": { what: "all" } } },
  } } satisfies Response
  expect(validateResponse(request, response)).toEqual(response)
  expect(() => validateResponse(request, { ...response, answers: { dimension: { ...response.answers.dimension, legend: { "0": "none", "1": "partial", "2": "all" } } } })).toThrow("legend")
})

test.each([401, 422, 200])("question-shape run stops on incompatible response %i and records unattempted slots", async (status) => {
  const parent = mkdtempSync(join(tmpdir(), "jev-stop-"))
  try {
    let calls = 0
    const plan = prepare("question-shapes")
    const out = join(parent, "run")
    const mock = Layer.succeed(JudgmentProvider, { evaluate: () => {
      calls++
      return Effect.succeed({ status, raw: "{}", requestId: "test", elapsedMs: 1 })
    } })
    await Effect.runPromise(evaluatePlan(plan, out).pipe(Effect.provide(mock)))
    expect(calls).toBe(1)
    const bytes = readFileSync(join(out, "run.json"), "utf8")
    const summary = replay(bytes, sha256(bytes))
    expect(summary.results[0]?.status).toBe(status === 200 ? "invalid_response" : "http_error")
    expect(summary.results.slice(1).every((r) => r.status === "not_attempted")).toBe(true)
    expect(existsSync(join(out, "0.intent.json"))).toBe(true)
    expect(existsSync(join(out, "1.intent.json"))).toBe(false)
    expect(canonical(JSON.parse(bytes).plan)).toBe(canonical(plan))
  } finally { rmSync(parent, { recursive: true, force: true }) }
})
