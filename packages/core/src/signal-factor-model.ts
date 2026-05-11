export type SignalFactorValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<SignalFactorValue>
  | { readonly [key: string]: SignalFactorValue }

export type SignalFactorValueKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "array"
  | "object"

export type SignalFactorScoreRole =
  | "evidence"
  | "threshold"
  | "penalty"
  | "weight"
  | "confidence"
  | "score-cap"
  | "metadata"

export type SignalFactorSource =
  | "signal-default"
  | "computed"
  | "vector"
  | "module"

export interface SignalFactorDefinition {
  readonly path: string
  readonly title: string
  readonly valueKind: SignalFactorValueKind
  readonly scoreRole: SignalFactorScoreRole
  readonly description?: string
  readonly defaultValue?: SignalFactorValue
}

export interface SignalFactorAttributionEvidence {
  readonly kind: string
  readonly value: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface SignalFactorAttribution {
  readonly ruleId?: string
  readonly sourceRef?: string
  readonly moduleId?: string
  readonly processorId?: string
  readonly evidence?: ReadonlyArray<SignalFactorAttributionEvidence>
}

export interface SignalFactorLedgerEntry {
  readonly path: string
  readonly value: SignalFactorValue
  readonly source: SignalFactorSource
  readonly affectsScore: boolean
  readonly title?: string
  readonly scoreRole?: SignalFactorScoreRole
  readonly attribution?: SignalFactorAttribution
  readonly mutations?: ReadonlyArray<SignalFactorPolicyMutation>
}

export interface SignalFactorLedger {
  readonly signalId: string
  readonly entries: ReadonlyArray<SignalFactorLedgerEntry>
}

export interface SignalFactorPolicyMutation {
  readonly path: string
  readonly source: SignalFactorSource
  readonly action: string
  readonly before?: SignalFactorValue
  readonly after: SignalFactorValue
  readonly ruleId?: string
  readonly sourceRef?: string
  readonly moduleId?: string
  readonly processorId?: string
  readonly evidence?: ReadonlyArray<SignalFactorAttributionEvidence>
}
