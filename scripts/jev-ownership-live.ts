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
  evaluateOwnershipGroups,
  jevClientLayer,
  type OwnershipGroupAssessment,
  type OwnershipGroupEvaluationInput,
  type OwnershipRubric,
  type OwnershipSourceSnapshot,
} from "../packages/cli/src/jev/index.ts"

export const MODEL = "jev-1.13.0"
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

const mixedPaypalLocal = paypalLocal

const notesOnly = `export const notes = "adapters talk to payment vendors"\n`

const emptyComment = `// no mapping here\n`

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

const reorderAnchors = (rubric: OwnershipRubric): OwnershipRubric => ({
  ...rubric,
  anchors: [...rubric.anchors].reverse(),
})

const sharedSources: ReadonlyArray<OwnershipSourceSnapshot> = [
  { path: "src/http-map.ts", role: "owner", bytes: sharedOwner },
  { path: "src/stripe-adapter.ts", role: "caller", bytes: stripeShared },
  { path: "src/paypal-adapter.ts", role: "caller", bytes: paypalShared },
]

const localSources: ReadonlyArray<OwnershipSourceSnapshot> = [
  { path: "src/stripe-adapter.ts", role: "caller", bytes: stripeLocal },
  { path: "src/paypal-adapter.ts", role: "caller", bytes: paypalLocal },
]

const mixedSources: ReadonlyArray<OwnershipSourceSnapshot> = [
  { path: "src/http-map.ts", role: "owner", bytes: sharedOwner },
  { path: "src/stripe-adapter.ts", role: "caller", bytes: stripeShared },
  { path: "src/paypal-adapter.ts", role: "caller", bytes: mixedPaypalLocal },
]

const distinctSources: ReadonlyArray<OwnershipSourceSnapshot> = [
  { path: "src/stripe-adapter.ts", role: "caller", bytes: distinctStripe },
  { path: "src/paypal-adapter.ts", role: "caller", bytes: distinctPaypal },
]

const missingSources: ReadonlyArray<OwnershipSourceSnapshot> = [
  { path: "src/readme-notes.ts", role: "context", bytes: notesOnly },
]

const ownerOnlySources: ReadonlyArray<OwnershipSourceSnapshot> = [
  { path: "src/http-map.ts", role: "owner", bytes: sharedOwner },
]

const oneCallerSources: ReadonlyArray<OwnershipSourceSnapshot> = [
  { path: "src/stripe-adapter.ts", role: "caller", bytes: stripeLocal },
]

const emptySources: ReadonlyArray<OwnershipSourceSnapshot> = [
  { path: "src/empty.ts", role: "context", bytes: emptyComment },
]

const trial = (
  label: string,
  family: string,
  rubric: OwnershipRubric,
  sources: ReadonlyArray<OwnershipSourceSnapshot>,
  repeat: number,
): { readonly label: string; readonly family: string; readonly repeat: number; readonly input: OwnershipGroupEvaluationInput } => ({
  label,
  family,
  repeat,
  input: {
    groupId: "http-status-class",
    rubric,
    sources: [...sources],
    model: MODEL,
  },
})

export const firstFive = () =>
  [
    trial("shared-code/shared-policy", "discrimination", sharedPreference, sharedSources, 1),
    trial("shared-code/local-policy", "discrimination", localPreference, sharedSources, 1),
    trial("local-code/local-policy", "discrimination", localPreference, localSources, 1),
    trial("local-code/shared-policy", "discrimination", sharedPreference, localSources, 1),
    trial("missing-evidence/shared-policy", "missing", sharedPreference, missingSources, 1),
  ] as const

export const liveMatrix = (): ReadonlyArray<{
  readonly label: string
  readonly family: string
  readonly repeat: number
  readonly input: OwnershipGroupEvaluationInput
}> => {
  const out: Array<{
    readonly label: string
    readonly family: string
    readonly repeat: number
    readonly input: OwnershipGroupEvaluationInput
  }> = []
  const pushRepeats = (
    base: string,
    family: string,
    rubric: OwnershipRubric,
    sources: ReadonlyArray<OwnershipSourceSnapshot>,
    times: number,
  ) => {
    for (let repeat = 1; repeat <= times; repeat++) {
      out.push(trial(`${base}#${repeat}`, family, rubric, sources, repeat))
    }
  }

  pushRepeats("shared-code/shared-policy", "discrimination", sharedPreference, sharedSources, 8)
  pushRepeats("shared-code/local-policy", "discrimination", localPreference, sharedSources, 8)
  pushRepeats("local-code/local-policy", "discrimination", localPreference, localSources, 8)
  pushRepeats("local-code/shared-policy", "discrimination", sharedPreference, localSources, 8)
  pushRepeats("mixed-code/shared-policy", "mixed", sharedPreference, mixedSources, 8)
  pushRepeats("mixed-code/local-policy", "mixed", localPreference, mixedSources, 8)
  pushRepeats("distinct-rules/shared-policy", "distinct", sharedPreference, distinctSources, 8)
  pushRepeats("distinct-rules/local-policy", "distinct", localPreference, distinctSources, 8)
  pushRepeats("missing-notes/shared-policy", "missing", sharedPreference, missingSources, 6)
  pushRepeats("missing-notes/local-policy", "missing", localPreference, missingSources, 6)
  pushRepeats("owner-only/shared-policy", "missing", sharedPreference, ownerOnlySources, 4)
  pushRepeats("one-caller/shared-policy", "missing", sharedPreference, oneCallerSources, 4)
  pushRepeats("empty/shared-policy", "missing", sharedPreference, emptySources, 4)

  pushRepeats(
    "shared-code/shared-policy/reordered-sources",
    "reorder",
    sharedPreference,
    [...sharedSources].reverse(),
    4,
  )
  pushRepeats(
    "local-code/local-policy/reordered-sources",
    "reorder",
    localPreference,
    [...localSources].reverse(),
    4,
  )
  pushRepeats(
    "shared-code/shared-policy/reordered-anchors",
    "reorder",
    reorderAnchors(sharedPreference),
    sharedSources,
    4,
  )
  pushRepeats(
    "local-code/shared-policy/reordered-anchors",
    "reorder",
    reorderAnchors(sharedPreference),
    localSources,
    4,
  )
  pushRepeats(
    "shared-code/shared-policy/swapped-roles",
    "role",
    sharedPreference,
    sharedSources.map((source) => ({
      ...source,
      role: source.role === "owner" ? "caller" : "owner",
    })),
    4,
  )
  pushRepeats(
    "local-code/local-policy/swapped-roles",
    "role",
    localPreference,
    localSources.map((source) => ({ ...source, role: "owner" })),
    4,
  )

  return out
}

const redact = (value: unknown): unknown => {
  if (typeof value === "string") return value.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
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
  rawSelectedAnchorId: assessment.rawSelectedAnchorId,
  selectionGate: assessment.selectionGate,
  distribution: Object.fromEntries(
    assessment.distribution.map((entry) => [entry.anchorId, entry.probability]),
  ),
  modelConfidence: assessment.modelConfidence,
  modelId: assessment.modelId,
  promptId: assessment.promptId,
  requestSha256: assessment.requestSha256,
  inputTokens: assessment.usage.inputTokens,
  outputTokens: assessment.usage.outputTokens,
  elapsedMs: Math.round(assessment.elapsedMs),
  requestId: assessment.requestId,
})

const histogram = (rows: ReadonlyArray<{ selectedAnchorId: string; family: string; label: string }>) => {
  const byFamily = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const family = byFamily.get(row.family) ?? new Map<string, number>()
    family.set(row.selectedAnchorId, (family.get(row.selectedAnchorId) ?? 0) + 1)
    byFamily.set(row.family, family)
  }
  return Object.fromEntries(
    [...byFamily.entries()].map(([family, counts]) => [family, Object.fromEntries(counts)]),
  )
}

if (import.meta.main) {
  const key = process.env.TYPESAFE_API_KEY
  if (!key) {
    console.error("TYPESAFE_API_KEY is not set")
    process.exit(1)
  }
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const layer = jevClientLayer({ apiKey: Redacted.make(key) })
  const mode = process.argv[2] ?? "matrix"
  const trials = mode === "first-five" ? [...firstFive()] : [...liveMatrix()]
  console.error(`running ${trials.length} live calls concurrency=4`)
  const assessments = await Effect.runPromise(
    evaluateOwnershipGroups(
      trials.map((item) => item.input),
      4,
    ).pipe(Effect.provide(layer)),
  )
  const records = trials.map((trialItem, index) => {
    const assessment = assessments[index]!
    const compiled = compileOwnershipRequestSync(trialItem.input)
    return redact({
      label: trialItem.label,
      family: trialItem.family,
      repeat: trialItem.repeat,
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
    })
  })
  const summaryRows = trials.map((trialItem, index) => ({
    label: trialItem.label,
    family: trialItem.family,
    ...summarize(assessments[index]!),
  }))
  const stamp = Date.now()
  const out = resolve(ARTIFACT_DIR, `${mode}-${stamp}.json`)
  const summaryPath = resolve(ARTIFACT_DIR, `${mode}-summary-${stamp}.json`)
  writeFileSync(out, `${JSON.stringify(records, null, 2)}\n`)
  writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        n: summaryRows.length,
        histogram: histogram(summaryRows),
        rows: summaryRows,
      },
      null,
      2,
    )}\n`,
  )
  for (const row of summaryRows) {
    console.log(
      JSON.stringify({
        label: row.label,
        family: row.family,
        selected: row.selectedAnchorId,
        raw: row.rawSelectedAnchorId,
        gate: row.selectionGate.passed,
        status: row.status,
        distribution: row.distribution,
        conf: row.modelConfidence,
        tokens: [row.inputTokens, row.outputTokens],
        ms: row.elapsedMs,
      }),
    )
  }
  console.error(`wrote ${out}`)
  console.error(`wrote ${summaryPath}`)
}
