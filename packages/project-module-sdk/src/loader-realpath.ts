import { realpath } from "node:fs/promises"
import { Effect } from "effect"
import { ProjectModuleLoadError } from "./loader-types.js"
import type { ProjectModuleRef } from "./manifest.js"

export const realpathOrProjectModuleLoadError = (
  ref: ProjectModuleRef,
  path: string,
  target: string,
  message: string,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: () => realpath(path),
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message,
        cause,
      }),
  })
