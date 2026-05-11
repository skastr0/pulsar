import { dedupeByKey } from "./dedupe-by-key.js"
import { matchesGlob } from "./globs.js"
import type { ObserverOutput } from "./observer.js"
import type {
  Location,
  PatternCondition,
  RoutingDiff,
  RoutingPattern,
} from "./routing-schema.js"

type PatternMatch = {
  readonly sourceLocations: ReadonlyArray<Location>
  readonly matchDetail: unknown
}

export const matchPattern = (
  pattern: RoutingPattern,
  observerOutput: ObserverOutput,
  diff: RoutingDiff,
): PatternMatch | undefined => {
  const condition = pattern.condition

  switch (condition.kind) {
    case "file-path":
      return matchFilePathCondition(condition, diff)
    case "import-added":
      return matchImportAddedCondition(condition, diff)
    case "ast-match":
      return matchAstMatchCondition(condition, diff)
    case "signal-threshold":
      return matchSignalThresholdCondition(condition, observerOutput, diff)
  }
}

type FilePathPatternCondition = Extract<PatternCondition, { readonly kind: "file-path" }>
type ImportAddedPatternCondition = Extract<PatternCondition, { readonly kind: "import-added" }>
type AstMatchPatternCondition = Extract<PatternCondition, { readonly kind: "ast-match" }>
type SignalThresholdPatternCondition = Extract<
  PatternCondition,
  { readonly kind: "signal-threshold" }
>

const matchFilePathCondition = (
  condition: FilePathPatternCondition,
  diff: RoutingDiff,
): PatternMatch | undefined => {
  const matchedFiles = diff.changedFiles.filter((file) =>
    condition.globs.some((glob: string) => matchesGlob(file, glob)),
  )
  if (matchedFiles.length === 0) return undefined
  return {
    sourceLocations: matchedFiles.map((file) => ({ file })),
    matchDetail: { matchedFiles },
  }
}

const matchImportAddedCondition = (
  condition: ImportAddedPatternCondition,
  diff: RoutingDiff,
): PatternMatch | undefined => {
  const matchedImports = diff.addedImports.filter((entry) =>
    condition.specifiers.some((specifier: string) =>
      matchesSpecifierPattern(entry.specifier, specifier),
    ),
  )
  if (matchedImports.length === 0) return undefined
  return {
    sourceLocations: matchedImports.map((entry) => ({
      file: entry.file,
      ...(entry.line !== undefined ? { line: entry.line } : {}),
    })),
    matchDetail: { matchedImports },
  }
}

const matchAstMatchCondition = (
  condition: AstMatchPatternCondition,
  diff: RoutingDiff,
): PatternMatch | undefined => {
  const matchedAstNodes = diff.astMatches.filter(
    (entry) => entry.signalId === condition.signalId && entry.outputKey === condition.outputKey,
  )
  if (matchedAstNodes.length === 0) return undefined
  return {
    sourceLocations: matchedAstNodes.map((entry) => entry.location),
    matchDetail: { matchedAstNodes },
  }
}

const matchSignalThresholdCondition = (
  condition: SignalThresholdPatternCondition,
  observerOutput: ObserverOutput,
  diff: RoutingDiff,
): PatternMatch | undefined => {
  const result = observerOutput.signalResults.get(condition.signalId)
  const signalChange = diff.signalChanges[condition.signalId]
  const scoreMatch =
    condition.below !== undefined && result !== undefined && result.score < condition.below
  const changeMatch =
    condition.changeRatioAbove !== undefined &&
    signalChange?.relativeDelta !== undefined &&
    signalChange.relativeDelta >= condition.changeRatioAbove

  if (!scoreMatch && !changeMatch) return undefined

  return {
    sourceLocations:
      signalChange?.sourceLocations ?? locationsFromDiagnostics(result?.diagnostics ?? []),
    matchDetail: {
      signalId: condition.signalId,
      ...(condition.below !== undefined ? { below: condition.below } : {}),
      ...(result !== undefined ? { currentScore: result.score } : {}),
      ...(signalChange !== undefined ? { signalChange } : {}),
    },
  }
}

const matchesSpecifierPattern = (specifier: string, pattern: string): boolean => {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1)
    return specifier.startsWith(prefix)
  }
  return specifier === pattern
}

type LocatedDiagnostic = {
  readonly location?: Location | undefined
}

const locationsFromDiagnostics = (
  diagnostics: ReadonlyArray<LocatedDiagnostic>,
): ReadonlyArray<Location> =>
  diagnostics.flatMap((diagnostic) =>
    diagnostic.location === undefined ? [] : [diagnostic.location],
  )

export const dedupeLocations = (
  locations: ReadonlyArray<Location>,
): ReadonlyArray<Location> =>
  dedupeByKey(
    locations,
    (location) => `${location.file}:${location.line ?? -1}:${location.column ?? -1}`,
  )
