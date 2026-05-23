import type { RustBoundaryRule } from "./rs-ad-02-types.js"
import { asUnknownRecord } from "./shared-record-guards.js"

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")

export const normalizeBoundaryRules = (raw: unknown): ReadonlyMap<string, RustBoundaryRule> => {
  const record = asUnknownRecord(raw)
  const boundaries = asUnknownRecord(record?.rust_crate_boundaries) ?? {}
  return new Map(
    Object.entries(boundaries).flatMap(([key, value]) => {
      const rule = asUnknownRecord(value)
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
