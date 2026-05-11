import type { ObserverOutput } from "./observer.js"

type PatternMatchPayload = {
  readonly matchDetail: unknown
}

type ContextPayloadSignalRef = {
  readonly signalId: string
  readonly include: "score" | "diagnostics" | "output" | "all"
}

type ContextPayloadPattern = {
  readonly contextPayload: ReadonlyArray<ContextPayloadSignalRef>
}

type ContextPayloadDiff = {
  readonly changedFiles: unknown
  readonly addedImports: unknown
  readonly astMatches: unknown
  readonly signalChanges: unknown
}

type SignalPayloadResult = {
  readonly score: number
  readonly diagnostics: unknown
  readonly output: unknown
}

export const buildContextPayload = (
  pattern: ContextPayloadPattern,
  observerOutput: ObserverOutput,
  diff: ContextPayloadDiff,
  match: PatternMatchPayload,
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
  result: SignalPayloadResult,
  include: ContextPayloadSignalRef["include"],
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
