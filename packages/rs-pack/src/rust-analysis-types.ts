import type { RustManifestInfo } from "./project.js"

export interface RustVisibility {
  readonly kind: "pub" | "pub-crate" | "pub-super" | "pub-in-path" | "private"
  readonly path?: string
}

export interface RustModuleFact {
  readonly crateName: string
  readonly file: string
  readonly line: number
  readonly relativeModulePath: string
  readonly modulePath: string
  readonly visibility: RustVisibility
}

export interface RustItemFact {
  readonly kind:
    | "fn"
    | "struct"
    | "enum"
    | "trait"
    | "impl"
    | "mod"
    | "const"
    | "static"
    | "type"
  readonly name: string
  readonly visibility: RustVisibility
  readonly crateName: string
  readonly file: string
  readonly line: number
  readonly relativeModulePath: string
  readonly modulePath: string
}

export interface RustUseFact {
  readonly crateName: string
  readonly file: string
  readonly line: number
  readonly relativeModulePath: string
  readonly modulePath: string
  readonly visibility: RustVisibility
  readonly path: string
  readonly segments: ReadonlyArray<string>
}

export interface RustMatchFact {
  readonly crateName: string
  readonly file: string
  readonly line: number
  readonly relativeModulePath: string
  readonly modulePath: string
  readonly functionName: string
  readonly armCount: number
  readonly catchAllArmCount: number
  readonly hasCatchAll: boolean
}

export interface RustIdentifierFact {
  readonly crateName: string
  readonly file: string
  readonly line: number
  readonly relativeModulePath: string
  readonly modulePath: string
  readonly kind: "item" | "function" | "parameter"
  readonly name: string
  readonly tokens: ReadonlyArray<string>
}

export interface RustFunctionFact {
  readonly crateName: string
  readonly file: string
  readonly line: number
  readonly relativeModulePath: string
  readonly modulePath: string
  readonly name: string
  readonly visibility: RustVisibility
  readonly isUnsafeFn: boolean
  readonly unsafeBlockCount: number
  readonly rawPointerParamCount: number
  readonly rawPointerReturn: boolean
  readonly lifetimeParamCount: number
  readonly lifetimeBoundCount: number
  readonly lifetimeInputCount: number
  readonly lifetimeOutputCount: number
  readonly lifetimeConstraintCount: number
  readonly returnTypeText: string | undefined
  readonly resultErrorType: string | undefined
  readonly complexity: number
}

export interface RustAnalysis {
  readonly modules: ReadonlyArray<RustModuleFact>
  readonly items: ReadonlyArray<RustItemFact>
  readonly uses: ReadonlyArray<RustUseFact>
  readonly functions: ReadonlyArray<RustFunctionFact>
  readonly matches: ReadonlyArray<RustMatchFact>
  readonly identifiers: ReadonlyArray<RustIdentifierFact>
  readonly modulesByPath: ReadonlyMap<string, RustModuleFact>
  readonly itemsByModuleAndName: ReadonlyMap<string, RustItemFact>
}

export interface RustFactCollections {
  readonly modules: Array<RustModuleFact>
  readonly items: Array<RustItemFact>
  readonly uses: Array<RustUseFact>
  readonly functions: Array<RustFunctionFact>
  readonly matches: Array<RustMatchFact>
  readonly identifiers: Array<RustIdentifierFact>
  readonly modulesByPath: Map<string, RustModuleFact>
  readonly itemsByModuleAndName: Map<string, RustItemFact>
}

export interface RustFileFactContext {
  readonly manifest: RustManifestInfo | undefined
  readonly crateName: string
  readonly file: string
  readonly baseModuleSegments: ReadonlyArray<string>
}

export interface RustNodeFactContext {
  readonly crateName: string
  readonly file: string
  readonly relativeModulePath: string
  readonly modulePath: string
}
