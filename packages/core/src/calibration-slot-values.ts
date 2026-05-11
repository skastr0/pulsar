import type {
  CalibrationConfidence,
  CalibrationEvidenceRef,
  SourceCategory,
} from "./calibration-model.js"

export interface FileClassificationValue {
  readonly path: string
  readonly categories: ReadonlyArray<SourceCategory>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface LanguagePackActivationValue {
  readonly repoRoot: string
  readonly sourceExtensions: ReadonlyArray<string>
  readonly activePackIds: ReadonlyArray<string>
  readonly evidence: ReadonlyArray<CalibrationEvidenceRef>
}

export interface TypeScriptNoopClassificationValue {
  readonly file: string
  readonly name: string
  readonly line?: number
  readonly nodeKind: string
  readonly bodyText?: string
  readonly functionText?: string
  readonly parentKind?: string
  readonly parentText?: string
  readonly ancestorKinds?: ReadonlyArray<string>
  readonly candidateKind?:
    | "throw-not-implemented"
    | "empty-body"
    | "todo-comment"
    | "mock-return"
    | "unknown"
  readonly inTestPath?: boolean
  readonly classification: "unknown" | "intentional_noop" | "stub"
  readonly confidence?: CalibrationConfidence
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptCloneGroupPolicyValue {
  readonly groupId: string
  readonly action: "keep" | "deweight" | "exclude"
  readonly factor: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptDependencyResolutionValue {
  readonly specifier: string
  readonly fromFile: string
  readonly resolution:
    | "unresolved"
    | "declared"
    | "virtual_module"
    | "path_alias"
    | "workspace"
    | "bundled_external"
    | "facade_alias"
  readonly packageName?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptSuppressionJustificationValue {
  readonly file: string
  readonly line: number
  readonly directive: string
  readonly justification: "unknown" | "justified" | "suspicious" | "unjustified"
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptCallbackContextNameValue {
  readonly file: string
  readonly line: number
  readonly fallbackName: string
  readonly resolvedName: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptCallExpressionFact {
  readonly calleeText: string
  readonly calleeName?: string
}

export interface TypeScriptImportBindingFact {
  readonly moduleSpecifier: string
  readonly importKind: "default" | "named" | "namespace"
  readonly importedName: string
  readonly localName: string
}

export interface TypeScriptLocalBindingFact {
  readonly localName: string
  readonly initializerCall?: TypeScriptCallExpressionFact
}

export interface TypeScriptExportSpecifierFact {
  readonly exportedName: string
  readonly localName: string
  readonly moduleSpecifier?: string
}

export interface TypeScriptExportDeclarationFact {
  readonly declarationKind: string
  readonly exportName: string
  readonly localName?: string
  readonly initializerCall?: TypeScriptCallExpressionFact
  readonly expressionIdentifier?: string
  readonly expressionCall?: TypeScriptCallExpressionFact
}

export interface TypeScriptExportReachabilityValue {
  readonly exportFile: string
  readonly exportName: string
  readonly declarationFiles: ReadonlyArray<string>
  readonly declarationKinds: ReadonlyArray<string>
  readonly declarations?: ReadonlyArray<TypeScriptExportDeclarationFact>
  readonly sourceImports?: ReadonlyArray<TypeScriptImportBindingFact>
  readonly sourceLocalBindings?: ReadonlyArray<TypeScriptLocalBindingFact>
  readonly sourceExportSpecifiers?: ReadonlyArray<TypeScriptExportSpecifierFact>
  readonly isPublicEntrypoint: boolean
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptUnfinishedImplementationPolicyValue {
  readonly signalId: string
  readonly findingId: string
  readonly file: string
  readonly name: string
  readonly line?: number
  readonly stubKind:
    | "throw-not-implemented"
    | "empty-body"
    | "todo-comment"
    | "mock-return"
    | "unknown"
  readonly message: string
  readonly visible: boolean
  readonly severity: "info" | "warn" | "block"
  readonly confidence: CalibrationConfidence
  readonly penaltyWeight: number
  readonly scoreCapParticipation: boolean
  readonly scoreCap?: number
  readonly factorPathPrefix: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptUnsafeTypePolicyValue {
  readonly signalId: string
  readonly findingId: string
  readonly file: string
  readonly line: number
  readonly kind:
    | "parameter"
    | "return"
    | "property"
    | "variable"
    | "type-alias"
    | "assertion"
    | "heritage"
    | "unknown"
  readonly target: string
  readonly boundary: boolean
  readonly visible: boolean
  readonly severity: "info" | "warn" | "block"
  readonly baseWeight: number
  readonly weight: number
  readonly factorPathPrefix: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface MixerCategoryPolicyValue {
  readonly category: string
  readonly rawScore: number
  readonly finalScore: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface CalibrationSlotValues {
  readonly "taxonomy.file-classifier": FileClassificationValue
  readonly "language-pack-activation": LanguagePackActivationValue
  readonly "typescript.noop-classifier": TypeScriptNoopClassificationValue
  readonly "typescript.clone-group-policy": TypeScriptCloneGroupPolicyValue
  readonly "typescript.dependency-resolver": TypeScriptDependencyResolutionValue
  readonly "typescript.suppression-justifier": TypeScriptSuppressionJustificationValue
  readonly "typescript.callback-context-namer": TypeScriptCallbackContextNameValue
  readonly "typescript.export-reachability": TypeScriptExportReachabilityValue
  readonly "typescript.unfinished-implementation-policy": TypeScriptUnfinishedImplementationPolicyValue
  readonly "typescript.unsafe-type-policy": TypeScriptUnsafeTypePolicyValue
  readonly "mixer.category-policy": MixerCategoryPolicyValue
}
