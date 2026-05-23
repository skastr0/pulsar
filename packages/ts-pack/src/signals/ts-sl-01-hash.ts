import { createHash } from "node:crypto"

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

export const normalizeExactSource = (source: string): string => {
  const normalized: Array<string> = []
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
    normalized.push(source.charAt(index))
  }
  return normalized.join("")
}

export const hashExactSource = (source: string): string =>
  createHash("sha256").update(normalizeExactSource(source)).digest("hex").slice(0, 16)
