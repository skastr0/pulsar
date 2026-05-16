import { Schema } from "effect"

export const ARCHITECTURE_ROLE_METADATA_KEY = "architecture_role"
export const ARCHITECTURAL_TIER_METADATA_KEY = "architectural_tier"
export const POLICY_TAGS_METADATA_KEY = "policy_tags"

export type ArchitectureRole = string
export type PolicyTag = string

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

export const readArchitectureRole = (
  metadata: Readonly<Record<string, unknown>> | undefined,
): ArchitectureRole | undefined => {
  const value = metadata?.[ARCHITECTURE_ROLE_METADATA_KEY]
  return isNonEmptyString(value) ? value.trim() : undefined
}

export const readPolicyTags = (
  metadata: Readonly<Record<string, unknown>> | undefined,
): ReadonlyArray<PolicyTag> => {
  const value = metadata?.[POLICY_TAGS_METADATA_KEY]
  return Array.isArray(value) ? uniqueStrings(value) : []
}

export const withArchitectureRoleMetadata = <
  Value extends object,
>(
  value: Value & { readonly metadata?: Readonly<Record<string, unknown>> },
  role: ArchitectureRole,
  metadata?: Readonly<Record<string, unknown>>,
): Value & { readonly metadata: Readonly<Record<string, unknown>> } => {
  const nextMetadata = {
    ...value.metadata,
    ...metadata,
  }
  const normalizedRole = normalizeString(role)
  if (normalizedRole === undefined) {
    return {
      ...value,
      metadata: nextMetadata,
    }
  }
  return {
    ...value,
    metadata: {
      ...nextMetadata,
      [ARCHITECTURE_ROLE_METADATA_KEY]: normalizedRole,
    },
  }
}

export const withPolicyTagMetadata = <
  Value extends object,
>(
  value: Value & { readonly metadata?: Readonly<Record<string, unknown>> },
  tag: PolicyTag,
  metadata?: Readonly<Record<string, unknown>>,
): Value & { readonly metadata: Readonly<Record<string, unknown>> } =>
  withPolicyTagsMetadata(value, [tag], metadata)

export const withPolicyTagsMetadata = <
  Value extends object,
>(
  value: Value & { readonly metadata?: Readonly<Record<string, unknown>> },
  tags: ReadonlyArray<PolicyTag>,
  metadata?: Readonly<Record<string, unknown>>,
): Value & { readonly metadata: Readonly<Record<string, unknown>> } => {
  const policyTags = uniqueStrings([
    ...readPolicyTags(value.metadata),
    ...readPolicyTags(metadata),
    ...tags,
  ])
  return {
    ...value,
    metadata: {
      ...value.metadata,
      ...metadata,
      [POLICY_TAGS_METADATA_KEY]: policyTags,
    },
  }
}

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

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

const normalizeString = (value: string): string | undefined => {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

const uniqueStrings = (
  values: ReadonlyArray<unknown>,
): ReadonlyArray<string> => [
  ...new Set(values.filter(isNonEmptyString).map((value) => value.trim())),
]
