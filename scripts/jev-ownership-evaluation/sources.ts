/**
 * Mechanical source snapshots. Arrangement is established by the text itself
 * (identical predicate bodies, import delegation, distinct tables). Snapshots
 * contain no case ids, preference names, expected anchors, or scoring words.
 */

export const PUBLISH_PREDICATE =
  "(signal.tier === 1 || signal.tier === 1.5) && signal.evidence === \"proof\" && signal.ceiling === \"hard-gate\""

export const SAMPLE_TABLE = "const SAMPLE_TIERS = new Set([2, 3])"
export const SAMPLE_PREDICATE =
  "SAMPLE_TIERS.has(signal.tier) && signal.evidence === \"heuristic\" && signal.ceiling === \"review\""

const SIGNAL_TYPE = `{
  readonly tier: number
  readonly evidence: "proof" | "heuristic"
  readonly ceiling: "hard-gate" | "review"
}`

export const OWNER_PUBLISH = `export type PublishSignal = ${SIGNAL_TYPE}

export function mayPublish(signal: PublishSignal): boolean {
  return ${PUBLISH_PREDICATE}
}
`

export const CALLER_PREVIEW_DELEGATED = `import { mayPublish, type PublishSignal } from "./publish-rule.ts"

export const previewAllowed = (signal: PublishSignal): boolean => mayPublish(signal)
`

export const CALLER_SUBMIT_DELEGATED = `import { mayPublish, type PublishSignal } from "./publish-rule.ts"

export const submitAllowed = (signal: PublishSignal): boolean => mayPublish(signal)
`

export const CALLER_AUDIT_DELEGATED = `import { mayPublish, type PublishSignal } from "./publish-rule.ts"

export const auditAllowed = (signal: PublishSignal): boolean => mayPublish(signal)
`

export const CALLER_PREVIEW_COPY = `type PublishSignal = ${SIGNAL_TYPE}

const mayPublish = (signal: PublishSignal): boolean =>
  ${PUBLISH_PREDICATE}

export const previewAllowed = (signal: PublishSignal): boolean => mayPublish(signal)
`

export const CALLER_SUBMIT_COPY = `type PublishSignal = ${SIGNAL_TYPE}

const mayPublish = (signal: PublishSignal): boolean =>
  ${PUBLISH_PREDICATE}

export const submitAllowed = (signal: PublishSignal): boolean => mayPublish(signal)
`

export const CALLER_AUDIT_COPY = `type PublishSignal = ${SIGNAL_TYPE}

const mayPublish = (signal: PublishSignal): boolean =>
  ${PUBLISH_PREDICATE}

export const auditAllowed = (signal: PublishSignal): boolean => mayPublish(signal)
`

export const CALLER_SAMPLE_COPY = `${SAMPLE_TABLE}

type SampleSignal = ${SIGNAL_TYPE}

const maySample = (signal: SampleSignal): boolean =>
  ${SAMPLE_PREDICATE}

export const sampleAllowed = (signal: SampleSignal): boolean => maySample(signal)
`

export const OWNER_SAMPLE = `${SAMPLE_TABLE}

export type SampleSignal = ${SIGNAL_TYPE}

export function maySample(signal: SampleSignal): boolean {
  return ${SAMPLE_PREDICATE}
}
`

export const CALLER_SAMPLE_DELEGATED = `import { maySample, type SampleSignal } from "./sample-rule.ts"

export const sampleAllowed = (signal: SampleSignal): boolean => maySample(signal)
`

export const AMBIGUOUS_ALPHA = `type GateSignal = ${SIGNAL_TYPE}

export const alphaAllowed = (signal: GateSignal): boolean =>
  signal.tier >= 1 && signal.evidence !== undefined
`

export const AMBIGUOUS_BETA = `type GateSignal = ${SIGNAL_TYPE}

export const betaAllowed = (signal: GateSignal): boolean => {
  if (signal.tier < 1) return false
  return signal.ceiling.length > 0
}
`

export const NOTES_ONLY = `// scoring service owns publication decisions
// callers should ask that service; no mapping is written here
`

export const STUB_TYPES_ONLY = `export type PublishSignal = ${SIGNAL_TYPE}

export type PublishDecision = "allow" | "deny"
`

export const PADDING_TITLE = `export const titleCase = (value: string): string =>
  value
    .split(/\\s+/u)
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
`

export const PADDING_SLUG = `export const slugify = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "")
`

export const PADDING_CLAMP = `export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))
`

export const PADDING_UNIQUE = `export const unique = <T>(items: ReadonlyArray<T>): ReadonlyArray<T> => [...new Set(items)]
`

export const source = (path: string, bytes: string, role: "owner" | "caller" | "context") => ({
  path,
  bytes,
  role,
})
