import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { RoutingPatternLoadFailed } from "./errors.js"
import { RoutingPattern, type RoutingPattern as RoutingPatternType } from "./routing-schema.js"
import apiSurfaceChangePattern from "../routing-patterns/api-surface-change.json" with { type: "json" }
import authPathsTouchedPattern from "../routing-patterns/auth-paths-touched.json" with { type: "json" }
import cryptoImportAddedPattern from "../routing-patterns/crypto-import-added.json" with { type: "json" }
import domainTermDriftPattern from "../routing-patterns/domain-term-drift.json" with { type: "json" }
import migrationAddedPattern from "../routing-patterns/migration-added.json" with { type: "json" }
import unsafeAddedPattern from "../routing-patterns/unsafe-added.json" with { type: "json" }

const SHIPPED_ROUTING_PATTERNS = [
  apiSurfaceChangePattern,
  authPathsTouchedPattern,
  cryptoImportAddedPattern,
  domainTermDriftPattern,
  migrationAddedPattern,
  unsafeAddedPattern,
] as const

const RoutingPatternFile = Schema.Union(RoutingPattern, Schema.Array(RoutingPattern))

export const loadRoutingPatterns = (
  options?: { readonly repoRoot?: string },
): Effect.Effect<ReadonlyArray<RoutingPatternType>, RoutingPatternLoadFailed, never> =>
  Effect.gen(function* () {
    const repoRoot = options?.repoRoot ?? process.cwd()
    const shipped = yield* decodeShippedRoutingPatterns(repoRoot)
    const custom =
      options?.repoRoot === undefined
        ? []
        : yield* loadPatternsFromDirectory({
            repoRoot: options.repoRoot,
            directory: join(options.repoRoot, ".pulsar", "routing-patterns"),
            optional: true,
          })

    return mergePatterns(shipped, custom)
  })

const mergePatterns = (
  shipped: ReadonlyArray<RoutingPatternType>,
  custom: ReadonlyArray<RoutingPatternType>,
): ReadonlyArray<RoutingPatternType> => {
  const merged = new Map<string, RoutingPatternType>()
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

const decodeShippedRoutingPatterns = (repoRoot: string) =>
  Effect.forEach(SHIPPED_ROUTING_PATTERNS, (pattern, index) =>
    Schema.decodeUnknown(RoutingPatternFile)(pattern).pipe(
      Effect.mapError(
        (cause) =>
          new RoutingPatternLoadFailed({
            repoPath: repoRoot,
            path: `shipped-routing-pattern:${index}`,
            message: `Failed to decode shipped routing pattern: ${String(cause)}`,
          }),
      ),
      Effect.flatMap(validateRoutingPatternFile(`shipped-routing-pattern:${index}`, repoRoot)),
      Effect.map((decoded) => (Array.isArray(decoded) ? decoded : [decoded])),
    ),
  ).pipe(Effect.map((groups) => groups.flat()))

const validateRoutingPatternFile = (path: string, repoRoot: string) =>
  (value: RoutingPatternType | ReadonlyArray<RoutingPatternType>) =>
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

const errorCodeOf = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  const code = error.code
  return typeof code === "string" ? code : undefined
}
