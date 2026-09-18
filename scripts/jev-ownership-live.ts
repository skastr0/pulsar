#!/usr/bin/env bun
/**
 * Live ownership-alignment calls through packages/cli/src/jev.
 * Records request/response/usage/latency without secrets.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Effect, Redacted } from "effect"
import {
  compileOwnershipRequestSync,
  evaluateOwnershipGroup,
  jevClientLayer,
  type OwnershipGroupAssessment,
  type OwnershipGroupEvaluationInput,
  type OwnershipRubric,
} from "../packages/cli/src/jev/index.ts"

const MODEL = "jev-1.13.0"
const ARTIFACT_DIR = resolve(import.meta.dir, "../.amp/in/artifacts/jev-ownership")

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

const stripeLocal = `function mapHttpStatus(status: number): "ok" | "retry" | "fail" {
  if (status >= 200 && status < 300) return "ok"
  if (status === 429 || status >= 500) return "retry"
  return "fail"
}

export function chargeStripeFromHttp(status: number, id: string) {
  const classified = mapHttpStatus(status)
  if (classified === "ok") return { status: "succeeded", providerRef: id }
  return { status: "failed", retryable: classified === "retry" }
}
`

const paypalLocal = `function mapHttpStatus(status: number): "ok" | "retry" | "fail" {
  if (status >= 200 && status < 300) return "ok"
  if (status === 429 || status >= 500) return "retry"
  return "fail"
}

export function capturePaypalFromHttp(status: number, id: string) {
  const classified = mapHttpStatus(status)
  if (classified === "ok") return { status: "succeeded", providerRef: id }
  return { status: "failed", retryable: classified === "retry" }
}
`

export const sharedPreference: OwnershipRubric = {
  preference: "shared_domain_rule",
  preferenceDescription:
    "A vendor-neutral HTTP status class mapping already used by two adapters should have one owner. Distinct vendor lifecycle machines are not that mapping.",
  anchors: [
    {
      id: "contrary",
      description:
        "Callers each keep their own copy of the same vendor-neutral HTTP class mapping, against the shared-owner preference.",
      value: 0,
    },
    {
      id: "mixed",
      description:
        "Some callers use a shared owner for the mapping while another still keeps a local copy of the same mapping.",
      value: 0.5,
    },
    {
      id: "meets",
      description:
        "The mapping lives in one owner and the callers use that owner. Same shape with different domain rules is not a miss.",
      value: 1,
    },
  ],
}

export const localPreference: OwnershipRubric = {
  preference: "caller_local",
  preferenceDescription:
    "Keep HTTP status mapping beside each vendor adapter. Duplication of a three-way status class is acceptable until a repository contract names a shared mapper.",
  anchors: [
    {
      id: "contrary",
      description:
        "A shared mapper owns the HTTP class mapping that this preference wants kept caller-local.",
      value: 0,
    },
    {
      id: "mixed",
      description: "A shared mapper exists alongside remaining caller-local copies of the same mapping.",
      value: 0.5,
    },
    {
      id: "meets",
      description: "Each caller keeps the mapping locally. No shared owner for this mapping.",
      value: 1,
    },
  ],
}

const sharedSources = [
  { path: "src/http-map.ts", role: "owner" as const, bytes: sharedOwner },
  { path: "src/stripe-adapter.ts", role: "caller" as const, bytes: stripeShared },
  { path: "src/paypal-adapter.ts", role: "caller" as const, bytes: paypalShared },
]

const localSources = [
  { path: "src/stripe-adapter.ts", role: "caller" as const, bytes: stripeLocal },
  { path: "src/paypal-adapter.ts", role: "caller" as const, bytes: paypalLocal },
]

export const firstFive = (): ReadonlyArray<{
  readonly label: string
  readonly input: OwnershipGroupEvaluationInput
}> => [
  {
    label: "shared-code/shared-policy",
    input: { groupId: "http-status-class", rubric: sharedPreference, sources: sharedSources, model: MODEL },
  },
  {
    label: "shared-code/local-policy",
    input: { groupId: "http-status-class", rubric: localPreference, sources: sharedSources, model: MODEL },
  },
  {
    label: "local-code/local-policy",
    input: { groupId: "http-status-class", rubric: localPreference, sources: localSources, model: MODEL },
  },
  {
    label: "local-code/shared-policy",
    input: { groupId: "http-status-class", rubric: sharedPreference, sources: localSources, model: MODEL },
  },
  {
    label: "missing-evidence/shared-policy",
    input: {
      groupId: "http-status-class",
      rubric: sharedPreference,
      model: MODEL,
      sources: [
        {
          path: "src/readme-notes.ts",
          role: "context",
          bytes: "export const notes = \"adapters talk to payment vendors\"\n",
        },
      ],
    },
  },
]

const redact = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
  }
  if (Array.isArray(value)) return value.map(redact)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (/key|token|secret|authorization/i.test(key)) return [key, "[redacted]"]
        return [key, redact(child)]
      }),
    )
  }
  return value
}

export const summarize = (assessment: OwnershipGroupAssessment) => ({
  groupId: assessment.groupId,
  status: assessment.status,
  selectedAnchorId: assessment.selectedAnchorId,
  distribution: Object.fromEntries(
    assessment.distribution.map((entry) => [entry.anchorId, entry.probability]),
  ),
  modelConfidence: assessment.modelConfidence,
  modelId: assessment.modelId,
  requestSha256: assessment.requestSha256,
  inputTokens: assessment.usage.inputTokens,
  outputTokens: assessment.usage.outputTokens,
  elapsedMs: Math.round(assessment.elapsedMs),
  requestId: assessment.requestId,
})

if (import.meta.main) {
  const key = process.env.TYPESAFE_API_KEY
  if (!key) {
    console.error("TYPESAFE_API_KEY is not set")
    process.exit(1)
  }
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const layer = jevClientLayer({ apiKey: Redacted.make(key) })
  const records: Array<unknown> = []
  for (const trial of firstFive()) {
    const compiled = compileOwnershipRequestSync(trial.input)
    const assessment = await Effect.runPromise(evaluateOwnershipGroup(trial.input).pipe(Effect.provide(layer)))
    const record = {
      label: trial.label,
      compiled: {
        requestSha256: compiled.requestSha256,
        promptFingerprint: compiled.promptFingerprint,
        contentHash: compiled.contentHash,
        policyFingerprint: compiled.policyFingerprint,
        rubricFingerprint: compiled.rubricFingerprint,
        optionIds: compiled.optionIds,
        request: compiled.request,
      },
      assessment: summarize(assessment),
      rawResponse: assessment.rawResponse,
    }
    records.push(redact(record))
    console.log(JSON.stringify({ label: trial.label, ...summarize(assessment) }))
  }
  const out = resolve(ARTIFACT_DIR, `first-five-${Date.now()}.json`)
  writeFileSync(out, `${JSON.stringify(records, null, 2)}\n`)
  console.error(`wrote ${out}`)
}
