import { Schema } from "effect"

export class DuplicateSignalIdError extends Schema.TaggedError<DuplicateSignalIdError>()(
  "DuplicateSignalIdError",
  { id: Schema.String },
) {}

export class MissingDependencyError extends Schema.TaggedError<MissingDependencyError>()(
  "MissingDependencyError",
  {
    signalId: Schema.String,
    missingInputId: Schema.String,
  },
) {}

export class CycleDetectedError extends Schema.TaggedError<CycleDetectedError>()(
  "CycleDetectedError",
  { chain: Schema.Array(Schema.String) },
) {}

export class CompositionTooDeepError extends Schema.TaggedError<CompositionTooDeepError>()(
  "CompositionTooDeepError",
  {
    signalId: Schema.String,
    depth: Schema.Number,
    max: Schema.Number,
  },
) {}

export class UnknownSignalIdError extends Schema.TaggedError<UnknownSignalIdError>()(
  "UnknownSignalIdError",
  { id: Schema.String },
) {}

export class ConfigValidationError extends Schema.TaggedError<ConfigValidationError>()(
  "ConfigValidationError",
  {
    signalId: Schema.String,
    message: Schema.String,
  },
) {}

export class ReferenceDataMissingError extends Schema.TaggedError<ReferenceDataMissingError>()(
  "ReferenceDataMissingError",
  {
    signalId: Schema.String,
    key: Schema.String,
  },
) {}

export class SignalComputeError extends Schema.TaggedError<SignalComputeError>()(
  "SignalComputeError",
  {
    signalId: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export type RegistryError =
  | DuplicateSignalIdError
  | MissingDependencyError
  | CycleDetectedError
  | CompositionTooDeepError

export type SignalError =
  | UnknownSignalIdError
  | ConfigValidationError
  | ReferenceDataMissingError
  | SignalComputeError
