export const levenshteinDistance = (left: string, right: string): number => {
  if (left === right) return 0
  if (left.length === 0) return right.length
  if (right.length === 0) return left.length

  const rows = Array.from({ length: left.length + 1 }, (_, index) => index)
  for (let i = 1; i <= right.length; i += 1) {
    let previous = i - 1
    rows[0] = i

    for (let j = 1; j <= left.length; j += 1) {
      const current = rows[j]!
      const cost = left[j - 1] === right[i - 1] ? 0 : 1
      rows[j] = Math.min(rows[j]! + 1, rows[j - 1]! + 1, previous + cost)
      previous = current
    }
  }

  return rows[left.length]!
}
