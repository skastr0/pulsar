import type { RustBoundaryRule } from "./rs-ad-02-types.js"

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

export const normalizeBoundaryRules = (raw: unknown): ReadonlyMap<string, RustBoundaryRule> => {
  const record = asRecord(raw)
  const boundaries = asRecord(record?.rust_crate_boundaries) ?? asRecord(record?.boundaries) ?? {}
  return new Map(
    Object.entries(boundaries).flatMap(([key, value]) => {
      const rule = asRecord(value)
      if (rule === undefined) return []
      return [
        [
          key,
          {
            visibility:
              typeof rule.visibility === "string" ? rule.visibility : "public-api",
            allowedDependents: isStringArray(rule.allowed_dependents)
              ? rule.allowed_dependents
              : [],
            publicModules: isStringArray(rule.public_modules)
              ? rule.public_modules
              : ["crate"],
          } satisfies RustBoundaryRule,
        ] as const,
      ]
    }),
  )
}
