import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Redacted } from "effect"
import {
  JEV_NOT_APPLICABLE_ANCHOR_ID,
  JEV_OWNERSHIP_MODEL,
  JEV_OWNERSHIP_QUESTION_ID,
  JEV_UNKNOWN_ANCHOR_ID,
  JevCompileError,
  JevHttpError,
  compileOwnershipRequestSync,
  evaluateOwnershipGroup,
  evaluateOwnershipGroups,
  jevClientLayer,
  type OwnershipGroupEvaluationInput,
  type OwnershipRubric,
} from "../jev/index.js"

const sharedPreference: OwnershipRubric = {
  preference: "shared_domain_rule",
  preferenceDescription:
    "Vendor-neutral HTTP status class mapping that two adapters already share should live in one owner.",
  anchors: [
    {
      id: "contrary",
      description: "The snapshots keep the shared mapping beside each caller against this preference.",
      value: 0,
    },
    {
      id: "mixed",
      description: "The snapshots mix shared ownership and caller-local copies of the same mapping.",
      value: 0.5,
    },
    {
      id: "meets",
      description: "The snapshots place the shared mapping in one owner used by the callers.",
      value: 1,
    },
  ],
}

const localPreference: OwnershipRubric = {
  preference: "caller_local",
  preferenceDescription:
    "Keep HTTP status mapping beside each vendor adapter; duplication of a three-way class is acceptable.",
  anchors: [
    {
      id: "contrary",
      description: "The snapshots extract a shared mapper against this caller-local preference.",
      value: 0,
    },
    {
      id: "mixed",
      description: "The snapshots mix a shared mapper with remaining caller-local copies.",
      value: 0.5,
    },
    {
      id: "meets",
      description: "The snapshots keep the mapping in each caller.",
      value: 1,
    },
  ],
}

const sharedOwner = `export type HttpClass = "ok" | "retry" | "fail"

export function mapHttpStatus(status: number): HttpClass {
  if (status >= 200 && status < 300) return "ok"
  if (status === 429 || status >= 500) return "retry"
  return "fail"
}
`

const stripeShared = `import { mapHttpStatus } from "./http-map"

export function chargeStripeFromHttp(status: number, id: string) {
  const classified = mapHttpStatus(status)
  if (classified === "ok") return { status: "succeeded", providerRef: id }
  return { status: "failed", retryable: classified === "retry" }
}
`

const paypalShared = `import { mapHttpStatus } from "./http-map"

export function capturePaypalFromHttp(status: number, id: string) {
  const classified = mapHttpStatus(status)
  if (classified === "ok") return { status: "succeeded", providerRef: id }
  return { status: "failed", retryable: classified === "retry" }
}
`

const distinctStripe = `export function chargeStripeFromHttp(event: { kind: "succeeded" | "card_declined" }, id: string) {
  if (event.kind === "succeeded") return { status: "succeeded", providerRef: id }
  return { status: "failed", code: "card_declined", retryable: false }
}
`

const distinctPaypal = `export function capturePaypalFromHttp(event: { kind: "COMPLETED" | "INSTRUMENT_DECLINED" }, id: string) {
  if (event.kind === "COMPLETED") return { status: "succeeded", providerRef: id }
  return { status: "failed", code: "instrument_declined", retryable: false }
}
`

const sharedArrangement = (groupId: string, rubric: OwnershipRubric): OwnershipGroupEvaluationInput => ({
  groupId,
  rubric,
  sources: [
    { path: "src/http-map.ts", role: "owner", bytes: sharedOwner },
    { path: "src/stripe-adapter.ts", role: "caller", bytes: stripeShared },
    { path: "src/paypal-adapter.ts", role: "caller", bytes: paypalShared },
  ],
})

describe("compileOwnershipRequest", () => {
  test("builds a self-contained Choice with unknown and not_applicable, no fixture ids in state", () => {
    const compiled = compileOwnershipRequestSync(sharedArrangement("http-status-class", sharedPreference))
    expect(compiled.request.model).toBe(JEV_OWNERSHIP_MODEL)
    expect(compiled.optionIds).toEqual([
      "contrary",
      "mixed",
      "meets",
      JEV_UNKNOWN_ANCHOR_ID,
      JEV_NOT_APPLICABLE_ANCHOR_ID,
    ])
    const question = compiled.request.questions[JEV_OWNERSHIP_QUESTION_ID]
    expect(question?.type).toBe("choice")
    if (question?.type !== "choice") throw new Error("expected choice")
    expect(Object.keys(question.criteria)).toEqual([...compiled.optionIds])
    const state = JSON.stringify(compiled.request.state)
    expect(state).not.toContain("C15")
    expect(state).not.toContain("fixture")
    expect(state).not.toContain("expected")
    expect(state).not.toContain("http-status-class")
    expect(state).not.toContain("groupId")
    expect(state).toContain("mapHttpStatus")
    expect(state).not.toContain("163d13789e231dbb")
    expect(compiled.requestSha256).toHaveLength(64)
    expect(compiled.contentHash).toHaveLength(64)
    expect(compiled.selectionGate.id).toBe("pulsar.ownership.selection_gate.v1")
  })

  test("reordering sources changes request identity only through snapshot order, opposite policies differ", () => {
    const shared = compileOwnershipRequestSync(sharedArrangement("http-status-class", sharedPreference))
    const local = compileOwnershipRequestSync(sharedArrangement("http-status-class", localPreference))
    expect(shared.policyFingerprint).not.toBe(local.policyFingerprint)
    expect(shared.requestSha256).not.toBe(local.requestSha256)
    const reversed = compileOwnershipRequestSync({
      ...sharedArrangement("http-status-class", sharedPreference),
      sources: [...sharedArrangement("http-status-class", sharedPreference).sources].reverse(),
    })
    expect(reversed.requestSha256).not.toBe(shared.requestSha256)
  })

  test("rejects empty sources and reserved abstention ids as preference anchors", () => {
    expect(() =>
      compileOwnershipRequestSync({
        groupId: "g",
        rubric: sharedPreference,
        sources: [],
      }),
    ).toThrow(JevCompileError)
    expect(() =>
      compileOwnershipRequestSync({
        groupId: "g",
        rubric: {
          ...sharedPreference,
          anchors: [{ id: "unknown", description: "no" }],
        },
        sources: [{ path: "a.ts", role: "owner", bytes: "x" }],
      }),
    ).toThrow(JevCompileError)
  })
})

describe("evaluateOwnershipGroup", () => {
  test("preserves raw response, request hash, usage, and full distribution including abstention mass", async () => {
    const input = sharedArrangement("http-status-class", sharedPreference)
    const compiled = compileOwnershipRequestSync(input)
    const raw = JSON.stringify({
      model: "jev-1.13.0",
      answers: {
        ownership: {
          type: "choice",
          choice: "meets",
          confidence: 0.8,
          probabilities: {
            contrary: 0.01,
            mixed: 0.04,
            meets: 0.9,
            unknown: 0.03,
            not_applicable: 0.02,
          },
        },
      },
      usage: { input_tokens: 12, output_tokens: 4 },
    })
    const assessment = await Effect.runPromise(
      evaluateOwnershipGroup(input).pipe(
        Effect.provide(
          jevClientLayer({
            apiKey: Redacted.make("test-key"),
            fetcher: async () =>
              new Response(raw, {
                status: 200,
                headers: { "x-typesafe-request-id": "req-1" },
              }),
          }),
        ),
      ),
    )
    expect(assessment.status).toBe("resolved")
    expect(assessment.selectedAnchorId).toBe("meets")
    expect(assessment.rawSelectedAnchorId).toBe("meets")
    expect(assessment.selectionGate.passed).toBe(true)
    expect(assessment.requestSha256).toBe(compiled.requestSha256)
    expect(assessment.rawResponse).toBe(raw)
    expect(assessment.requestId).toBe("req-1")
    expect(assessment.usage).toEqual({ inputTokens: 12, outputTokens: 4 })
    expect(assessment.distribution.map((entry) => entry.anchorId)).toEqual([...compiled.optionIds])
    expect(assessment.distribution.find((entry) => entry.anchorId === "unknown")?.probability).toBe(0.03)
    expect(assessment.modelConfidence).toBe(0.8)
  })

  test("retains unknown as unresolved instead of inventing a quality score", async () => {
    const input = sharedArrangement("http-status-class", sharedPreference)
    const raw = JSON.stringify({
      model: "jev-1.13.0",
      answers: {
        ownership: {
          type: "choice",
          choice: "unknown",
          confidence: 0.4,
          probabilities: {
            contrary: 0.1,
            mixed: 0.1,
            meets: 0.1,
            unknown: 0.6,
            not_applicable: 0.1,
          },
        },
      },
      usage: { input_tokens: 8, output_tokens: 3 },
    })
    const assessment = await Effect.runPromise(
      evaluateOwnershipGroup(input).pipe(
        Effect.provide(
          jevClientLayer({
            apiKey: Redacted.make("test-key"),
            fetcher: async () => new Response(raw, { status: 200 }),
          }),
        ),
      ),
    )
    expect(assessment.status).toBe("unresolved")
    expect(assessment.selectedAnchorId).toBe("unknown")
    expect(assessment.rawSelectedAnchorId).toBe("unknown")
    expect(assessment.selectionGate.passed).toBe(false)
  })

  test("low-confidence not_applicable stays unresolved and keeps raw selection", async () => {
    const input = sharedArrangement("http-status-class", sharedPreference)
    const raw = JSON.stringify({
      model: "jev-1.13.0",
      answers: {
        ownership: {
          type: "choice",
          choice: "not_applicable",
          confidence: 0.5,
          probabilities: {
            contrary: 0,
            mixed: 0,
            meets: 0,
            unknown: 0.39,
            not_applicable: 0.61,
          },
        },
      },
      usage: { input_tokens: 8, output_tokens: 3 },
    })
    const assessment = await Effect.runPromise(
      evaluateOwnershipGroup(input).pipe(
        Effect.provide(
          jevClientLayer({
            apiKey: Redacted.make("test-key"),
            fetcher: async () => new Response(raw, { status: 200 }),
          }),
        ),
      ),
    )
    expect(assessment.status).toBe("unresolved")
    expect(assessment.selectedAnchorId).toBe("unknown")
    expect(assessment.rawSelectedAnchorId).toBe("not_applicable")
    expect(assessment.selectionGate.passed).toBe(false)
    expect(assessment.distribution.find((entry) => entry.anchorId === "not_applicable")?.probability).toBe(0.61)
  })

  test("low-confidence meets stays unresolved", async () => {
    const input = sharedArrangement("http-status-class", sharedPreference)
    const raw = JSON.stringify({
      model: "jev-1.13.0",
      answers: {
        ownership: {
          type: "choice",
          choice: "meets",
          confidence: 0.4,
          probabilities: {
            contrary: 0.2,
            mixed: 0.2,
            meets: 0.5,
            unknown: 0.05,
            not_applicable: 0.05,
          },
        },
      },
      usage: { input_tokens: 8, output_tokens: 3 },
    })
    const assessment = await Effect.runPromise(
      evaluateOwnershipGroup(input).pipe(
        Effect.provide(
          jevClientLayer({
            apiKey: Redacted.make("test-key"),
            fetcher: async () => new Response(raw, { status: 200 }),
          }),
        ),
      ),
    )
    expect(assessment.status).toBe("unresolved")
    expect(assessment.rawSelectedAnchorId).toBe("meets")
    expect(assessment.selectedAnchorId).toBe("unknown")
  })

  test("rejects response model mismatch", async () => {
    const input = sharedArrangement("http-status-class", sharedPreference)
    const raw = JSON.stringify({
      model: "jev-other",
      answers: {
        ownership: {
          type: "choice",
          choice: "meets",
          confidence: 1,
          probabilities: {
            contrary: 0,
            mixed: 0,
            meets: 1,
            unknown: 0,
            not_applicable: 0,
          },
        },
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const result = await Effect.runPromise(
      Effect.result(
        evaluateOwnershipGroup(input).pipe(
          Effect.provide(
            jevClientLayer({
              apiKey: Redacted.make("test-key"),
              fetcher: async () => new Response(raw, { status: 200 }),
            }),
          ),
        ),
      ),
    )
    expect(result._tag).toBe("Failure")
  })

  test("propagates HTTP failure without retry", async () => {
    const input = sharedArrangement("http-status-class", sharedPreference)
    let calls = 0
    const result = await Effect.runPromise(
      Effect.result(
        evaluateOwnershipGroup(input).pipe(
          Effect.provide(
            jevClientLayer({
              apiKey: Redacted.make("test-key"),
              fetcher: async () => {
                calls += 1
                return new Response("nope", { status: 500 })
              },
            }),
          ),
        ),
      ),
    )
    expect(result._tag).toBe("Failure")
    if (result._tag !== "Failure") throw new Error("expected failure")
    expect(result.failure).toBeInstanceOf(JevHttpError)
    expect(calls).toBe(1)
  })

  test("bounds concurrent evaluations and forwards abort", async () => {
    const input = sharedArrangement("http-status-class", sharedPreference)
    let inFlight = 0
    let maxInFlight = 0
    let aborted = 0
    let sawSecond = false
    const firstStarted = Promise.withResolvers<void>()
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (inFlight === 1) firstStarted.resolve()
      if (inFlight === 2) sawSecond = true
      try {
        await new Promise<void>((_resolve, reject) => {
          const abort = init?.signal
          const fail = () => {
            aborted += 1
            reject(new DOMException("aborted", "AbortError"))
          }
          if (abort?.aborted) {
            fail()
            return
          }
          abort?.addEventListener("abort", fail, { once: true })
        })
        throw new Error("fetcher resolved without abort")
      } finally {
        inFlight -= 1
      }
    }
    const layer = jevClientLayer({ apiKey: Redacted.make("test-key"), fetcher })
    const fiber = Effect.runFork(
      evaluateOwnershipGroups([input, input, input, input], 2).pipe(Effect.provide(layer)),
    )
    await firstStarted.promise
    await Effect.sleep("20 millis").pipe(Effect.runPromise)
    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(sawSecond || maxInFlight === 1).toBe(true)
    await Effect.runPromise(Fiber.interrupt(fiber))
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(exit._tag).toBe("Failure")
    expect(aborted).toBeGreaterThan(0)
    expect(maxInFlight).toBeLessThanOrEqual(2)
  })
})

describe("role perturbation compiler", () => {
  test("swapping filing tags still sends the same source text", () => {
    const original = compileOwnershipRequestSync(sharedArrangement("http-status-class", sharedPreference))
    const swapped = compileOwnershipRequestSync({
      groupId: "http-status-class",
      rubric: sharedPreference,
      sources: sharedArrangement("http-status-class", sharedPreference).sources.map((source) => ({
        ...source,
        role: source.role === "owner" ? "caller" : "owner",
      })),
    })
    const originalState = JSON.stringify(original.request.state)
    const swappedState = JSON.stringify(swapped.request.state)
    expect(originalState).toContain("mapHttpStatus")
    expect(swappedState).toContain("mapHttpStatus")
    expect(original.requestSha256).not.toBe(swapped.requestSha256)
  })
})

describe("distinct-rule control compiler", () => {
  test("does not treat distinct vendor machines as the shared HTTP mapping", () => {
    const compiled = compileOwnershipRequestSync({
      groupId: "vendor-lifecycle",
      rubric: sharedPreference,
      sources: [
        { path: "src/stripe-adapter.ts", role: "caller", bytes: distinctStripe },
        { path: "src/paypal-adapter.ts", role: "caller", bytes: distinctPaypal },
      ],
    })
    const state = JSON.stringify(compiled.request.state)
    expect(state).toContain("card_declined")
    expect(state).toContain("INSTRUMENT_DECLINED")
    expect(state).not.toContain("mapHttpStatus")
  })
})
