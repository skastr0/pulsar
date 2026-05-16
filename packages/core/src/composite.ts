import { createHash } from "node:crypto"
import type { EnforcementCeiling } from "./enforcement.js"
import type { SignalInputRef } from "./signal.js"

export type CompositeInputState =
  | "present"
  | "missing_optional"
  | "missing_required"

export interface CompositeInputSpec {
  readonly id: string
  readonly aliases?: ReadonlyArray<string>
  readonly optional?: boolean
  readonly factorPath?: string
  readonly weight?: number
  /**
   * Semantic fingerprint for callback-backed input interpretation. Required
   * when `rawValue` or `normalize` delegates to helpers that `Function#toString`
   * cannot see; bump it whenever the callback's transitive semantics change.
   */
  readonly cacheFingerprint?: string
  readonly rawValue?: (value: unknown) => unknown
  readonly normalize?: (value: unknown) => number | undefined
}

export interface ResolvedCompositeInput {
  readonly id: string
  readonly aliases: ReadonlyArray<string>
  readonly optional: boolean
  readonly factorPath?: string
  readonly weight: number
  readonly state: CompositeInputState
  readonly resolvedId?: string
  readonly value?: unknown
  readonly rawValue?: unknown
  readonly normalizedValue?: number
}

export interface CompositeInputResolution {
  readonly inputs: ReadonlyArray<ResolvedCompositeInput>
  readonly missingInputs: ReadonlyArray<string>
  readonly missingRequiredInputs: ReadonlyArray<string>
  readonly hasMissingRequiredInputs: boolean
  readonly valueOf: <T>(id: string) => T | undefined
}

export interface CompositeInputExplanation {
  readonly id: string
  readonly aliases: ReadonlyArray<string>
  readonly optional: boolean
  readonly factorPath?: string
  readonly weight: number
  readonly state: CompositeInputState
  readonly resolvedId?: string
  readonly rawValue?: unknown
  readonly normalizedValue?: number
}

export interface CompositeExplanation {
  readonly primitiveInputs: ReadonlyArray<CompositeInputExplanation>
  readonly missingInputs: ReadonlyArray<string>
  readonly weights: ReadonlyArray<{
    readonly id: string
    readonly weight: number
  }>
  readonly finalScore: number
  readonly rationale: string
  readonly enforcementCeiling: EnforcementCeiling
}

export const compositeSignalInputs = (
  specs: ReadonlyArray<CompositeInputSpec>,
): ReadonlyArray<SignalInputRef> =>
  specs.map((spec) => ({
    id: spec.id,
    ...(spec.optional === true ? { optional: true } : {}),
    cacheFingerprint: fingerprintCompositeInputSpec(spec),
  }))

export const resolveCompositeInputs = (
  specs: ReadonlyArray<CompositeInputSpec>,
  inputOutputs: ReadonlyMap<string, unknown>,
): CompositeInputResolution => {
  const resolvedInputs = specs.map((spec) =>
    resolveCompositeInput(spec, inputOutputs),
  )
  const values = new Map(
    resolvedInputs
      .filter((input) => input.state === "present")
      .map((input) => [input.id, input.value] as const),
  )
  const missingInputs = resolvedInputs
    .filter((input) => input.state !== "present")
    .map((input) => input.id)
  const missingRequiredInputs = resolvedInputs
    .filter((input) => input.state === "missing_required")
    .map((input) => input.id)

  return {
    inputs: resolvedInputs,
    missingInputs,
    missingRequiredInputs,
    hasMissingRequiredInputs: missingRequiredInputs.length > 0,
    valueOf: <T>(id: string): T | undefined => values.get(id) as T | undefined,
  }
}

export const buildCompositeExplanation = (args: {
  readonly inputs: CompositeInputResolution
  readonly finalScore: number
  readonly rationale: string
  readonly enforcementCeiling: EnforcementCeiling
}): CompositeExplanation => ({
  primitiveInputs: args.inputs.inputs.map((input) => ({
    id: input.id,
    aliases: input.aliases,
    optional: input.optional,
    ...(input.factorPath !== undefined ? { factorPath: input.factorPath } : {}),
    weight: input.weight,
    state: input.state,
    ...(input.resolvedId !== undefined ? { resolvedId: input.resolvedId } : {}),
    ...(input.rawValue !== undefined ? { rawValue: input.rawValue } : {}),
    ...(input.normalizedValue !== undefined
      ? { normalizedValue: input.normalizedValue }
      : {}),
  })),
  missingInputs: args.inputs.missingInputs,
  weights: args.inputs.inputs.map((input) => ({
    id: input.id,
    weight: input.weight,
  })),
  finalScore: args.finalScore,
  rationale: args.rationale,
  enforcementCeiling: args.enforcementCeiling,
})

const resolveCompositeInput = (
  spec: CompositeInputSpec,
  inputOutputs: ReadonlyMap<string, unknown>,
): ResolvedCompositeInput => {
  const identifiers = [spec.id, ...(spec.aliases ?? [])]
  const resolvedId = identifiers.find((id) => inputOutputs.has(id))
  const value = resolvedId === undefined ? undefined : inputOutputs.get(resolvedId)
  const aliases = spec.aliases ?? []
  const optional = spec.optional === true
  const base = {
    id: spec.id,
    aliases,
    optional,
    ...(spec.factorPath !== undefined ? { factorPath: spec.factorPath } : {}),
    weight: spec.weight ?? 1,
  }

  if (resolvedId === undefined || value === undefined) {
    return {
      ...base,
      state: optional ? "missing_optional" : "missing_required",
    }
  }

  const rawValue = spec.rawValue?.(value)
  const normalizedValue = spec.normalize?.(value)

  return {
    ...base,
    state: "present",
    resolvedId,
    value,
    ...(rawValue !== undefined ? { rawValue } : {}),
    ...(normalizedValue !== undefined ? { normalizedValue } : {}),
  }
}

const fingerprintCompositeInputSpec = (spec: CompositeInputSpec): string => {
  if (
    spec.cacheFingerprint === undefined &&
    (spec.rawValue !== undefined || spec.normalize !== undefined)
  ) {
    throw new Error(
      `Composite input ${spec.id} uses value callbacks and must declare cacheFingerprint`,
    )
  }

  const hash = createHash("sha256")
  hash.update(
    JSON.stringify({
      aliases: spec.aliases ?? [],
      optional: spec.optional === true,
      factorPath: spec.factorPath ?? null,
      weight: spec.weight ?? 1,
      cacheFingerprint: spec.cacheFingerprint ?? null,
    }),
  )
  return hash.digest("hex")
}
