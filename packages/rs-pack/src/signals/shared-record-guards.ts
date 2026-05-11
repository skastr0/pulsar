export type UnknownRecord = Record<string, unknown>

export const asUnknownRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined
