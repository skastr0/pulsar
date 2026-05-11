import { Effect } from "effect"
import { UnknownSignalFactorError, UnknownSignalIdError } from "./errors.js"
import type { Registry } from "./registry.js"
import type { SignalFactorValue, SignalIdentity } from "./signal.js"
import type {
  PulsarVector,
  SignalFactorOverrideMap,
  SignalOverride,
} from "./vector-schema.js"

export * from "./vector-ai-mode.js"
export * from "./vector-backpressure-config.js"
export * from "./vector-observer-config.js"
export * from "./vector-provenance.js"

/**
 * Validate that every signal id referenced in the vector is known to the
 * registry. This is a load-time check — bad vectors fail loud, not late.
 */
export const validateVectorAgainstRegistry = (
  vector: PulsarVector,
  registry: Registry,
): Effect.Effect<void, UnknownSignalIdError | UnknownSignalFactorError> =>
  Effect.gen(function* () {
    for (const id of Object.keys(vector.signal_overrides)) {
      const signal = registry.byId.get(id)
      if (signal === undefined) return yield* new UnknownSignalIdError({ id })

      const factorPaths = new Set((signal.factorDefinitions ?? []).map((factor) => factor.path))
      for (const factorPath of Object.keys(vector.signal_overrides[id]?.factors ?? {})) {
        if (!factorPaths.has(factorPath)) {
          return yield* new UnknownSignalFactorError({
            signalId: signal.id,
            factorPath,
          })
        }
      }
    }
  })

/**
 * Resolve the effective config for a signal given a pulsar vector,
 * falling back to the signal's defaultConfig when no override is
 * provided.
 */
export const resolvedConfig = <Config>(
  signal: string | SignalIdentity,
  defaultConfig: Config,
  vector: PulsarVector | undefined,
): Config => {
  if (vector === undefined) return defaultConfig
  const override = signalOverrideOf(signal, vector)
  if (override === undefined) return defaultConfig
  return {
    ...defaultConfig,
    ...((override.config ?? {}) as Partial<Config>),
    ...configPatchFromFactorOverrides<Config>(override.factors),
  }
}

export const isActive = (
  signal: string | SignalIdentity,
  vector: PulsarVector | undefined,
): boolean => {
  if (vector === undefined) return true
  const override = signalOverrideOf(signal, vector)
  return override?.active ?? true
}

export const weightOf = (
  signal: string | SignalIdentity,
  vector: PulsarVector | undefined,
): number => {
  if (vector === undefined) return 1
  const override = signalOverrideOf(signal, vector)
  return override?.weight ?? 1
}

export const signalOverrideOf = (
  signal: string | SignalIdentity,
  vector: PulsarVector | undefined,
): SignalOverride | undefined => {
  if (vector === undefined) return undefined
  for (const id of signalIdsForOverrideLookup(signal)) {
    const override = vector.signal_overrides[id]
    if (override !== undefined) return override
  }
  return undefined
}

export const factorOverridesOf = (
  signal: string | SignalIdentity,
  vector: PulsarVector | undefined,
): SignalFactorOverrideMap => {
  const factors = signalOverrideOf(signal, vector)?.factors
  return factors === undefined ? {} : (factors as SignalFactorOverrideMap)
}

const configPatchFromFactorOverrides = <Config>(
  factors: SignalOverride["factors"] | undefined,
): Partial<Config> => {
  if (factors === undefined) return {}
  const patch: Record<string, SignalFactorValue> = {}
  for (const [path, value] of Object.entries(factors)) {
    if (!path.startsWith("config.")) continue
    patch[path.slice("config.".length)] = (value ?? null) as SignalFactorValue
  }
  return patch as Partial<Config>
}

const signalIdsForOverrideLookup = (
  signal: string | SignalIdentity,
): ReadonlyArray<string> =>
  typeof signal === "string" ? [signal] : [signal.id, ...(signal.aliases ?? [])]
