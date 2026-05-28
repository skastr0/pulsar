export const topLevelClassMemberText = (body: string): string => {
  let result = ""
  let braceDepth = 0
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char === "{") {
      result += " "
      braceDepth += 1
      continue
    }
    if (char === "}") {
      if (braceDepth > 0) braceDepth -= 1
      result += " "
      continue
    }
    result += braceDepth === 0 ? char : " "
  }
  return result
}

export const matchingBraceIndex = (content: string, openBrace: number): number | undefined => {
  let depth = 0
  for (let index = openBrace; index < content.length; index += 1) {
    const char = content[index]
    if (char === "{") depth += 1
    if (char === "}") {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return undefined
}

export const maskAmbientBlocks = (content: string): string => {
  const result = content.split("")
  const ambientBlockPattern = /\b(?:export\s+)?declare\s+(?:global|module|namespace)\b/gu
  for (const match of content.matchAll(ambientBlockPattern)) {
    const start = match.index ?? 0
    const openBrace = content.indexOf("{", start + match[0].length)
    if (openBrace === -1) continue
    const closeBrace = matchingBraceIndex(content, openBrace)
    const stop = closeBrace === undefined ? content.length : closeBrace + 1
    for (let index = start; index < stop; index += 1) result[index] = " "
  }
  return result.join("")
}

export const maskCommentsAndStrings = (content: string): string => {
  let result = ""
  for (let index = 0; index < content.length;) {
    const char = content[index]
    const next = content[index + 1]
    if (char === "/" && next === "/") {
      const end = content.indexOf("\n", index + 2)
      const stop = end === -1 ? content.length : end
      result += " ".repeat(stop - index)
      index = stop
      continue
    }
    if (char === "/" && next === "*") {
      const end = content.indexOf("*/", index + 2)
      const stop = end === -1 ? content.length : end + 2
      result += " ".repeat(stop - index)
      index = stop
      continue
    }
    if (char === "\"" || char === "'" || char === "`") {
      const stop = quotedLiteralEnd(content, index, char)
      result += " ".repeat(stop - index)
      index = stop
      continue
    }
    if (char === "/" && isRegexLiteralStart(result)) {
      const stop = regexLiteralEnd(content, index)
      if (stop !== undefined) {
        result += " ".repeat(stop - index)
        index = stop
        continue
      }
    }
    result += char
    index += 1
  }
  return result
}

const quotedLiteralEnd = (content: string, start: number, quote: string): number => {
  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index]
    if (char === "\\") {
      index += 1
      continue
    }
    if (char === quote) return index + 1
  }
  return content.length
}

const regexLiteralEnd = (content: string, start: number): number | undefined => {
  let inCharacterClass = false
  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index]
    if (char === "\n" || char === "\r") return undefined
    if (char === "\\") {
      index += 1
      continue
    }
    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (char === "/" && !inCharacterClass) {
      let stop = index + 1
      while (/[A-Za-z]/u.test(content[stop] ?? "")) stop += 1
      return stop
    }
  }
  return undefined
}

const isRegexLiteralStart = (maskedPrefix: string): boolean => {
  const trimmed = maskedPrefix.trimEnd()
  if (trimmed.length === 0) return true
  const previous = trimmed.at(-1)
  if (previous === undefined) return true
  if ("([{=,:;!&|?+-*%^~<>".includes(previous)) return true
  const match = /([A-Za-z_$][\w$]*)$/u.exec(trimmed)
  return match !== null && REGEX_PREFIX_KEYWORDS.has(match[1]!)
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
])
