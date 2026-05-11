import { Schema } from "effect"
import { ChangedHunk } from "./context.js"

export const Location = Schema.Struct({
  file: Schema.String,
  line: Schema.optional(Schema.Number),
  column: Schema.optional(Schema.Number),
})
export type Location = typeof Location.Type

export const SignalRef = Schema.Struct({
  signalId: Schema.String,
  include: Schema.optionalWith(
    Schema.Literal("score", "diagnostics", "output", "all"),
    { default: () => "all" },
  ),
})
export type SignalRef = typeof SignalRef.Type

const FilePathCondition = Schema.Struct({
  kind: Schema.Literal("file-path"),
  globs: Schema.Array(Schema.String),
})

const ImportAddedCondition = Schema.Struct({
  kind: Schema.Literal("import-added"),
  specifiers: Schema.Array(Schema.String),
})

const AstMatchCondition = Schema.Struct({
  kind: Schema.Literal("ast-match"),
  signalId: Schema.String,
  outputKey: Schema.String,
})

const SignalThresholdCondition = Schema.Struct({
  kind: Schema.Literal("signal-threshold"),
  signalId: Schema.String,
  below: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
  changeRatioAbove: Schema.optional(Schema.Number.pipe(Schema.greaterThanOrEqualTo(0))),
})

export const PatternCondition = Schema.Union(
  FilePathCondition,
  ImportAddedCondition,
  AstMatchCondition,
  SignalThresholdCondition,
)
export type PatternCondition = typeof PatternCondition.Type

export const RoutingPattern = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  triggerKind: Schema.Literal(
    "file-path",
    "import-added",
    "ast-match",
    "signal-threshold",
  ),
  condition: PatternCondition,
  reviewerRole: Schema.String,
  contextPayload: Schema.Array(SignalRef),
})
export type RoutingPattern = typeof RoutingPattern.Type

export const ImportAddition = Schema.Struct({
  file: Schema.String,
  specifier: Schema.String,
  line: Schema.optional(Schema.Number),
})
export type ImportAddition = typeof ImportAddition.Type

export const AstMatch = Schema.Struct({
  signalId: Schema.String,
  outputKey: Schema.String,
  location: Location,
  data: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type AstMatch = typeof AstMatch.Type

export const SignalChange = Schema.Struct({
  previousScore: Schema.optional(Schema.Number),
  currentScore: Schema.Number,
  absoluteDelta: Schema.Number,
  relativeDelta: Schema.optional(Schema.Number),
  sourceLocations: Schema.optional(Schema.Array(Location)),
})
export type SignalChange = typeof SignalChange.Type

export const RoutingDiff = Schema.Struct({
  changedFiles: Schema.Array(Schema.String),
  changedHunks: Schema.optionalWith(Schema.Array(ChangedHunk), { default: () => [] }),
  addedFiles: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
  addedImports: Schema.optionalWith(Schema.Array(ImportAddition), { default: () => [] }),
  astMatches: Schema.optionalWith(Schema.Array(AstMatch), { default: () => [] }),
  signalChanges: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: SignalChange }),
    { default: () => ({}) },
  ),
})
export type RoutingDiff = typeof RoutingDiff.Type

export const RoutingTrigger = Schema.Struct({
  patternId: Schema.String,
  reviewerRole: Schema.String,
  contextPayload: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  sourceLocations: Schema.Array(Location),
})
export type RoutingTrigger = typeof RoutingTrigger.Type

export const RoutingOutput = Schema.Struct({
  triggers: Schema.Array(RoutingTrigger),
})
export type RoutingOutput = typeof RoutingOutput.Type
