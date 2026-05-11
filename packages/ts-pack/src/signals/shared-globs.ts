export {
  matchesAnyGlob,
} from "@skastr0/pulsar-core/signal"
import { matchesAnyGlob } from "@skastr0/pulsar-core/signal"

export const isExcluded = (path: string, globs: ReadonlyArray<string>): boolean =>
  matchesAnyGlob(path, globs)
