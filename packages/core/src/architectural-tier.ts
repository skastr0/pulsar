import { Schema } from "effect"

export const ARCHITECTURAL_TIER_METADATA_KEY = "architectural_tier"

export const ArchitecturalTier = Schema.Literal(
  "pure_utility",
  "shared_contextual",
  "integration",
)
export type ArchitecturalTier = typeof ArchitecturalTier.Type

export const ARCHITECTURAL_TIERS: ReadonlyArray<ArchitecturalTier> = [
  "pure_utility",
  "shared_contextual",
  "integration",
]

export const isArchitecturalTier = (value: unknown): value is ArchitecturalTier =>
  typeof value === "string" &&
  ARCHITECTURAL_TIERS.includes(value as ArchitecturalTier)

export const readArchitecturalTier = (
  metadata: Readonly<Record<string, unknown>> | undefined,
): ArchitecturalTier | undefined => {
  const value = metadata?.[ARCHITECTURAL_TIER_METADATA_KEY]
  return isArchitecturalTier(value) ? value : undefined
}

export const withArchitecturalTierMetadata = <
  Value extends object,
>(
  value: Value & { readonly metadata?: Readonly<Record<string, unknown>> },
  tier: ArchitecturalTier,
  metadata?: Readonly<Record<string, unknown>>,
): Value & { readonly metadata: Readonly<Record<string, unknown>> } => ({
  ...value,
  metadata: {
    ...value.metadata,
    ...metadata,
    [ARCHITECTURAL_TIER_METADATA_KEY]: tier,
  },
})
