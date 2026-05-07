import { Context, Effect, Option, Schema } from "effect"
import { ReferenceDataMissingError } from "./errors.js"

/**
 * A changed hunk in the scored commit, used by signals to compute
 * diff-aware outputs without re-reading the whole tree.
 */
export const ChangedHunk = Schema.Struct({
  file: Schema.String,
  oldStart: Schema.Number,
  oldLines: Schema.Number,
  newStart: Schema.Number,
  newLines: Schema.Number,
})
export type ChangedHunk = typeof ChangedHunk.Type

/**
 * Scoped reference data. A key identifies the kind (e.g. "glossary",
 * "boundary-rules"); the value is opaque and validated by each consumer.
 */
export interface ReferenceData {
  readonly get: <A>(key: string) => Effect.Effect<Option.Option<A>>
  readonly require: <A>(signalId: string, key: string) => Effect.Effect<A, ReferenceDataMissingError>
}

export class ReferenceDataTag extends Context.Tag("@skastr0/pulsar-core/ReferenceData")<
  ReferenceDataTag,
  ReferenceData
>() {}

/**
 * The scoring context — the spine that threads through every signal's
 * compute. Provided by the scoring engine once per commit.
 */
export interface SignalContext {
  readonly gitSha: string
  readonly worktreePath: string
  readonly changedHunks: ReadonlyArray<ChangedHunk>
}

export class SignalContextTag extends Context.Tag("@skastr0/pulsar-core/SignalContext")<
  SignalContextTag,
  SignalContext
>() {}

export const makeReferenceData = (
  entries: ReadonlyMap<string, unknown>,
): ReferenceData => ({
  get: <A>(key: string) => Effect.sync(() => Option.fromNullable(entries.get(key) as A | undefined)),
  require: <A>(signalId: string, key: string) =>
    Effect.gen(function* () {
      const value = entries.get(key)
      if (value === undefined) {
        return yield* new ReferenceDataMissingError({ signalId, key })
      }
      return value as A
    }),
})
