export const countRetainedLines = (
  introducedLines: ReadonlyArray<string>,
  targetLines: ReadonlyArray<string>,
  threshold: number,
): number => {
  const available = targetLines.map((line) => line.trimEnd())
  const exactIndex = buildExactLineIndex(available)
  const lengthIndex = buildLengthIndex(available)
  const used = new Set<number>()
  let retained = 0

  for (const line of introducedLines) {
    const exactMatch = findExactLine(line, exactIndex, used)
    if (exactMatch !== undefined) {
      used.add(exactMatch)
      retained += 1
      continue
    }

    const normalizedLine = line.trim()
    let bestIndex: number | undefined
    let bestSimilarity = 0

    for (const i of candidateIndexesByLength(normalizedLine, lengthIndex, threshold)) {
      if (used.has(i)) continue
      const candidate = available[i]?.trim() ?? ""
      const similarity = similarityScoreAtThreshold(
        normalizedLine,
        candidate,
        threshold,
      )
      if (similarity === undefined) continue
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestIndex = i
      }
    }

    if (bestIndex !== undefined && bestSimilarity >= threshold) {
      used.add(bestIndex)
      retained += 1
    }
  }

  return retained
}

const buildExactLineIndex = (
  available: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyArray<number>> => {
  const exactIndex = new Map<string, Array<number>>()
  for (let i = 0; i < available.length; i += 1) {
    const line = available[i]
    if (line === undefined) continue
    const indexes = exactIndex.get(line) ?? []
    indexes.push(i)
    exactIndex.set(line, indexes)
  }
  return exactIndex
}

const buildLengthIndex = (
  available: ReadonlyArray<string>,
): ReadonlyMap<number, ReadonlyArray<number>> => {
  const lengthIndex = new Map<number, Array<number>>()
  for (let i = 0; i < available.length; i += 1) {
    const length = available[i]?.trim().length
    if (length === undefined) continue
    const indexes = lengthIndex.get(length) ?? []
    indexes.push(i)
    lengthIndex.set(length, indexes)
  }
  return lengthIndex
}

const candidateIndexesByLength = (
  line: string,
  lengthIndex: ReadonlyMap<number, ReadonlyArray<number>>,
  threshold: number,
): ReadonlyArray<number> => {
  const length = line.length
  const minLength = Math.ceil(length * threshold)
  const maxLength = Math.floor(length / threshold)
  const indexes: Array<number> = []

  for (let candidateLength = minLength; candidateLength <= maxLength; candidateLength += 1) {
    indexes.push(...(lengthIndex.get(candidateLength) ?? []))
  }

  return indexes
}

const findExactLine = (
  line: string,
  exactIndex: ReadonlyMap<string, ReadonlyArray<number>>,
  used: ReadonlySet<number>,
): number | undefined => {
  const indexes = exactIndex.get(line)
  if (indexes === undefined) return undefined

  for (const index of indexes) {
    if (!used.has(index)) return index
  }
  return undefined
}

const similarityScoreAtThreshold = (
  left: string,
  right: string,
  threshold: number,
): number | undefined => {
  if (left === right) return 1
  const maxLength = Math.max(left.length, right.length)
  if (maxLength === 0) return 1
  const maxDistance = Math.floor(maxLength * (1 - threshold))
  const distance = levenshteinAtMost(left, right, maxDistance)
  if (distance === undefined) return undefined
  const score = 1 - distance / maxLength
  return score >= threshold ? score : undefined
}

const levenshteinAtMost = (
  left: string,
  right: string,
  maxDistance: number,
): number | undefined => {
  if (Math.abs(left.length - right.length) > maxDistance) return undefined
  if (left.length === 0) return right.length
  if (right.length === 0) return left.length

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 0; i < left.length; i += 1) {
    const current = [i + 1]
    let rowMinimum = current[0] ?? 0
    for (let j = 0; j < right.length; j += 1) {
      const insert = (current[j] ?? 0) + 1
      const remove = (previous[j + 1] ?? 0) + 1
      const replace = (previous[j] ?? 0) + (left[i] === right[j] ? 0 : 1)
      const value = Math.min(insert, remove, replace)
      current[j + 1] = value
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > maxDistance) return undefined
    previous = current
  }
  const distance = previous[right.length] ?? 0
  return distance <= maxDistance ? distance : undefined
}
