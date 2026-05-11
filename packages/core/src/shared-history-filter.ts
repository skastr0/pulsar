import { matchesAnyGlob } from "./globs.js"

export interface SharedHistoryFilterConfig {
  readonly includeExtensions: ReadonlyArray<string>
  readonly excludeGlobs: ReadonlyArray<string>
  readonly maxCommits?: number
}

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

export const hasIncludedExtension = (
  path: string,
  includeExtensions: ReadonlyArray<string>,
): boolean => includeExtensions.some((extension) => path.endsWith(extension))

export const isIncludedHistoryPath = (
  path: string,
  config: SharedHistoryFilterConfig,
): boolean =>
  hasIncludedExtension(path, config.includeExtensions) &&
  !matchesAnyGlob(path, config.excludeGlobs)

export const sourcePathspecs = (
  includeExtensions: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  includeExtensions.flatMap((extension) => [
    `:(glob)*${extension}`,
    `:(glob)**/*${extension}`,
  ])
