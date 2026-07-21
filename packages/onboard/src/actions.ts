import type {
  CalibrationAction,
  CalibrationChoice,
  CatalogEntry,
  CatalogOption,
  JsonValue,
} from "./types.js"

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null) return true
  if (typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== "object") return false
  return Object.values(value as Record<string, unknown>).every(isJsonValue)
}

const parseJsonValue = (raw: string): JsonValue => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`Calibration value must be valid JSON: ${String(cause)}`)
  }
  if (!isJsonValue(parsed)) {
    throw new Error("Calibration value must be finite JSON data")
  }
  return parsed
}

export const actionForOption = (
  entry: CatalogEntry,
  optionIndex: number,
  explicitValue?: string,
): CalibrationAction => {
  const option = entry.options[optionIndex]
  if (option === undefined) {
    throw new Error(`Unknown option ${optionIndex} for catalog signal ${entry.id}`)
  }

  switch (option.calibrationKind) {
    case "keep-default":
      return { kind: "keep-default" }
    case "baseline-accept":
      return { kind: "baseline-accept" }
    case "project-module":
    case "pack-toggle":
      if (entry.packGate === undefined || entry.packGate.length === 0) {
        return {
          kind: "unsupported",
          reason: `${option.calibrationKind} option has no typed packGate`,
        }
      }
      return { kind: "enable-pack", packId: entry.packGate }
    case "conventions":
      return {
        kind: "unsupported",
        reason: "conventions calibration requires a typed conventions action",
      }
    case "vector-config": {
      if (explicitValue === undefined) {
        throw new Error(`Option ${entry.id}[${optionIndex}] requires {"key":...,"value":...}`)
      }
      const parsed = parseJsonValue(explicitValue)
      const record =
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed as { readonly [key: string]: JsonValue }
          : undefined
      if (
        record === undefined ||
        typeof record.key !== "string" ||
        record.key.length === 0 ||
        !("value" in record)
      ) {
        throw new Error(`Option ${entry.id}[${optionIndex}] requires {"key":...,"value":...}`)
      }
      return { kind: "vector-config", key: record.key, value: record.value }
    }
    case "vector-weight": {
      if (explicitValue === undefined) {
        throw new Error(`Option ${entry.id}[${optionIndex}] requires a numeric weight`)
      }
      const value = parseJsonValue(explicitValue)
      if (typeof value !== "number") {
        throw new Error(`Option ${entry.id}[${optionIndex}] requires a numeric weight`)
      }
      return { kind: "vector-weight", value }
    }
    case "vector-active": {
      if (explicitValue === undefined) {
        throw new Error(`Option ${entry.id}[${optionIndex}] requires true or false`)
      }
      const value = parseJsonValue(explicitValue)
      if (typeof value !== "boolean") {
        throw new Error(`Option ${entry.id}[${optionIndex}] requires true or false`)
      }
      return { kind: "vector-active", value }
    }
  }
}

const expectedActionKind = (
  entry: CatalogEntry,
  option: CatalogOption,
): CalibrationAction["kind"] => {
  switch (option.calibrationKind) {
    case "keep-default":
      return "keep-default"
    case "vector-config":
      return "vector-config"
    case "vector-weight":
      return "vector-weight"
    case "vector-active":
      return "vector-active"
    case "baseline-accept":
      return "baseline-accept"
    case "project-module":
    case "pack-toggle":
      return entry.packGate === undefined ? "unsupported" : "enable-pack"
    case "conventions":
      return "unsupported"
  }
}

export const validateChoiceAgainstCatalog = (
  choice: CalibrationChoice,
  catalog: ReadonlyArray<CatalogEntry>,
): CatalogOption => {
  const entry = catalog.find((candidate) => candidate.id === choice.signalId)
  if (entry === undefined) {
    throw new Error(`Unknown exact catalog signal id: ${choice.signalId}`)
  }
  const option = entry.options[choice.optionIndex]
  if (option === undefined) {
    throw new Error(`Unknown option ${choice.optionIndex} for catalog signal ${choice.signalId}`)
  }
  const expected = expectedActionKind(entry, option)
  if (choice.action.kind !== expected) {
    throw new Error(
      `Action ${choice.action.kind} does not match ${choice.signalId}[${choice.optionIndex}] (${option.calibrationKind})`,
    )
  }
  if (choice.action.kind === "enable-pack" && choice.action.packId !== entry.packGate) {
    throw new Error(`Pack ${choice.action.packId} does not match ${choice.signalId} packGate ${entry.packGate}`)
  }
  return option
}
