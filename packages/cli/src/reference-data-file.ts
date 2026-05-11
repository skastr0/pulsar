import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"

export const GLOSSARY_DRAFT_RELATIVE_PATH = ".pulsar/glossary.draft.json" as const
export const CONVENTIONS_DRAFT_RELATIVE_PATH = ".pulsar/conventions.draft.json" as const

export const resolveReferenceDataPath = (repoRoot: string, relativePath: string): string =>
  join(repoRoot, relativePath)

const ensureReferenceDataDir = (repoRoot: string): Effect.Effect<void, Error, never> =>
  Effect.tryPromise({
    try: () => mkdir(join(repoRoot, ".pulsar"), { recursive: true }),
    catch: (cause) =>
      new Error(`Failed to create .pulsar directory in ${repoRoot}: ${String(cause)}`),
  })

export const writeReferenceJson = (
  repoRoot: string,
  relativePath: string,
  value: unknown,
): Effect.Effect<string, Error, never> =>
  Effect.gen(function* () {
    yield* ensureReferenceDataDir(repoRoot)
    const absolutePath = resolveReferenceDataPath(repoRoot, relativePath)
    yield* Effect.tryPromise({
      try: () => writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"),
      catch: (cause) =>
        new Error(`Failed to write reference data at ${absolutePath}: ${String(cause)}`),
    })
    return absolutePath
  })

export const readReferenceJson = (
  repoRoot: string,
  relativePath: string,
): Effect.Effect<unknown, Error, never> =>
  Effect.gen(function* () {
    const absolutePath = resolveReferenceDataPath(repoRoot, relativePath)
    const raw = yield* Effect.tryPromise({
      try: () => readFile(absolutePath, "utf8"),
      catch: (cause) =>
        new Error(`Failed to read reference data at ${absolutePath}: ${String(cause)}`),
    })

    return yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: (cause) =>
        new Error(`Failed to parse reference data JSON at ${absolutePath}: ${String(cause)}`),
    })
  })

export const promoteReferenceFile = (
  repoRoot: string,
  draftRelativePath: string,
  canonicalRelativePath: string,
): Effect.Effect<string, Error, never> =>
  Effect.gen(function* () {
    yield* ensureReferenceDataDir(repoRoot)
    const draftPath = resolveReferenceDataPath(repoRoot, draftRelativePath)
    const canonicalPath = resolveReferenceDataPath(repoRoot, canonicalRelativePath)
    yield* Effect.tryPromise({
      try: () => rename(draftPath, canonicalPath),
      catch: (cause) =>
        new Error(
          `Failed to promote reference data from ${draftPath} to ${canonicalPath}: ${String(cause)}`,
        ),
    })
    return canonicalPath
  })

export const removeReferenceFile = (
  repoRoot: string,
  relativePath: string,
): Effect.Effect<void, Error, never> =>
  Effect.tryPromise({
    try: () => rm(resolveReferenceDataPath(repoRoot, relativePath), { force: true }),
    catch: (cause) =>
      new Error(`Failed to remove reference data ${relativePath}: ${String(cause)}`),
  })
