import type { Diagnostic } from "./diagnostic.js"
import { matchesGlob } from "./globs.js"
import type { ObserverOutput } from "./observer.js"
import type { SignalRunResult } from "./runner.js"
import type {
  Location,
  PatternCondition,
  RoutingDiff,
  RoutingPattern,
  SignalRef,
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

export const buildContextPayload = (
  pattern: RoutingPattern,
  observerOutput: ObserverOutput,
  diff: RoutingDiff,
  match: PatternMatch,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    diff: toSerializable({
      changedFiles: diff.changedFiles,
      addedImports: diff.addedImports,
      astMatches: diff.astMatches,
      signalChanges: diff.signalChanges,
      match: match.matchDetail,
    }),
  }

  for (const signalRef of pattern.contextPayload) {
    const result = observerOutput.signalResults.get(signalRef.signalId)
    if (result === undefined) continue
    payload[signalRef.signalId] = selectSignalPayload(result, signalRef.include)
  }

  return payload
}

const selectSignalPayload = (
  result: SignalRunResult,
  include: SignalRef["include"],
): unknown => {
  switch (include) {
    case "score":
      return { score: result.score }
    case "diagnostics":
      return { diagnostics: toSerializable(result.diagnostics) }
    case "output":
      return { output: toSerializable(result.output) }
    case "all":
    default:
      return {
        score: result.score,
        diagnostics: toSerializable(result.diagnostics),
        output: toSerializable(result.output),
      }
  }
}

const matchesSpecifierPattern = (specifier: string, pattern: string): boolean => {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1)
    return specifier.startsWith(prefix)
  }
  return specifier === pattern
}

const locationsFromDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>,
): ReadonlyArray<Location> =>
  diagnostics.flatMap((diagnostic) =>
    diagnostic.location === undefined ? [] : [diagnostic.location],
  )

export const dedupeLocations = (
  locations: ReadonlyArray<Location>,
): ReadonlyArray<Location> => {
  const seen = new Set<string>()
  const deduped: Array<Location> = []
  for (const location of locations) {
    const key = `${location.file}:${location.line ?? -1}:${location.column ?? -1}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(location)
  }
  return deduped
}

const toSerializable = (value: unknown): unknown => {
  if (value === null || value === undefined) return value
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (Array.isArray(value)) return value.map(toSerializable)
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [String(key), toSerializable(entry)]),
    )
  }
  if (value instanceof Set) {
    return [...value.values()].map(toSerializable)
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        toSerializable(entry),
      ]),
    )
  }
  return String(value)
}
