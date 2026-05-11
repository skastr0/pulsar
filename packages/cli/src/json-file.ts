import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Effect } from "effect"

interface WriteJsonFileOptions {
  readonly writeErrorDescription?: string
}

export const writeJsonFile = (
  filePath: string,
  value: unknown,
  opts?: WriteJsonFileOptions,
): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(dirname(filePath), { recursive: true }),
      catch: (cause) => new Error(`Failed to create directory for ${filePath}: ${String(cause)}`),
    })
    yield* Effect.tryPromise({
      try: () => writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"),
      catch: (cause) =>
        new Error(`Failed to write ${opts?.writeErrorDescription ?? filePath}: ${String(cause)}`),
    })
  })
