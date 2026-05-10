import { Context } from "effect"
import type {
  AnySignal,
  SignalFactorDefinition,
  SignalFactorLedger,
  SignalFactorLedgerEntry,
  SignalFactorPolicyMutation,
  SignalFactorValue,
} from "./signal.js"
import {
  factorOverridesOf,
  type PulsarVector,
  type SignalFactorOverrideMap,
} from "./vector.js"

const FACTOR_PATH_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

export const SIGNAL_FACTOR_POLICY_PRECEDENCE = [
  "signal-default",
  "module",
  "vector",
] as const

export interface SignalFactorPolicyContext {
  readonly signalId: string
  readonly precedence: typeof SIGNAL_FACTOR_POLICY_PRECEDENCE
  readonly vectorOverrides: SignalFactorOverrideMap
  readonly vectorSourceRef?: string
}

export class SignalFactorPolicyTag extends Context.Tag(
  "@skastr0/pulsar-core/SignalFactorPolicy",
)<SignalFactorPolicyTag, SignalFactorPolicyContext>() {}

export const makeSignalFactorPolicyContext = (
  signal: AnySignal,
  vector?: PulsarVector,
  options?: { readonly vectorSourceRef?: string },
): SignalFactorPolicyContext => ({
  signalId: signal.id,
  precedence: SIGNAL_FACTOR_POLICY_PRECEDENCE,
  vectorOverrides: factorOverridesOf(signal, vector),
  ...(options?.vectorSourceRef !== undefined
    ? { vectorSourceRef: options.vectorSourceRef }
    : {}),
})

export interface FactorDefinitionValidationIssue {
  readonly path: string
  readonly message: string
}

export const validateFactorDefinitions = (
  definitions: ReadonlyArray<SignalFactorDefinition>,
): ReadonlyArray<FactorDefinitionValidationIssue> => {
  const issues: Array<FactorDefinitionValidationIssue> = []
  const seen = new Set<string>()

  for (const definition of definitions) {
    if (!FACTOR_PATH_PATTERN.test(definition.path)) {
      issues.push({
        path: definition.path,
        message:
          "Factor paths must be stable lowercase dot/underscore/hyphen paths.",
      })
    }
    if (seen.has(definition.path)) {
      issues.push({
        path: definition.path,
        message: "Factor path is declared more than once.",
      })
    }
    seen.add(definition.path)
  }

  return issues
}

export const assertValidFactorDefinitions = (
  definitions: ReadonlyArray<SignalFactorDefinition>,
): void => {
  const issues = validateFactorDefinitions(definitions)
  if (issues.length === 0) return
  const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")
  throw new Error(`Invalid signal factor definitions: ${detail}`)
}

export const makeFactorEntry = (
  definition: SignalFactorDefinition,
  value: SignalFactorValue,
  options?: {
    readonly source?: SignalFactorLedgerEntry["source"]
    readonly affectsScore?: boolean
    readonly attribution?: SignalFactorLedgerEntry["attribution"]
  },
): SignalFactorLedgerEntry => ({
  path: definition.path,
  title: definition.title,
  scoreRole: definition.scoreRole,
  value,
  source: options?.source ?? "computed",
  affectsScore: options?.affectsScore ?? definition.scoreRole !== "metadata",
  ...(options?.attribution !== undefined ? { attribution: options.attribution } : {}),
})

export const makeFactorLedger = (
  signalId: string,
  entries: ReadonlyArray<SignalFactorLedgerEntry>,
): SignalFactorLedger => ({
  signalId,
  entries: [...entries].sort((left, right) => left.path.localeCompare(right.path)),
})

export const applyFactorOverrides = (
  entries: ReadonlyArray<SignalFactorLedgerEntry>,
  overrides: SignalFactorOverrideMap,
  options?: {
    readonly sourceRef?: string
    readonly ruleId?: string
  },
): ReadonlyArray<SignalFactorLedgerEntry> =>
  entries.map((entry) => {
    if (!Object.hasOwn(overrides, entry.path)) return entry
    const nextValue = overrides[entry.path] ?? null
    const ruleId = options?.ruleId ?? "vector.factor-override"
    const mutation: SignalFactorPolicyMutation = {
      path: entry.path,
      source: "vector",
      action: entry.source === "module" ? "override-module-factor" : "override-factor",
      before: entry.value,
      after: nextValue,
      ruleId,
      ...(options?.sourceRef !== undefined ? { sourceRef: options.sourceRef } : {}),
    }
    return {
      ...entry,
      value: nextValue,
      source: "vector",
      attribution: {
        ...entry.attribution,
        ruleId,
        ...(mutation.sourceRef !== undefined ? { sourceRef: mutation.sourceRef } : {}),
      },
      mutations: [...(entry.mutations ?? []), mutation],
    }
  })

export const applySignalFactorPolicy = (
  ledger: SignalFactorLedger,
  policy: SignalFactorPolicyContext,
): SignalFactorLedger => ({
  signalId: ledger.signalId,
  entries: applyFactorOverrides(ledger.entries, policy.vectorOverrides, {
    ...(policy.vectorSourceRef !== undefined ? { sourceRef: policy.vectorSourceRef } : {}),
  }),
})

export const overriddenFactorValue = <Value extends SignalFactorValue>(
  path: string,
  defaultValue: Value,
  overrides: SignalFactorOverrideMap,
): Value | SignalFactorValue =>
  Object.hasOwn(overrides, path) ? (overrides[path] ?? null) : defaultValue
