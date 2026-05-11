import { Schema } from "effect"
import type { Category } from "./category.js"
import { diagnosticHashOf, type Diagnostic } from "./diagnostic.js"
import type { HardGateViolation } from "./observer.js"

const baselineViolationSchema = Schema.Struct({
  file: Schema.String,
  line: Schema.optional(Schema.Number),
  hash: Schema.String,
  detail: Schema.String,
})
export type BaselineViolation = typeof baselineViolationSchema.Type

const baselineSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  baseline_sha: Schema.String,
  created_at: Schema.String,
  vector_id: Schema.optional(Schema.String),
  vector_source: Schema.optional(Schema.String),
  vector_trust_boundary: Schema.optional(Schema.Literal(
    "explicit-path",
    "repo-local",
    "organization-standard-fallback",
    "built-in-defaults",
  )),
  observer_config_hash: Schema.optional(Schema.String),
  violations: Schema.Record({ key: Schema.String, value: Schema.Array(baselineViolationSchema) }),
})
export type Baseline = typeof baselineSchema.Type

export const decodeBaseline = Schema.decodeUnknown(baselineSchema)
export const decodeBaselineSync = Schema.decodeUnknownSync(baselineSchema)

export interface CurrentViolationSnapshot extends BaselineViolation {
  readonly signalId: string
  readonly category: Category
  readonly diagnostic: Diagnostic
}

export interface PaidDebtViolation extends BaselineViolation {
  readonly signalId: string
}

export interface BaselineComparison {
  readonly current: ReadonlyArray<CurrentViolationSnapshot>
  readonly tolerated: ReadonlyArray<CurrentViolationSnapshot>
  readonly newViolations: ReadonlyArray<CurrentViolationSnapshot>
  readonly paidDebt: ReadonlyArray<PaidDebtViolation>
}

export interface BaselineSignalIdentityOptions {
  readonly canonicalSignalId?: (signalId: string) => string | undefined
}

export const createBaseline = (opts: {
  readonly baselineSha: string
  readonly createdAt?: string
  readonly vectorId?: string
  readonly vectorSource?: string
  readonly vectorTrustBoundary?:
    | "explicit-path"
    | "repo-local"
    | "organization-standard-fallback"
    | "built-in-defaults"
  readonly observerConfigHash?: string
  readonly violations: ReadonlyArray<HardGateViolation>
} & BaselineSignalIdentityOptions): Baseline => {
  const grouped: Record<string, Array<BaselineViolation>> = {}
  for (const violation of dedupeCurrentViolations(opts.violations)) {
    const signalId = canonicalBaselineSignalId(violation.signalId, opts)
    grouped[signalId] ??= []
    grouped[signalId]!.push(toBaselineViolation(violation))
  }

  for (const signalId of Object.keys(grouped)) {
    grouped[signalId] = sortBaselineViolations(grouped[signalId]!)
  }

  return decodeBaselineSync({
    schema_version: 1,
    baseline_sha: opts.baselineSha,
    created_at: opts.createdAt ?? new Date().toISOString(),
    ...(opts.vectorId !== undefined ? { vector_id: opts.vectorId } : {}),
    ...(opts.vectorSource !== undefined ? { vector_source: opts.vectorSource } : {}),
    ...(opts.vectorTrustBoundary !== undefined
      ? { vector_trust_boundary: opts.vectorTrustBoundary }
      : {}),
    ...(opts.observerConfigHash !== undefined
      ? { observer_config_hash: opts.observerConfigHash }
      : {}),
    violations: grouped,
  })
}

export const compareToBaseline = (
  baseline: Baseline,
  violations: ReadonlyArray<HardGateViolation>,
  options?: BaselineSignalIdentityOptions,
): BaselineComparison => {
  const current = dedupeCurrentViolations(violations, options)
  const baselineEntries = flattenBaseline(baseline, options)
  const baselineKeys = new Set(baselineEntries.map(baselineKeyOf))
  const currentKeys = new Set(current.map(currentKeyOf))

  return {
    current,
    tolerated: current.filter((violation) => baselineKeys.has(currentKeyOf(violation))),
    newViolations: current.filter((violation) => !baselineKeys.has(currentKeyOf(violation))),
    paidDebt: baselineEntries.filter((violation) => !currentKeys.has(baselineKeyOf(violation))),
  }
}

export const baselineViolationCount = (baseline: Baseline): number =>
  Object.values(baseline.violations).reduce((sum, violations) => sum + violations.length, 0)

const dedupeCurrentViolations = (
  violations: ReadonlyArray<HardGateViolation>,
  options?: BaselineSignalIdentityOptions,
): ReadonlyArray<CurrentViolationSnapshot> => {
  const seen = new Set<string>()
  const snapshots: Array<CurrentViolationSnapshot> = []
  for (const violation of violations) {
    const snapshot = snapshotViolation(violation, options)
    const key = currentKeyOf(snapshot)
    if (seen.has(key)) continue
    seen.add(key)
    snapshots.push(snapshot)
  }
  return sortCurrentViolations(snapshots)
}

const snapshotViolation = (
  violation: HardGateViolation,
  options?: BaselineSignalIdentityOptions,
): CurrentViolationSnapshot => {
  const hash = diagnosticHashOf(violation.diagnostic)
  if (hash === undefined) {
    throw new Error(
      `Hard-gate violation ${violation.signalId} is missing Diagnostic.data.hash.`,
    )
  }

  const file = diagnosticFileOf(violation.diagnostic)
  if (file === undefined) {
    throw new Error(
      `Hard-gate violation ${violation.signalId} is missing a file location.`,
    )
  }

  return {
    signalId: canonicalBaselineSignalId(violation.signalId, options),
    category: violation.category,
    diagnostic: violation.diagnostic,
    file,
    ...(violation.diagnostic.location?.line !== undefined
      ? { line: violation.diagnostic.location.line }
      : {}),
    hash,
    detail: violation.diagnostic.message,
  }
}

const diagnosticFileOf = (diagnostic: Diagnostic): string | undefined => {
  const locationFile = diagnostic.location?.file
  if (locationFile !== undefined) return locationFile
  const dataFile = diagnostic.data?.file
  return typeof dataFile === "string" ? dataFile : undefined
}

const flattenBaseline = (
  baseline: Baseline,
  options?: BaselineSignalIdentityOptions,
): ReadonlyArray<PaidDebtViolation> =>
  Object.entries(baseline.violations)
    .flatMap(([signalId, violations]) =>
      violations.map((violation) => ({
        signalId: canonicalBaselineSignalId(signalId, options),
        ...violation,
      })),
    )
    .sort((a, b) => compareViolationTuple(tupleOfBaseline(a), tupleOfBaseline(b)))

const canonicalBaselineSignalId = (
  signalId: string,
  options?: BaselineSignalIdentityOptions,
): string => options?.canonicalSignalId?.(signalId) ?? signalId

const toBaselineViolation = (violation: CurrentViolationSnapshot): BaselineViolation => ({
  file: violation.file,
  ...(violation.line !== undefined ? { line: violation.line } : {}),
  hash: violation.hash,
  detail: violation.detail,
})

const currentKeyOf = (violation: CurrentViolationSnapshot): string =>
  `${violation.signalId}:${violation.hash}`

const baselineKeyOf = (violation: PaidDebtViolation): string =>
  `${violation.signalId}:${violation.hash}`

const tupleOfCurrent = (violation: CurrentViolationSnapshot): [string, string, string, number] => [
  violation.signalId,
  violation.hash,
  violation.file,
  violation.line ?? -1,
]

const tupleOfBaseline = (violation: PaidDebtViolation): [string, string, string, number] => [
  violation.signalId,
  violation.hash,
  violation.file,
  violation.line ?? -1,
]

const sortCurrentViolations = (
  violations: ReadonlyArray<CurrentViolationSnapshot>,
): ReadonlyArray<CurrentViolationSnapshot> =>
  [...violations].sort((a, b) => compareViolationTuple(tupleOfCurrent(a), tupleOfCurrent(b)))

const sortBaselineViolations = (
  violations: ReadonlyArray<BaselineViolation>,
): Array<BaselineViolation> =>
  [...violations].sort((a, b) =>
    compareViolationTuple(["", a.hash, a.file, a.line ?? -1], ["", b.hash, b.file, b.line ?? -1]),
  )

const compareViolationTuple = (
  a: [string, string, string, number],
  b: [string, string, string, number],
): number => {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1
  return a[3] - b[3]
}
