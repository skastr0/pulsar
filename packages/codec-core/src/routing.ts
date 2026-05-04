import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Schema } from "effect"
import { ChangedHunk } from "./context.js"
import type { Diagnostic } from "./diagnostic.js"
import { RoutingPatternLoadFailed } from "./errors.js"
import { matchesGlob } from "./globs.js"
import type { ObserverOutput } from "./observer.js"
import type { SignalRunResult } from "./runner.js"

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

const RoutingPatternFile = Schema.Union(RoutingPattern, Schema.Array(RoutingPattern))

const SHIPPED_ROUTING_PATTERNS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "routing-patterns",
)

export class RoutingDetector {
  constructor(
    readonly patterns: ReadonlyArray<RoutingPattern>,
  ) {}

  detect(observerOutput: ObserverOutput, diff: RoutingDiff): RoutingOutput {
    const normalizedDiff = Schema.decodeUnknownSync(RoutingDiff)(diff)
    const triggers = this.patterns
      .flatMap((pattern) => {
        const match = matchPattern(pattern, observerOutput, normalizedDiff)
        if (match === undefined) return []

        return [
          {
            patternId: pattern.id,
            reviewerRole: pattern.reviewerRole,
            contextPayload: buildContextPayload(pattern, observerOutput, normalizedDiff, match),
            sourceLocations: dedupeLocations(match.sourceLocations),
          } satisfies RoutingTrigger,
        ]
      })

    return { triggers }
  }

  static load(options?: { readonly repoRoot?: string }) {
    return Effect.gen(function* () {
      const shipped = yield* loadPatternsFromDirectory({
        repoRoot: options?.repoRoot ?? process.cwd(),
        directory: SHIPPED_ROUTING_PATTERNS_DIR,
        optional: false,
      })
      const custom =
        options?.repoRoot === undefined
          ? []
          : yield* loadPatternsFromDirectory({
              repoRoot: options.repoRoot,
              directory: join(options.repoRoot, ".taste-codec", "routing-patterns"),
              optional: true,
            })

      return new RoutingDetector(mergePatterns(shipped, custom))
    })
  }
}

type PatternMatch = {
  readonly sourceLocations: ReadonlyArray<Location>
  readonly matchDetail: unknown
}

const matchPattern = (
  pattern: RoutingPattern,
  observerOutput: ObserverOutput,
  diff: RoutingDiff,
): PatternMatch | undefined => {
  const condition = pattern.condition

  switch (condition.kind) {
    case "file-path": {
      const matchedFiles = diff.changedFiles.filter((file) =>
        condition.globs.some((glob: string) => matchesGlob(file, glob)),
      )
      if (matchedFiles.length === 0) return undefined
      return {
        sourceLocations: matchedFiles.map((file) => ({ file })),
        matchDetail: { matchedFiles },
      }
    }
    case "import-added": {
      const matchedImports = diff.addedImports.filter((entry) =>
        condition.specifiers.some((specifier: string) =>
          matchesSpecifierPattern(entry.specifier, specifier),
        ),
      )
      if (matchedImports.length === 0) return undefined
      return {
        sourceLocations: matchedImports.map((entry) => ({
          file: entry.file,
          ...(entry.line !== undefined ? { line: entry.line } : {}),
        })),
        matchDetail: { matchedImports },
      }
    }
    case "ast-match": {
      const matchedAstNodes = diff.astMatches.filter(
        (entry) =>
          entry.signalId === condition.signalId &&
          entry.outputKey === condition.outputKey,
      )
      if (matchedAstNodes.length === 0) return undefined
      return {
        sourceLocations: matchedAstNodes.map((entry) => entry.location),
        matchDetail: { matchedAstNodes },
      }
    }
    case "signal-threshold": {
      const result = observerOutput.signalResults.get(condition.signalId)
      const signalChange = diff.signalChanges[condition.signalId]
      const scoreMatch =
        condition.below !== undefined &&
        result !== undefined &&
        result.score < condition.below
      const changeMatch =
        condition.changeRatioAbove !== undefined &&
        signalChange?.relativeDelta !== undefined &&
        signalChange.relativeDelta >= condition.changeRatioAbove

      if (!scoreMatch && !changeMatch) return undefined

      const sourceLocations =
        signalChange?.sourceLocations ?? locationsFromDiagnostics(result?.diagnostics ?? [])

      return {
        sourceLocations,
        matchDetail: {
          signalId: condition.signalId,
          ...(condition.below !== undefined ? { below: condition.below } : {}),
          ...(result !== undefined ? { currentScore: result.score } : {}),
          ...(signalChange !== undefined ? { signalChange } : {}),
        },
      }
    }
  }
}

const buildContextPayload = (
  pattern: RoutingPattern,
  observerOutput: ObserverOutput,
  diff: RoutingDiff,
  match: PatternMatch,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    diff: toSerializable({
      changedFiles: diff.changedFiles,
      addedImports: diff.addedImports,
      astMatches: diff.astMatches,
      signalChanges: diff.signalChanges,
      match: match.matchDetail,
    }),
  }

  for (const signalRef of pattern.contextPayload) {
    const result = observerOutput.signalResults.get(signalRef.signalId)
    if (result === undefined) continue
    payload[signalRef.signalId] = selectSignalPayload(result, signalRef.include)
  }

  return payload
}

const selectSignalPayload = (
  result: SignalRunResult,
  include: SignalRef["include"],
): unknown => {
  switch (include) {
    case "score":
      return { score: result.score }
    case "diagnostics":
      return { diagnostics: toSerializable(result.diagnostics) }
    case "output":
      return { output: toSerializable(result.output) }
    case "all":
    default:
      return {
        score: result.score,
        diagnostics: toSerializable(result.diagnostics),
        output: toSerializable(result.output),
      }
  }
}

const matchesSpecifierPattern = (specifier: string, pattern: string): boolean => {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1)
    return specifier.startsWith(prefix)
  }
  return specifier === pattern
}

const locationsFromDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>,
): ReadonlyArray<Location> =>
  diagnostics.flatMap((diagnostic) =>
    diagnostic.location === undefined ? [] : [diagnostic.location],
  )

const dedupeLocations = (
  locations: ReadonlyArray<Location>,
): ReadonlyArray<Location> => {
  const seen = new Set<string>()
  const deduped: Array<Location> = []
  for (const location of locations) {
    const key = `${location.file}:${location.line ?? -1}:${location.column ?? -1}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(location)
  }
  return deduped
}

const mergePatterns = (
  shipped: ReadonlyArray<RoutingPattern>,
  custom: ReadonlyArray<RoutingPattern>,
): ReadonlyArray<RoutingPattern> => {
  const merged = new Map<string, RoutingPattern>()
  for (const pattern of shipped) merged.set(pattern.id, pattern)
  for (const pattern of custom) merged.set(pattern.id, pattern)
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id))
}

const loadPatternsFromDirectory = (opts: {
  readonly repoRoot: string
  readonly directory: string
  readonly optional: boolean
}) =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: async () => {
        try {
          const files = await readdir(opts.directory)
          return files.filter((file) => file.endsWith(".json")).sort()
        } catch (cause) {
          if (opts.optional && errorCodeOf(cause) === "ENOENT") {
            return []
          }
          throw cause
        }
      },
      catch: (cause) =>
        new RoutingPatternLoadFailed({
          repoPath: opts.repoRoot,
          path: opts.directory,
          message: `Failed to list routing patterns: ${String(cause)}`,
        }),
    })

    return yield* Effect.forEach(entries, (file) =>
      Effect.gen(function* () {
        const absolutePath = join(opts.directory, file)
        const raw = yield* Effect.tryPromise({
          try: () => readFile(absolutePath, "utf8"),
          catch: (cause) =>
            new RoutingPatternLoadFailed({
              repoPath: opts.repoRoot,
              path: absolutePath,
              message: `Failed to read routing pattern file: ${String(cause)}`,
            }),
        })

        const parsed = yield* Effect.try({
          try: () => JSON.parse(raw),
          catch: (cause) =>
            new RoutingPatternLoadFailed({
              repoPath: opts.repoRoot,
              path: absolutePath,
              message: `Failed to parse routing pattern JSON: ${String(cause)}`,
            }),
        })

        const decoded = yield* Schema.decodeUnknown(RoutingPatternFile)(parsed).pipe(
          Effect.mapError(
            (cause) =>
              new RoutingPatternLoadFailed({
                repoPath: opts.repoRoot,
                path: absolutePath,
                message: `Failed to decode routing pattern file: ${String(cause)}`,
              }),
          ),
          Effect.flatMap(validateRoutingPatternFile(absolutePath, opts.repoRoot)),
        )

        return Array.isArray(decoded) ? decoded : [decoded]
      }),
    ).pipe(Effect.map((groups) => groups.flat()))
  })

const validateRoutingPatternFile = (path: string, repoRoot: string) =>
  (value: RoutingPattern | ReadonlyArray<RoutingPattern>) =>
    Effect.gen(function* () {
      const patterns = Array.isArray(value) ? value : [value]
      for (const pattern of patterns) {
        if (pattern.triggerKind !== pattern.condition.kind) {
          return yield* Effect.fail(
            new RoutingPatternLoadFailed({
              repoPath: repoRoot,
              path,
              message: `Pattern ${pattern.id} has triggerKind ${pattern.triggerKind} but condition kind ${pattern.condition.kind}`,
            }),
          )
        }
        if (
          pattern.condition.kind === "signal-threshold" &&
          pattern.condition.below === undefined &&
          pattern.condition.changeRatioAbove === undefined
        ) {
          return yield* Effect.fail(
            new RoutingPatternLoadFailed({
              repoPath: repoRoot,
              path,
              message: `Pattern ${pattern.id} must declare below or changeRatioAbove`,
            }),
          )
        }
      }
      return value
    })

const toSerializable = (value: unknown): unknown => {
  if (value === null || value === undefined) return value
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (Array.isArray(value)) return value.map(toSerializable)
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [String(key), toSerializable(entry)]),
    )
  }
  if (value instanceof Set) {
    return [...value.values()].map(toSerializable)
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        toSerializable(entry),
      ]),
    )
  }
  return String(value)
}

const errorCodeOf = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  const code = error.code
  return typeof code === "string" ? code : undefined
}
