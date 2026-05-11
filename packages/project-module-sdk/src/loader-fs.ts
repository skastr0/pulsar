import { mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { ProjectModuleLoadError } from "./loader-types.js"
import type { ProjectModuleRef } from "./manifest.js"

export const mkdirForProjectModuleDirectory = (
  ref: ProjectModuleRef,
  target: string,
  message: string,
): Effect.Effect<void, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: () => mkdir(target, { recursive: true }),
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message,
        cause,
      }),
  })
