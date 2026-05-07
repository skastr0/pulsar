import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import { decodeSchemaConventions } from "./conventions.js"
import { ReferenceDataLoadFailed } from "./errors.js"
import { decodeGlossary } from "./glossary.js"

export const CANONICAL_GLOSSARY_RELATIVE_PATH = ".pulsar/glossary.json" as const
export const CANONICAL_CONVENTIONS_RELATIVE_PATH = ".pulsar/conventions.json" as const

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

export const loadCanonicalReferenceDataEntries = (repoRoot: string) =>
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

    return entries as ReadonlyMap<string, unknown>
  })
