export {
  matchesAnyGlob,
} from "@taste-codec/core"

import { matchesAnyGlob } from "@taste-codec/core"

export const isExcluded = (path: string, globs: ReadonlyArray<string>): boolean =>
  matchesAnyGlob(path, globs)
