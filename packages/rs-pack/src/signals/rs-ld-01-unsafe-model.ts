export type UnsafeSiteKind =
  | "unsafe_block"
  | "unsafe_function"
  | "unsafe_function_signature"
  | "unsafe_trait"
  | "unsafe_impl"
  | "foreign_function"
  | "static_mut"

export interface UnsafeSite {
  readonly kind: UnsafeSiteKind
  readonly module: string
  readonly file: string
  readonly line: number
  readonly name: string | undefined
  readonly functionName: string | undefined
}

export interface UnsafeModuleSummary {
  readonly module: string
  readonly file: string
  readonly totalFunctions: number
  readonly safeOnlyMatchedSelectors: ReadonlyArray<string>
  readonly unsafeSiteCount: number
  readonly unsafeSiteKindCounts: Partial<Record<UnsafeSiteKind, number>>
  readonly sites: ReadonlyArray<UnsafeSite>
  readonly unsafeBlockCount: number
  readonly unsafeFunctionCount: number
  readonly propagatingFunctionCount: number
  readonly unsafePropagationShare: number
  readonly unsafeSitesPerFunction: number
  readonly cappedUnsafeSiteShare: number
  readonly unsafePressure: number
}

export interface FunctionCallFacts {
  readonly key: string
  readonly module: string
  readonly name: string
  readonly callees: ReadonlyArray<CalleeRef>
}

export interface CalleeRef {
  readonly name: string
  readonly pathSegments: ReadonlyArray<string>
}

export const functionKey = (module: string, name: string): string => `${module}::${name}`

