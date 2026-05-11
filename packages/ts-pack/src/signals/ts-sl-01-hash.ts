export const countExactTokens = (source: string): number => {
  let count = 0
  let inToken = false

  for (let index = 0; index < source.length; index++) {
    const charCode = source.charCodeAt(index)
    const isWhitespace =
      charCode === 9 ||
      charCode === 10 ||
      charCode === 11 ||
      charCode === 12 ||
      charCode === 13 ||
      charCode === 32
    if (isWhitespace) {
      inToken = false
      continue
    }

    if (!inToken) {
      count++
      inToken = true
    }
  }

  return count
}

export const hashExactSource = (source: string): string => {
  let hash = 0
  for (let index = 0; index < source.length; index++) {
    const charCode = source.charCodeAt(index)
    if (
      charCode === 9 ||
      charCode === 10 ||
      charCode === 11 ||
      charCode === 12 ||
      charCode === 13 ||
      charCode === 32
    ) {
      continue
    }
    hash = ((hash << 5) - hash) + charCode
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}
