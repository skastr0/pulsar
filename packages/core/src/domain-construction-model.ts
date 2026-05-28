import { Schema } from "effect"

export const DOMAIN_CONSTRUCTION_REFERENCE_DATA_KEY = "domain-construction" as const
export const CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH =
  ".pulsar/domain-construction.json" as const

export const DomainConstructionEvidence = Schema.Struct({
  path: Schema.String,
  symbol: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
})
export type DomainConstructionEvidence = typeof DomainConstructionEvidence.Type

export const DomainConstructionControl = Schema.Struct({
  intent: Schema.Literal("controlled", "intentionally_open"),
  reason: Schema.optional(Schema.String),
  smart_constructors: Schema.optional(Schema.Array(DomainConstructionEvidence)),
  parsers: Schema.optional(Schema.Array(DomainConstructionEvidence)),
  controlled_exports: Schema.optional(Schema.Array(DomainConstructionEvidence)),
  allow_public_constructor: Schema.optional(Schema.Boolean),
})
export type DomainConstructionControl = typeof DomainConstructionControl.Type

export const DomainConstructKind = Schema.Literal(
  "brand",
  "newtype",
  "value-object",
  "opaque-type",
  "wrapper",
  "domain-primitive",
)
export type DomainConstructKind = typeof DomainConstructKind.Type

export const DomainConstructionConstruct = Schema.Struct({
  id: Schema.String,
  symbol: Schema.String,
  kind: DomainConstructKind,
  declaration_path: Schema.String,
  source_hashes: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  control: DomainConstructionControl,
})
export type DomainConstructionConstruct = typeof DomainConstructionConstruct.Type

export const DomainConstructionManifest = Schema.Struct({
  schema_version: Schema.Literal(1),
  constructs: Schema.Array(DomainConstructionConstruct),
})
export type DomainConstructionManifest = typeof DomainConstructionManifest.Type

export type DomainConstructionFactState =
  | "present"
  | "zero"
  | "not_configured"
  | "unknown"
  | "not_applicable"

export type DomainConstructionFindingKind =
  | "uncontrolled-constructor-export"
  | "missing-construction-evidence"
  | "missing-source-provenance"
  | "stale-source"
  | "explicitly-open-construct"

export interface DomainConstructionFinding {
  readonly findingId: string
  readonly constructId: string
  readonly symbol: string
  readonly kind: DomainConstructionFindingKind
  readonly file: string
  readonly severity: "info" | "warn"
  readonly weight: number
  readonly evidence: ReadonlyArray<string>
}

export interface DomainConstructionEvidenceFact {
  readonly path: string
  readonly symbol?: string
  readonly present: boolean
  readonly hash?: string
  readonly matchedSymbol: boolean
}

export interface DomainConstructionConstructFact {
  readonly constructId: string
  readonly symbol: string
  readonly kind: DomainConstructKind
  readonly declarationPath: string
  readonly controlIntent: DomainConstructionControl["intent"]
  readonly reason?: string
  readonly sourceHashes: Readonly<Record<string, string>>
  readonly expectedSourceHashes: Readonly<Record<string, string>>
  readonly exportedDeclarationDetected: boolean
  readonly publicConstructorDetected: boolean
  readonly privateConstructorDetected: boolean
  readonly allowPublicConstructor: boolean
  readonly smartConstructors: ReadonlyArray<DomainConstructionEvidenceFact>
  readonly parsers: ReadonlyArray<DomainConstructionEvidenceFact>
  readonly controlledExports: ReadonlyArray<DomainConstructionEvidenceFact>
}

export interface DomainConstructionFacts {
  readonly state: DomainConstructionFactState
  readonly sourcePath?: string
  readonly checkedPaths: ReadonlyArray<string>
  readonly constructs: ReadonlyArray<DomainConstructionConstructFact>
  readonly findings: ReadonlyArray<DomainConstructionFinding>
  readonly sourceFingerprint: string
  readonly message?: string
}

export const FINDING_WEIGHT: Record<DomainConstructionFindingKind, number> = {
  "uncontrolled-constructor-export": 5,
  "missing-construction-evidence": 3,
  "missing-source-provenance": 3,
  "stale-source": 4,
  "explicitly-open-construct": 0,
}
