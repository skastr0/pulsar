export const sortedUniqueFiles = (files: ReadonlyArray<string>): Array<string> =>
  [...new Set(files)].sort((left, right) => left.localeCompare(right))

export const clampWeight = (value: number): number => roundNumber(Math.max(0, Math.min(2, value)))

export const roundNumber = (value: number): number => Number(value.toFixed(2))

export const roundSupport = (value: number | undefined): number =>
  Number((value ?? 0).toFixed(3))

export const formatSigned = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`
