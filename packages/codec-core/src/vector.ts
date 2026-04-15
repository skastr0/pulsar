import { Effect, Schema } from "effect"
import type { Registry } from "./registry.js"
import { UnknownSignalIdError } from "./errors.js"

export const SignalOverride = Schema.Struct({
  active: Schema.optional(Schema.Boolean),
  weight: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
  config: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type SignalOverride = typeof SignalOverride.Type

export const TasteVector = Schema.Struct({
  id: Schema.String,
  domain: Schema.String,
  signal_overrides: Schema.Record({ key: Schema.String, value: SignalOverride }),
})
export type TasteVector = typeof TasteVector.Type

export const decodeTasteVector = Schema.decodeUnknown(TasteVector)

/**
 * Validate that every signal id referenced in the vector is known to the
 * registry. This is a load-time check — bad vectors fail loud, not late.
 */
export const validateVectorAgainstRegistry = (
  vector: TasteVector,
  registry: Registry,
): Effect.Effect<void, UnknownSignalIdError> =>
  Effect.gen(function* () {
    for (const id of Object.keys(vector.signal_overrides)) {
      if (!registry.has(id)) return yield* new UnknownSignalIdError({ id })
    }
  })

/**
 * Resolve the effective config for a signal given a taste vector,
 * falling back to the signal's defaultConfig when no override is
 * provided.
 */
export const resolvedConfig = <Config>(
  signalId: string,
  defaultConfig: Config,
  vector: TasteVector | undefined,
): Config => {
  if (vector === undefined) return defaultConfig
  const override = vector.signal_overrides[signalId]
  if (override === undefined || override.config === undefined) return defaultConfig
  return { ...defaultConfig, ...(override.config as Partial<Config>) }
}

export const isActive = (signalId: string, vector: TasteVector | undefined): boolean => {
  if (vector === undefined) return true
  const override = vector.signal_overrides[signalId]
  return override?.active ?? true
}

export const weightOf = (signalId: string, vector: TasteVector | undefined): number => {
  if (vector === undefined) return 1
  const override = vector.signal_overrides[signalId]
  return override?.weight ?? 1
}
