export const TS_KEYWORDS = new Set([
  "abstract", "any", "as", "async", "await", "bigint", "boolean", "break", "case", "catch",
  "class", "const", "constructor", "continue", "debugger", "declare", "default", "delete",
  "do", "else", "enum", "export", "extends", "false", "finally", "for", "from", "function",
  "get", "if", "implements", "import", "in", "infer", "instanceof", "interface", "is",
  "keyof", "let", "module", "namespace", "never", "new", "null", "number", "object",
  "of", "package", "private", "protected", "public", "readonly", "return", "require",
  "set", "static", "string", "super", "switch", "symbol", "this", "throw", "true",
  "try", "type", "typeof", "undefined", "unique", "unknown", "var", "void", "while",
  "with", "yield",
])

export const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const PUNCTUATION_TOKENS = new Set("{}()[],;:.<>+-*/%&|!?=".split(""))
const THREE_CHAR_OPERATORS = new Set(["!==", "===", ">>>", "..."])
const TWO_CHAR_OPERATORS = new Set([
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "**",
  "++",
  "--",
  "&&",
  "||",
  "<<",
  ">>",
])

export const scanStructuralSource = (
  source: string,
  accept: (token: string) => void,
): void => {
  let index = 0
  while (index < source.length) {
    index = scanStructuralToken(source, index, accept)
  }
}

const scanStructuralToken = (
  source: string,
  index: number,
  accept: (token: string) => void,
): number => {
  const char = source[index]!
  const charCode = source.charCodeAt(index)
  if (isWhitespaceCharCode(charCode)) return index + 1
  if (char === "/" && source[index + 1] === "/") return skipLineComment(source, index + 2)
  if (char === "/" && source[index + 1] === "*") return skipBlockComment(source, index + 2)
  if (char === "\"" || char === "'") return acceptQuotedString(source, index, char, accept)
  if (char === "`") return acceptTemplateLiteral(source, index, accept)
  if (isIdentifierStartCharCode(charCode)) return acceptIdentifier(source, index, accept)
  if (isDigitCharCode(charCode)) return acceptNumber(source, index, accept)
  return acceptOperatorOrPunctuation(source, index, char, accept)
}

const acceptQuotedString = (
  source: string,
  index: number,
  quote: "\"" | "'",
  accept: (token: string) => void,
): number => {
  const end = skipQuotedString(source, index, quote)
  accept(source.slice(index, end))
  return end
}

const acceptTemplateLiteral = (
  source: string,
  index: number,
  accept: (token: string) => void,
): number => {
  accept("TMPL")
  return skipTemplateLiteral(source, index + 1)
}

const acceptIdentifier = (
  source: string,
  index: number,
  accept: (token: string) => void,
): number => {
  const end = scanIdentifierEnd(source, index + 1)
  accept(source.slice(index, end))
  return end
}

const acceptNumber = (
  source: string,
  index: number,
  accept: (token: string) => void,
): number => {
  accept("NUM")
  return scanNumberEnd(source, index)
}

const acceptOperatorOrPunctuation = (
  source: string,
  index: number,
  char: string,
  accept: (token: string) => void,
): number => {
  const three = source.slice(index, index + 3)
  if (THREE_CHAR_OPERATORS.has(three)) {
    accept(three)
    return index + 3
  }
  const two = source.slice(index, index + 2)
  if (TWO_CHAR_OPERATORS.has(two)) {
    accept(two)
    return index + 2
  }
  if (PUNCTUATION_TOKENS.has(char)) accept(char)
  return index + 1
}

const isWhitespaceCharCode = (charCode: number): boolean =>
  charCode === 9 ||
  charCode === 10 ||
  charCode === 11 ||
  charCode === 12 ||
  charCode === 13 ||
  charCode === 32

const isIdentifierStartCharCode = (charCode: number): boolean =>
  (charCode >= 65 && charCode <= 90) ||
  (charCode >= 97 && charCode <= 122) ||
  charCode === 36 ||
  charCode === 95

const isIdentifierPartCharCode = (charCode: number): boolean =>
  isIdentifierStartCharCode(charCode) || isDigitCharCode(charCode)

const isDigitCharCode = (charCode: number): boolean =>
  charCode >= 48 && charCode <= 57

const skipLineComment = (source: string, index: number): number => {
  let cursor = index
  while (cursor < source.length && source[cursor] !== "\n") cursor++
  return cursor
}

const skipBlockComment = (source: string, index: number): number => {
  let cursor = index
  while (cursor < source.length) {
    if (source[cursor] === "*" && source[cursor + 1] === "/") return cursor + 2
    cursor++
  }
  return source.length
}

const skipQuotedString = (source: string, index: number, quote: "\"" | "'"): number => {
  let cursor = index + 1
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === "\\") {
      cursor += 2
      continue
    }
    cursor++
    if (char === quote) return cursor
  }
  return source.length
}

const skipTemplateLiteral = (source: string, index: number): number => {
  let cursor = index
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === "\\") {
      cursor += 2
      continue
    }
    cursor++
    if (char === "`") return cursor
  }
  return source.length
}

const scanIdentifierEnd = (source: string, index: number): number => {
  let cursor = index
  while (cursor < source.length && isIdentifierPartCharCode(source.charCodeAt(cursor))) {
    cursor++
  }
  return cursor
}

const scanNumberEnd = (source: string, index: number): number => {
  let cursor = index + 1
  while (cursor < source.length) {
    const charCode = source.charCodeAt(cursor)
    const char = source[cursor]!
    if (isDigitCharCode(charCode) || char === "_") {
      cursor++
      continue
    }
    if (char === "." && source[cursor + 1] !== ".") {
      cursor++
      continue
    }
    if (char === "x" || char === "X" || char === "o" || char === "O" || char === "b" || char === "B") {
      cursor++
      continue
    }
    if ((charCode >= 65 && charCode <= 70) || (charCode >= 97 && charCode <= 102)) {
      cursor++
      continue
    }
    if (
      (char === "+" || char === "-") &&
      (source[cursor - 1] === "e" || source[cursor - 1] === "E")
    ) {
      cursor++
      continue
    }
    return cursor
  }
  return cursor
}
