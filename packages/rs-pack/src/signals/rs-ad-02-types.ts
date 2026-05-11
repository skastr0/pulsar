import { Schema } from "effect"

export const RsAd02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type RsAd02Config = typeof RsAd02Config.Type

export interface RustBoundaryRule {
  readonly visibility: string
  readonly allowedDependents: ReadonlyArray<string>
  readonly publicModules: ReadonlyArray<string>
}

export interface RsAd02Violation {
  readonly file: string
  readonly line: number
  readonly fromCrate: string
  readonly toCrate: string
  readonly importPath: string
  readonly kind: "dependent-not-allowed" | "non-public-target" | "boundary-rule"
  readonly detail: string
}

export interface RsAd02Output {
  readonly checkedImports: number
  readonly violations: ReadonlyArray<RsAd02Violation>
  readonly referenceDataStatus: "loaded" | "missing"
}
