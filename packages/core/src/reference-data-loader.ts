import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import { decodeSchemaConventions } from "./conventions.js"
import {
  buildAbsentCoverageFacts,
  buildUnknownCoverageFacts,
  CANONICAL_ISTANBUL_RELATIVE_PATH,
  CANONICAL_LCOV_RELATIVE_PATH,
  COVERAGE_REFERENCE_DATA_KEY,
  parseCoverageCandidate,
} from "./coverage-facts.js"
import { ReferenceDataLoadFailed } from "./errors.js"
import { decodeGlossary } from "./glossary.js"

export const CANONICAL_GLOSSARY_RELATIVE_PATH = ".pulsar/glossary.json" as const
export const CANONICAL_CONVENTIONS_RELATIVE_PATH = ".pulsar/conventions.json" as const
const CANONICAL_COVERAGE_RELATIVE_PATHS = [
  CANONICAL_LCOV_RELATIVE_PATH,
  CANONICAL_ISTANBUL_RELATIVE_PATH,
] as const

const REFERENCE_DATA_SPECS: ReadonlyArray<{
  readonly key: string
  readonly relativePath: string
  readonly decode: (value: unknown) => Effect.Effect<unknown, unknown, never>
}> = [
  {
    key: "glossary",
    relativePath: CANONICAL_GLOSSARY_RELATIVE_PATH,
    decode: decodeGlossary,
  },
  {
    key: "schema-conventions",
    relativePath: CANONICAL_CONVENTIONS_RELATIVE_PATH,
    decode: decodeSchemaConventions,
  },
]

export const loadCanonicalReferenceDataEntries = (
  repoRoot: string,
): Effect.Effect<ReadonlyMap<string, unknown>, ReferenceDataLoadFailed, never> =>
  Effect.gen(function* () {
    const entries = new Map<string, unknown>()

    for (const spec of REFERENCE_DATA_SPECS) {
      const absolutePath = join(repoRoot, spec.relativePath)
      if (!existsSync(absolutePath)) continue

      const raw = yield* Effect.tryPromise({
        try: () => readFile(absolutePath, "utf8"),
        catch: (cause) =>
          new ReferenceDataLoadFailed({
            repoPath: repoRoot,
            path: absolutePath,
            message: `Failed to read reference data: ${String(cause)}`,
          }),
      })

      const parsed = yield* Effect.try({
        try: () => JSON.parse(raw),
        catch: (cause) =>
          new ReferenceDataLoadFailed({
            repoPath: repoRoot,
            path: absolutePath,
            message: `Failed to parse reference data JSON: ${String(cause)}`,
          }),
      })

      const decoded = yield* Effect.mapError(spec.decode(parsed), (cause) =>
        new ReferenceDataLoadFailed({
          repoPath: repoRoot,
          path: absolutePath,
          message: `Failed to decode ${spec.key}: ${String(cause)}`,
        }),
      )

      entries.set(spec.key, decoded)
    }

    entries.set(
      COVERAGE_REFERENCE_DATA_KEY,
      yield* loadCoverageReferenceEntry(repoRoot),
    )

    return entries as ReadonlyMap<string, unknown>
  })

const loadCoverageReferenceEntry = (
  repoRoot: string,
): Effect.Effect<unknown, ReferenceDataLoadFailed, never> =>
  Effect.gen(function* () {
    const checkedPaths = [...CANONICAL_COVERAGE_RELATIVE_PATHS]
    for (const relativePath of checkedPaths) {
      const absolutePath = join(repoRoot, relativePath)
      if (!existsSync(absolutePath)) continue
      const raw = yield* Effect.tryPromise({
        try: () => readFile(absolutePath, "utf8"),
        catch: (cause) =>
          new ReferenceDataLoadFailed({
            repoPath: repoRoot,
            path: absolutePath,
            message: `Failed to read coverage reference data: ${String(cause)}`,
          }),
      })

      return yield* Effect.sync(() => {
        try {
          return parseCoverageCandidate(repoRoot, { relativePath, content: raw }, checkedPaths)
        } catch (cause) {
          return buildUnknownCoverageFacts(
            checkedPaths,
            `Failed to parse coverage reference data: ${String(cause)}`,
            absolutePath,
          )
        }
      })
    }

    return buildAbsentCoverageFacts(checkedPaths)
  })
