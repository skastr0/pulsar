export {
  matchesAnyGlob,
} from "@skastr0/pulsar-core"

import { matchesAnyGlob } from "@skastr0/pulsar-core"

export const isExcluded = (path: string, globs: ReadonlyArray<string>): boolean =>
  matchesAnyGlob(path, globs)
