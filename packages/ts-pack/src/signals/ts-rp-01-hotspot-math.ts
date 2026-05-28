export const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
  }
  return sorted[mid] ?? 0
}

export const softGate = (value: number, minimum: number, softness: number): number => {
  if (minimum <= 0) return value > 0 ? 1 : 0
  if (softness <= 0) return value >= minimum ? 1 : 0
  const clampedSoftness = Math.max(0, Math.min(0.99, softness))
  const lower = Math.max(0, minimum * (1 - clampedSoftness))
  const upper = Math.max(lower + Number.EPSILON, minimum * (1 + clampedSoftness))
  if (value <= lower) return 0
  if (value >= upper) return 1
  const t = (value - lower) / (upper - lower)
  return t * t * (3 - 2 * t)
}

export const percentileRank = (
  value: number,
  values: ReadonlyArray<number>,
): number => {
  if (values.length <= 1) return 1
  const sorted = [...values].sort((a, b) => a - b)
  let lastIndex = 0
  for (let index = 0; index < sorted.length; index += 1) {
    if ((sorted[index] ?? 0) <= value) {
      lastIndex = index
    }
  }
  return lastIndex / (sorted.length - 1)
}

export const aboveFloor = (value: number, floor: number): number => {
  const effectiveFloor = Math.max(0, Math.min(0.95, floor))
  if (effectiveFloor >= 1) return 0
  return Math.max(0, Math.min(1, (value - effectiveFloor) / (1 - effectiveFloor)))
}

export const normalizeObservedMagnitude = (
  value: number,
  minimum: number,
  softness: number,
): number => {
  const clampedSoftness = Math.max(0, Math.min(0.99, softness))
  const lower = Math.max(0, minimum * (1 - clampedSoftness))
  const upper = Math.max(lower + 1, minimum * 8)
  if (upper <= lower) return 1
  return Math.max(0, Math.min(1, (value - lower) / (upper - lower)))
}

export const normalizeDiagnosticLimit = (value: number): number =>
  normalizePositiveWhole(value)

const normalizePositiveWhole = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  const integer = Math.floor(value)
  return integer > 0 ? integer : 0
}

export const normalizeNonNegativeFinite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : fallback

export const normalizeFiniteRange = (
  value: number,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (!Number.isFinite(value)) return fallback
  if (value < min) return min
  if (value > max) return max
  return value
}

export const clamp01 = (value: number): number =>
  normalizeFiniteRange(value, 0, 0, 1)

export const compareNumberDesc = (left: number, right: number): number => {
  if (left === right) return 0
  return right > left ? 1 : -1
}

export const compareStringAsc = (left: string, right: string): number => {
  if (left === right) return 0
  return left < right ? -1 : 1
}
