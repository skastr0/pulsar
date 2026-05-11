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

interface SignalFactorPolicyContext {
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

export const withConfigFactorLedger = <S extends AnySignal>(signal: S): S => {
  const configDefinitions = configFactorDefinitions(signal)
  if (configDefinitions.length === 0) return signal
  const existingDefinitions = signal.factorDefinitions ?? []
  const existingPaths = new Set(existingDefinitions.map((definition) => definition.path))
  const extraDefinitions = configDefinitions.filter((definition) => !existingPaths.has(definition.path))
  if (extraDefinitions.length === 0) return signal

  return {
    ...signal,
    factorDefinitions: [...existingDefinitions, ...extraDefinitions],
    factorLedger: (output: unknown) => {
      const existingLedger = signal.factorLedger?.(output)
      return makeFactorLedger(signal.id, [
        ...(existingLedger?.entries ?? []),
        ...extraDefinitions.map((definition) =>
          makeFactorEntry(definition, definition.defaultValue ?? null, {
            source: "signal-default",
          }),
        ),
      ])
    },
  }
}

const configFactorDefinitions = (signal: AnySignal): ReadonlyArray<SignalFactorDefinition> => {
  const config = signal.defaultConfig
  if (config === null || typeof config !== "object" || Array.isArray(config)) return []
  return Object.entries(config as Record<string, unknown>)
    .flatMap(([key, value]) => {
      const factorValue = toSignalFactorValue(value)
      if (factorValue === undefined) return []
      return [{
        path: `config.${normalizeFactorPathSegment(key)}`,
        title: `Config ${key.replaceAll("_", " ")}`,
        valueKind: signalFactorValueKind(factorValue),
        scoreRole: configScoreRole(key, factorValue),
        defaultValue: factorValue,
      } satisfies SignalFactorDefinition]
    })
}

const normalizeFactorPathSegment = (value: string): string =>
  value
    .replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()

const configScoreRole = (
  key: string,
  value: SignalFactorValue,
): SignalFactorDefinition["scoreRole"] => {
  if (typeof value === "number") return key.includes("weight") ? "weight" : "threshold"
  if (typeof value === "boolean") return "threshold"
  return "metadata"
}

const signalFactorValueKind = (
  value: SignalFactorValue,
): SignalFactorDefinition["valueKind"] => {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (typeof value === "object") return "object"
  if (typeof value === "string") return "string"
  if (typeof value === "number") return "number"
  return "boolean"
}

const toSignalFactorValue = (value: unknown): SignalFactorValue | undefined => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }
  if (Array.isArray(value)) {
    const items = value.map(toSignalFactorValue)
    return items.every((item): item is SignalFactorValue => item !== undefined)
      ? items
      : undefined
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, toSignalFactorValue(item)] as const)
    if (!entries.every((entry): entry is readonly [string, SignalFactorValue] => entry[1] !== undefined)) {
      return undefined
    }
    return Object.fromEntries(entries)
  }
  return undefined
}

interface FactorDefinitionValidationIssue {
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
    if (entry.source === "vector" && Object.is(entry.value, nextValue)) {
      return entry
    }
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
