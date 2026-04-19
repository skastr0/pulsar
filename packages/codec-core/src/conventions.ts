import { Schema } from "effect"

export const CasingPattern = Schema.Literal(
  "camelCase",
  "PascalCase",
  "UPPER_SNAKE_CASE",
  "snake_case",
  "kebab-case",
)
export type CasingPattern = typeof CasingPattern.Type

const NAMING_CONVENTION_PATTERN =
  /^(camelCase|PascalCase|UPPER_SNAKE_CASE|snake_case|kebab-case)( \| (camelCase|PascalCase|UPPER_SNAKE_CASE|snake_case|kebab-case))*$/

export const NamingConventionValue = Schema.String.pipe(
  Schema.pattern(NAMING_CONVENTION_PATTERN),
)
export type NamingConventionValue = typeof NamingConventionValue.Type

export const BoundaryVisibility = Schema.Literal("public-api", "internal")
export type BoundaryVisibility = typeof BoundaryVisibility.Type

export const BoundaryConvention = Schema.Struct({
  visibility: BoundaryVisibility,
  allowed_imports: Schema.Array(Schema.String),
  blocked_imports: Schema.optional(Schema.Array(Schema.String)),
})
export type BoundaryConvention = typeof BoundaryConvention.Type

export const RustCrateBoundaryConvention = Schema.Struct({
  visibility: BoundaryVisibility,
  allowed_dependents: Schema.optional(Schema.Array(Schema.String)),
  public_modules: Schema.optional(Schema.Array(Schema.String)),
})
export type RustCrateBoundaryConvention = typeof RustCrateBoundaryConvention.Type

export const NamingConventions = Schema.Struct({
  function: NamingConventionValue,
  class: NamingConventionValue,
  interface: NamingConventionValue,
  type: NamingConventionValue,
  const: NamingConventionValue,
  enum: NamingConventionValue,
})
export type NamingConventions = typeof NamingConventions.Type

export const ArchitecturalRule = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  allowed: Schema.Boolean,
  reason: Schema.String,
})
export type ArchitecturalRule = typeof ArchitecturalRule.Type

export const SchemaConventions = Schema.Struct({
  schema_version: Schema.Literal(1),
  extracted_at_sha: Schema.String,
  boundaries: Schema.Record({ key: Schema.String, value: BoundaryConvention }),
  rust_crate_boundaries: Schema.optional(
    Schema.Record({ key: Schema.String, value: RustCrateBoundaryConvention }),
  ),
  naming_conventions: NamingConventions,
  architectural_rules: Schema.Array(ArchitecturalRule),
})
export type SchemaConventions = typeof SchemaConventions.Type

export const decodeSchemaConventions = Schema.decodeUnknown(SchemaConventions)
export const decodeSchemaConventionsSync = Schema.decodeUnknownSync(SchemaConventions)
